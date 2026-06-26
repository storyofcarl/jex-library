import { describe, it, expect } from 'vitest';
import { averagePoints, minMaxDownsample, type XY } from './aggregate.js';

function ramp(n: number): XY[] {
  return Array.from({ length: n }, (_, i) => ({ x: i, y: i }));
}

describe('averagePoints', () => {
  it('returns the input when already small enough', () => {
    const pts = ramp(5);
    expect(averagePoints(pts, 10)).toEqual(pts);
  });

  it('downsamples to ~targetBuckets points', () => {
    const out = averagePoints(ramp(1000), 50);
    expect(out.length).toBeLessThanOrEqual(50);
    expect(out.length).toBeGreaterThan(2);
  });

  it('preserves first and last points', () => {
    const pts = ramp(1000);
    const out = averagePoints(pts, 20);
    expect(out[0]).toEqual(pts[0]);
    expect(out[out.length - 1]).toEqual(pts[pts.length - 1]);
  });

  it('averages y within buckets (monotone ramp stays monotone)', () => {
    const out = averagePoints(ramp(1000), 20);
    for (let i = 1; i < out.length; i++) {
      expect(out[i]!.y).toBeGreaterThanOrEqual(out[i - 1]!.y);
    }
  });
});

describe('minMaxDownsample', () => {
  it('keeps endpoints and reduces count', () => {
    const pts = ramp(1000);
    const out = minMaxDownsample(pts, 40);
    expect(out[0]).toEqual(pts[0]);
    expect(out[out.length - 1]).toEqual(pts[pts.length - 1]);
    expect(out.length).toBeLessThan(pts.length);
  });

  it('preserves extreme peaks', () => {
    const pts: XY[] = ramp(100);
    pts[50] = { x: 50, y: 9999 };
    const out = minMaxDownsample(pts, 20);
    expect(out.some((p) => p.y === 9999)).toBe(true);
  });
});
