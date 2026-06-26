import { describe, it, expect } from 'vitest';
import { expandEvent, expandEvents, describeRule } from './recurrence.js';
import type { CalendarEvent } from './contract.js';

function evt(partial: Partial<CalendarEvent>): CalendarEvent {
  return {
    id: 'e1',
    title: 'T',
    start: new Date(2026, 5, 1, 9, 0),
    end: new Date(2026, 5, 1, 10, 0),
    ...partial,
  } as CalendarEvent;
}

describe('recurrence', () => {
  it('non-recurring event yields one occurrence when in window', () => {
    const e = evt({});
    const occs = expandEvent(e, new Date(2026, 5, 1), new Date(2026, 5, 2));
    expect(occs).toHaveLength(1);
    expect(occs[0]!.isRecurring).toBe(false);
  });

  it('non-recurring event outside window yields none', () => {
    const e = evt({});
    const occs = expandEvent(e, new Date(2026, 6, 1), new Date(2026, 6, 2));
    expect(occs).toHaveLength(0);
  });

  it('daily recurrence with count', () => {
    const e = evt({ recurrence: { freq: 'daily', count: 5 } });
    const occs = expandEvent(e, new Date(2026, 5, 1), new Date(2026, 6, 1));
    expect(occs).toHaveLength(5);
    expect(occs[0]!.start.getDate()).toBe(1);
    expect(occs[4]!.start.getDate()).toBe(5);
    expect(occs.every((o) => o.isRecurring)).toBe(true);
  });

  it('daily recurrence with interval', () => {
    const e = evt({ recurrence: { freq: 'daily', interval: 2, count: 3 } });
    const occs = expandEvent(e, new Date(2026, 5, 1), new Date(2026, 6, 1));
    expect(occs.map((o) => o.start.getDate())).toEqual([1, 3, 5]);
  });

  it('weekly recurrence with byWeekday expands each selected day', () => {
    // 2026-06-01 is a Monday. byWeekday Mon(1) + Wed(3).
    const e = evt({
      start: new Date(2026, 5, 1, 9),
      end: new Date(2026, 5, 1, 10),
      recurrence: { freq: 'weekly', byWeekday: [1, 3], until: new Date(2026, 5, 14) },
    });
    const occs = expandEvent(e, new Date(2026, 5, 1), new Date(2026, 5, 15));
    const dates = occs.map((o) => o.start.getDate());
    // Mon Jun 1, Wed Jun 3, Mon Jun 8, Wed Jun 10
    expect(dates).toContain(1);
    expect(dates).toContain(3);
    expect(dates).toContain(8);
    expect(dates).toContain(10);
    expect(occs.every((o) => [1, 3].includes(o.start.getDay()))).toBe(true);
  });

  it('monthly recurrence', () => {
    const e = evt({ recurrence: { freq: 'monthly', count: 3 } });
    const occs = expandEvent(e, new Date(2026, 0, 1), new Date(2026, 11, 31));
    expect(occs.map((o) => o.start.getMonth())).toEqual([5, 6, 7]);
  });

  it('yearly recurrence', () => {
    const e = evt({ recurrence: { freq: 'yearly', count: 2 } });
    const occs = expandEvent(e, new Date(2026, 0, 1), new Date(2030, 0, 1));
    expect(occs.map((o) => o.start.getFullYear())).toEqual([2026, 2027]);
  });

  it('monthly recurrence does not drift after a day-of-month clamp', () => {
    // Jan 31 series: Feb has no 31st (and others vary). RRULE BYMONTHDAY=31
    // emits only in months that HAVE a 31st and never gets "stuck" on the 28th.
    const e = evt({
      start: new Date(2026, 0, 31, 9),
      end: new Date(2026, 0, 31, 10),
      recurrence: { freq: 'monthly' },
    });
    const occs = expandEvent(e, new Date(2026, 0, 1), new Date(2026, 11, 31, 23, 59));
    // Months with a 31st in 2026: Jan, Mar, May, Jul, Aug, Oct, Dec.
    expect(occs.map((o) => o.start.getMonth())).toEqual([0, 2, 4, 6, 7, 9, 11]);
    // Every emitted occurrence is on the 31st — no permanent drift to the 28th.
    expect(occs.every((o) => o.start.getDate() === 31)).toBe(true);
  });

  it('monthly count counts only real (non-skipped) occurrences', () => {
    const e = evt({
      start: new Date(2026, 0, 31, 9),
      end: new Date(2026, 0, 31, 10),
      recurrence: { freq: 'monthly', count: 3 },
    });
    const occs = expandEvent(e, new Date(2026, 0, 1), new Date(2027, 11, 31));
    // First 3 months that have a 31st: Jan, Mar, May 2026.
    expect(occs.map((o) => [o.start.getFullYear(), o.start.getMonth()])).toEqual([
      [2026, 0],
      [2026, 2],
      [2026, 4],
    ]);
  });

  it('yearly Feb-29 only emits in leap years and stays on the 29th', () => {
    // 2024 is a leap year. Next Feb-29 is 2028, then 2032.
    const e = evt({
      start: new Date(2024, 1, 29, 9),
      end: new Date(2024, 1, 29, 10),
      recurrence: { freq: 'yearly' },
    });
    const occs = expandEvent(e, new Date(2024, 0, 1), new Date(2033, 0, 1));
    expect(occs.map((o) => o.start.getFullYear())).toEqual([2024, 2028, 2032]);
    expect(occs.every((o) => o.start.getMonth() === 1 && o.start.getDate() === 29)).toBe(true);
  });

  it('until terminates generation', () => {
    const e = evt({ recurrence: { freq: 'daily', until: new Date(2026, 5, 3) } });
    const occs = expandEvent(e, new Date(2026, 5, 1), new Date(2026, 6, 1));
    expect(occs.map((o) => o.start.getDate())).toEqual([1, 2, 3]);
  });

  it('exDates skip matching occurrences', () => {
    const e = evt({
      recurrence: { freq: 'daily', count: 5, exDates: [new Date(2026, 5, 3)] },
    });
    const occs = expandEvent(e, new Date(2026, 5, 1), new Date(2026, 6, 1));
    expect(occs.map((o) => o.start.getDate())).toEqual([1, 2, 4, 5]);
  });

  it('preserves duration across occurrences', () => {
    const e = evt({
      start: new Date(2026, 5, 1, 9),
      end: new Date(2026, 5, 1, 11, 30),
      recurrence: { freq: 'daily', count: 2 },
    });
    const occs = expandEvent(e, new Date(2026, 5, 1), new Date(2026, 5, 3));
    for (const o of occs) {
      expect(o.end.getTime() - o.start.getTime()).toBe(2.5 * 3_600_000);
    }
  });

  it('occurrenceKey is unique per occurrence', () => {
    const e = evt({ recurrence: { freq: 'daily', count: 3 } });
    const occs = expandEvent(e, new Date(2026, 5, 1), new Date(2026, 5, 4));
    const keys = new Set(occs.map((o) => o.occurrenceKey));
    expect(keys.size).toBe(3);
  });

  it('expandEvents merges + time-sorts across events', () => {
    const a = evt({ id: 'a', start: new Date(2026, 5, 1, 14), end: new Date(2026, 5, 1, 15) });
    const b = evt({ id: 'b', start: new Date(2026, 5, 1, 9), end: new Date(2026, 5, 1, 10) });
    const occs = expandEvents([a, b], new Date(2026, 5, 1), new Date(2026, 5, 2));
    expect(occs.map((o) => o.event.id)).toEqual(['b', 'a']);
  });

  it('describeRule summarizes', () => {
    expect(describeRule({ freq: 'daily' })).toContain('day');
    expect(describeRule({ freq: 'weekly', interval: 2 })).toContain('2');
    expect(describeRule({ freq: 'weekly', byWeekday: [1, 5] })).toContain('Mon');
    expect(describeRule({ freq: 'daily', count: 3 })).toContain('3 times');
  });

  it('caps runaway unbounded rules', () => {
    const e = evt({ recurrence: { freq: 'daily' } });
    // Huge window — should be bounded by MAX_OCCURRENCES, not hang.
    const occs = expandEvent(e, new Date(2026, 5, 1), new Date(2126, 5, 1));
    expect(occs.length).toBeLessThanOrEqual(1000);
    expect(occs.length).toBeGreaterThan(0);
  });
});
