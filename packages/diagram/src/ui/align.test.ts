import { describe, it, expect } from 'vitest';
import { alignShapes, distributeShapes, computeSnap } from './align.js';
import type { ShapeModel } from '../contract.js';

function s(id: string, x: number, y: number, w = 50, h = 40): ShapeModel {
  return { id, type: 'rect', x, y, w, h };
}

describe('align', () => {
  it('aligns left and center-x', () => {
    const shapes = [s('a', 0, 0), s('b', 100, 50), s('c', 30, 100)];
    const left = alignShapes(shapes, 'left');
    expect(left.get('a')!.x).toBe(0);
    expect(left.get('b')!.x).toBe(0);
    expect(left.get('c')!.x).toBe(0);

    const center = alignShapes(shapes, 'center-x');
    // All centers equal.
    const centers = [...center.values()].map((p, i) => p.x + shapes[i].w / 2);
    expect(new Set(centers.map((c) => Math.round(c))).size).toBe(1);
  });

  it('aligns top/bottom', () => {
    const shapes = [s('a', 0, 0), s('b', 0, 200)];
    const top = alignShapes(shapes, 'top');
    expect(top.get('a')!.y).toBe(0);
    expect(top.get('b')!.y).toBe(0);
    const bottom = alignShapes(shapes, 'bottom');
    expect(bottom.get('a')!.y).toBe(200);
  });

  it('returns empty for <2 shapes', () => {
    expect(alignShapes([s('a', 0, 0)], 'left').size).toBe(0);
  });

  it('distributes horizontally with equal gaps', () => {
    const shapes = [s('a', 0, 0), s('b', 60, 0), s('c', 200, 0)];
    const patch = distributeShapes(shapes, 'horizontal');
    expect(patch.has('b')).toBe(true);
    // The middle shape moves so gaps equalize.
    const aRight = 50;
    const bLeft = patch.get('b')!.x;
    const bRight = bLeft + 50;
    const cLeft = 200;
    expect(Math.round(bLeft - aRight)).toBe(Math.round(cLeft - bRight));
  });

  it('needs >=3 shapes to distribute', () => {
    expect(distributeShapes([s('a', 0, 0), s('b', 100, 0)], 'horizontal').size).toBe(0);
  });

  it('snaps an edge to a neighbor and reports a guide line', () => {
    const moving = s('m', 0, 0, 50, 40);
    const other = s('o', 200, 4, 50, 40); // top edge at y=4
    const { position, lines } = computeSnap(moving, { x: 0, y: 2 }, [other], 6);
    expect(position.y).toBe(4);
    expect(lines.some((l) => l.orientation === 'h' && l.pos === 4)).toBe(true);
  });

  it('does not snap when out of threshold', () => {
    const moving = s('m', 0, 0);
    const other = s('o', 500, 500);
    const { lines } = computeSnap(moving, { x: 0, y: 0 }, [other], 6);
    expect(lines.length).toBe(0);
  });
});
