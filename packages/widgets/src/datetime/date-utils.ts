/**
 * Internal date helpers for the Date & time cluster. Pure, dependency-free,
 * timezone-naive (operates on local-time Date objects). Not exported from the
 * package barrel — these are private to the datetime components.
 */

/** Day index where the week starts: 0 = Sunday, 1 = Monday. */
export type WeekStart = 0 | 1;

export const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

/** Two-letter weekday abbreviations indexed by JS day (0=Sun). */
export const WEEKDAY_ABBR = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'] as const;

/** Strip the time portion, returning midnight of the same local day. */
export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** True if both dates fall on the same local calendar day. */
export function isSameDay(a: Date | null | undefined, b: Date | null | undefined): boolean {
  if (!a || !b) return false;
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** True if both dates fall in the same local month/year. */
export function isSameMonth(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

/** Add (or subtract) whole days, returning a new Date. */
export function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

/** Add (or subtract) whole months, clamping the day to the target month length. */
export function addMonths(d: Date, n: number): Date {
  const year = d.getFullYear();
  const month = d.getMonth() + n;
  const day = Math.min(d.getDate(), daysInMonth(year, month));
  return new Date(year, month, day);
}

/** Number of days in the given (year, monthIndex), month may be out of 0..11 range. */
export function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

/** Clamp a date into the optional [min, max] day range. */
export function clampDate(d: Date, min?: Date | null, max?: Date | null): Date {
  if (min && d < startOfDay(min)) return startOfDay(min);
  if (max && d > startOfDay(max)) return startOfDay(max);
  return d;
}

/** True when `d` is before `min`'s day or after `max`'s day (inclusive bounds). */
export function isDisabledDay(d: Date, min?: Date | null, max?: Date | null): boolean {
  const day = startOfDay(d);
  if (min && day < startOfDay(min)) return true;
  if (max && day > startOfDay(max)) return true;
  return false;
}

/**
 * Build the 6-row (42 cell) month grid for the month containing `viewDate`.
 * Leading/trailing cells belong to the adjacent months so the grid is full.
 */
export function buildMonthMatrix(viewDate: Date, weekStart: WeekStart): Date[] {
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const first = new Date(year, month, 1);
  // How many leading days from the previous month we need to show.
  const lead = (first.getDay() - weekStart + 7) % 7;
  const start = addDays(first, -lead);
  const cells: Date[] = [];
  for (let i = 0; i < 42; i++) cells.push(addDays(start, i));
  return cells;
}

/** Weekday header labels ordered for the given week start. */
export function weekdayHeaders(weekStart: WeekStart): string[] {
  const out: string[] = [];
  for (let i = 0; i < 7; i++) out.push(WEEKDAY_ABBR[(weekStart + i) % 7]!);
  return out;
}

/** Parse a `YYYY-MM-DD` string into a local Date, or null if invalid. */
export function parseISODate(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]) - 1;
  const day = Number(m[3]);
  const d = new Date(year, month, day);
  if (d.getFullYear() !== year || d.getMonth() !== month || d.getDate() !== day) return null;
  return d;
}

/** Format a Date as `YYYY-MM-DD` (local). */
export function formatISODate(d: Date): string {
  const y = String(d.getFullYear()).padStart(4, '0');
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Pad a number to two digits. */
export function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** A time of day in 24-hour terms. */
export interface TimeValue {
  hours: number; // 0..23
  minutes: number; // 0..59
}

/** Format a TimeValue as `HH:MM` (24h). */
export function formatTime24(t: TimeValue): string {
  return `${pad2(t.hours)}:${pad2(t.minutes)}`;
}

/** Format a TimeValue as `h:MM AM/PM` (12h). */
export function formatTime12(t: TimeValue): string {
  const period = t.hours < 12 ? 'AM' : 'PM';
  let h = t.hours % 12;
  if (h === 0) h = 12;
  return `${h}:${pad2(t.minutes)} ${period}`;
}

/** Parse `HH:MM` (24h) or `h:MM AM/PM` (12h) into a TimeValue, or null. */
export function parseTime(value: string): TimeValue | null {
  const v = value.trim();
  const ampm = /^(\d{1,2}):(\d{2})\s*([AaPp][Mm])$/.exec(v);
  if (ampm) {
    let h = Number(ampm[1]);
    const min = Number(ampm[2]);
    const isPm = ampm[3]!.toLowerCase() === 'pm';
    if (h < 1 || h > 12 || min > 59) return null;
    if (h === 12) h = 0;
    if (isPm) h += 12;
    return { hours: h, minutes: min };
  }
  const t24 = /^(\d{1,2}):(\d{2})$/.exec(v);
  if (t24) {
    const h = Number(t24[1]);
    const min = Number(t24[2]);
    if (h > 23 || min > 59) return null;
    return { hours: h, minutes: min };
  }
  return null;
}

/** Snap minutes to the nearest lower multiple of `step` (minutes). */
export function snapMinutes(minutes: number, step: number): number {
  if (step <= 1) return minutes;
  return Math.floor(minutes / step) * step;
}
