/** jsdom unit test for value formatting + input parsing. */
import { describe, it, expect } from 'vitest';
import { formatValue, parseInput, isCellError, NUMBER_FORMAT_PRESETS } from './format.js';
import type { CellError } from '../contract.js';

describe('formatValue', () => {
  it('formats empties and booleans', () => {
    expect(formatValue(null)).toBe('');
    expect(formatValue('')).toBe('');
    expect(formatValue(true)).toBe('TRUE');
    expect(formatValue(false)).toBe('FALSE');
  });

  it('formats errors as their code', () => {
    const e: CellError = { kind: 'error', code: '#DIV/0!' };
    expect(formatValue(e)).toBe('#DIV/0!');
    expect(isCellError(e)).toBe(true);
    expect(isCellError(5)).toBe(false);
  });

  it('formats numbers (general)', () => {
    expect(formatValue(1234)).toBe('1234');
    expect(formatValue(12.5)).toBe('12.5');
  });

  it('formats number/currency/percent', () => {
    expect(formatValue(1234.5, { type: 'number', numberFormat: '#,##0.00' })).toBe('1,234.50');
    expect(formatValue(1234.5, { type: 'currency', numberFormat: '#,##0.00' })).toBe('$1,234.50');
    expect(formatValue(0.125, { type: 'percent', numberFormat: '0.0%' })).toBe('12.5%');
  });

  it('formats negative currency', () => {
    expect(formatValue(-50, { type: 'currency', numberFormat: '#,##0.00' })).toBe('-$50.00');
  });

  it('formats dates and times', () => {
    const d = new Date(2024, 0, 5, 9, 7, 0);
    expect(formatValue(d, { type: 'date', numberFormat: 'yyyy-mm-dd' })).toBe('2024-01-05');
    expect(formatValue(d, { type: 'time', numberFormat: 'hh:mm' })).toBe('09:07');
  });

  it('keeps text verbatim when typed text', () => {
    expect(formatValue('007', { type: 'text' })).toBe('007');
  });
});

describe('parseInput', () => {
  it('parses numbers, booleans, percents', () => {
    expect(parseInput('42')).toBe(42);
    expect(parseInput('3.14')).toBeCloseTo(3.14);
    expect(parseInput('true')).toBe(true);
    expect(parseInput('FALSE')).toBe(false);
    expect(parseInput('50%')).toBeCloseTo(0.5);
  });

  it('strips currency symbols and grouping', () => {
    expect(parseInput('$1,234')).toBe(1234);
  });

  it('keeps strings as strings', () => {
    expect(parseInput('hello')).toBe('hello');
  });

  it('respects text format', () => {
    expect(parseInput('42', { type: 'text' })).toBe('42');
  });

  it('returns null for blank', () => {
    expect(parseInput('   ')).toBe(null);
  });
});

describe('NUMBER_FORMAT_PRESETS', () => {
  it('includes all contract format types', () => {
    const ids = NUMBER_FORMAT_PRESETS.map((p) => p.id);
    for (const t of ['general', 'number', 'currency', 'percent', 'date', 'time', 'text']) {
      expect(ids).toContain(t);
    }
  });
});
