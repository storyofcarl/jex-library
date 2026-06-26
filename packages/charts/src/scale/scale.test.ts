import { describe, it, expect } from 'vitest';
import { niceStep, niceTicks, niceBounds, defaultNumberFormat } from './scale.js';
import { LinearScale } from './linear-scale.js';
import { LogScale } from './log-scale.js';
import { BandScale } from './category-scale.js';
import { TimeScale } from './time-scale.js';

describe('nice-number helpers', () => {
  it('rounds raw steps to 1/2/5/10 multiples', () => {
    expect(niceStep(0.9)).toBe(1);
    expect(niceStep(1.5)).toBe(2);
    expect(niceStep(3)).toBe(5);
    expect(niceStep(7)).toBe(10);
    expect(niceStep(23)).toBe(50);
  });

  it('produces ticks spanning the domain', () => {
    const ticks = niceTicks(0, 100, 5);
    expect(ticks[0]).toBe(0);
    expect(ticks[ticks.length - 1]).toBeLessThanOrEqual(100);
    // step is a nice 20 → evenly spaced round values.
    expect(ticks).toEqual([0, 20, 40, 60, 80, 100]);
  });

  it('avoids float drift in ticks', () => {
    const ticks = niceTicks(0, 1, 10);
    for (const t of ticks) expect(Number.isFinite(t)).toBe(true);
    expect(ticks).toContain(0.5);
  });

  it('nice bounds enclose the data', () => {
    const [lo, hi] = niceBounds(3, 97, 5);
    expect(lo).toBeLessThanOrEqual(3);
    expect(hi).toBeGreaterThanOrEqual(97);
  });

  it('formats large/small numbers compactly', () => {
    expect(defaultNumberFormat(1500000)).toContain('e');
    expect(defaultNumberFormat(42)).toBe('42');
  });
});

describe('LinearScale', () => {
  it('maps domain to range and inverts', () => {
    const s = new LinearScale({ domain: [0, 10], range: [0, 100] });
    expect(s.scale(5)).toBe(50);
    expect(s.invert(50)).toBe(5);
    expect(s.scale(0)).toBe(0);
    expect(s.scale(10)).toBe(100);
  });

  it('handles inverted ranges (pixel y down)', () => {
    const s = new LinearScale({ domain: [0, 10], range: [100, 0] });
    expect(s.scale(0)).toBe(100);
    expect(s.scale(10)).toBe(0);
  });

  it('produces ticks with positions', () => {
    const s = new LinearScale({ domain: [0, 10], range: [0, 100], nice: true });
    const ticks = s.ticks();
    expect(ticks.length).toBeGreaterThan(1);
    expect(ticks[0]).toHaveProperty('position');
    expect(ticks[0]).toHaveProperty('label');
  });

  it('expands degenerate domains', () => {
    const s = new LinearScale({ domain: [5, 5], range: [0, 100] });
    expect(s.domain[0]).toBeLessThan(s.domain[1]);
  });
});

describe('LogScale', () => {
  it('maps logarithmically', () => {
    const s = new LogScale({ domain: [1, 100], range: [0, 100] });
    expect(s.scale(1)).toBeCloseTo(0, 5);
    expect(s.scale(100)).toBeCloseTo(100, 5);
    expect(s.scale(10)).toBeCloseTo(50, 5);
  });

  it('inverts back to value', () => {
    const s = new LogScale({ domain: [1, 1000], range: [0, 300] });
    expect(s.invert(s.scale(100))).toBeCloseTo(100, 3);
  });

  it('clamps non-positive domains', () => {
    const s = new LogScale({ domain: [0, 100], range: [0, 100] });
    expect(s.domain[0]).toBeGreaterThan(0);
  });

  it('emits power-of-base ticks', () => {
    const s = new LogScale({ domain: [1, 1000], range: [0, 100] });
    const values = s.ticks().map((t) => t.value);
    expect(values).toContain(10);
    expect(values).toContain(100);
  });
});

describe('BandScale', () => {
  it('centers category bands', () => {
    const s = new BandScale({ domain: ['a', 'b', 'c'], range: [0, 300], padding: 0 });
    expect(s.bandwidth).toBeCloseTo(100, 5);
    expect(s.scaleBand('a')).toBeCloseTo(50, 5);
    expect(s.scaleBand('b')).toBeCloseTo(150, 5);
  });

  it('returns NaN for unknown categories', () => {
    const s = new BandScale({ domain: ['a'], range: [0, 100] });
    expect(Number.isNaN(s.scaleBand('z'))).toBe(true);
  });

  it('applies inner padding', () => {
    const s = new BandScale({ domain: ['a', 'b'], range: [0, 200], padding: 0.5 });
    expect(s.bandwidth).toBeCloseTo(50, 5);
  });

  it('exposes band left edges', () => {
    const s = new BandScale({ domain: ['a', 'b'], range: [0, 200], padding: 0 });
    expect(s.bandLeft('a')).toBeCloseTo(0, 5);
    expect(s.bandLeft(1)).toBeCloseTo(100, 5);
  });
});

describe('TimeScale', () => {
  it('maps epoch ms linearly', () => {
    const t0 = Date.UTC(2020, 0, 1);
    const t1 = Date.UTC(2020, 0, 2);
    const s = new TimeScale({ domain: [t0, t1], range: [0, 100] });
    expect(s.scale(t0)).toBeCloseTo(0, 5);
    expect(s.scale(t1)).toBeCloseTo(100, 5);
    expect(s.scale((t0 + t1) / 2)).toBeCloseTo(50, 5);
  });

  it('accepts Date objects', () => {
    const s = new TimeScale({
      domain: [new Date(Date.UTC(2020, 0, 1)), new Date(Date.UTC(2020, 0, 2))],
      range: [0, 100],
    });
    expect(s.scale(new Date(Date.UTC(2020, 0, 1)))).toBeCloseTo(0, 5);
  });

  it('produces calendar ticks', () => {
    const s = new TimeScale({
      domain: [Date.UTC(2020, 0, 1), Date.UTC(2020, 0, 8)],
      range: [0, 700],
    });
    expect(s.ticks().length).toBeGreaterThan(0);
  });
});
