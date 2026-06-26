import { describe, it, expect } from 'vitest';
import { parseRRule, toRRule, expandEvent } from './recurrence.js';
import type { CalendarEvent, RecurrenceRule } from './contract.js';

describe('RRULE string interop', () => {
  it('toRRule serializes the supported parts', () => {
    const s = toRRule({ freq: 'weekly', interval: 2, byWeekday: [1, 3], count: 6 });
    expect(s).toContain('FREQ=WEEKLY');
    expect(s).toContain('INTERVAL=2');
    expect(s).toContain('BYDAY=MO,WE');
    expect(s).toContain('COUNT=6');
  });

  it('parseRRule round-trips toRRule (with and without the RRULE: prefix)', () => {
    const rule: RecurrenceRule = { freq: 'weekly', interval: 2, byWeekday: [1, 3], count: 6 };
    const parsed = parseRRule(toRRule(rule))!;
    expect(parsed.freq).toBe('weekly');
    expect(parsed.interval).toBe(2);
    expect(parsed.byWeekday).toEqual([1, 3]);
    expect(parsed.count).toBe(6);
    // tolerant of an explicit RRULE: prefix
    expect(parseRRule('RRULE:FREQ=DAILY')!.freq).toBe('daily');
  });

  it('parse→expand matches the object path exactly', () => {
    const base = { id: 'e', title: 'T', start: new Date(2026, 5, 1, 9), end: new Date(2026, 5, 1, 10) };
    const rule: RecurrenceRule = { freq: 'weekly', byWeekday: [1, 3], count: 4 };
    const objEvent = { ...base, recurrence: rule } as CalendarEvent;
    const strEvent = { ...base, recurrence: parseRRule(toRRule(rule))! } as CalendarEvent;
    const w0 = new Date(2026, 5, 1);
    const w1 = new Date(2026, 6, 1);
    const a = expandEvent(objEvent, w0, w1).map((o) => o.start.getTime());
    const b = expandEvent(strEvent, w0, w1).map((o) => o.start.getTime());
    expect(a.length).toBe(4);
    expect(b).toEqual(a);
  });

  it('UNTIL round-trips at day granularity', () => {
    const parsed = parseRRule(toRRule({ freq: 'daily', until: new Date(2026, 5, 10) }))!;
    expect(parsed.until?.getFullYear()).toBe(2026);
    expect(parsed.until?.getMonth()).toBe(5);
    expect(parsed.until?.getDate()).toBe(10);
  });

  it('returns null for empty / unsupported rules', () => {
    expect(parseRRule('')).toBeNull();
    expect(parseRRule('garbage')).toBeNull();
    expect(parseRRule('FREQ=HOURLY')).toBeNull();
  });
});
