/**
 * Recurring-event expansion — a pragmatic subset of the RFC-5545 RRULE grammar.
 *
 * Supports the parts a scheduler actually needs to expand a master event into
 * concrete occurrences within a visible window:
 *
 *   FREQ=DAILY|WEEKLY|MONTHLY|YEARLY   (required)
 *   INTERVAL=<n>                        (default 1)
 *   COUNT=<n>                           (cap on occurrences)
 *   UNTIL=<epoch-ms or YYYYMMDD...>     (inclusive end bound)
 *   BYDAY=MO,TU,...                     (WEEKLY only; weekday filter)
 *
 * All arithmetic is UTC, matching timeline-core. Expansion is windowed: callers
 * pass the visible `[from, to)` span so we never materialize an unbounded
 * sequence. Each occurrence preserves the master's duration.
 */

import type { TimeMs, DurationMs, TimeSpan } from '@jects/timeline-core';

const MS_DAY = 86_400_000;
const WEEKDAYS: Record<string, number> = {
  SU: 0,
  MO: 1,
  TU: 2,
  WE: 3,
  TH: 4,
  FR: 5,
  SA: 6,
};

/** Parsed RRULE. */
export interface RecurrenceRule {
  freq: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
  interval: number;
  count?: number;
  until?: TimeMs;
  /** UTC weekday numbers (0=Sun..6=Sat) for WEEKLY BYDAY. */
  byDay?: number[];
}

/**
 * Parse an RRULE string. Returns `null` for an unparseable / unsupported rule so
 * the caller can fall back to treating the event as a single occurrence.
 */
export function parseRRule(rule: string): RecurrenceRule | null {
  if (!rule) return null;
  const body = rule.replace(/^RRULE:/i, '').trim();
  if (!body) return null;
  const parts = new Map<string, string>();
  for (const seg of body.split(';')) {
    const [k, v] = seg.split('=');
    if (k && v) parts.set(k.trim().toUpperCase(), v.trim());
  }
  const freqRaw = parts.get('FREQ');
  if (!freqRaw) return null;
  const freq = freqRaw.toUpperCase();
  if (freq !== 'DAILY' && freq !== 'WEEKLY' && freq !== 'MONTHLY' && freq !== 'YEARLY') {
    return null;
  }

  const out: RecurrenceRule = { freq, interval: 1 };
  const interval = parts.get('INTERVAL');
  if (interval) {
    const n = parseInt(interval, 10);
    if (Number.isFinite(n) && n > 0) out.interval = n;
  }
  const count = parts.get('COUNT');
  if (count) {
    const n = parseInt(count, 10);
    if (Number.isFinite(n) && n > 0) out.count = n;
  }
  const until = parts.get('UNTIL');
  if (until) {
    const u = parseUntil(until);
    if (u != null) out.until = u;
  }
  const byDay = parts.get('BYDAY');
  if (byDay) {
    const days = byDay
      .split(',')
      .map((d) => WEEKDAYS[d.trim().toUpperCase().slice(-2)])
      .filter((d): d is number => d != null);
    if (days.length > 0) out.byDay = days;
  }
  return out;
}

/** Parse an UNTIL value: a raw epoch-ms number, ISO date, or YYYYMMDD[THHMMSSZ]. */
function parseUntil(raw: string): TimeMs | null {
  // Pure number → epoch ms.
  if (/^\d+$/.test(raw) && raw.length > 8) {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  // Basic iCal form: 20251231 or 20251231T235959Z.
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z?)?$/.exec(raw);
  if (m) {
    const [, y, mo, d, hh, mm, ss] = m;
    return Date.UTC(
      Number(y),
      Number(mo) - 1,
      Number(d),
      hh ? Number(hh) : 0,
      mm ? Number(mm) : 0,
      ss ? Number(ss) : 0,
    );
  }
  const t = Date.parse(raw);
  return Number.isNaN(t) ? null : t;
}

