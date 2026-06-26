import { describe, it, expect } from 'vitest';
import {
  resolveAvailableRanges,
  normalizeRanges,
  weekdayOf,
  isBlackout,
  rulesFromWorkingHours,
  type AvailabilityRules,
} from './availability-rules.js';

describe('weekdayOf', () => {
  it('returns the local weekday (0=Sun)', () => {
    expect(weekdayOf('2030-06-24')).toBe(1); // Monday
    expect(weekdayOf('2030-06-23')).toBe(0); // Sunday
  });
});

describe('normalizeRanges', () => {
  it('sorts, drops malformed, and merges overlapping/adjacent', () => {
    expect(
      normalizeRanges([
        { start: '13:00', end: '17:00' },
        { start: '09:00', end: '12:00' },
        { start: '12:00', end: '13:00' }, // adjacent — merges
        { start: 'bad', end: 'x' },
      ]),
    ).toEqual([{ start: '09:00', end: '17:00' }]);
  });
  it('drops inverted ranges', () => {
    expect(normalizeRanges([{ start: '17:00', end: '09:00' }])).toEqual([]);
  });
});

describe('isBlackout', () => {
  it('matches a single day and a span', () => {
    expect(isBlackout(['2030-06-24'], '2030-06-24')).toBe(true);
    expect(isBlackout([{ date: '2030-06-24', endDate: '2030-06-26' }], '2030-06-25')).toBe(true);
    expect(isBlackout([{ date: '2030-06-24', endDate: '2030-06-26' }], '2030-06-27')).toBe(false);
  });
});

describe('resolveAvailableRanges', () => {
  const rules: AvailabilityRules = {
    weekly: {
      1: [{ start: '09:00', end: '12:00' }, { start: '13:00', end: '17:00' }],
      2: [{ start: '10:00', end: '14:00' }],
    },
    overrides: [{ date: '2030-06-24', ranges: [{ start: '09:00', end: '10:00' }] }],
    blackouts: ['2030-12-25'],
  };

  it('uses the weekly pattern for the weekday', () => {
    // 2030-06-25 is a Tuesday (weekday 2).
    expect(resolveAvailableRanges(rules, '2030-06-25')).toEqual([{ start: '10:00', end: '14:00' }]);
  });

  it('date override beats the weekly pattern', () => {
    expect(resolveAvailableRanges(rules, '2030-06-24')).toEqual([{ start: '09:00', end: '10:00' }]);
  });

  it('blackout beats everything (closed)', () => {
    expect(resolveAvailableRanges(rules, '2030-12-25')).toEqual([]);
  });

  it('closed when no weekly entry', () => {
    // 2030-06-23 is a Sunday — no weekly[0].
    expect(resolveAvailableRanges(rules, '2030-06-23')).toEqual([]);
  });

  it('per-resource schedule overrides the base', () => {
    const r: AvailabilityRules = {
      weekly: { 1: [{ start: '09:00', end: '17:00' }] },
      perResource: { vip: { weekly: { 1: [{ start: '08:00', end: '20:00' }] } } },
    };
    expect(resolveAvailableRanges(r, '2030-06-24')).toEqual([{ start: '09:00', end: '17:00' }]);
    expect(resolveAvailableRanges(r, '2030-06-24', 'vip')).toEqual([
      { start: '08:00', end: '20:00' },
    ]);
  });
});

describe('rulesFromWorkingHours', () => {
  it('builds a Mon–Fri weekly pattern by default', () => {
    const r = rulesFromWorkingHours({ start: '09:00', end: '17:00' });
    expect(resolveAvailableRanges(r, '2030-06-24')).toEqual([{ start: '09:00', end: '17:00' }]); // Mon
    expect(resolveAvailableRanges(r, '2030-06-23')).toEqual([]); // Sun closed
  });
});
