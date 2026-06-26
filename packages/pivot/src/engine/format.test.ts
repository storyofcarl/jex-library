import { describe, it, expect } from 'vitest';
import { formatNumber, makeNumberFormat } from './format.js';

describe('formatNumber', () => {
  it('renders blank for null/NaN', () => {
    expect(formatNumber(null)).toBe('');
    expect(formatNumber(undefined)).toBe('');
    expect(formatNumber(NaN, { blank: '—' })).toBe('—');
  });

  it('formats with locale + currency options', () => {
    const usd = formatNumber(1234.5, { locale: 'en-US', style: 'currency', currency: 'USD' });
    expect(usd).toMatch(/\$1,234\.50/);
  });

  it('honors fraction digits', () => {
    expect(formatNumber(3.14159, { locale: 'en-US', maximumFractionDigits: 2 })).toBe('3.14');
  });

  it('makeNumberFormat returns a bound formatter', () => {
    const fmt = makeNumberFormat({ locale: 'en-US', minimumFractionDigits: 1 });
    expect(fmt(2)).toBe('2.0');
    expect(fmt(null)).toBe('');
  });
});
