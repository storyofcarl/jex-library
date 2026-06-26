import { describe, it, expect } from 'vitest';
import { AggregatorRegistry, toNumber } from './aggregators.js';

describe('toNumber', () => {
  it('coerces numerics, dates, booleans; rejects junk', () => {
    expect(toNumber(3)).toBe(3);
    expect(toNumber('4.5')).toBe(4.5);
    expect(toNumber(true)).toBe(1);
    expect(toNumber(false)).toBe(0);
    expect(toNumber(new Date(1000))).toBe(1000);
    expect(toNumber('')).toBeNull();
    expect(toNumber(null)).toBeNull();
    expect(toNumber('abc')).toBeNull();
    expect(toNumber(Infinity)).toBeNull();
  });
});

describe('AggregatorRegistry built-ins', () => {
  const r = new AggregatorRegistry();
  const agg = (name: string, values: unknown[]) => r.get(name)!(values);

  it('sum / product', () => {
    expect(agg('sum', [1, 2, 3, 'x', null])).toBe(6);
    expect(agg('product', [2, 3, 4])).toBe(24);
    expect(agg('product', [])).toBeNull();
  });

  it('count variants', () => {
    expect(agg('count', [1, 2, 'x', null, ''])).toBe(2); // numeric only
    expect(agg('counta', [1, 2, 'x', null, ''])).toBe(3); // non-empty
    expect(agg('countunique', [1, 1, 2, 'a', 'a', null])).toBe(3);
  });

  it('min / max', () => {
    expect(agg('min', [5, 2, 9])).toBe(2);
    expect(agg('max', [5, 2, 9])).toBe(9);
    expect(agg('min', [])).toBeNull();
  });

  it('average / median', () => {
    expect(agg('average', [2, 4, 6])).toBe(4);
    expect(agg('median', [1, 2, 3])).toBe(2);
    expect(agg('median', [1, 2, 3, 4])).toBe(2.5);
    expect(agg('average', [])).toBeNull();
  });

  it('variance / stddev (population)', () => {
    // values 2,4,4,4,5,5,7,9 -> mean 5, variance 4, stddev 2
    const data = [2, 4, 4, 4, 5, 5, 7, 9];
    expect(agg('variance', data)).toBe(4);
    expect(agg('stddev', data)).toBe(2);
  });

  it('addMathMethod registers a custom reducer', () => {
    r.add('range', (values) => {
      const nums = values.map(Number).filter((n) => Number.isFinite(n));
      return nums.length ? Math.max(...nums) - Math.min(...nums) : null;
    });
    expect(r.has('range')).toBe(true);
    expect(agg('range', [3, 10, 7])).toBe(7);
    expect(r.names()).toContain('range');
  });

  it('unknown aggregator resolves to undefined', () => {
    expect(r.get('nope')).toBeUndefined();
  });
});
