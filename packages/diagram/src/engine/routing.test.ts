import { describe, it, expect } from 'vitest';
import {
  StraightRouter,
  ElbowRouter,
  OrthogonalRouter,
  CurvedRouter,
  builtinRouters,
  arrowGeometry,
  resolveEndpoints,
} from './routing.js';
import { segmentIntersectsRect, shapeRect, inflate } from './geometry.js';
import type { ConnectorModel, ShapeModel, Point } from '../contract.js';

function shape(id: string, x: number, y: number, w = 80, h = 60): ShapeModel {
  return { id, type: 'rect', x, y, w, h };
}
function conn(kind: ConnectorModel['kind'], from: string, to: string): ConnectorModel {
  return { id: `${from}-${to}`, from: { shape: from }, to: { shape: to }, kind };
}

function isOrthogonal(pts: Point[]): boolean {
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    const horiz = Math.abs(a.y - b.y) < 1e-6;
    const vert = Math.abs(a.x - b.x) < 1e-6;
    if (!horiz && !vert) return false;
  }
  return true;
}

describe('straight routing', () => {
  it('connects perimeter points with two waypoints', () => {
    const a = shape('a', 0, 0);
    const b = shape('b', 300, 0);
    const r = new StraightRouter().route(conn('straight', 'a', 'b'), a, b, [a, b]);
    expect(r.points.length).toBe(2);
    expect(r.startPoint).toEqual(r.points[0]);
    expect(r.endPoint).toEqual(r.points[r.points.length - 1]);
    // start on a's right edge, end on b's left edge
    expect(r.startPoint.x).toBeCloseTo(80);
    expect(r.endPoint.x).toBeCloseTo(300);
  });

  it('honors explicit ports', () => {
    const a: ShapeModel = {
      ...shape('a', 0, 0),
      ports: [{ id: 'top', side: 'top', offset: { x: 0.5, y: 0 } }],
    };
    const b = shape('b', 300, 0);
    const c = conn('straight', 'a', 'b');
    c.from.port = 'top';
    const r = new StraightRouter().route(c, a, b, [a, b]);
    expect(r.startPoint).toEqual({ x: 40, y: 0 });
  });
});

describe('elbow routing', () => {
  it('produces an axis-aligned (orthogonal) polyline', () => {
    const a = shape('a', 0, 0);
    const b = shape('b', 300, 200);
    const r = new ElbowRouter().route(conn('elbow', 'a', 'b'), a, b, [a, b]);
    expect(r.points.length).toBeGreaterThanOrEqual(2);
    expect(isOrthogonal(r.points)).toBe(true);
  });
});

describe('curved routing', () => {
  it('emits a 3-point skeleton (mid control point)', () => {
    const a = shape('a', 0, 0);
    const b = shape('b', 300, 0);
    const r = new CurvedRouter().route(conn('curved', 'a', 'b'), a, b, [a, b]);
    expect(r.points.length).toBe(3);
  });
});

describe('orthogonal pathfinding', () => {
  it('returns an axis-aligned route', () => {
    const a = shape('a', 0, 100);
    const b = shape('b', 400, 100);
    const r = new OrthogonalRouter().route(conn('orthogonal', 'a', 'b'), a, b, [a, b]);
    expect(isOrthogonal(r.points)).toBe(true);
    expect(r.points.length).toBeGreaterThanOrEqual(2);
  });

  it('routes around an obstacle directly between the endpoints', () => {
    const a = shape('a', 0, 100, 80, 60);
    const b = shape('b', 400, 100, 80, 60);
    // obstacle squarely in the straight path
    const obstacle = shape('o', 200, 90, 80, 80);
    const r = new OrthogonalRouter(12).route(
      conn('orthogonal', 'a', 'b'),
      a,
      b,
      [a, b, obstacle],
    );
    expect(isOrthogonal(r.points)).toBe(true);
    // No segment of the route should cross the inflated obstacle box.
    const obRect = inflate(shapeRect(obstacle), 12);
    let crosses = false;
    for (let i = 0; i < r.points.length - 1; i++) {
      if (segmentIntersectsRect(r.points[i]!, r.points[i + 1]!, obRect)) crosses = true;
    }
    expect(crosses).toBe(false);
  });

  it('keeps endpoints anchored to shape perimeters', () => {
    const a = shape('a', 0, 0);
    const b = shape('b', 300, 300);
    const r = new OrthogonalRouter().route(conn('orthogonal', 'a', 'b'), a, b, [a, b]);
    expect(r.points[0]).toEqual(r.startPoint);
    expect(r.points[r.points.length - 1]).toEqual(r.endPoint);
  });
});

describe('arrowheads', () => {
  it('builds a triangular arrow polygon pointing along the segment', () => {
    const g = arrowGeometry('arrow', { x: 100, y: 0 }, { x: 0, y: 0 }, 10);
    expect(g.polygon.length).toBe(3);
    expect(g.tip).toEqual({ x: 100, y: 0 });
    expect(g.dir.x).toBeCloseTo(1);
    expect(g.dir.y).toBeCloseTo(0);
  });

  it('diamond head yields a 4-point polygon', () => {
    const g = arrowGeometry('diamond', { x: 0, y: 100 }, { x: 0, y: 0 }, 8);
    expect(g.polygon.length).toBe(4);
  });

  it('none head yields an empty polygon', () => {
    const g = arrowGeometry('none', { x: 10, y: 0 }, { x: 0, y: 0 });
    expect(g.polygon.length).toBe(0);
  });
});

describe('builtinRouters / endpoints', () => {
  it('exposes all four connector kinds', () => {
    const kinds = builtinRouters().map((r) => r.kind).sort();
    expect(kinds).toEqual(['curved', 'elbow', 'orthogonal', 'straight']);
  });

  it('resolveEndpoints aims each end at the other shape center', () => {
    const a = shape('a', 0, 0);
    const b = shape('b', 300, 0);
    const e = resolveEndpoints(conn('straight', 'a', 'b'), a, b);
    expect(e.startSide).toBe('right');
    expect(e.endSide).toBe('left');
  });
});
