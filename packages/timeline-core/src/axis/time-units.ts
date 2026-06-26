/**
 * Calendar arithmetic for the time axis — pure, DOM-free, UTC throughout.
 *
 * Time is epoch milliseconds (UTC) per the timeline contract. These helpers
 * floor a time to a unit boundary and advance by a whole number of units,
 * honouring real calendar lengths (variable month/quarter/year lengths, leap
 * years) rather than fixed millisecond approximations. The axis uses them both
 * to lay out unevenly-sized header cells (e.g. month columns of 28–31 days) and
 * to generate ticks.
 *
 * All operations use the UTC getters/setters on `Date` so results are stable
 * regardless of the host machine's local timezone — the core stays
 * calendar-agnostic and tz-agnostic.
 */

import type { TimeMs, TimeUnit } from '../contract.js';

/** Milliseconds in fixed-length sub-day units (exact). */
const MS = {
  millisecond: 1,
  second: 1_000,
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
  week: 604_800_000,
} as const;

/**
 * Whether a unit has a constant millisecond length (so pixel geometry can use a
 * fixed `pxPerUnit` directly) or is calendar-variable (month/quarter/year).
 */
export function isFixedUnit(unit: TimeUnit): boolean {
  return unit !== 'month' && unit !== 'quarter' && unit !== 'year';
}

/** Exact millisecond length of a fixed-length unit. Throws for variable units. */
export function fixedUnitMs(unit: TimeUnit): number {
  if (!isFixedUnit(unit)) {
    throw new RangeError(`fixedUnitMs: '${unit}' is calendar-variable; use addUnits/unitSpanMs`);
  }
  return MS[unit as keyof typeof MS];
}

/**
 * Floor a time down to the start of the `unit` boundary it falls in (UTC).
 * Weeks are floored to the most recent Monday (ISO week start).
 */
export function floorToUnit(time: TimeMs, unit: TimeUnit): TimeMs {
  const d = new Date(time);
  switch (unit) {
    case 'millisecond':
      return time;
    case 'second':
      d.setUTCMilliseconds(0);
      return d.getTime();
    case 'minute':
      d.setUTCSeconds(0, 0);
      return d.getTime();
    case 'hour':
      d.setUTCMinutes(0, 0, 0);
      return d.getTime();
    case 'day':
      d.setUTCHours(0, 0, 0, 0);
      return d.getTime();
    case 'week': {
      d.setUTCHours(0, 0, 0, 0);
      // getUTCDay: 0=Sun..6=Sat. ISO week starts Monday → shift Sunday back 6.
      const dow = d.getUTCDay();
      const back = dow === 0 ? 6 : dow - 1;
      d.setUTCDate(d.getUTCDate() - back);
      return d.getTime();
    }
    case 'month':
      d.setUTCHours(0, 0, 0, 0);
      d.setUTCDate(1);
      return d.getTime();
    case 'quarter': {
      d.setUTCHours(0, 0, 0, 0);
      d.setUTCDate(1);
      const q = Math.floor(d.getUTCMonth() / 3) * 3;
      d.setUTCMonth(q);
      return d.getTime();
    }
    case 'year':
      d.setUTCHours(0, 0, 0, 0);
      d.setUTCMonth(0, 1);
      return d.getTime();
    default:
      return time;
  }
}

/**
 * Advance a time by `count` whole `unit`s (UTC, calendar-aware). `count` may be
 * negative. Month/quarter/year arithmetic clamps day-of-month so adding a month
 * to Jan-31 lands on the last day of February, never overflowing into March.
 */
export function addUnits(time: TimeMs, unit: TimeUnit, count: number): TimeMs {
  if (count === 0) return time;
  if (isFixedUnit(unit)) {
    return time + fixedUnitMs(unit) * count;
  }
  const d = new Date(time);
  switch (unit) {
    case 'month':
      addMonthsClamped(d, count);
      break;
    case 'quarter':
      addMonthsClamped(d, count * 3);
      break;
    case 'year':
      addMonthsClamped(d, count * 12);
      break;
  }
  return d.getTime();
}

/** Add whole months to a UTC date, clamping the day to the target month length. */
function addMonthsClamped(d: Date, months: number): void {
  const day = d.getUTCDate();
  // Set to the 1st first to avoid overflow during the month change, then clamp.
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = daysInMonth(d.getUTCFullYear(), d.getUTCMonth());
  d.setUTCDate(Math.min(day, last));
}

/** Number of days in a UTC month (0-based month index). */
export function daysInMonth(year: number, month: number): number {
  // Day 0 of the next month is the last day of this month.
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/**
 * Millisecond length of the `[start, start+increment*unit)` cell beginning at a
 * unit-aligned `start`. For fixed units this is constant; for calendar units it
 * is the true distance to the next boundary (so adjacent month cells differ).
 */
export function unitSpanMs(start: TimeMs, unit: TimeUnit, increment = 1): number {
  return addUnits(start, unit, increment) - start;
}

/**
 * Count of whole `unit`-cells (of size `increment`) needed to cover the half-open
 * interval `[start, end)`, where `start` is unit-aligned. Always ≥ 0.
 */
export function unitCount(start: TimeMs, end: TimeMs, unit: TimeUnit, increment = 1): number {
  if (end <= start) return 0;
  if (isFixedUnit(unit)) {
    const step = fixedUnitMs(unit) * increment;
    return Math.ceil((end - start) / step);
  }
  // Variable units: walk the calendar.
  let t = start;
  let n = 0;
  while (t < end) {
    t = addUnits(t, unit, increment);
    n++;
    // Safety valve against pathological inputs (never expected in practice).
    if (n > 5_000_000) break;
  }
  return n;
}

/**
 * The UTC weekday of a time, 0=Sunday..6=Saturday (matches `Date.getUTCDay`).
 * Used by non-working-time shading to detect weekends.
 */
export function weekday(time: TimeMs): number {
  return new Date(time).getUTCDay();
}