/** Advance a UTC time by one recurrence step of `freq * interval`. */
function step(time: TimeMs, rule: RecurrenceRule): TimeMs {
  const d = new Date(time);
  switch (rule.freq) {
    case 'DAILY':
      return time + MS_DAY * rule.interval;
    case 'WEEKLY':
      return time + MS_DAY * 7 * rule.interval;
    case 'MONTHLY':
      d.setUTCMonth(d.getUTCMonth() + rule.interval);
      return d.getTime();
    case 'YEARLY':
      d.setUTCFullYear(d.getUTCFullYear() + rule.interval);
      return d.getTime();
  }
}

/**
 * Expand a recurring event into concrete occurrence spans intersecting the
 * visible `[from, to)` window. The master's own span is the first candidate; the
 * duration is preserved for every occurrence. WEEKLY rules with BYDAY emit one
 * occurrence per matching weekday inside each weekly interval.
 *
 * @param masterSpan   The master event's `[start, end)`.
 * @param rule         The parsed recurrence rule.
 * @param window       The visible span to clip expansion to.
 * @param hardCap      Safety cap on emitted occurrences (default 1000).
 */
export function expandOccurrences(
  masterSpan: TimeSpan,
  rule: RecurrenceRule,
  window: TimeSpan,
  hardCap = 1000,
): TimeSpan[] {
  const duration: DurationMs = Math.max(1, masterSpan.end - masterSpan.start);
  const out: TimeSpan[] = [];
  let occurrenceCount = 0;
  let cursor = masterSpan.start;
  let guard = 0;

  // COUNT/UNTIL define the *true* sequence and must always be advanced to
  // completion (so the same master yields the same occurrence set regardless of
  // how wide the visible window is — idempotent expansion). The window only
  // clips which counted occurrences are pushed to `out`. When the rule is
  // open-ended (no COUNT, no UNTIL) the window + hard cap are the only stop, so
  // we may terminate once we've scanned past the window.
  const bounded = rule.count != null || rule.until != null;

  const emit = (start: TimeMs): boolean => {
    if (rule.until != null && start > rule.until) return false;
    const span = { start, end: start + duration };
    // Keep occurrences that intersect the visible window.
    if (span.end > window.start && span.start < window.end) {
      out.push(span);
    }
    occurrenceCount++;
    return true;
  };

  while (guard++ < hardCap * 4) {
    if (rule.count != null && occurrenceCount >= rule.count) break;
    if (rule.until != null && cursor > rule.until) break;
    // Only stop on the window edge for open-ended rules; a COUNT/UNTIL-bounded
    // series must keep counting past the window so it stays idempotent.
    if (!bounded && cursor >= window.end && out.length > 0) break;

    if (rule.freq === 'WEEKLY' && rule.byDay && rule.byDay.length > 0) {
      // Anchor to the Sunday of the cursor's week, emit each selected weekday.
      const weekStart = floorToSunday(cursor);
      for (const wd of [...rule.byDay].sort((a, b) => a - b)) {
        const occStart = weekStart + wd * MS_DAY + timeOfDay(masterSpan.start);
        if (occStart < masterSpan.start) continue; // before the master's first start
        if (rule.count != null && occurrenceCount >= rule.count) break;
        if (!emit(occStart)) break;
        if (occurrenceCount > hardCap) break;
      }
    } else {
      if (!emit(cursor)) break;
    }

    if (out.length > hardCap || occurrenceCount > hardCap) break;
    cursor = step(cursor, rule);
  }

  // De-dupe + sort (BYDAY can revisit a start across week boundaries).
  out.sort((a, b) => a.start - b.start);
  const seen = new Set<number>();
  return out.filter((s) => (seen.has(s.start) ? false : (seen.add(s.start), true)));
}

/** Floor a UTC time to the Sunday 00:00 of its week. */
function floorToSunday(time: TimeMs): TimeMs {
  const d = new Date(time);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d.getTime();
}

/** Milliseconds since UTC midnight for a time. */
function timeOfDay(time: TimeMs): number {
  const d = new Date(time);
  return (
    d.getUTCHours() * 3_600_000 +
    d.getUTCMinutes() * 60_000 +
    d.getUTCSeconds() * 1_000 +
    d.getUTCMilliseconds()
  );
}
