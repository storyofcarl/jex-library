/**
 * @jects/gantt — working-time calendar arithmetic.
 *
 * Pure logic (no DOM). Builds a `WorkingTimeCalculator` from a `CalendarModel`,
 * resolving the parent-chain cascade of weekday rules and dated exceptions, and
 * implementing the working-time ⇄ wall-clock conversions the scheduler needs:
 *
 *   - {@link WorkingTimeCalculator.isWorkingTime}
 *   - {@link WorkingTimeCalculator.addWorkingTime} (skips non-working time)
 *   - {@link WorkingTimeCalculator.workingDurationBetween}
 *   - {@link WorkingTimeCalculator.ceilToWorkingTime} / `floorToWorkingTime`
 *
 * All times are epoch milliseconds (UTC). Intervals are expressed in
 * minutes-from-midnight; this implementation evaluates them against UTC wall
 * clock (timezone offset handling is intentionally out of scope for the headless
 * math — the project tz is assumed UTC, matching the contract's "epoch ms (UTC)"
 * convention). The arithmetic is exact at minute granularity.
 */

import type {
  CalendarModel,
  CalendarException,
  WeekdayRule,
  WorkingInterval,
  WorkingTimeCalculator,
} from '../contract.js';
import type { TimeMs, DurationMs, TimeSpan } from '@jects/timeline-core';

const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 86_400_000;

/** A normalized, non-overlapping, sorted set of working intervals for a day. */
type DayIntervals = ReadonlyArray<WorkingInterval>;

/** Floor an epoch-ms instant to UTC midnight of its day. */
function dayStart(time: TimeMs): TimeMs {
  return Math.floor(time / MS_PER_DAY) * MS_PER_DAY;
}

/** UTC weekday (0 = Sunday … 6 = Saturday) of a day-start instant. */
function weekdayOf(dayStartMs: TimeMs): number {
  // 1970-01-01 (epoch 0) was a Thursday (weekday 4).
  const days = Math.floor(dayStartMs / MS_PER_DAY);
  return (((days + 4) % 7) + 7) % 7;
}

/**
 * Normalize a list of intervals: clamp to `[0, 1440)`, drop empties, sort by
 * `from`, and merge any overlapping/adjacent ranges. Stable & defensive so
 * callers can hand us raw config.
 */
function normalizeIntervals(intervals: ReadonlyArray<WorkingInterval>): WorkingInterval[] {
  const cleaned = intervals
    .map((iv) => ({ from: Math.max(0, Math.min(1440, iv.from)), to: Math.max(0, Math.min(1440, iv.to)) }))
    .filter((iv) => iv.to > iv.from)
    .sort((a, b) => a.from - b.from);
  const merged: WorkingInterval[] = [];
  for (const iv of cleaned) {
    const last = merged[merged.length - 1];
    if (last && iv.from <= last.to) {
      last.to = Math.max(last.to, iv.to);
    } else {
      merged.push({ from: iv.from, to: iv.to });
    }
  }
  return merged;
}

/** True iff two half-open day-spans overlap. */
function spanOverlapsDay(span: TimeSpan, ds: TimeMs): boolean {
  return span.start < ds + MS_PER_DAY && span.end > ds;
}

/**
 * Resolve the effective `CalendarModel` for an id by flattening its parent
 * chain: a child's weekday rules and exceptions override the parent's, weekday
 * by weekday. Cycles are broken defensively.
 */
export function resolveCalendar(
  calendarId: string,
  calendars: ReadonlyMap<string, CalendarModel>,
): CalendarModel {
  const chain: CalendarModel[] = [];
  const seen = new Set<string>();
  let cur: CalendarModel | undefined = calendars.get(calendarId);
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    chain.push(cur);
    cur = cur.parentId ? calendars.get(cur.parentId) : undefined;
  }
  // chain is child → … → root. Apply root first, child last (child wins).
  const weekByDay = new Map<number, WeekdayRule>();
  const exceptions: CalendarException[] = [];
  let hoursPerDay: number | undefined;
  let name: string | undefined;
  let timezone: string | undefined;
  for (let i = chain.length - 1; i >= 0; i--) {
    const cal = chain[i];
    if (!cal) continue;
    for (const rule of cal.week) weekByDay.set(rule.weekday, rule);
    if (cal.exceptions) exceptions.push(...cal.exceptions);
    if (cal.hoursPerDay != null) hoursPerDay = cal.hoursPerDay;
    if (cal.name != null) name = cal.name;
    if (cal.timezone != null) timezone = cal.timezone;
  }
  const resolved: CalendarModel = {
    id: calendarId,
    week: [...weekByDay.values()].sort((a, b) => a.weekday - b.weekday),
    exceptions,
    hoursPerDay: hoursPerDay ?? 8,
  };
  if (name !== undefined) resolved.name = name;
  if (timezone !== undefined) resolved.timezone = timezone;
  return resolved;
}

