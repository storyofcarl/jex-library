/**
 * `calendar-bridge` — projects a Gantt `CalendarModel` (rich: per-weekday working
 * intervals, dated exceptions/holidays, hoursPerDay) onto the lighter
 * `WorkingTimeCalendar` shape `@jects/timeline-core` consumes for non-working-time
 * *shading*.
 *
 * Why this exists: the scheduling engine places bars using the real
 * `CalendarModel(s)`, but `computeNonWorkingSpans` only understands
 * `weekendDays` + a single `[dayStartHour, dayEndHour)` window + explicit
 * `holidays`. Without this projection the timeline backdrop falls back to a
 * generic Sat/Sun, 09:00–17:00 default that does NOT match the scheduled bars
 * (a Mon–Sat project would show a misleading Saturday shade; custom weeks and
 * holidays would never be shaded). Mapping the engine's resolved calendar here
 * keeps the shaded background and the scheduled bars in agreement.
 *
 * Pure logic (no DOM); UTC wall-clock, matching the calendar engine's convention.
 */

import type { TimeSpan } from '@jects/timeline-core';
import type { WorkingTimeCalendar } from '@jects/timeline-core';
import type { CalendarModel, WeekdayRule, WorkingInterval } from '../contract.js';

const MINUTES_PER_HOUR = 60;

/** Pick the widest contiguous working window across all working weekdays. */
function workingWindow(week: ReadonlyArray<WeekdayRule>): {
  startHour: number;
  endHour: number;
} | null {
  let minFrom = Infinity;
  let maxTo = -Infinity;
  for (const rule of week) {
    for (const iv of rule.intervals) {
      if (iv.to <= iv.from) continue;
      if (iv.from < minFrom) minFrom = iv.from;
      if (iv.to > maxTo) maxTo = iv.to;
    }
  }
  if (minFrom === Infinity || maxTo === -Infinity) return null;
  return { startHour: minFrom / MINUTES_PER_HOUR, endHour: maxTo / MINUTES_PER_HOUR };
}

/** Does a weekday rule describe any working time at all? */
function isWorkingDay(rule: WeekdayRule): boolean {
  return rule.intervals.some((iv: WorkingInterval) => iv.to > iv.from);
}

/**
 * Map a resolved Gantt `CalendarModel` to the timeline-core `WorkingTimeCalendar`
 * the backdrop shader understands:
 *   - weekday rules with no working interval → `weekendDays`,
 *   - the union working window → `[dayStartHour, dayEndHour)`,
 *   - exceptions with no working interval → `holidays`.
 *
 * When the calendar has no usable week pattern (e.g. the default-engine's empty
 * `{ week: [] }`), returns `null` so the caller can fall back to the
 * timeline-core default (Sat/Sun, 09:00–17:00) rather than shading *every* day.
 */
export function toWorkingTimeCalendar(
  calendar: CalendarModel | undefined,
): WorkingTimeCalendar | null {
  if (!calendar || calendar.week.length === 0) return null;

  // Weekdays explicitly present in the week pattern with no working interval are
  // non-working. Weekdays *absent* from the pattern are also non-working (per the
  // contract: "missing weekdays = non-working"), but we only have signal for the
  // ones present; treat any 0..6 weekday not listed as working as a weekend day.
  const working = new Set<number>();
  for (const rule of calendar.week) {
    if (isWorkingDay(rule)) working.add(((rule.weekday % 7) + 7) % 7);
  }
  const weekendDays: number[] = [];
  for (let d = 0; d < 7; d++) if (!working.has(d)) weekendDays.push(d);

  const win = workingWindow(calendar.week);

  const holidays: TimeSpan[] = [];
  for (const ex of calendar.exceptions ?? []) {
    const hasWork = ex.intervals.some((iv) => iv.to > iv.from);
    if (!hasWork) holidays.push({ start: ex.span.start, end: ex.span.end });
  }

  const out: WorkingTimeCalendar = { weekendDays };
  if (win) {
    out.dayStartHour = win.startHour;
    out.dayEndHour = win.endHour;
  }
  if (holidays.length) out.holidays = holidays;
  return out;
}
