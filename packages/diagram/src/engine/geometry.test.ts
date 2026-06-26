import { describe, it, expect } from 'vitest';
import {
  clamp,
  dist,
  perimeterPoint,
  sideOf,
  rectContains,
  rectsIntersect,
  inflate,
  unionRects,
  distToSegment,
  distToPolyline,
  segmentIntersectsRect,
  segmentsIntersect,
  simplifyPath,
} from './geometry.js';

describe('scalar + point math', () => {
  it('clamps into range', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
  });
  it('computes euclidean distance', () => {
    expect(dist({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });
});

describe('rect ops', () => {
  const r = { x: 0, y: 0, width: 100, height: 60 };
  it('rectContains respects padding', () => {
    expect(rectContains(r, { x: 50, y: 30 })).toBe(true);
    expect(rectContains(r, { x: -2, y: 30 })).toBe(false);
    expect(rectContains(r, { x: -2, y: 30 }, 4)).toBe(true);
  });
  it('rectsIntersect detects overlap', () => {
    expect(rectsIntersect(r, { x: 50, y: 30, width: 100, height: 60 })).toBe(true);
    expect(rectsIntersect(r, { x: 200, y: 0, width: 10, height: 10 })).toBe(false);
  });
  it('inflate grows all sides', () => {
    expect(inflate(r, 5)).toEqual({ x: -5, y: -5, width: 110, height: 70 });
  });
  it('unionRects bounds all', () => {
    const u = unionRects([r, { x: 200, y: 100, width: 50, height: 50 }]);
    expect(u).toEqual({ x: 0, y: 0, width: 250, height: 150 });
  });
});

describe('perimeter + side', () => {
  const r = { x: 0, y: 0, width: 100, height: 60 };
  it('finds the perimeter point toward a target', () => {
    const p = perimeterPoint(r, { x: 1000, y: 30 });
    expect(p.x).toBeCloseTo(100);
    expect(p.y).toBeCloseTo(30);
  });
  it('classifies the side a perimeter point sits on', () => {
    expect(sideOf(r, { x: 100, y: 30 })).toBe('right');
    expect(sideOf(r, { x: 0, y: 30 })).toBe('left');
    expect(sideOf(r, { x: 50, y: 0 })).toBe('top');
    expect(sideOf(r, { x: 50, y: 60 })).toBe('bottom');
  });
});

describe('segment math', () => {
  it('distToSegment clamps to endpoints', () => {
    expect(distToSegment({ x: 5, y: 5 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(5);
    expect(distToSegment({ x: -5, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(5);
  });
  it('distToPolyline finds the nearest segment', () => {
    const poly = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }];
    expect(distToPolyline({ x: 10, y: 5 }, poly)).toBe(0);
    expect(distToPolyline({ x: 12, y: 5 }, poly)).toBe(2);
  });
  it('segmentsIntersect detects crossing', () => {
    expect(segmentsIntersect({ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 10, y: 0 })).toBe(true);
    expect(segmentsIntersect({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 5 }, { x: 1, y: 5 })).toBe(false);
  });
  it('segmentIntersectsRect detects a line crossing a box', () => {
    const box = { x: 40, y: 40, width: 20, height: 20 };
    expect(segmentIntersectsRect({ x: 0, y: 50 }, { x: 100, y: 50 }, box)).toBe(true);
    expect(segmentIntersectsRect({ x: 0, y: 0 }, { x: 10, y: 0 }, box)).toBe(false);
  });
});

describe('simplifyPath', () => {
  it('collapses collinear and duplicate points', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 10, y: 0 }, // collinear horizontal
      { x: 10, y: 0 }, // dup
      { x: 10, y: 10 },
    ];
    expect(simplifyPath(pts)).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ]);
  });
  it('leaves a 2-point path untouched', () => {
    const pts = [{ x: 0, y: 0 }, { x: 1, y: 1 }];
    expect(simplifyPath(pts)).toEqual(pts);
  });
});
