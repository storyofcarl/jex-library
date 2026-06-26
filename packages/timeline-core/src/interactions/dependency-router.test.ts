/** jsdom unit tests for the orthogonal dependency router. */
import { describe, it, expect } from 'vitest';
import {
  OrthogonalDependencyRouter,
  routeWaypoints,
  toPath,
  arrowheadPath,
} from './dependency-router.js';
import { TestAxis, makeBar } from './test-harness.js';
import type { DependencyLink, EventBar, RecordId } from '../contract.js';
import type { TestRecord } from './test-harness.js';

const axis = new TestAxis(0.01, 1000, 0);

function barMap(...bars: EventBar<TestRecord>[]): Map<RecordId, EventBar<TestRecord>> {
  const m = new Map<RecordId, EventBar<TestRecord>>();
  for (const b of bars) m.set(b.event.id, b);
  return m;
}

describe('routeWaypoints', () => {
  it('routes a forward FS link with a mid-x vertical jog', () => {
    // from end (dir +1) at (30,10) → to start (dir -1) at (60,40)
    const pts = routeWaypoints({ x: 30, y: 10 }, 1, { x: 60, y: 40 }, -1, 12);
    expect(pts[0]).toEqual({ x: 30, y: 10 });
    expect(pts[pts.length - 1]).toEqual({ x: 60, y: 40 });
    // Every segment is axis-aligned (orthogonal): consecutive points share
    // either x or y.
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!;
      const b = pts[i]!;
      expect(a.x === b.x || a.y === b.y).toBe(true);
    }
    // The vertical jog happens at a single shared mid-x.
    expect(pts.some((p) => p.y === 10)).toBe(true);
    expect(pts.some((p) => p.y === 40)).toBe(true);
  });

  it('routes a backward link out-around-and-back', () => {
    // target is behind the source: from end at (60,10) to start at (20,40).
    const pts = routeWaypoints({ x: 60, y: 10 }, 1, { x: 20, y: 40 }, -1, 12);
    expect(pts[0]).toEqual({ x: 60, y: 10 });
    expect(pts[pts.length - 1]).toEqual({ x: 20, y: 40 });
    // Uses a shared mid-y for the horizontal traversal.
    const midY = (10 + 40) / 2;
    expect(pts.some((p) => p.y === midY)).toBe(true);
  });

  it('dedupes consecutive identical points', () => {
    const pts = routeWaypoints({ x: 0, y: 0 }, 1, { x: 100, y: 0 }, -1, 0);
    for (let i = 1; i < pts.length; i++) {
      expect(pts[i]).not.toEqual(pts[i - 1]);
    }
  });
});

describe('toPath / arrowheadPath', () => {
  it('serializes a polyline to an SVG path', () => {
    expect(toPath([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 20 }])).toBe(
      'M 0 0 L 10 0 L 10 20',
    );
  });

  it('rounds coordinates to 0.01px', () => {
    expect(toPath([{ x: 1.234, y: 5.678 }])).toBe('M 1.23 5.68');
  });

  it('builds a closed triangle arrowhead pointing into the tip', () => {
    const d = arrowheadPath({ x: 60, y: 40 }, -1, 7); // arriving heading +x
    expect(d.startsWith('M 60 40')).toBe(true);
    expect(d.trim().endsWith('Z')).toBe(true);
    // base is behind the tip in -x.
    expect(d).toContain('53');
  });
});

describe('OrthogonalDependencyRouter', () => {
  const a = makeBar(axis, 'a', 'r1', { start: 1000, end: 3000 }, 0, 20); // x10..30
  const b = makeBar(axis, 'b', 'r2', { start: 5000, end: 7000 }, 0, 20); // x50..70

  it('routes FS by default (end → start)', () => {
    const router = new OrthogonalDependencyRouter<TestRecord>({
      rowOffsets: new Map([['r1', 0], ['r2', 100]]),
    });
    const link: DependencyLink = { id: 'l1', fromId: 'a', toId: 'b' };
    const [line] = router.route({ links: [link], bars: barMap(a, b), axis });
    expect(line.from).toEqual({ x: 30, y: 10 }); // a end, row 0
    expect(line.to).toEqual({ x: 50, y: 110 }); // b start, row offset 100
    expect(line.path.startsWith('M 30 10')).toBe(true);
  });

  it('honours explicit terminals (SS link)', () => {
    const router = new OrthogonalDependencyRouter<TestRecord>();
    const link: DependencyLink = {
      id: 'l2',
      fromId: 'a',
      toId: 'b',
      fromSide: 'start',
      toSide: 'start',
    };
    const line = router.routeOne(link, barMap(a, b), axis)!;
    expect(line.from.x).toBe(10); // a start
    expect(line.to.x).toBe(50); // b start
  });

  it('skips links whose endpoint bar is missing', () => {
    const router = new OrthogonalDependencyRouter<TestRecord>();
    const link: DependencyLink = { id: 'l3', fromId: 'a', toId: 'ghost' };
    expect(router.route({ links: [link], bars: barMap(a), axis })).toHaveLength(0);
    expect(router.routeOne(link, barMap(a), axis)).toBeUndefined();
  });

  it('produces an arrowhead at the target terminal', () => {
    const router = new OrthogonalDependencyRouter<TestRecord>();
    const link: DependencyLink = { id: 'l4', fromId: 'a', toId: 'b' };
    const line = router.routeOne(link, barMap(a, b), axis)!;
    const arrow = router.arrowFor(line);
    expect(arrow.startsWith(`M ${line.to.x} ${line.to.y}`)).toBe(true);
    expect(arrow.endsWith('Z')).toBe(true);
  });
});
