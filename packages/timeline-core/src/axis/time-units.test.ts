import { describe, it, expect } from 'vitest';
import {
  isFixedUnit,
  fixedUnitMs,
  floorToUnit,
  addUnits,
  daysInMonth,
  unitSpanMs,
  unitCount,
  weekday,
} from './time-units.js';

/** Helper: build a UTC epoch ms. */
const utc = (y: number, mo: number, d: number, h = 0, mi = 0): number =>
  Date.UTC(y, mo, d, h, mi, 0, 0);

describe('time-units: unit classification', () => {
  it('marks calendar units as variable', () => {
    expect(isFixedUnit('hour')).toBe(true);
    expect(isFixedUnit('day')).toBe(true);
    expect(isFixedUnit('week')).toBe(true);
    expect(isFixedUnit('month')).toBe(false);
    expect(isFixedUnit('quarter')).toBe(false);
    expect(isFixedUnit('year')).toBe(false);
  });

  it('returns exact ms for fixed units', () => {
    expect(fixedUnitMs('second')).toBe(1000);
    expect(fixedUnitMs('hour')).toBe(3_600_000);
    expect(fixedUnitMs('day')).toBe(86_400_000);
    expect(fixedUnitMs('week')).toBe(604_800_000);
  });

  it('throws for variable units in fixedUnitMs', () => {
    expect(() => fixedUnitMs('month')).toThrow();
    expect(() => fixedUnitMs('year')).toThrow();
  });
});

describe('time-units: floorToUnit (UTC)', () => {
  it('floors to hour/day', () => {
    expect(floorToUnit(utc(2026, 5, 24, 13, 47), 'hour')).toBe(utc(2026, 5, 24, 13, 0));
    expect(floorToUnit(utc(2026, 5, 24, 13, 47), 'day')).toBe(utc(2026, 5, 24));
  });

  it('floors week to the most recent Monday', () => {
    // 2026-06-24 is a Wednesday → Monday is 2026-06-22.
    expect(weekday(utc(2026, 5, 24))).toBe(3); // Wed
    expect(floorToUnit(utc(2026, 5, 24, 9), 'week')).toBe(utc(2026, 5, 22));
    // A Sunday floors back 6 days to the previous Monday.
    expect(weekday(utc(2026, 5, 28))).toBe(0); // Sun
    expect(floorToUnit(utc(2026, 5, 28, 9), 'week')).toBe(utc(2026, 5, 22));
  });

  it('floors month/quarter/year', () => {
    expect(floorToUnit(utc(2026, 5, 24, 13), 'month')).toBe(utc(2026, 5, 1));
    // June is Q2 → quarter starts in April (month index 3).
    expect(floorToUnit(utc(2026, 5, 24), 'quarter')).toBe(utc(2026, 3, 1));
    expect(floorToUnit(utc(2026, 5, 24), 'year')).toBe(utc(2026, 0, 1));
  });
});

describe('time-units: addUnits (calendar-aware)', () => {
  it('adds fixed units exactly', () => {
    expect(addUnits(utc(2026, 5, 24), 'day', 3)).toBe(utc(2026, 5, 27));
    expect(addUnits(utc(2026, 5, 24, 10), 'hour', -2)).toBe(utc(2026, 5, 24, 8));
  });

  it('adds months across year boundaries', () => {
    expect(addUnits(utc(2026, 10, 1), 'month', 3)).toBe(utc(2027, 1, 1));
  });

  it('clamps day-of-month when the target month is shorter', () => {
    // Jan 31 + 1 month → Feb 28 (2026 is not a leap year).
    expect(addUnits(utc(2026, 0, 31), 'month', 1)).toBe(utc(2026, 1, 28));
    // Jan 31 + 1 month in 2028 (leap) → Feb 29.
    expect(addUnits(utc(2028, 0, 31), 'month', 1)).toBe(utc(2028, 1, 29));
  });

  it('adds quarters and years', () => {
    expect(addUnits(utc(2026, 0, 1), 'quarter', 2)).toBe(utc(2026, 6, 1));
    expect(addUnits(utc(2026, 0, 1), 'year', 1)).toBe(utc(2027, 0, 1));
  });

  it('is a no-op for count 0', () => {
    const t = utc(2026, 5, 24);
    expect(addUnits(t, 'month', 0)).toBe(t);
  });
});

describe('time-units: daysInMonth', () => {
  it('handles 30/31/28/29-day months', () => {
    expect(daysInMonth(2026, 0)).toBe(31); // Jan
    expect(daysInMonth(2026, 1)).toBe(28); // Feb non-leap
    expect(daysInMonth(2028, 1)).toBe(29); // Feb leap
    expect(daysInMonth(2026, 3)).toBe(30); // Apr
  });
});

describe('time-units: unitSpanMs varies for calendar units', () => {
  it('gives true month lengths', () => {
    // Feb 2026 is 28 days; March is 31.
    expect(unitSpanMs(utc(2026, 1, 1), 'month')).toBe(28 * 86_400_000);
    expect(unitSpanMs(utc(2026, 2, 1), 'month')).toBe(31 * 86_400_000);
  });

  it('is constant for fixed units', () => {
    expect(unitSpanMs(utc(2026, 5, 24), 'day')).toBe(86_400_000);
    expect(unitSpanMs(utc(2026, 5, 24), 'hour', 2)).toBe(2 * 3_600_000);
  });
});

describe('time-units: unitCount', () => {
  it('counts fixed-unit cells (ceil)', () => {
    expect(unitCount(utc(2026, 5, 24), utc(2026, 5, 27), 'day')).toBe(3);
    // partial day rounds up
    expect(unitCount(utc(2026, 5, 24), utc(2026, 5, 27, 5), 'day')).toBe(4);
  });

  it('counts variable-unit cells by walking the calendar', () => {
    // Jan 1 → Apr 1 spans 3 months.
    expect(unitCount(utc(2026, 0, 1), utc(2026, 3, 1), 'month')).toBe(3);
    // partial month rounds up to cover.
    expect(unitCount(utc(2026, 0, 1), utc(2026, 2, 15), 'month')).toBe(3);
  });

  it('returns 0 for empty/inverted ranges', () => {
    expect(unitCount(utc(2026, 5, 24), utc(2026, 5, 24), 'day')).toBe(0);
    expect(unitCount(utc(2026, 5, 27), utc(2026, 5, 24), 'day')).toBe(0);
  });
});
