import { describe, it, expect } from 'vitest';
import {
  startOfDay,
  endOfDay,
  addDays,
  addMonths,
  addYears,
  addMinutes,
  daysInMonth,
  isSameDay,
  isSameMonth,
  diffDays,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  monthGrid,
  weekDays,
  isoWeek,
  minutesIntoDay,
  atMinutes,
  rangesOverlap,
  dayKey,
  parseLocal,
  toLocalInput,
  toDateInput,
} from './date-utils.js';

describe('date-utils', () => {
  it('startOfDay / endOfDay zero and max the time', () => {
    const d = new Date(2026, 5, 24, 13, 45, 30, 500);
    expect(startOfDay(d).getHours()).toBe(0);
    expect(startOfDay(d).getMinutes()).toBe(0);
    const e = endOfDay(d);
    expect(e.getHours()).toBe(23);
    expect(e.getMinutes()).toBe(59);
  });

  it('addMonths clamps day-of-month (Jan 31 + 1mo = Feb 28/29)', () => {
    const jan31 = new Date(2026, 0, 31);
    const feb = addMonths(jan31, 1);
    expect(feb.getMonth()).toBe(1);
    expect(feb.getDate()).toBe(28); // 2026 not a leap year
  });

  it('addYears clamps Feb 29 to Feb 28 in non-leap years', () => {
    const leap = new Date(2024, 1, 29);
    const next = addYears(leap, 1);
    expect(next.getMonth()).toBe(1);
    expect(next.getDate()).toBe(28);
  });

  it('daysInMonth', () => {
    expect(daysInMonth(2024, 1)).toBe(29);
    expect(daysInMonth(2026, 1)).toBe(28);
    expect(daysInMonth(2026, 3)).toBe(30);
  });

  it('isSameDay / isSameMonth', () => {
    expect(isSameDay(new Date(2026, 5, 24, 1), new Date(2026, 5, 24, 23))).toBe(true);
    expect(isSameDay(new Date(2026, 5, 24), new Date(2026, 5, 25))).toBe(false);
    expect(isSameMonth(new Date(2026, 5, 1), new Date(2026, 5, 30))).toBe(true);
  });

  it('diffDays measures whole calendar days', () => {
    expect(diffDays(new Date(2026, 5, 1), new Date(2026, 5, 4))).toBe(3);
    expect(diffDays(new Date(2026, 5, 4), new Date(2026, 5, 1))).toBe(-3);
  });

  it('startOfWeek respects weekStart', () => {
    // 2026-06-24 is a Wednesday.
    const wed = new Date(2026, 5, 24);
    expect(startOfWeek(wed, 0).getDay()).toBe(0); // Sunday
    expect(startOfWeek(wed, 1).getDay()).toBe(1); // Monday
  });

  it('endOfWeek is 6 days after startOfWeek', () => {
    const wed = new Date(2026, 5, 24);
    expect(diffDays(startOfWeek(wed, 0), endOfWeek(wed, 0))).toBe(6);
  });

  it('startOfMonth / endOfMonth', () => {
    const d = new Date(2026, 5, 15);
    expect(startOfMonth(d).getDate()).toBe(1);
    expect(endOfMonth(d).getDate()).toBe(30);
  });

  it('monthGrid always returns 42 days starting on weekStart', () => {
    const grid = monthGrid(new Date(2026, 5, 1), 0);
    expect(grid).toHaveLength(42);
    expect(grid[0]!.getDay()).toBe(0);
  });

  it('weekDays returns 7 consecutive days', () => {
    const days = weekDays(new Date(2026, 5, 24), 1);
    expect(days).toHaveLength(7);
    expect(days[0]!.getDay()).toBe(1);
    expect(diffDays(days[0]!, days[6]!)).toBe(6);
  });

  it('isoWeek computes ISO-8601 week numbers', () => {
    expect(isoWeek(new Date(2026, 0, 1))).toBe(1);
    expect(isoWeek(new Date(2026, 5, 24))).toBeGreaterThan(20);
  });

  it('minutesIntoDay / atMinutes round-trip', () => {
    const d = new Date(2026, 5, 24, 9, 30);
    expect(minutesIntoDay(d)).toBe(9 * 60 + 30);
    const back = atMinutes(startOfDay(d), 9 * 60 + 30);
    expect(back.getHours()).toBe(9);
    expect(back.getMinutes()).toBe(30);
  });

  it('rangesOverlap is half-open (touching edges do not overlap)', () => {
    const a0 = new Date(2026, 5, 24, 9);
    const a1 = new Date(2026, 5, 24, 10);
    const b0 = new Date(2026, 5, 24, 10);
    const b1 = new Date(2026, 5, 24, 11);
    expect(rangesOverlap(a0, a1, b0, b1)).toBe(false);
    expect(rangesOverlap(a0, a1, new Date(2026, 5, 24, 9, 30), b1)).toBe(true);
  });

  it('dayKey is a stable YYYY-MM-DD key', () => {
    expect(dayKey(new Date(2026, 5, 4))).toBe('2026-06-04');
  });

  it('parseLocal / toLocalInput / toDateInput round-trip', () => {
    const d = new Date(2026, 5, 24, 14, 5);
    expect(toLocalInput(d)).toBe('2026-06-24T14:05');
    expect(toDateInput(d)).toBe('2026-06-24');
    const parsed = parseLocal('2026-06-24T14:05')!;
    expect(parsed.getHours()).toBe(14);
    expect(parsed.getMinutes()).toBe(5);
    expect(parseLocal('not-a-date')).toBeNull();
  });

  it('addMinutes / addDays are pure', () => {
    const base = new Date(2026, 5, 24, 9, 0);
    const plus = addMinutes(base, 90);
    expect(plus.getHours()).toBe(10);
    expect(plus.getMinutes()).toBe(30);
    expect(base.getHours()).toBe(9); // unchanged
    expect(addDays(base, 1).getDate()).toBe(25);
  });
});
