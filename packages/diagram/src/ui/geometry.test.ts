import { describe, it, expect } from 'vitest';
import {
  shapeRect,
  rectCenter,
  pointInRect,
  rectsIntersect,
  rectContainsRect,
  unionRects,
  normalizeRect,
  distToSegment,
  distToPolyline,
  snapScalar,
  snapPoint,
  clamp,
  round,
  resizeRect,
} from './geometry.js';

describe('geometry', () => {
  it('computes shape rect and center', () => {
    const r = shapeRect({ x: 10, y: 20, w: 40, h: 60 });
    expect(r).toEqual({ x: 10, y: 20, width: 40, height: 60 });
    expect(rectCenter(r)).toEqual({ x: 30, y: 50 });
  });

  it('pointInRect respects edges', () => {
    const r = { x: 0, y: 0, width: 10, height: 10 };
    expect(pointInRect({ x: 5, y: 5 }, r)).toBe(true);
    expect(pointInRect({ x: 0, y: 0 }, r)).toBe(true);
    expect(pointInRect({ x: 11, y: 5 }, r)).toBe(false);
  });

  it('detects intersection and containment', () => {
    const a = { x: 0, y: 0, width: 10, height: 10 };
    const b = { x: 5, y: 5, width: 10, height: 10 };
    const c = { x: 2, y: 2, width: 4, height: 4 };
    expect(rectsIntersect(a, b)).toBe(true);
    expect(rectsIntersect(a, { x: 100, y: 100, width: 1, height: 1 })).toBe(false);
    expect(rectContainsRect(a, c)).toBe(true);
    expect(rectContainsRect(c, a)).toBe(false);
  });

  it('unions rects', () => {
    expect(unionRects([])).toBeNull();
    const u = unionRects([
      { x: 0, y: 0, width: 10, height: 10 },
      { x: 20, y: 5, width: 10, height: 10 },
    ]);
    expect(u).toEqual({ x: 0, y: 0, width: 30, height: 15 });
  });

  it('normalizes inverted drag rects', () => {
    expect(normalizeRect({ x: 10, y: 10 }, { x: 2, y: 4 })).toEqual({
      x: 2,
      y: 4,
      width: 8,
      height: 6,
    });
  });

  it('measures distance to a segment and polyline', () => {
    expect(distToSegment({ x: 5, y: 5 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(5);
    expect(distToPolyline({ x: 5, y: 2 }, [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ])).toBe(2);
  });

  it('snaps scalars and points', () => {
    expect(snapScalar(13, 10)).toBe(10);
    expect(snapScalar(16, 10)).toBe(20);
    expect(snapScalar(16, 0)).toBe(16);
    expect(snapPoint({ x: 13, y: 27 }, 10)).toEqual({ x: 10, y: 30 });
  });

  it('clamps and rounds', () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-1, 0, 3)).toBe(0);
    expect(round(1.23456, 2)).toBe(1.23);
  });

  it('resizes via handles with a minimum size', () => {
    const r = { x: 0, y: 0, width: 100, height: 100 };
    const se = resizeRect(r, 'se', 20, 30);
    expect(se).toEqual({ x: 0, y: 0, width: 120, height: 130 });

    const nw = resizeRect(r, 'nw', 10, 10);
    expect(nw).toEqual({ x: 10, y: 10, width: 90, height: 90 });

    // Clamp to min when shrinking past it.
    const clamped = resizeRect(r, 'e', -200, 0, { width: 8, height: 8 });
    expect(clamped.width).toBe(8);
  });
});
