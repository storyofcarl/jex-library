/**
 * @jects/calendar — recurrence expansion.
 *
 * Expands a `CalendarEvent` (with or without a `RecurrenceRule`) into concrete
 * `EventOccurrence`s that overlap a query window. Pure + framework-free.
 *
 * Supported frequencies: daily, weekly (with `byWeekday`), monthly, yearly,
 * each with `interval`, and `count` / `until` / `exDates` terminators.
 */

import type { CalendarEvent, EventOccurrence, RecurrenceRule } from './contract.js';
import {
  addDays,
  addMonths,
  addWeeks,
  addYears,
  clone,
  isSameDay,
  rangesOverlap,
  startOfDay,
  type Weekday,
} from './date-utils.js';

/** Hard cap so a malformed/unbounded rule can never loop forever. */
const MAX_OCCURRENCES = 1000;

function occurrenceKey(ev: CalendarEvent, start: Date): string {
  return `${String(ev.id)}@${start.toISOString()}`;
}

function makeOccurrence(
  ev: CalendarEvent,
  start: Date,
  durationMs: number,
  isRecurring: boolean,
): EventOccurrence {
  return {
    event: ev,
    start,
    end: new Date(start.getTime() + durationMs),
    occurrenceKey: occurrenceKey(ev, start),
    isRecurring,
  };
}

function isExcluded(rule: RecurrenceRule, start: Date): boolean {
  return !!rule.exDates?.some((ex) => isSameDay(ex, start));
}

/** Apply the time-of-day from `base` onto the calendar day of `day`. */
function withTimeOf(day: Date, base: Date): Date {
  const x = startOfDay(day);
  x.setHours(base.getHours(), base.getMinutes(), base.getSeconds(), base.getMilliseconds());
  return x;
}

/**
 * Generate the ordered start instants for a rule, beginning at `seed`, stopping
 * at `count`/`until`/the window end. Weekly rules with `byWeekday` emit each
 * selected weekday within every active week.
 */
function* iterateStarts(
  seed: Date,
  rule: RecurrenceRule,
  windowEnd: Date,
): Generator<Date> {
  const interval = Math.max(1, rule.interval ?? 1);
  const until = rule.until ? clone(rule.until) : undefined;
  let emitted = 0;
  let guard = 0;

  const past = (d: Date): boolean =>
    (until !== undefined && startOfDay(d).getTime() > startOfDay(until).getTime()) ||
    d.getTime() > windowEnd.getTime();

  if (rule.freq === 'weekly' && rule.byWeekday && rule.byWeekday.length > 0) {
    const weekdays = [...new Set(rule.byWeekday)].sort((a, b) => a - b);
    // Anchor to the seed's week start (using Sunday-based weeks for iteration).
    let weekStartDay = addDays(startOfDay(seed), -seed.getDay());
    while (guard++ < MAX_OCCURRENCES * 7) {
      for (const wd of weekdays) {
        const candidate = withTimeOf(addDays(weekStartDay, wd), seed);
        if (candidate.getTime() < seed.getTime()) continue; // before series start
        if (past(candidate)) return;
        if (rule.count !== undefined && emitted >= rule.count) return;
        yield candidate;
        emitted++;
      }
      weekStartDay = addWeeks(weekStartDay, interval);
      if (past(addDays(weekStartDay, 6))) return;
    }
    return;
  }

  // Daily/weekly: a fixed-length period never clamps, so cumulative stepping is
  // exact. Monthly/yearly MUST be recomputed from the seed by absolute offset
  // (n*interval), because addMonths/addYears clamp the day-of-month to the
  // target month's length — stepping from the previous (already-clamped) result
  // would poison every later occurrence (e.g. Jan 31 → Feb 28 → Mar 28 → …).
  if (rule.freq === 'monthly' || rule.freq === 'yearly') {
    const seedDom = seed.getDate();
    for (let n = 0; guard++ < MAX_OCCURRENCES; n++) {
      const current =
        rule.freq === 'monthly'
          ? addMonths(seed, n * interval)
          : addYears(seed, n * interval);
      if (past(current)) return;
      if (rule.count !== undefined && emitted >= rule.count) return;
      // RRULE BYMONTHDAY semantics: months that don't contain the anchor's
      // day-of-month (e.g. Feb 30/31) are skipped, not clamped — so a long
      // series keeps landing on the original day whenever the month allows it.
      if (current.getDate() !== seedDom) continue;
      yield clone(current);
      emitted++;
    }
    return;
  }

  let current = clone(seed);
  while (guard++ < MAX_OCCURRENCES) {
    if (past(current)) return;
    if (rule.count !== undefined && emitted >= rule.count) return;
    yield clone(current);
    emitted++;
    switch (rule.freq) {
      case 'daily':
        current = addDays(current, interval);
        break;
      case 'weekly':
        current = addWeeks(current, interval);
        break;
    }
  }
}

/**
 * Expand a single event into the occurrences overlapping `[windowStart, windowEnd)`.
 * Non-recurring events yield 0 or 1 occurrence.
 */
