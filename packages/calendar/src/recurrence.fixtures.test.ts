/**
 * @jects/calendar — RECURRENCE known-answer fixtures.
 *
 * Proof-grade vectors (not behavior smoke tests): each case pins the EXACT,
 * hand-computed expansion of a representative RRULE over a fixed window, so a
 * regression in `parseRRule`/`expandEvent` fails loudly with a concrete diff.
 *
 * Dates are constructed with the LOCAL `Date` constructor on both the input and
 * the expected side. The recurrence engine works entirely in local calendar
 * fields (`getDate()`, `startOfDay`, …), so building expectations the same way
 * makes these fixtures independent of the test runner's own timezone.
 */
import { describe, it, expect } from 'vitest';
import { parseRRule, expandEvent } from './recurrence.js';
import type { CalendarEvent, RecurrenceRule } from './contract.js';

/** Local `YYYY-MM-DD HH:MM` of a Date, for stable golden comparison. */
function stamp(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}`
  );
}

/** Build a recurring event from an RRULE string (the documented store path). */
function recurring(
  start: Date,
  end: Date,
  rrule: string,
  extra?: Partial<RecurrenceRule>,
): CalendarEvent {
  const rule = parseRRule(rrule);
  if (!rule) throw new Error(`fixture RRULE did not parse: ${rrule}`);
  return {
    id: 'fx',
    title: 'Fixture',
    start,
    end,
    recurrence: { ...rule, ...extra },
  } as CalendarEvent;
}

function expandStamps(ev: CalendarEvent, w0: Date, w1: Date): string[] {
  return expandEvent(ev, w0, w1).map((o) => stamp(o.start));
}

describe('recurrence fixtures — FREQ=WEEKLY;BYDAY=MO,WE,FR', () => {
  it('emits exactly the Mon/Wed/Fri instants inside the window', () => {
    // Series starts Mon 2024-01-01 09:00 (2024-01-01 IS a Monday).
    const ev = recurring(
      new Date(2024, 0, 1, 9, 0),
      new Date(2024, 0, 1, 10, 0),
      'FREQ=WEEKLY;BYDAY=MO,WE,FR',
    );
    // Window [Jan 1 00:00, Jan 15 00:00): the Jan 15 Monday falls on/after the
    // exclusive end and is therefore NOT emitted.
    const got = expandStamps(ev, new Date(2024, 0, 1), new Date(2024, 0, 15));
    expect(got).toEqual([
      '2024-01-01 09:00', // Mon
      '2024-01-03 09:00', // Wed
      '2024-01-05 09:00', // Fri
      '2024-01-08 09:00', // Mon
      '2024-01-10 09:00', // Wed
      '2024-01-12 09:00', // Fri
    ]);
  });
});

describe('recurrence fixtures — FREQ=DAILY;INTERVAL=2;COUNT=6', () => {
  it('emits 6 every-other-day instants then stops on COUNT', () => {
    const ev = recurring(
      new Date(2024, 2, 1, 8, 0),
      new Date(2024, 2, 1, 8, 30),
      'FREQ=DAILY;INTERVAL=2;COUNT=6',
    );
    // Window is wide (full March) so COUNT — not the window — is the terminator.
    const got = expandStamps(ev, new Date(2024, 2, 1), new Date(2024, 3, 1));
    expect(got).toEqual([
      '2024-03-01 08:00',
      '2024-03-03 08:00',
      '2024-03-05 08:00',
      '2024-03-07 08:00',
      '2024-03-09 08:00',
      '2024-03-11 08:00',
    ]);
    expect(got).toHaveLength(6);
  });
});

describe('recurrence fixtures — FREQ=MONTHLY on the 31st (month-length edge)', () => {
  it('lands only in 31-day months, skipping (not clamping) shorter months', () => {
    // Anchor on Jan 31 2024 (leap year). RRULE BYMONTHDAY semantics: months
    // without a 31st (Feb/Apr/Jun/Sep/Nov) are SKIPPED, never rolled to the 1st
    // or clamped to the 28th/30th.
    const ev = recurring(
      new Date(2024, 0, 31, 12, 0),
      new Date(2024, 0, 31, 13, 0),
      'FREQ=MONTHLY',
    );
    const got = expandStamps(ev, new Date(2024, 0, 1), new Date(2025, 0, 1));
    expect(got).toEqual([
      '2024-01-31 12:00',
      '2024-03-31 12:00',
      '2024-05-31 12:00',
      '2024-07-31 12:00',
      '2024-08-31 12:00',
      '2024-10-31 12:00',
      '2024-12-31 12:00',
    ]);
    // Exactly the seven 31-day months of 2024.
    expect(got).toHaveLength(7);
  });
});

describe('recurrence fixtures — UNTIL-bounded rule', () => {
  it('includes the UNTIL day (inclusive) and stops the next day', () => {
    // FREQ=DAILY;UNTIL=20240310 from Mar 5 → Mar 5,6,7,8,9,10 then stop.
    const ev = recurring(
      new Date(2024, 2, 5, 9, 0),
      new Date(2024, 2, 5, 9, 30),
      'FREQ=DAILY;UNTIL=20240310',
    );
    const got = expandStamps(ev, new Date(2024, 2, 1), new Date(2024, 3, 1));
    expect(got).toEqual([
      '2024-03-05 09:00',
      '2024-03-06 09:00',
      '2024-03-07 09:00',
      '2024-03-08 09:00',
      '2024-03-09 09:00',
      '2024-03-10 09:00', // UNTIL is an inclusive calendar day
    ]);
    expect(got).toHaveLength(6);
  });
});

describe('recurrence fixtures — exDates exclusion', () => {
  it('COUNT counts the excluded day, then exDates removes it (5 → 4)', () => {
    // FREQ=DAILY;COUNT=5 from May 1 generates May 1..5; exDates drops May 3.
    // The excluded occurrence still consumes one of the 5 COUNT slots, so the
    // visible result is 4 — a deliberate proof of COUNT-before-exclusion order.
    const ev = recurring(
      new Date(2024, 4, 1, 10, 0),
      new Date(2024, 4, 1, 11, 0),
      'FREQ=DAILY;COUNT=5',
      { exDates: [new Date(2024, 4, 3)] },
    );
    const got = expandStamps(ev, new Date(2024, 4, 1), new Date(2024, 5, 1));
    expect(got).toEqual([
      '2024-05-01 10:00',
      '2024-05-02 10:00',
      // 2024-05-03 excluded
      '2024-05-04 10:00',
      '2024-05-05 10:00',
    ]);
    expect(got).toHaveLength(4);
  });
});
