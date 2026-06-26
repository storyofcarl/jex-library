import { describe, it, expect } from 'vitest';
import {
  parseRRule,
  toRRule,
  expandRecurrence,
  generateSeries,
  validateSeries,
  describeRule,
} from './recurring.js';

describe('parseRRule / toRRule round-trip', () => {
  it('parses a weekly biweekly rule with BYDAY + COUNT', () => {
    const rule = parseRRule('RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=6');
    expect(rule).toEqual({ freq: 'weekly', interval: 2, byWeekday: [1, 3], count: 6 });
    expect(toRRule(rule!)).toBe('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=6');
  });
  it('parses UNTIL', () => {
    const rule = parseRRule('FREQ=DAILY;UNTIL=20300701');
    expect(rule).toEqual({ freq: 'daily', until: '2030-07-01' });
    expect(toRRule(rule!)).toBe('FREQ=DAILY;UNTIL=20300701');
  });
  it('rejects malformed', () => {
    expect(parseRRule('')).toBeNull();
    expect(parseRRule('INTERVAL=2')).toBeNull();
    expect(parseRRule('FREQ=NOPE')).toBeNull();
  });
});

describe('expandRecurrence', () => {
  it('expands daily with count', () => {
    expect(expandRecurrence({ freq: 'daily', count: 3 }, '2030-06-24')).toEqual([
      '2030-06-24',
      '2030-06-25',
      '2030-06-26',
    ]);
  });
  it('expands weekly interval (biweekly)', () => {
    expect(expandRecurrence({ freq: 'weekly', interval: 2, count: 3 }, '2030-06-24')).toEqual([
      '2030-06-24',
      '2030-07-08',
      '2030-07-22',
    ]);
  });
  it('expands weekly with BYDAY honouring start + until', () => {
    // Start Mon 2030-06-24; Mon/Wed until 2030-07-02.
    const out = expandRecurrence(
      { freq: 'weekly', byWeekday: [1, 3], until: '2030-07-02' },
      '2030-06-24',
    );
    expect(out).toEqual(['2030-06-24', '2030-06-26', '2030-07-01']);
  });
  it('expands monthly', () => {
    expect(expandRecurrence({ freq: 'monthly', count: 3 }, '2030-01-15')).toEqual([
      '2030-01-15',
      '2030-02-15',
      '2030-03-15',
    ]);
  });
});

describe('generateSeries / validateSeries', () => {
  it('keeps the same time across occurrences and validates each', () => {
    const series = generateSeries({ freq: 'daily', count: 3 }, '2030-06-24', '09:00');
    expect(series).toEqual([
      { date: '2030-06-24', time: '09:00' },
      { date: '2030-06-25', time: '09:00' },
      { date: '2030-06-26', time: '09:00' },
    ]);
    const validated = validateSeries(series, (s) => s.date !== '2030-06-25');
    expect(validated.map((v) => v.available)).toEqual([true, false, true]);
  });
});

describe('describeRule', () => {
  it('summarises a weekly rule', () => {
    expect(describeRule({ freq: 'weekly', interval: 2, byWeekday: [1, 3], count: 6 })).toBe(
      'Every 2 weeks on Mon, Wed (6 times)',
    );
    expect(describeRule({ freq: 'daily' })).toBe('Every day');
  });
});