/**
 * A concrete working-time calculator. Construct via {@link buildCalculator}.
 *
 * The implementation walks day-by-day. For any given day it computes that day's
 * effective working intervals (latest exception that overlaps the day wins,
 * otherwise the weekday rule), then performs minute-accurate arithmetic within
 * the day. To stay robust against pathologically sparse calendars (e.g. one
 * working hour per month), forward/backward scans are bounded and a calendar
 * with no working time at all is detected up front.
 */
class CalendarCalculator implements WorkingTimeCalculator {
  readonly calendar: CalendarModel;
  /** Cache of resolved day intervals, keyed by day-start ms. */
  private readonly dayCache = new Map<TimeMs, DayIntervals>();
  /** Whether the weekly pattern has any working time at all. */
  private readonly weekHasWork: boolean;
  /** Max days a single scan will advance before giving up (≈ 30 years). */
  private static readonly MAX_SCAN_DAYS = 366 * 30;

  constructor(calendar: CalendarModel) {
    this.calendar = calendar;
    this.weekHasWork = calendar.week.some((r) => normalizeIntervals(r.intervals).length > 0);
  }

  /** Does this calendar define any working time at all (weekly or exception)? */
  hasAnyWorkingTime(): boolean {
    if (this.weekHasWork) return true;
    return (this.calendar.exceptions ?? []).some((ex) => normalizeIntervals(ex.intervals).length > 0);
  }

  /** Effective normalized intervals for the day containing `time`. */
  private intervalsForDay(ds: TimeMs): DayIntervals {
    const cached = this.dayCache.get(ds);
    if (cached) return cached;
    let intervals: WorkingInterval[] | undefined;
    // Latest matching exception wins (exceptions later in the array override).
    const exceptions = this.calendar.exceptions ?? [];
    for (const ex of exceptions) {
      if (spanOverlapsDay(ex.span, ds)) intervals = normalizeIntervals(ex.intervals);
    }
    if (intervals === undefined) {
      const wd = weekdayOf(ds);
      const rule = this.calendar.week.find((r) => r.weekday === wd);
      intervals = rule ? normalizeIntervals(rule.intervals) : [];
    }
    this.dayCache.set(ds, intervals);
    return intervals;
  }

  /** Minute-of-day [0,1440) for an instant. */
  private static minuteOfDay(time: TimeMs): number {
    return (time - dayStart(time)) / MS_PER_MINUTE;
  }

  isWorkingTime(time: TimeMs): boolean {
    const ds = dayStart(time);
    const minute = CalendarCalculator.minuteOfDay(time);
    for (const iv of this.intervalsForDay(ds)) {
      if (minute >= iv.from && minute < iv.to) return true;
    }
    return false;
  }

  ceilToWorkingTime(time: TimeMs): TimeMs {
    if (!this.hasAnyWorkingTime()) return time;
    let ds = dayStart(time);
    for (let i = 0; i < CalendarCalculator.MAX_SCAN_DAYS; i++) {
      const intervals = this.intervalsForDay(ds);
      if (intervals.length > 0) {
        const minute = ds === dayStart(time) ? CalendarCalculator.minuteOfDay(time) : 0;
        for (const iv of intervals) {
          if (minute < iv.to) {
            // If we're inside or before this interval, snap forward to max(minute, from).
            const m = Math.max(minute, iv.from);
            return ds + m * MS_PER_MINUTE;
          }
        }
      }
      ds += MS_PER_DAY;
    }
    return time;
  }

