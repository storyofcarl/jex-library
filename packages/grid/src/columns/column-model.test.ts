/** jsdom unit tests — column model geometry: resize, reorder, hide, frozen, flex, auto-width. */
import { describe, it, expect } from 'vitest';
import { ColumnModel, clampWidth, columnId } from './column-model.js';
import type { ColumnDef } from '../contract.js';

interface Row {
  id: number;
  name: string;
  age: number;
}

const cols = (): ColumnDef<Row>[] => [
  { field: 'name', width: 200 },
  { field: 'age', type: 'number', width: 80 },
  { field: 'id', width: 100 },
];

describe('ColumnModel — resolve geometry', () => {
  it('lays out fixed-width columns with sequential left offsets', () => {
    const m = new ColumnModel<Row>(cols());
    const layout = m.resolve(1000);
    expect(layout.all).toHaveLength(3);
    expect(layout.all.map((c) => c.width)).toEqual([200, 80, 100]);
    expect(layout.all.map((c) => c.left)).toEqual([0, 200, 280]);
    expect(layout.centerWidth).toBe(380);
  });

  it('distributes leftover space across flex columns proportionally', () => {
    const m = new ColumnModel<Row>([
      { field: 'name', flex: 1, minWidth: 50 },
      { field: 'age', flex: 3, minWidth: 50 },
    ]);
    const layout = m.resolve(450); // 450 - (50+50) base = 350 leftover; 1:3 split
    const [a, b] = layout.all;
    expect(Math.round(a!.width)).toBe(50 + Math.round(350 / 4));
    expect(Math.round(b!.width)).toBe(50 + Math.round((350 * 3) / 4));
    expect(Math.round(a!.width + b!.width)).toBe(450);
  });

  it('defaults alignment by type (number → end, check → center)', () => {
    const m = new ColumnModel<Row>([
      { field: 'name' },
      { field: 'age', type: 'number' },
      { field: 'id', type: 'check' },
    ]);
    const layout = m.resolve(600);
    expect(layout.all.map((c) => c.align)).toEqual(['start', 'end', 'center']);
  });
});

describe('ColumnModel — frozen split regions', () => {
  it('splits into left / center / right regions, each positioned from x=0', () => {
    const m = new ColumnModel<Row>([
      { field: 'name', width: 120, frozen: 'left' },
      { field: 'age', width: 80 },
      { field: 'id', width: 60, frozen: 'right' },
    ]);
    const layout = m.resolve(800);
    expect(layout.left.map((c) => c.id)).toEqual(['name']);
    expect(layout.center.map((c) => c.id)).toEqual(['age']);
    expect(layout.right.map((c) => c.id)).toEqual(['id']);
    expect(layout.left[0]!.left).toBe(0);
    expect(layout.right[0]!.left).toBe(0);
    expect(layout.leftWidth).toBe(120);
    expect(layout.rightWidth).toBe(60);
    // visual order: left ++ center ++ right
    expect(layout.all.map((c) => c.id)).toEqual(['name', 'age', 'id']);
  });

  it('setFrozen moves a column into a region', () => {
    const m = new ColumnModel<Row>(cols());
    m.setFrozen('age', 'left');
    const layout = m.resolve(800);
    expect(layout.left.map((c) => c.id)).toContain('age');
    m.setFrozen('age', null);
    expect(m.resolve(800).left).toHaveLength(0);
  });
});

describe('ColumnModel — resize', () => {
  it('setWidth clamps to min/max and persists as an override', () => {
    const m = new ColumnModel<Row>([{ field: 'name', width: 100, minWidth: 60, maxWidth: 300 }]);
    expect(m.setWidth('name', 1000)).toBe(300);
    expect(m.setWidth('name', 10)).toBe(60);
    expect(m.setWidth('name', 150)).toBe(150);
    expect(m.resolve(800).all[0]!.width).toBe(150);
  });

  it('clampWidth helper respects defaults', () => {
    expect(clampWidth({ field: 'x' }, 5)).toBe(40); // default min
  });
});

describe('ColumnModel — reorder', () => {
  it('moves a column to a new index and reports from/to', () => {
    const m = new ColumnModel<Row>(cols());
    const res = m.move(0, 2);
    expect(res).toEqual({ fromIndex: 0, toIndex: 2 });
    expect(m.getColumns().map((c, i) => columnId(c, i))).toEqual(['age', 'id', 'name']);
  });

  it('move is a no-op for out-of-range / identity', () => {
    const m = new ColumnModel<Row>(cols());
    expect(m.move(0, 0)).toBeNull();
    expect(m.move(5, 1)).toBeNull();
  });

  it('moveBefore positions a column before a target id', () => {
    const m = new ColumnModel<Row>(cols());
    m.moveBefore('id', 'name');
    expect(m.getColumns().map((c, i) => columnId(c, i))).toEqual(['id', 'name', 'age']);
  });
});

describe('ColumnModel — hide / show', () => {
  it('hidden columns drop out of resolved layout but remain in the model', () => {
    const m = new ColumnModel<Row>(cols());
    m.setHidden('age', true);
    expect(m.resolve(800).all.map((c) => c.id)).toEqual(['name', 'id']);
    expect(m.getColumns()).toHaveLength(3);
    expect(m.toggleHidden('age')).toBe(false); // now visible again
    expect(m.resolve(800).all).toHaveLength(3);
  });
});

describe('ColumnModel — auto-width', () => {
  it('auto-sizes to measured content + padding, clamped', () => {
    const m = new ColumnModel<Row>([{ field: 'name', width: 50, maxWidth: 500 }]);
    const w = m.autoSize('name', () => 120, 24);
    expect(w).toBe(144);
    expect(m.resolve(800).all[0]!.width).toBe(144);
  });
});
