import { describe, it, expect } from 'vitest';
import { formatTime } from './format.js';

const T = Date.UTC(2025, 0, 6, 14, 30); // 2025-01-06 (Mon) 14:30 UTC

describe('formatTime', () => {
  it('formats datetime fallback', () => {
    expect(formatTime(T)).toBe('2025-01-06 14:30');
    expect(formatTime(T, 'datetime')).toBe('2025-01-06 14:30');
  });

  it('formats month + year', () => {
    expect(formatTime(T, 'MMM YYYY')).toBe('Jan 2025');
  });

  it('formats weekday + day + month', () => {
    expect(formatTime(T, 'ddd D MMM')).toBe('Mon 6 Jan');
  });

  it('formats hours with padding', () => {
    expect(formatTime(Date.UTC(2025, 0, 6, 9), 'HH')).toBe('09');
  });

  it('emits bracketed literals verbatim with the week number', () => {
    // 2025-01-06 is in ISO week 2.
    expect(formatTime(T, '[W]w')).toBe('W2');
  });

  it('formats quarter', () => {
    expect(formatTime(Date.UTC(2025, 7, 1), '[Q]Q')).toBe('Q3');
  });
});