  floorToWorkingTime(time: TimeMs): TimeMs {
    if (!this.hasAnyWorkingTime()) return time;
    let ds = dayStart(time);
    for (let i = 0; i < CalendarCalculator.MAX_SCAN_DAYS; i++) {
      const intervals = this.intervalsForDay(ds);
      if (intervals.length > 0) {
        const isToday = ds === dayStart(time);
        const minute = isToday ? CalendarCalculator.minuteOfDay(time) : 1440;
        // Walk intervals from the back to find the latest end ≤ minute.
        for (let j = intervals.length - 1; j >= 0; j--) {
          const iv = intervals[j]!;
          if (iv.from < minute) {
            // The previous working instant is min(minute, to). If minute is
            // strictly inside [from,to) we are already at a working instant.
            const m = Math.min(minute, iv.to);
            // floor is the previous working *instant*; the instant at exactly
            // iv.to is non-working (half-open), so step back to to only when
            // minute is past it. When minute < to we're inside → return time.
            if (minute > iv.from && minute <= iv.to) return time;
            return ds + m * MS_PER_MINUTE;
          }
        }
      }
      ds -= MS_PER_DAY;
    }
    return time;
  }

  addWorkingTime(time: TimeMs, duration: DurationMs): TimeMs {
    if (duration === 0) return time;
    if (!this.hasAnyWorkingTime()) return time + duration;
    if (duration < 0) return this.subtractWorkingTime(time, -duration);

    let remaining = duration;
    let cursor = this.ceilToWorkingTime(time);
    let ds = dayStart(cursor);
    let guard = 0;
    while (remaining > 0) {
      if (guard++ > CalendarCalculator.MAX_SCAN_DAYS) return cursor;
      const intervals = this.intervalsForDay(ds);
      const minute = ds === dayStart(cursor) ? CalendarCalculator.minuteOfDay(cursor) : 0;
      for (const iv of intervals) {
        const ivStart = Math.max(minute, iv.from);
        if (ivStart >= iv.to) continue;
        const available = (iv.to - ivStart) * MS_PER_MINUTE;
        if (remaining <= available) {
          return ds + ivStart * MS_PER_MINUTE + remaining;
        }
        remaining -= available;
      }
      ds += MS_PER_DAY;
      cursor = ds;
    }
    return cursor;
  }

  /** Move `time` backward by a positive working duration. */
  private subtractWorkingTime(time: TimeMs, duration: DurationMs): TimeMs {
    let remaining = duration;
    let cursor = this.floorToWorkingTime(time);
    let ds = dayStart(cursor);
    let guard = 0;
    while (remaining > 0) {
      if (guard++ > CalendarCalculator.MAX_SCAN_DAYS) return cursor;
      const intervals = this.intervalsForDay(ds);
      const isToday = ds === dayStart(cursor);
      const upper = isToday ? CalendarCalculator.minuteOfDay(cursor) : 1440;
      for (let j = intervals.length - 1; j >= 0; j--) {
        const iv = intervals[j]!;
        const ivEnd = Math.min(upper, iv.to);
        if (ivEnd <= iv.from) continue;
        const available = (ivEnd - iv.from) * MS_PER_MINUTE;
        if (remaining <= available) {
          return ds + ivEnd * MS_PER_MINUTE - remaining;
        }
        remaining -= available;
      }
      ds -= MS_PER_DAY;
      cursor = ds + MS_PER_DAY; // start scanning previous day from its end
    }
    return cursor;
  }

  workingDurationBetween(start: TimeMs, end: TimeMs): DurationMs {
    if (end <= start) return 0;
    if (!this.hasAnyWorkingTime()) return 0;
    let total = 0;
    let ds = dayStart(start);
    const lastDs = dayStart(end);
    let guard = 0;
    while (ds <= lastDs) {
      if (guard++ > CalendarCalculator.MAX_SCAN_DAYS) break;
      const intervals = this.intervalsForDay(ds);
      const lowerMin = ds === dayStart(start) ? CalendarCalculator.minuteOfDay(start) : 0;
      const upperMin = ds === lastDs ? CalendarCalculator.minuteOfDay(end) : 1440;
      for (const iv of intervals) {
        const a = Math.max(lowerMin, iv.from);
        const b = Math.min(upperMin, iv.to);
        if (b > a) total += (b - a) * MS_PER_MINUTE;
      }
      ds += MS_PER_DAY;
    }
    return total;
  }
}

/** Build a `WorkingTimeCalculator` from an already-resolved calendar. */
export function buildCalculator(calendar: CalendarModel): CalendarCalculator {
  return new CalendarCalculator(calendar);
}

/**
 * Resolve a calendar id against a calendar map (parent cascade) and build its
 * calculator. Used by the engine to lazily materialize per-task calculators.
 */
export function calculatorFor(
  calendarId: string,
  calendars: ReadonlyMap<string, CalendarModel>,
): CalendarCalculator {
  return buildCalculator(resolveCalendar(calendarId, calendars));
}

export type { CalendarCalculator };
