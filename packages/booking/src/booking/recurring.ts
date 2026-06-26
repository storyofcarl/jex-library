/**
 * recurring — book a weekly/biweekly/custom SERIES. Parses/serialises an RFC-5545
 * RRULE subset (mirroring the `@jects/calendar` recurrence helpers so the wire
 * format is identical), expands a rule into concrete dates, and validates each
 * generated slot of the series against an availability predicate. Dependency-free,
 * timezone-naive (operates on local-day `YYYY-MM-DD` strings) and unit-tested.
 */

import type { Weekday } from './availability-rules.js';

/** Repeat cadence. */
export type RecurrenceFreq = 'daily' | 'weekly' | 'monthly' | 'yearly';

/** A parsed recurrence rule (RFC-5545 subset). */
export interface RecurrenceRule {
  /** How often the series repeats. */
  freq: RecurrenceFreq;
  /** Repeat every N periods (default 1 ⇒ biweekly is `weekly` interval 2). */
  interval?: number;
  /** For weekly rules: which weekdays (0=Sun..6=Sat). */
  byWeekday?: Weekday[];
  /** Stop after this many occurrences. */
  count?: number;
  /** Stop on/after this date (`YYYY-MM-DD`, inclusive). */
  until?: string;
}

const FREQ_TO_RRULE: Record<RecurrenceFreq, string> = {
  daily: 'DAILY',
  weekly: 'WEEKLY',
  monthly: 'MONTHLY',
  yearly: 'YEARLY',
};
const RRULE_TO_FREQ: Record<string, RecurrenceFreq> = {
  DAILY: 'daily',
  WEEKLY: 'weekly',
  MONTHLY: 'monthly',
  YEARLY: 'yearly',
};
/** Index 0=Sun..6=Sat → RFC day codes. */
const RRULE_DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;
const DAY_TO_NUM: Record<string, Weekday> = {
  SU: 0,
  MO: 1,
  TU: 2,
  WE: 3,
  TH: 4,
  FR: 5,
  SA: 6,
};

