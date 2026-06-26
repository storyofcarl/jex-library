/**
 * @jects/calendar — framework-free date math utilities.
 *
 * All functions operate on native `Date` and are pure (no mutation of inputs).
 * The calendar treats a "day" as a local-midnight boundary; time-of-day math is
 * used by Day/Week views. Week start is configurable (0 = Sunday default).
 */

export const MS_PER_MINUTE = 60_000;
export const MS_PER_HOUR = 3_600_000;
export const MS_PER_DAY = 86_400_000;

/** Day-of-week index 0..6 where 0 = Sunday. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** Clone a date. */
export function clone(d: Date): Date {
  return new Date(d.getTime());
}

/** Local midnight of the given date (00:00:00.000). */
export function startOfDay(d: Date): Date {
  const x = clone(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/** Local end-of-day (23:59:59.999). */
export function endOfDay(d: Date): Date {
  const x = clone(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

/** Add (possibly negative) whole days. */
export function addDays(d: Date, n: number): Date {
  const x = clone(d);
  x.setDate(x.getDate() + n);
  return x;
}

/** Add (possibly negative) whole weeks. */
export function addWeeks(d: Date, n: number): Date {
  return addDays(d, n * 7);
}

/** Add months, clamping the day-of-month to the target month's length. */
export function addMonths(d: Date, n: number): Date {
  const x = clone(d);
  const targetMonth = x.getMonth() + n;
  const day = x.getDate();
  x.setDate(1);
  x.setMonth(targetMonth);
  const last = daysInMonth(x.getFullYear(), x.getMonth());
  x.setDate(Math.min(day, last));
  return x;
}

/** Add years, clamping Feb-29 to Feb-28 in non-leap years. */
export function addYears(d: Date, n: number): Date {
  return addMonths(d, n * 12);
}

/** Add minutes. */
export function addMinutes(d: Date, n: number): Date {
  return new Date(d.getTime() + n * MS_PER_MINUTE);
}

/** Number of days in a given (0-based) month of a year. */
export function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

/** True when two dates fall on the same local calendar day. */
export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** True when two dates fall in the same local month + year. */
export function isSameMonth(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

/** Whole-day difference (b - a), measured at local midnight. Can be negative. */
export function diffDays(a: Date, b: Date): number {
  const ms = startOfDay(b).getTime() - startOfDay(a).getTime();
  return Math.round(ms / MS_PER_DAY);
}

/** Start of the week containing `d`, given a week-start weekday. */
export function startOfWeek(d: Date, weekStart: Weekday = 0): Date {
  const x = startOfDay(d);
  const day = x.getDay();
  const delta = (day - weekStart + 7) % 7;
  return addDays(x, -delta);
}

/** End of the week containing `d` (last day at 23:59:59.999). */
export function endOfWeek(d: Date, weekStart: Weekday = 0): Date {
  return endOfDay(addDays(startOfWeek(d, weekStart), 6));
}

/** First day of the month for `d`. */
export function startOfMonth(d: Date): Date {
  const x = startOfDay(d);
  x.setDate(1);
  return x;
}

/** Last day of the month for `d` (end-of-day). */
export function endOfMonth(d: Date): Date {
  const x = startOfMonth(d);
  return endOfDay(addDays(addMonths(x, 1), -1));
}

/** Start of the year. */
export function startOfYear(d: Date): Date {
  return startOfDay(new Date(d.getFullYear(), 0, 1));
}

/**
 * The 6x7 grid of days that renders a month view: starts on the `weekStart`
 * weekday on/before the 1st and always returns 42 days (6 weeks) so the grid
 * is geometrically stable across months.
 */
export function monthGrid(d: Date, weekStart: Weekday = 0): Date[] {
  const first = startOfMonth(d);
  const gridStart = startOfWeek(first, weekStart);
  const days: Date[] = [];
  for (let i = 0; i < 42; i++) days.push(addDays(gridStart, i));
  return days;
}

/** The 7 days of the week containing `d`. */
export function weekDays(d: Date, weekStart: Weekday = 0): Date[] {
  const start = startOfWeek(d, weekStart);
  const days: Date[] = [];
  for (let i = 0; i < 7; i++) days.push(addDays(start, i));
  return days;
}

/**
 * ISO-8601 week number (weeks start Monday; week 1 contains the first Thursday).
 * Independent of the display `weekStart`.
 */
export function isoWeek(d: Date): number {
  const x = startOfDay(d);
  // Thursday in current week decides the year.
  const day = (x.getDay() + 6) % 7; // Mon=0..Sun=6
  x.setDate(x.getDate() - day + 3);
  const firstThursday = new Date(x.getFullYear(), 0, 4);
  const firstDay = (firstThursday.getDay() + 6) % 7;
  firstThursday.setDate(firstThursday.getDate() - firstDay + 3);
  return 1 + Math.round((x.getTime() - firstThursday.getTime()) / (MS_PER_DAY * 7));
}

/** Minutes since local midnight for the given date. */
export function minutesIntoDay(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

/** Compose a Date from a base day + minutes-since-midnight. */
export function atMinutes(day: Date, minutes: number): Date {
  const x = startOfDay(day);
  return addMinutes(x, minutes);
}

/** Clamp a date into [min, max]. */
export function clampDate(d: Date, min: Date, max: Date): Date {
  if (d.getTime() < min.getTime()) return clone(min);
  if (d.getTime() > max.getTime()) return clone(max);
  return clone(d);
}

/** True when [aStart, aEnd) overlaps [bStart, bEnd). Touching edges do NOT overlap. */
export function rangesOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart.getTime() < bEnd.getTime() && bStart.getTime() < aEnd.getTime();
}

const PAD = (n: number): string => String(n).padStart(2, '0');

/** `YYYY-MM-DD` local date key — stable map key for a calendar day. */
export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${PAD(d.getMonth() + 1)}-${PAD(d.getDate())}`;
}

/** `HH:MM` 24h time label. */
export function timeLabel24(d: Date): string {
  return `${PAD(d.getHours())}:${PAD(d.getMinutes())}`;
}

/** Parse a `YYYY-MM-DDTHH:MM` (or date-only) local string into a Date. */
export function parseLocal(value: string): Date | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(value);
  if (!m) return null;
  const [, y, mo, da, hh, mi] = m;
  return new Date(
    Number(y),
    Number(mo) - 1,
    Number(da),
    hh ? Number(hh) : 0,
    mi ? Number(mi) : 0,
    0,
    0,
  );
}

/** Format a Date as `YYYY-MM-DDTHH:MM` for `<input type="datetime-local">`. */
export function toLocalInput(d: Date): string {
  return `${d.getFullYear()}-${PAD(d.getMonth() + 1)}-${PAD(d.getDate())}T${PAD(
    d.getHours(),
  )}:${PAD(d.getMinutes())}`;
}

/** Format a Date as `YYYY-MM-DD` for `<input type="date">`. */
export function toDateInput(d: Date): string {
  return `${d.getFullYear()}-${PAD(d.getMonth() + 1)}-${PAD(d.getDate())}`;
}
