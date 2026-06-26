/**
 * availability-rules — weekly recurring working hours, specific-date overrides and
 * blackout/holiday dates, optionally scoped per resource. Resolves to the set of
 * available time-of-day ranges for a given calendar day, which the slot engine
 * then divides into slots. Dependency-free, timezone-naive (operates on local
 * `YYYY-MM-DD` day strings and `HH:MM` minute-of-day windows) and unit-tested.
 */

import { parseHM, formatHM, type WorkingHours } from './slots.js';

/** 0 = Sunday … 6 = Saturday (matches `Date.prototype.getDay`). */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** A half-open time-of-day window, e.g. `{ start: '09:00', end: '12:00' }`. */
export interface TimeRange {
  start: string;
  end: string;
}

/** A specific calendar day whose availability replaces the weekly pattern. */
export interface DateOverride {
  /** `YYYY-MM-DD`. */
  date: string;
  /** Ranges available that day (empty array ⇒ closed). */
  ranges: TimeRange[];
}

/** A blackout/holiday entry — a single day or an inclusive day span. */
export interface BlackoutDate {
  /** `YYYY-MM-DD` (inclusive start). */
  date: string;
  /** Optional `YYYY-MM-DD` inclusive end for a multi-day blackout. */
  endDate?: string;
  /** Optional human-readable reason (holiday name, vacation, …). */
  reason?: string;
}

/** A weekly availability pattern plus date-specific exceptions. */
export interface AvailabilitySchedule {
  /** Per-weekday recurring ranges. Missing weekday ⇒ closed that weekday. */
  weekly?: Partial<Record<Weekday, TimeRange[]>>;
  /** Specific-date overrides (win over `weekly`). */
  overrides?: DateOverride[];
  /** Blackout days/spans (win over everything ⇒ closed). */
  blackouts?: Array<string | BlackoutDate>;
}

/**
 * The full availability ruleset. A base schedule plus optional per-resource
 * schedules that fully replace the base for that resource when present.
 */
export interface AvailabilityRules extends AvailabilitySchedule {
  /** Per-resource schedules, keyed by resource id. */
  perResource?: Record<string, AvailabilitySchedule>;
}

/** Local-day weekday for a `YYYY-MM-DD` string (timezone-naive). */
export function weekdayOf(date: string): Weekday {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  if (!m) return 0;
  // Construct in local time at noon to dodge DST edges.
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0);
  return d.getDay() as Weekday;
}

/** Is `date` (YYYY-MM-DD) inside `[start, end]` inclusive (string compare safe for ISO). */
function withinSpan(date: string, start: string, end?: string): boolean {
  if (!end) return date === start;
  const lo = start <= end ? start : end;
  const hi = start <= end ? end : start;
  return date >= lo && date <= hi;
}

/** True when `date` falls on any blackout entry. */
export function isBlackout(blackouts: Array<string | BlackoutDate> | undefined, date: string): boolean {
  if (!blackouts) return false;
  for (const b of blackouts) {
    if (typeof b === 'string') {
      if (b === date) return true;
    } else if (withinSpan(date, b.date, b.endDate)) {
      return true;
    }
  }
  return false;
}

/** Validate, drop-malformed, sort and merge overlapping/adjacent ranges. */
export function normalizeRanges(ranges: TimeRange[]): TimeRange[] {
  const parsed = ranges
    .map((r) => {
      const s = parseHM(r.start);
      const e = parseHM(r.end);
      if (s == null || e == null || e <= s) return null;
      return [s, e] as const;
    })
    .filter((r): r is readonly [number, number] => r != null)
    .sort((a, b) => a[0] - b[0]);

  const merged: Array<[number, number]> = [];
  for (const [s, e] of parsed) {
    const last = merged[merged.length - 1];
    if (last && s <= last[1]) {
      if (e > last[1]) last[1] = e; // extend; adjacent (s === last[1]) also merges
    } else {
      merged.push([s, e]);
    }
  }
  return merged.map(([s, e]) => ({ start: formatHM(s), end: formatHM(e) }));
}

/** Pick the schedule for a resource (its own when defined, else the base). */
function scheduleFor(rules: AvailabilityRules, resourceId?: string): AvailabilitySchedule {
  if (resourceId && rules.perResource && rules.perResource[resourceId]) {
    return rules.perResource[resourceId];
  }
  return rules;
}

/**
 * Resolve the ordered, normalized list of available time-of-day ranges for one
 * day. Precedence: blackout (⇒ none) ▸ date override ▸ weekly pattern.
 */
export function resolveAvailableRanges(
  rules: AvailabilityRules,
  date: string,
  resourceId?: string,
): TimeRange[] {
  const schedule = scheduleFor(rules, resourceId);

  if (isBlackout(schedule.blackouts, date)) return [];

  const override = schedule.overrides?.find((o) => o.date === date);
  if (override) return normalizeRanges(override.ranges);

  const weekly = schedule.weekly?.[weekdayOf(date)];
  if (weekly && weekly.length > 0) return normalizeRanges(weekly);

  return [];
}

/**
 * Build an `AvailabilityRules` from a simple `WorkingHours` window applied to a
 * set of open weekdays (default Mon–Fri). Bridges the legacy `workingHours`
 * config onto the richer rules engine so both paths share one resolver.
 */
export function rulesFromWorkingHours(
  hours: WorkingHours,
  openDays: Weekday[] = [1, 2, 3, 4, 5],
): AvailabilityRules {
  const weekly: Partial<Record<Weekday, TimeRange[]>> = {};
  for (const d of openDays) weekly[d] = [{ start: hours.start, end: hours.end }];
  return { weekly };
}
