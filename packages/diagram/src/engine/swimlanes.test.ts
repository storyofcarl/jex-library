import { describe, it, expect } from 'vitest';
import {
  laneOf,
  shapesInLane,
  childLanes,
  rootLanes,
  clampToLane,
} from './swimlanes.js';
import type { ShapeModel, SwimlaneModel } from '../contract.js';

const lanes: SwimlaneModel[] = [
  { id: 'pool', orientation: 'horizontal', x: 0, y: 0, w: 400, h: 200 },
  { id: 'laneA', orientation: 'horizontal', x: 0, y: 0, w: 400, h: 100, parent: 'pool', order: 0 },
  { id: 'laneB', orientation: 'horizontal', x: 0, y: 100, w: 400, h: 100, parent: 'pool', order: 1 },
];

function shape(id: string, x: number, y: number, over: Partial<ShapeModel> = {}): ShapeModel {
  return { id, type: 'rect', x, y, w: 40, h: 30, ...over };
}

describe('lane membership', () => {
  it('resolves the innermost lane containing the shape center', () => {
    const s = shape('s', 50, 20); // center (70,35) → laneA
    expect(laneOf(s, lanes)?.id).toBe('laneA');
  });

  it('honors an explicit lane id over geometry', () => {
    const s = shape('s', 50, 20, { lane: 'laneB' });
    expect(laneOf(s, lanes)?.id).toBe('laneB');
  });

  it('returns undefined when the shape sits outside every lane', () => {
    const s = shape('s', 1000, 1000);
    expect(laneOf(s, lanes)).toBeUndefined();
  });

  it('shapesInLane collects members by resolved membership', () => {
    const shapes = [shape('a', 10, 10), shape('b', 10, 120), shape('c', 10, 30)];
    expect(shapesInLane('laneA', shapes, lanes).map((s) => s.id).sort()).toEqual(['a', 'c']);
    expect(shapesInLane('laneB', shapes, lanes).map((s) => s.id)).toEqual(['b']);
  });
});

describe('lane hierarchy', () => {
  it('childLanes returns ordered direct children', () => {
    expect(childLanes('pool', lanes).map((l) => l.id)).toEqual(['laneA', 'laneB']);
  });
  it('rootLanes returns lanes with no parent', () => {
    expect(rootLanes(lanes).map((l) => l.id)).toEqual(['pool']);
  });
});

describe('clampToLane', () => {
  it('pulls a shape back inside its lane box', () => {
    const s = shape('s', 380, 90, { lane: 'laneA' }); // overflows right + bottom of laneA
    const patch = clampToLane(s, lanes, 4);
    expect(patch).not.toBeNull();
    expect(patch!.x).toBeLessThanOrEqual(400 - 40 - 4);
    expect(patch!.y).toBeLessThanOrEqual(100 - 30 - 4);
  });
  it('returns null when already inside', () => {
    const s = shape('s', 50, 20, { lane: 'laneA' });
    expect(clampToLane(s, lanes)).toBeNull();
  });
  it('returns null when the shape has no lane', () => {
    const s = shape('s', 1000, 1000);
    expect(clampToLane(s, lanes)).toBeNull();
  });
});
