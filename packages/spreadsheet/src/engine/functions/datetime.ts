/**
 * Date & time worksheet functions. Dates are Excel serial numbers internally;
 * these helpers convert to/from JS `Date` via the shared serial utilities.
 */

import type { CellValue, SpreadsheetFunction } from '../../contract.js';
import { ERR, dateToSerial, isError, serialToDate, toNumber } from '../errors.js';
import { type FnArg, asScalar } from '../helpers.js';

function n(a: FnArg | undefined): number | CellValue {
  return toNumber(asScalar(a));
}

/** Coerce an arg to a JS Date via its serial. */
function asDate(a: FnArg | undefined): Date | CellValue {
  const s = asScalar(a);
  if (isError(s)) return s;
  if (s instanceof Date) return s;
  const num = toNumber(s);
  if (isError(num)) return num;
  return serialToDate(num as number);
}

function daysBetween(a: Date, b: Date): number {
  return Math.round(dateToSerial(b)) - Math.round(dateToSerial(a));
}

export const dateFunctions: Record<string, SpreadsheetFunction> = {
  DATE: (args) => {
    const y = n(args[0]);
    const m = n(args[1]);
    const d = n(args[2]);
    if (isError(y)) return y;
    if (isError(m)) return m;
    if (isError(d)) return d;
    let year = Math.floor(y as number);
    if (year < 1900) year += 1900;
    const date = new Date(year, Math.floor(m as number) - 1, Math.floor(d as number));
    return dateToSerial(date);
  },
  TIME: (args) => {
    const h = n(args[0]);
    const mi = n(args[1]);
    const s = n(args[2]);
    if (isError(h)) return h;
    if (isError(mi)) return mi;
    if (isError(s)) return s;
    const frac = ((h as number) * 3600 + (mi as number) * 60 + (s as number)) / 86400;
    return frac - Math.floor(frac);
  },
  TODAY: () => {
    const now = new Date();
    return Math.floor(dateToSerial(new Date(now.getFullYear(), now.getMonth(), now.getDate())));
  },
  NOW: () => dateToSerial(new Date()),
  YEAR: (args) => withDate(args, (d) => d.getFullYear()),
  MONTH: (args) => withDate(args, (d) => d.getMonth() + 1),
  DAY: (args) => withDate(args, (d) => d.getDate()),
  HOUR: (args) => withDate(args, (d) => d.getHours()),
  MINUTE: (args) => withDate(args, (d) => d.getMinutes()),
  SECOND: (args) => withDate(args, (d) => d.getSeconds()),
  WEEKDAY: (args) => {
    const d = asDate(args[0]);
    if (isError(d)) return d;
    const type = args.length > 1 ? n(args[1]) : 1;
    if (isError(type)) return type;
    const dow = (d as Date).getDay(); // 0=Sun
    switch (Math.floor(type as number)) {
      case 1:
        return dow + 1;
      case 2:
        return ((dow + 6) % 7) + 1;
      case 3:
        return (dow + 6) % 7;
      default:
        return dow + 1;
    }
  },
  WEEKNUM: (args) => {
    const d = asDate(args[0]);
    if (isError(d)) return d;
    const date = d as Date;
    const start = new Date(date.getFullYear(), 0, 1);
    const days = daysBetween(start, date);
    return Math.floor((days + start.getDay()) / 7) + 1;
  },
  EOMONTH: (args) => {
    const d = asDate(args[0]);
    if (isError(d)) return d;
    const months = n(args[1]);
    if (isError(months)) return months;
    const base = d as Date;
    const target = new Date(base.getFullYear(), base.getMonth() + Math.floor(months as number) + 1, 0);
    return Math.floor(dateToSerial(target));
  },
  EDATE: (args) => {
    const d = asDate(args[0]);
    if (isError(d)) return d;
    const months = n(args[1]);
    if (isError(months)) return months;
    const base = d as Date;
    const targetMonth = base.getMonth() + Math.floor(months as number);
    const lastDay = new Date(base.getFullYear(), targetMonth + 1, 0).getDate();
    const target = new Date(base.getFullYear(), targetMonth, Math.min(base.getDate(), lastDay));
    return Math.floor(dateToSerial(target));
  },
  DATEDIF: (args) => {
    const start = asDate(args[0]);
    const end = asDate(args[1]);
    if (isError(start)) return start;
    if (isError(end)) return end;
    const unit = String(asScalar(args[2])).toUpperCase();
    const a = start as Date;
    const b = end as Date;
    switch (unit) {
      case 'D':
        return daysBetween(a, b);
      case 'M':
        return monthDiff(a, b);
      case 'Y':
        return Math.floor(monthDiff(a, b) / 12);
      case 'MD': {
        // Day-of-month difference, ignoring months/years. When b's day is
        // earlier than a's, borrow a full start-month worth of days (Excel rule:
        // e.g. Jan 30 → Mar 5 = 5 - 30 + 31 = 6).
        if (b.getDate() >= a.getDate()) return b.getDate() - a.getDate();
        const daysInStartMonth = new Date(a.getFullYear(), a.getMonth() + 1, 0).getDate();
        return b.getDate() - a.getDate() + daysInStartMonth;
      }
      case 'YM':
        return ((monthDiff(a, b) % 12) + 12) % 12;
      case 'YD': {
        const anchor = new Date(b.getFullYear(), a.getMonth(), a.getDate());
        let diff = daysBetween(anchor, b);
        if (diff < 0) diff = daysBetween(new Date(b.getFullYear() - 1, a.getMonth(), a.getDate()), b);
        return diff;
      }
      default:
        return ERR.NUM;
    }
  },
  DAYS: (args) => {
    const end = asDate(args[0]);
    const start = asDate(args[1]);
    if (isError(end)) return end;
    if (isError(start)) return start;
    return daysBetween(start as Date, end as Date);
  },
  NETWORKDAYS: (args) => {
    const start = asDate(args[0]);
    const end = asDate(args[1]);
    if (isError(start)) return start;
    if (isError(end)) return end;
    let count = 0;
    const a = new Date(start as Date);
    const b = end as Date;
    const step = a <= b ? 1 : -1;
    while (step > 0 ? a <= b : a >= b) {
      const dow = a.getDay();
      if (dow !== 0 && dow !== 6) count++;
      a.setDate(a.getDate() + step);
    }
    return step > 0 ? count : -count;
  },
  WORKDAY: (args) => {
    const start = asDate(args[0]);
    if (isError(start)) return start;
    const days = n(args[1]);
    if (isError(days)) return days;
    let remaining = Math.floor(days as number);
    const d = new Date(start as Date);
    const step = remaining >= 0 ? 1 : -1;
    remaining = Math.abs(remaining);
    while (remaining > 0) {
      d.setDate(d.getDate() + step);
      const dow = d.getDay();
      if (dow !== 0 && dow !== 6) remaining--;
    }
    return Math.floor(dateToSerial(d));
  },
  DATEVALUE: (args) => {
    const s = asScalar(args[0]);
    if (isError(s)) return s;
    const ms = Date.parse(String(s));
    if (Number.isNaN(ms)) return ERR.VALUE;
    const d = new Date(ms);
    return Math.floor(dateToSerial(new Date(d.getFullYear(), d.getMonth(), d.getDate())));
  },
  TIMEVALUE: (args) => {
    const s = String(asScalar(args[0]));
    const m = /(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(s);
    if (!m) return ERR.VALUE;
    const h = Number(m[1]);
    const mi = Number(m[2]);
    const sec = Number(m[3] ?? 0);
    return (h * 3600 + mi * 60 + sec) / 86400;
  },
};

function withDate(args: ReadonlyArray<FnArg>, fn: (d: Date) => number): CellValue {
  const d = asDate(args[0]);
  if (isError(d)) return d;
  return fn(d as Date);
}

function monthDiff(a: Date, b: Date): number {
  let months = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
  if (b.getDate() < a.getDate()) months--;
  return months;
}
