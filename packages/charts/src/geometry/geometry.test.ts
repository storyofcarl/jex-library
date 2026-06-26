import { describe, it, expect } from 'vitest';
import { linePath, splinePath, areaPath, rectPath } from './path.js';
import { pieSlices, arcPath, polarToCartesian } from './arc.js';
import { radarPoints, radarGridRing } from './radar.js';
import { squarify } from './treemap.js';

describe('path builders', () => {
  it('linePath emits M then L commands', () => {
    const d = linePath([
      { x: 0, y: 0 },
      { x: 10, y: 20 },
      { x: 20, y: 5 },
    ]);
    expect(d.startsWith('M0,0')).toBe(true);
    expect(d).toContain('L10,20');
    expect(d).toContain('L20,5');
  });

  it('linePath breaks on NaN gaps', () => {
    const d = linePath([
      { x: 0, y: 0 },
      { x: 10, y: NaN },
      { x: 20, y: 5 },
    ]);
    // After the gap, the next valid point starts a new sub-path with M.
    expect((d.match(/M/g) ?? []).length).toBe(2);
  });

  it('splinePath emits cubic C commands for >=3 points', () => {
    const d = splinePath([
      { x: 0, y: 0 },
      { x: 10, y: 20 },
      { x: 20, y: 5 },
      { x: 30, y: 25 },
    ]);
    expect(d).toContain('C');
    expect(d.startsWith('M0,0')).toBe(true);
  });

  it('splinePath falls back to a line for <3 points', () => {
    const d = splinePath([
      { x: 0, y: 0 },
      { x: 10, y: 10 },
    ]);
    expect(d).not.toContain('C');
  });

  it('areaPath closes back to the baseline', () => {
    const d = areaPath(
      [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ],
      50,
    );
    expect(d.endsWith('Z')).toBe(true);
    expect(d).toContain('L10,50');
    expect(d).toContain('L0,50');
  });

  it('rectPath draws a closed rectangle', () => {
    const d = rectPath(0, 0, 10, 20);
    expect(d).toBe('M0,0h10v20h-10Z');
  });
});

describe('arc / pie geometry', () => {
  it('pieSlices sum to a full turn', () => {
    const slices = pieSlices([1, 1, 2]);
    const total = slices[slices.length - 1]!.endAngle - slices[0]!.startAngle;
    expect(total).toBeCloseTo(Math.PI * 2, 5);
  });

  it('pieSlices fractions sum to 1', () => {
    const slices = pieSlices([3, 1]);
    expect(slices[0]!.fraction).toBeCloseTo(0.75, 5);
    expect(slices[1]!.fraction).toBeCloseTo(0.25, 5);
  });

  it('treats negative values as zero', () => {
    const slices = pieSlices([10, -5]);
    expect(slices[1]!.fraction).toBe(0);
  });

  it('polarToCartesian places angle 0 at top', () => {
    const p = polarToCartesian(0, 0, 10, 0);
    expect(p.x).toBeCloseTo(0, 5);
    expect(p.y).toBeCloseTo(-10, 5);
  });

  it('arcPath wedge starts at center for solid pie', () => {
    const d = arcPath(50, 50, 40, 0, 0, Math.PI / 2);
    expect(d.startsWith('M50,50')).toBe(true);
    expect(d).toContain('A40,40');
    expect(d.endsWith('Z')).toBe(true);
  });

  it('arcPath donut segment has two arcs', () => {
    const d = arcPath(50, 50, 40, 20, 0, Math.PI / 2);
    expect((d.match(/A/g) ?? []).length).toBe(2);
  });
});

describe('radar geometry', () => {
  it('maps values onto axes radiating from center', () => {
    const pts = radarPoints([10, 10, 10], 3, 0, 0, 100, 0, 10);
    expect(pts.length).toBe(3);
    // First axis points straight up.
    expect(pts[0]!.x).toBeCloseTo(0, 5);
    expect(pts[0]!.y).toBeCloseTo(-100, 5);
  });

  it('clamps values to [0,radius]', () => {
    const pts = radarPoints([20], 1, 0, 0, 100, 0, 10);
    const dist = Math.hypot(pts[0]!.x, pts[0]!.y);
    expect(dist).toBeLessThanOrEqual(100.001);
  });

  it('grid ring has one vertex per axis', () => {
    expect(radarGridRing(5, 0, 0, 50).length).toBe(5);
  });
});

describe('treemap squarify', () => {
  it('produces one rect per positive value', () => {
    const rects = squarify(
      [
        { index: 0, value: 6 },
        { index: 1, value: 3 },
        { index: 2, value: 1 },
      ],
      0,
      0,
      100,
      100,
    );
    expect(rects.length).toBe(3);
  });

  it('rect areas are proportional to values', () => {
    const rects = squarify(
      [
        { index: 0, value: 3 },
        { index: 1, value: 1 },
      ],
      0,
      0,
      100,
      100,
    );
    const byIndex = new Map(rects.map((r) => [r.index, r]));
    const a0 = byIndex.get(0)!.width * byIndex.get(0)!.height;
    const a1 = byIndex.get(1)!.width * byIndex.get(1)!.height;
    expect(a0 / a1).toBeCloseTo(3, 1);
  });

  it('rects fill the container area', () => {
    const rects = squarify(
      [
        { index: 0, value: 1 },
        { index: 1, value: 1 },
        { index: 2, value: 1 },
        { index: 3, value: 1 },
      ],
      0,
      0,
      100,
      100,
    );
    const total = rects.reduce((s, r) => s + r.width * r.height, 0);
    expect(total).toBeCloseTo(10000, 0);
  });

  it('drops non-positive values', () => {
    const rects = squarify(
      [
        { index: 0, value: 5 },
        { index: 1, value: 0 },
        { index: 2, value: -3 },
      ],
      0,
      0,
      100,
      100,
    );
    expect(rects.length).toBe(1);
  });
});