/** `YYYY-MM-DD` → local Date at noon (DST-safe). */
function parseDay(date: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0);
}
/** Local Date → `YYYY-MM-DD`. */
function fmtDay(d: Date): string {
  return `${String(d.getFullYear()).padStart(4, '0')}-${String(d.getMonth() + 1).padStart(
    2,
    '0',
  )}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Parse an `RRULE:`-prefixed (or bare) rule string, or `null` when invalid. */
export function parseRRule(rule: string): RecurrenceRule | null {
  if (!rule) return null;
  const body = rule.replace(/^RRULE:/i, '').trim();
  if (!body) return null;
  const parts = new Map<string, string>();
  for (const seg of body.split(';')) {
    const eq = seg.indexOf('=');
    if (eq === -1) continue;
    parts.set(seg.slice(0, eq).trim().toUpperCase(), seg.slice(eq + 1).trim());
  }
  const freqRaw = parts.get('FREQ');
  if (!freqRaw) return null;
  const freq = RRULE_TO_FREQ[freqRaw.toUpperCase()];
  if (!freq) return null;

  const out: RecurrenceRule = { freq };
  const interval = parts.get('INTERVAL');
  if (interval) {
    const n = parseInt(interval, 10);
    if (Number.isFinite(n) && n > 1) out.interval = n;
  }
  const count = parts.get('COUNT');
  if (count) {
    const n = parseInt(count, 10);
    if (Number.isFinite(n) && n > 0) out.count = n;
  }
  const until = parts.get('UNTIL');
  if (until) {
    const m = /^(\d{4})-?(\d{2})-?(\d{2})/.exec(until);
    if (m) out.until = `${m[1]}-${m[2]}-${m[3]}`;
  }
  const byDay = parts.get('BYDAY');
  if (byDay) {
    const days = byDay
      .split(',')
      .map((d) => DAY_TO_NUM[d.trim().toUpperCase().slice(-2)])
      .filter((d): d is Weekday => d !== undefined);
    if (days.length > 0) out.byWeekday = [...new Set(days)].sort((a, b) => a - b);
  }
  return out;
}

/** Serialise a rule back to an RRULE string (no `RRULE:` prefix). */
export function toRRule(rule: RecurrenceRule): string {
  const segs = [`FREQ=${FREQ_TO_RRULE[rule.freq]}`];
  const interval = Math.max(1, rule.interval ?? 1);
  if (interval > 1) segs.push(`INTERVAL=${interval}`);
  if (rule.freq === 'weekly' && rule.byWeekday?.length) {
    const days = [...new Set(rule.byWeekday)].sort((a, b) => a - b).map((w) => RRULE_DAYS[w]);
    segs.push(`BYDAY=${days.join(',')}`);
  }
  if (rule.count !== undefined) segs.push(`COUNT=${rule.count}`);
  else if (rule.until) segs.push(`UNTIL=${rule.until.replace(/-/g, '')}`);
  return segs.join(';');
}

/** Hard ceiling on generated occurrences to bound open-ended rules. */
const MAX_OCCURRENCES = 366;

/**
 * Expand a rule starting from `start` (`YYYY-MM-DD`) into concrete day strings.
 * Honours `count`, `until`, `interval`, and (for weekly) `byWeekday`. A `limit`
 * caps generation when neither `count` nor `until` is set.
 */
export function expandRecurrence(
  rule: RecurrenceRule,
  start: string,
  limit = 52,
): string[] {
  const startDate = parseDay(start);
  if (!startDate) return [];
  const interval = Math.max(1, rule.interval ?? 1);
  const cap = Math.min(MAX_OCCURRENCES, rule.count ?? limit);
  const until = rule.until && rule.until >= start ? rule.until : undefined;
  const out: string[] = [];

  if (rule.freq === 'weekly' && rule.byWeekday?.length) {
    // Walk week by week (stepping `interval` weeks), emitting the configured
    // weekdays within each active week, anchored to the start week's Sunday.
    const days = [...new Set(rule.byWeekday)].sort((a, b) => a - b);
    const weekAnchor = new Date(startDate);
    weekAnchor.setDate(weekAnchor.getDate() - weekAnchor.getDay()); // back to Sunday
    let guard = 0;
    while (out.length < cap && guard < MAX_OCCURRENCES) {
      guard++;
      for (const wd of days) {
        const d = new Date(weekAnchor);
        d.setDate(d.getDate() + wd);
        const iso = fmtDay(d);
        if (iso < start) continue;
        if (until && iso > until) return out;
        out.push(iso);
        if (out.length >= cap) return out;
      }
      weekAnchor.setDate(weekAnchor.getDate() + 7 * interval);
    }
    return out;
  }

  // daily / weekly(no byday) / monthly / yearly — step from the start date.
  const cursor = new Date(startDate);
  let guard = 0;
  while (out.length < cap && guard < MAX_OCCURRENCES) {
    guard++;
    const iso = fmtDay(cursor);
    if (until && iso > until) break;
    out.push(iso);
    switch (rule.freq) {
      case 'daily':
        cursor.setDate(cursor.getDate() + interval);
        break;
      case 'weekly':
        cursor.setDate(cursor.getDate() + 7 * interval);
        break;
      case 'monthly':
        cursor.setMonth(cursor.getMonth() + interval);
        break;
      case 'yearly':
        cursor.setFullYear(cursor.getFullYear() + interval);
        break;
    }
  }
  return out;
}

/** One slot of a generated series. */
export interface SeriesSlot {
  date: string;
  time: string;
}

/** Validation outcome for one series slot. */
export interface SeriesSlotValidation extends SeriesSlot {
  available: boolean;
}

/**
 * Generate the series of `{date, time}` slots for a rule + start day + time.
 * Each occurrence keeps the same time-of-day.
 */
export function generateSeries(
  rule: RecurrenceRule,
  start: string,
  time: string,
  limit = 52,
): SeriesSlot[] {
  return expandRecurrence(rule, start, limit).map((date) => ({ date, time }));
}

/**
 * Validate each series slot against an availability predicate (typically a
 * closure over the slot engine + store + capacity). Returns per-slot results so
 * the caller can book the available ones and surface the conflicts.
 */
export function validateSeries(
  series: SeriesSlot[],
  isAvailable: (slot: SeriesSlot) => boolean,
): SeriesSlotValidation[] {
  return series.map((slot) => ({ ...slot, available: isAvailable(slot) }));
}

/** Human-readable summary, e.g. "Every 2 weeks on Mon, Wed (10 times)". */
export function describeRule(rule: RecurrenceRule): string {
  const interval = Math.max(1, rule.interval ?? 1);
  const unit = { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' }[rule.freq];
  const head = interval === 1 ? `Every ${unit}` : `Every ${interval} ${unit}s`;
  let s = head;
  if (rule.freq === 'weekly' && rule.byWeekday?.length) {
    const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    s += ` on ${[...new Set(rule.byWeekday)].sort((a, b) => a - b).map((w) => names[w]).join(', ')}`;
  }
  if (rule.count) s += ` (${rule.count} times)`;
  else if (rule.until) s += ` until ${rule.until}`;
  return s;
}
