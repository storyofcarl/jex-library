/**
 * @jects/todo — date-only recurrence (a pragmatic RFC-5545 RRULE subset).
 *
 * Tasks recur on a calendar-day grid (due dates are ISO `YYYY-MM-DD`), so this
 * is a slimmed, dependency-free port of `@jects/calendar`'s recurrence engine
 * specialised for date-only stepping. It parses an RRULE body, and — given a
 * task's current due day — computes the NEXT occurrence after that day, which is
 * what "completing a recurring task spawns the next instance" needs.
 *
 * Supported parts: `FREQ` (DAILY/WEEKLY/MONTHLY/YEARLY, required), `INTERVAL`,
 * `COUNT`, `UNTIL` (YYYYMMDD), `BYDAY` (weekly). Anything unsupported parses to
 * `null` so callers can treat the task as non-recurring.
 */

import { isoToDate, dateToIso } from './todo-utils.js';

/** Recurrence frequency (lower-cased RFC-5545 FREQ). */
export type TodoRecurFreq = 'daily' | 'weekly' | 'monthly' | 'yearly';

/** A parsed recurrence rule (date-only). `byWeekday`: 0=Sun..6=Sat. */
export interface TodoRecurRule {
  freq: TodoRecurFreq;
  interval?: number;
  count?: number;
  until?: string | null; // ISO YYYY-MM-DD
  byWeekday?: number[];
}

const RRULE_DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;
const DAY_TO_NUM: Record<string, number> = {
  SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6,
};
const FREQ_TO_RRULE: Record<TodoRecurFreq, string> = {
  daily: 'DAILY', weekly: 'WEEKLY', monthly: 'MONTHLY', yearly: 'YEARLY',
};
const RRULE_TO_FREQ: Record<string, TodoRecurFreq> = {
  DAILY: 'daily', WEEKLY: 'weekly', MONTHLY: 'monthly', YEARLY: 'yearly',
};

/** Hard cap so a malformed/unbounded rule can never loop forever. */
const MAX_STEPS = 1000;

/**
 * Parse an RRULE string (bare body or `RRULE:`-prefixed) into a {@link TodoRecurRule}.
 * Returns `null` for an unparseable / unsupported rule.
 */
export function parseRecurrence(rule: string | null | undefined): TodoRecurRule | null {
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

  const out: TodoRecurRule = { freq };
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
    const m = /^(\d{4})(\d{2})(\d{2})/.exec(until.trim());
    if (m) out.until = `${m[1]}-${m[2]}-${m[3]}`;
  }
  const byDay = parts.get('BYDAY');
  if (byDay) {
    const days = byDay
      .split(',')
      .map((d) => DAY_TO_NUM[d.trim().toUpperCase().slice(-2)])
      .filter((d): d is number => d !== undefined);
    if (days.length > 0) out.byWeekday = [...new Set(days)].sort((a, b) => a - b);
  }
  return out;
}

/** Serialize a {@link TodoRecurRule} back to a bare RRULE body. */
export function formatRecurrence(rule: TodoRecurRule): string {
  const segs = [`FREQ=${FREQ_TO_RRULE[rule.freq]}`];
  const interval = Math.max(1, rule.interval ?? 1);
  if (interval > 1) segs.push(`INTERVAL=${interval}`);
  if (rule.freq === 'weekly' && rule.byWeekday?.length) {
    const days = [...new Set(rule.byWeekday)]
      .sort((a, b) => a - b)
      .map((w) => RRULE_DAYS[w]);
    segs.push(`BYDAY=${days.join(',')}`);
  }
  if (rule.count !== undefined) segs.push(`COUNT=${rule.count}`);
  else if (rule.until) {
    const d = isoToDate(rule.until);
    if (d) segs.push(`UNTIL=${rule.until.replace(/-/g, '')}`);
  }
  return segs.join(';');
}

