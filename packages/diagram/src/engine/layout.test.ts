import { describe, it, expect } from 'vitest';
import {
  OrthogonalLayout,
  RadialLayout,
  builtinLayouts,
  layoutForMode,
} from './layout.js';
import type { ShapeModel, ConnectorModel, DiagramMode } from '../contract.js';

function shape(id: string, w = 80, h = 50): ShapeModel {
  return { id, type: 'rect', x: 0, y: 0, w, h };
}
function edge(from: string, to: string): ConnectorModel {
  return { id: `${from}-${to}`, from: { shape: from }, to: { shape: to }, kind: 'orthogonal' };
}

/** A small tree: root → a,b ; a → a1,a2 */
function tree(): { shapes: ShapeModel[]; connectors: ConnectorModel[] } {
  return {
    shapes: ['root', 'a', 'b', 'a1', 'a2'].map((id) => shape(id)),
    connectors: [edge('root', 'a'), edge('root', 'b'), edge('a', 'a1'), edge('a', 'a2')],
  };
}

describe('orthogonal (layered tree) layout', () => {
  it('places deeper nodes on successive ranks (down direction)', () => {
    const { shapes, connectors } = tree();
    const res = new OrthogonalLayout().apply(shapes, connectors, { direction: 'down', origin: { x: 0, y: 0 } });
    const yRoot = res.positions.get('root')!.y;
    const yA = res.positions.get('a')!.y;
    const yA1 = res.positions.get('a1')!.y;
    expect(yA).toBeGreaterThan(yRoot);
    expect(yA1).toBeGreaterThan(yA);
  });

  it('centers a parent over its two children in the cross axis', () => {
    const { shapes, connectors } = tree();
    const res = new OrthogonalLayout().apply(shapes, connectors, { direction: 'down' });
    const cx = (id: string) => res.positions.get(id)!.x + 40;
    const parent = cx('a');
    const mid = (cx('a1') + cx('a2')) / 2;
    expect(parent).toBeCloseTo(mid, 1);
  });

  it('does not overlap sibling subtrees', () => {
    const { shapes, connectors } = tree();
    const res = new OrthogonalLayout().apply(shapes, connectors, { direction: 'down', nodeSpacing: 40 });
    // a and b are siblings; a's subtree (a1,a2) must not overlap b in x
    const xa1 = res.positions.get('a1')!.x;
    const xa2 = res.positions.get('a2')!.x;
    const xb = res.positions.get('b')!.x;
    expect(Math.max(xa1, xa2) + 80).toBeLessThanOrEqual(xb + 1);
  });

  it('does not overlap deep (3+ level) sibling subtrees', () => {
    // root → L,R ; L → l1,l2 ; l1 → l1a,l1b ; R → r1,r2 ; r1 → r1a,r1b
    // The deepest grandchildren of L's left branch must stay clear of R's
    // subtree — this is the case the mod accumulation must handle.
    const ids = [
      'root',
      'L', 'R',
      'l1', 'l2', 'r1', 'r2',
      'l1a', 'l1b', 'r1a', 'r1b',
    ];
    const shapes = ids.map((id) => shape(id));
    const connectors = [
      edge('root', 'L'), edge('root', 'R'),
      edge('L', 'l1'), edge('L', 'l2'),
      edge('R', 'r1'), edge('R', 'r2'),
      edge('l1', 'l1a'), edge('l1', 'l1b'),
      edge('r1', 'r1a'), edge('r1', 'r1b'),
    ];
    const gap = 40;
    const res = new OrthogonalLayout().apply(shapes, connectors, {
      direction: 'down',
      nodeSpacing: gap,
    });
    // Group nodes by their rank (y) and assert no horizontal overlap within a rank.
    const byRank = new Map<number, Array<{ x: number; w: number }>>();
    for (const id of ids) {
      const p = res.positions.get(id)!;
      const y = Math.round(p.y);
      const arr = byRank.get(y) ?? [];
      arr.push({ x: p.x, w: 80 });
      byRank.set(y, arr);
    }
    for (const row of byRank.values()) {
      row.sort((a, b) => a.x - b.x);
      for (let i = 1; i < row.length; i++) {
        const prev = row[i - 1]!;
        const cur = row[i]!;
        // No overlap: next box starts at or after the previous box's right edge.
        expect(cur.x).toBeGreaterThanOrEqual(prev.x + prev.w - 0.5);
      }
    }
  });

  it('lays out left-to-right when direction is right (PERT-style)', () => {
    const { shapes, connectors } = tree();
    const res = new OrthogonalLayout().apply(shapes, connectors, { direction: 'right' });
    expect(res.positions.get('a')!.x).toBeGreaterThan(res.positions.get('root')!.x);
  });

  it('reports content bounds', () => {
    const { shapes, connectors } = tree();
    const res = new OrthogonalLayout().apply(shapes, connectors, {});
    expect(res.bounds).toBeDefined();
    expect(res.bounds!.width).toBeGreaterThan(0);
  });

  it('leaves isolated nodes at their original position', () => {
    const shapes = [shape('lonely')];
    shapes[0]!.x = 999;
    shapes[0]!.y = 888;
    const res = new OrthogonalLayout().apply(shapes, [], {});
    expect(res.positions.get('lonely')).toEqual({ x: 999, y: 888 });
  });
});

describe('radial (mind-map) layout', () => {
  it('places the hub at the origin and children on rings', () => {
    const { shapes, connectors } = tree();
    const origin = { x: 500, y: 500 };
    const res = new RadialLayout().apply(shapes, connectors, { origin, rankSpacing: 120 });
    const hub = res.positions.get('root')!;
    // hub box centered on origin
    expect(hub.x + 40).toBeCloseTo(origin.x, 1);
    expect(hub.y + 25).toBeCloseTo(origin.y, 1);
    // depth-2 node a1 is farther from origin than depth-1 node a
    const distFrom = (id: string) => {
      const p = res.positions.get(id)!;
      return Math.hypot(p.x + 40 - origin.x, p.y + 25 - origin.y);
    };
    expect(distFrom('a1')).toBeGreaterThan(distFrom('a'));
  });
});

describe('mode → layout rules', () => {
  const cases: Array<[DiagramMode, string]> = [
    ['flowchart', 'orthogonal'],
    ['orgchart', 'orthogonal'],
    ['mindmap', 'radial'],
    ['pert', 'orthogonal'],
  ];
  it.each(cases)('mode %s defaults to %s layout', (mode, kind) => {
    expect(layoutForMode(mode).kind).toBe(kind);
  });

  it('flowchart flows down; pert flows right', () => {
    expect(layoutForMode('flowchart').options.direction).toBe('down');
    expect(layoutForMode('pert').options.direction).toBe('right');
  });

  it('builtinLayouts exposes orthogonal + radial', () => {
    expect(builtinLayouts().map((l) => l.kind).sort()).toEqual(['orthogonal', 'radial']);
  });
});
