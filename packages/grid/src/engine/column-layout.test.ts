import { describe, it, expect } from 'vitest';
import {
  resolveColumns,
  computeColumnWindow,
  columnId,
  DEFAULT_COLUMN_WIDTH,
  DEFAULT_MIN_COLUMN_WIDTH,
} from './column-layout.js';
import type { ColumnDef } from '../contract.js';

describe('column-layout: resolveColumns', () => {
  it('assigns default widths and sequential left offsets', () => {
    const layout = resolveColumns([{ field: 'a' }, { field: 'b' }]);
    expect(layout.columns).toHaveLength(2);
    expect(layout.columns[0]!.width).toBe(DEFAULT_COLUMN_WIDTH);
    expect(layout.columns[0]!.left).toBe(0);
    expect(layout.columns[1]!.left).toBe(DEFAULT_COLUMN_WIDTH);
    expect(layout.totalWidth).toBe(DEFAULT_COLUMN_WIDTH * 2);
  });

  it('honors explicit width and min/max clamping', () => {
    const layout = resolveColumns([
      { field: 'a', width: 200 },
      { field: 'b', width: 10, minWidth: 50 },
      { field: 'c', width: 999, maxWidth: 300 },
    ]);
    expect(layout.columns[0]!.width).toBe(200);
    expect(layout.columns[1]!.width).toBe(50);
    expect(layout.columns[2]!.width).toBe(300);
  });

  it('skips hidden columns', () => {
    const layout = resolveColumns([{ field: 'a' }, { field: 'b', hidden: true }, { field: 'c' }]);
    expect(layout.columns).toHaveLength(2);
    expect(layout.columns.map((c) => c.id)).toEqual(['a', 'c']);
  });

  it('distributes leftover width across flex columns by weight', () => {
    const layout = resolveColumns(
      [
        { field: 'a', width: 100 },
        { field: 'b', flex: 1 },
        { field: 'c', flex: 3 },
      ],
      900,
    );
    // leftover = 900 - 100 (fixed) = 800, split 1:3 → 200 / 600
    expect(layout.columns[0]!.width).toBe(100);
    expect(layout.columns[1]!.width).toBe(200);
    expect(layout.columns[2]!.width).toBe(600);
  });

  it('flex falls back to min width when no available space', () => {
    const layout = resolveColumns([{ field: 'a', flex: 1 }], 0);
    expect(layout.columns[0]!.width).toBe(DEFAULT_MIN_COLUMN_WIDTH);
  });

  it('partitions frozen columns into bands in display order', () => {
    const layout = resolveColumns([
      { field: 'a', frozen: 'left', width: 80 },
      { field: 'b', width: 100 },
      { field: 'c', frozen: 'right', width: 60 },
      { field: 'd', frozen: 'left', width: 40 },
    ]);
    expect(layout.left.map((c) => c.id)).toEqual(['a', 'd']);
    expect(layout.center.map((c) => c.id)).toEqual(['b']);
    expect(layout.right.map((c) => c.id)).toEqual(['c']);
    expect(layout.leftWidth).toBe(120);
    expect(layout.rightWidth).toBe(60);
    // ordered: left band first, then center, then right; final index re-stamped
    expect(layout.columns.map((c) => c.id)).toEqual(['a', 'd', 'b', 'c']);
    expect(layout.columns.map((c) => c.index)).toEqual([0, 1, 2, 3]);
  });

  it('columnId prefers id, then field, then positional', () => {
    expect(columnId({ id: 'x', field: 'f' } as ColumnDef, 2)).toBe('x');
    expect(columnId({ field: 'f' } as ColumnDef, 2)).toBe('f');
    expect(columnId({} as ColumnDef, 2)).toBe('col-2');
  });
});

describe('column-layout: computeColumnWindow', () => {
  const center = resolveColumns([
    { field: 'a', width: 100 },
    { field: 'b', width: 100 },
    { field: 'c', width: 100 },
    { field: 'd', width: 100 },
    { field: 'e', width: 100 },
  ]).center;

  it('returns the intersecting range plus overscan', () => {
    // scrollLeft 150, width 100 → spans col index 1..2; +1 overscan each side → 0..4
    const w = computeColumnWindow(center, 150, 100, 1);
    expect(w.start).toBe(0);
    expect(w.end).toBe(4);
  });

  it('clamps to bounds', () => {
    const w = computeColumnWindow(center, 0, 1000, 1);
    expect(w.start).toBe(0);
    expect(w.end).toBe(4);
  });

  it('handles empty center band', () => {
    const w = computeColumnWindow([], 0, 100, 1);
    expect(w.start).toBe(0);
    expect(w.end).toBe(-1);
  });
});