/** A human summary of a recurrence rule for the editor / chips. */
export function describeRecurrence(rule: string | TodoRecurRule | null | undefined): string {
  const parsed = typeof rule === 'string' ? parseRecurrence(rule) : rule;
  if (!parsed) return '';
  const n = Math.max(1, parsed.interval ?? 1);
  const every = n === 1 ? '' : `${n} `;
  const unit = { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' }[parsed.freq];
  let s = `Every ${every}${unit}${n === 1 ? '' : 's'}`;
  if (parsed.freq === 'weekly' && parsed.byWeekday?.length) {
    const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    s += ` on ${parsed.byWeekday.map((w) => names[w]).join(', ')}`;
  }
  if (parsed.count !== undefined) s += `, ${parsed.count} times`;
  else if (parsed.until) s += `, until ${parsed.until}`;
  return s;
}

function addDays(iso: string, days: number): string {
  const d = isoToDate(iso);
  if (!d) return iso;
  d.setDate(d.getDate() + days);
  return dateToIso(d) ?? iso;
}

/**
 * Compute the next occurrence date (ISO `YYYY-MM-DD`) strictly AFTER `from`,
 * following `rule` anchored at `anchor` (the series' first due date). Returns
 * `null` when the series has ended (past `UNTIL`/`COUNT`) or the rule is invalid.
 *
 * `anchor` defaults to `from` when omitted (a task with no recorded original
 * start simply steps forward from its current due date).
 */
export function nextOccurrence(
  rule: string | TodoRecurRule | null | undefined,
  from: string | null | undefined,
  anchor?: string | null,
): string | null {
  const parsed = typeof rule === 'string' ? parseRecurrence(rule) : rule;
  if (!parsed) return null;
  const fromDate = isoToDate(from ?? undefined);
  if (!fromDate) return null;
  const fromIso = dateToIso(fromDate)!;
  const seedIso = anchor && isoToDate(anchor) ? anchor : fromIso;
  const interval = Math.max(1, parsed.interval ?? 1);
  const untilDate = parsed.until ? isoToDate(parsed.until) : null;

  const past = (iso: string): boolean => {
    if (!untilDate) return false;
    const d = isoToDate(iso)!;
    return d.getTime() > untilDate.getTime();
  };

  // Walk occurrences from the seed; return the first strictly after `from`.
  // `count` (when present) bounds the whole series, so a recurrence that has
  // exhausted its count yields null even if `until` is open.
  const candidates = iterate(parsed, seedIso, interval, MAX_STEPS);
  let emitted = 0;
  for (const iso of candidates) {
    if (parsed.count !== undefined && emitted >= parsed.count) return null;
    emitted++;
    if (past(iso)) return null;
    if (isoToDate(iso)!.getTime() > fromDate.getTime()) return iso;
  }
  return null;
}

/** Generate ordered ISO day strings for a rule (date-only), capped at `max`. */
function* iterate(
  rule: TodoRecurRule,
  seedIso: string,
  interval: number,
  max: number,
): Generator<string> {
  if (rule.freq === 'weekly' && rule.byWeekday && rule.byWeekday.length > 0) {
    const weekdays = [...new Set(rule.byWeekday)].sort((a, b) => a - b);
    const seed = isoToDate(seedIso)!;
    // Anchor to the seed's (Sunday-based) week start.
    let weekStart = addDays(seedIso, -seed.getDay());
    let guard = 0;
    while (guard++ < max) {
      for (const wd of weekdays) {
        const cand = addDays(weekStart, wd);
        if (isoToDate(cand)!.getTime() < seed.getTime()) continue;
        yield cand;
      }
      weekStart = addDays(weekStart, interval * 7);
    }
    return;
  }

  const seed = isoToDate(seedIso)!;
  const seedDom = seed.getDate();
  for (let n = 0; n < max; n++) {
    let d: Date;
    if (rule.freq === 'monthly') {
      d = new Date(seed.getFullYear(), seed.getMonth() + n * interval, seedDom);
      // Skip months that don't contain the anchor day (BYMONTHDAY semantics).
      if (d.getDate() !== seedDom) continue;
    } else if (rule.freq === 'yearly') {
      d = new Date(seed.getFullYear() + n * interval, seed.getMonth(), seedDom);
      if (d.getDate() !== seedDom) continue;
    } else if (rule.freq === 'weekly') {
      d = new Date(seed.getFullYear(), seed.getMonth(), seedDom + n * interval * 7);
    } else {
      // daily
      d = new Date(seed.getFullYear(), seed.getMonth(), seedDom + n * interval);
    }
    yield dateToIso(d)!;
  }
}
