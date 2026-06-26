/**
 * Time ranges, non-working-time shading, and column lines — pixel geometry the
 * renderer paints behind the event bars. Pure projection over a {@link TimeAxis};
 * no DOM.
 *
 * Three backdrop primitives:
 *   1. {@link TimeRange}s — arbitrary highlighted/shaded spans (today marker,
 *      a deadline band, a selected window). Projected to `{ x, width }` boxes.
 *   2. Non-working-time shading — derived spans for weekends and daily off-hours
 *      from a {@link WorkingTimeCalendar}, clipped to the axis range, then
 *      projected. The core stays calendar-agnostic: consumers may pass their own
 *      calendar; the default covers Sat/Sun weekends + a working-hours window.
 *   3. Column lines — the vertical gridlines at every finest tick boundary
 *      (minor) and coarser band boundary (major), as pixel x positions.
 */

import type { TimeAxis, TimeSpan, TimeMs, TimeTick } from '../contract.js';
import { addUnits, floorToUnit, weekday } from './time-units.js';

/* ═══════════════════════════════════════════════════════════════════════════
   1. TIME RANGES
   ═══════════════════════════════════════════════════════════════════════════ */

/** Kind of range, surfaced as a CSS modifier by the renderer. */
export type TimeRangeKind = 'highlight' | 'shade' | 'marker' | string;

/** A named, styleable span on the time grid (deadline, today, selection, ...). */
export interface TimeRange {
  /** Stable id. */
  id: string;
  /** The span. For a zero-width marker (e.g. "now") set `end === start`. */
  span: TimeSpan;
  /** Kind → CSS modifier key. Default `'highlight'`. */
  kind?: TimeRangeKind;
  /** Optional label the renderer may show. */
  label?: string;
  /** Optional extra CSS modifier. */
  styleKey?: string;
}

/** The projected pixel box of a {@link TimeRange}, ready to paint. */
export interface TimeRangeBox {
  /** The source range. */
  range: TimeRange;
  /** Left px within axis content. */
  x: number;
  /** Width px (0 for a marker). */
  width: number;
  /** True when this is a zero-duration marker line rather than a band. */
  marker: boolean;
}

/**
 * Project a set of time ranges to pixel boxes against the axis. Ranges fully
 * outside the axis range are dropped; partial ranges are clipped. Markers
 * (`end === start`) keep `width: 0` and `marker: true`.
 */
export function projectTimeRanges(ranges: ReadonlyArray<TimeRange>, axis: TimeAxis): TimeRangeBox[] {
  const { start: rangeStart, end: rangeEnd } = axis.range;
  const out: TimeRangeBox[] = [];
  for (const range of ranges) {
    const isMarker = range.span.end <= range.span.start;
    if (isMarker) {
      const at = range.span.start;
      if (at < rangeStart || at > rangeEnd) continue;
      out.push({ range, x: axis.toX(at), width: 0, marker: true });
      continue;
    }
    // Clip to the visible axis range.
    const start = Math.max(range.span.start, rangeStart);
    const end = Math.min(range.span.end, rangeEnd);
    if (end <= start) continue;
    const box = axis.spanToBox({ start, end });
    out.push({ range, x: box.x, width: box.width, marker: false });
  }
  return out;
}

/* ═══════════════════════════════════════════════════════════════════════════
   2. NON-WORKING-TIME SHADING
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * A minimal working-time calendar the core understands. Consumers (e.g. Gantt's
 * scheduling engine) may supply a richer one; this core only needs to know which
 * weekdays are off and the working-hours window within a working day.
 */
export interface WorkingTimeCalendar {
  /** UTC weekdays that are entirely non-working. Default `[0, 6]` (Sun, Sat). */
  weekendDays?: number[];
  /** Start of the working day, hours past midnight UTC (inclusive). Default 9. */
  dayStartHour?: number;
  /** End of the working day, hours past midnight UTC (exclusive). Default 17. */
  dayEndHour?: number;
  /** Explicit non-working spans (holidays, blackout windows). */
  holidays?: ReadonlyArray<TimeSpan>;
}

const DEFAULT_CALENDAR: Required<Omit<WorkingTimeCalendar, 'holidays'>> & {
  holidays: ReadonlyArray<TimeSpan>;
} = {
  weekendDays: [0, 6],
  dayStartHour: 9,
  dayEndHour: 17,
  holidays: [],
};

const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;