export function expandEvent(
  ev: CalendarEvent,
  windowStart: Date,
  windowEnd: Date,
): EventOccurrence[] {
  const durationMs = Math.max(0, ev.end.getTime() - ev.start.getTime());

  if (!ev.recurrence) {
    if (rangesOverlap(ev.start, ev.end, windowStart, windowEnd)) {
      return [makeOccurrence(ev, clone(ev.start), durationMs, false)];
    }
    return [];
  }

  const out: EventOccurrence[] = [];
  for (const start of iterateStarts(ev.start, ev.recurrence, windowEnd)) {
    if (out.length >= MAX_OCCURRENCES) break;
    if (isExcluded(ev.recurrence, start)) continue;
    const end = new Date(start.getTime() + durationMs);
    if (rangesOverlap(start, end, windowStart, windowEnd)) {
      out.push(makeOccurrence(ev, start, durationMs, true));
    }
  }
  return out;
}

/** Expand many events and return all occurrences in the window, time-sorted. */
export function expandEvents(
  events: Iterable<CalendarEvent>,
  windowStart: Date,
  windowEnd: Date,
): EventOccurrence[] {
  const out: EventOccurrence[] = [];
  for (const ev of events) out.push(...expandEvent(ev, windowStart, windowEnd));
  out.sort((a, b) => a.start.getTime() - b.start.getTime() || a.end.getTime() - b.end.getTime());
  return out;
}

/* ═══════════════════════════════════════════════════════════════════════════
   RRULE string interop (RFC-5545 subset)
   ═══════════════════════════════════════════════════════════════════════════ */

/** RFC-5545 BYDAY tokens, indexed to / from our 0=Sun..6=Sat weekday numbers. */
const RRULE_DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;
const DAY_TO_NUM: Record<string, Weekday> = {
  SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6,
};
const FREQ_TO_RRULE: Record<RecurrenceRule['freq'], string> = {
  daily: 'DAILY', weekly: 'WEEKLY', monthly: 'MONTHLY', yearly: 'YEARLY',
};
const RRULE_TO_FREQ: Record<string, RecurrenceRule['freq']> = {
  DAILY: 'daily', WEEKLY: 'weekly', MONTHLY: 'monthly', YEARLY: 'yearly',
};

const PAD = (n: number): string => String(n).padStart(2, '0');

/** Format a Date as an RFC-5545 basic date value `YYYYMMDD` (local calendar day). */
function rruleUntil(d: Date): string {
  return `${d.getFullYear()}${PAD(d.getMonth() + 1)}${PAD(d.getDate())}`;
}

/** Parse an RFC-5545 `UNTIL` value (`YYYYMMDD[THHMMSS[Z]]`) into a local Date. */
function parseRRuleUntil(raw: string): Date | undefined {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?Z?)?$/.exec(raw.trim());
  if (!m) {
    const t = Date.parse(raw);
    return Number.isNaN(t) ? undefined : new Date(t);
  }
  const [, y, mo, da, hh, mi, ss] = m;
  return new Date(
    Number(y),
    Number(mo) - 1,
    Number(da),
    hh ? Number(hh) : 0,
    mi ? Number(mi) : 0,
    ss ? Number(ss) : 0,
  );
}

/**
 * Parse an RRULE string (a pragmatic RFC-5545 subset) into a {@link RecurrenceRule}.
 * Accepts a bare body (`FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE`) or a `RRULE:`-prefixed
 * line. Returns `null` for an unparseable / unsupported rule so the caller can
 * fall back to treating the event as a single occurrence.
 *
 * Supported parts: `FREQ` (required), `INTERVAL`, `COUNT`, `UNTIL`, `BYDAY`.
 */
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
    const u = parseRRuleUntil(until);
    if (u) out.until = u;
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

/**
 * Serialize a {@link RecurrenceRule} to a bare RRULE body (`FREQ=…;…`, no
 * `RRULE:` prefix). The inverse of {@link parseRRule} for the supported subset
 * (`exDates` are an event-level concern, not part of the RRULE line).
 */
export function toRRule(rule: RecurrenceRule): string {
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
  else if (rule.until) segs.push(`UNTIL=${rruleUntil(rule.until)}`);
  return segs.join(';');
}

/** A human summary of a recurrence rule for the editor / tooltips. */
export function describeRule(rule: RecurrenceRule): string {
  const n = Math.max(1, rule.interval ?? 1);
  const every = n === 1 ? '' : `${n} `;
  const unit = { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' }[rule.freq];
  let s = `Every ${every}${unit}${n === 1 ? '' : 's'}`;
  if (rule.freq === 'weekly' && rule.byWeekday?.length) {
    const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    s += ` on ${rule.byWeekday.map((w: Weekday) => names[w]).join(', ')}`;
  }
  if (rule.count !== undefined) s += `, ${rule.count} times`;
  else if (rule.until) s += `, until ${rule.until.toLocaleDateString()}`;
  return s;
}