/**
 * Derive non-working-time spans across the axis range from a calendar:
 *   - whole weekend days,
 *   - the off-hours of each working day (`[00:00, dayStart)` and
 *     `[dayEnd, 24:00)`),
 *   - any explicit holiday spans.
 *
 * Spans are clipped to the axis range and merged where adjacent/overlapping, so
 * the renderer paints one shaded band per contiguous non-working stretch.
 *
 * `granularity` is a hint: when the axis is zoomed out to day-or-coarser ticks,
 * intra-day off-hours add noise, so pass `'day'` to emit only whole non-working
 * days (weekends + holidays) and skip the daily off-hours bands.
 */
export function computeNonWorkingSpans(
  axis: TimeAxis,
  calendar: WorkingTimeCalendar = {},
  granularity: 'hour' | 'day' = 'hour',
): TimeSpan[] {
  const cal = { ...DEFAULT_CALENDAR, ...calendar };
  const weekend = new Set(cal.weekendDays);
  const { start: rangeStart, end: rangeEnd } = axis.range;
  const raw: TimeSpan[] = [];

  // Walk day by day from the day containing rangeStart.
  let day = floorToUnit(rangeStart, 'day');
  let guard = 0;
  while (day < rangeEnd) {
    const nextDay = addUnits(day, 'day', 1);
    if (weekend.has(weekday(day))) {
      // Whole weekend day is non-working.
      raw.push({ start: day, end: nextDay });
    } else if (granularity === 'hour') {
      // Working day: shade the off-hours before start and after end.
      const workStart = day + cal.dayStartHour * MS_PER_HOUR;
      const workEnd = day + cal.dayEndHour * MS_PER_HOUR;
      if (workStart > day) raw.push({ start: day, end: workStart });
      if (workEnd < nextDay && workEnd <= day + MS_PER_DAY) {
        raw.push({ start: workEnd, end: nextDay });
      }
    }
    day = nextDay;
    if (++guard > 200_000) break; // ~500yr safety valve
  }

  // Holidays.
  for (const h of cal.holidays) raw.push({ start: h.start, end: h.end });

  // Clip to axis range and merge.
  return mergeSpans(clipSpans(raw, rangeStart, rangeEnd));
}

/** Project non-working spans to pixel boxes (clipped to the axis range). */
export function projectNonWorkingSpans(
  spans: ReadonlyArray<TimeSpan>,
  axis: TimeAxis,
): Array<{ span: TimeSpan; x: number; width: number }> {
  const out: Array<{ span: TimeSpan; x: number; width: number }> = [];
  for (const span of spans) {
    const box = axis.spanToBox(span);
    if (box.width <= 0) continue;
    out.push({ span, x: box.x, width: box.width });
  }
  return out;
}

/** Clip spans to `[lo, hi)`, dropping empties. */
function clipSpans(spans: ReadonlyArray<TimeSpan>, lo: TimeMs, hi: TimeMs): TimeSpan[] {
  const out: TimeSpan[] = [];
  for (const s of spans) {
    const start = Math.max(s.start, lo);
    const end = Math.min(s.end, hi);
    if (end > start) out.push({ start, end });
  }
  return out;
}

/** Merge overlapping/adjacent spans into a minimal sorted set. */
export function mergeSpans(spans: ReadonlyArray<TimeSpan>): TimeSpan[] {
  if (spans.length === 0) return [];
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  const out: TimeSpan[] = [{ ...sorted[0]! }];
  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i]!;
    const last = out[out.length - 1]!;
    if (cur.start <= last.end) {
      last.end = Math.max(last.end, cur.end);
    } else {
      out.push({ ...cur });
    }
  }
  return out;
}

/* ═══════════════════════════════════════════════════════════════════════════
   3. COLUMN LINES (vertical gridlines)
   ═══════════════════════════════════════════════════════════════════════════ */

/** A vertical gridline at a tick boundary. */
export interface ColumnLine {
  /** Left pixel offset within axis content. */
  x: number;
  /** The boundary time. */
  time: TimeMs;
  /** True at a coarser band boundary (drawn heavier). */
  major: boolean;
}

/**
 * The vertical column lines for a pixel window — one per finest tick boundary,
 * flagged `major` where it coincides with a coarser header band boundary. Built
 * directly from the axis's ticks so lines align pixel-perfectly with the time
 * grid the renderer paints.
 */
export function computeColumnLines(axis: TimeAxis, xStart: number, xEnd: number): ColumnLine[] {
  const ticks: TimeTick[] = axis.ticksInRange(xStart, xEnd);
  const out: ColumnLine[] = [];
  for (const tick of ticks) {
    out.push({ x: tick.x, time: tick.span.start, major: tick.major });
  }
  return out;
}
