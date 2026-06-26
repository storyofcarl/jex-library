/** jsdom unit tests — selection model (cell/row/range) + rectangle helpers. */
import { describe, it, expect, vi } from 'vitest';
import {
  GridSelectionModel,
  normalizeRect,
  rectContains,
  rectToCells,
  type SelectionHost,
} from './selection.js';
import type { Model } from '@jects/core';
import type { SelectionMode } from '../contract.js';

interface Row extends Model {
  id: number;
  name: string;
}
const rows: Row[] = [
  { id: 1, name: 'a' },
  { id: 2, name: 'b' },
  { id: 3, name: 'c' },
];

function host(mode: SelectionMode, onChange = vi.fn()): SelectionHost<Row> {
  return {
    mode,
    rowCount: () => rows.length,
    colCount: () => 3,
    idAt: (i) => rows[i]?.id,
    indexOf: (id) => rows.findIndex((r) => r.id === id),
    rowById: (id) => rows.find((r) => r.id === id),
    onChange,
  };
}

describe('rectangle helpers', () => {
  it('normalizeRect orders corners', () => {
    expect(normalizeRect({ rowIndex: 3, colIndex: 4 }, { rowIndex: 1, colIndex: 2 })).toEqual({
      top: 1,
      left: 2,
      bottom: 3,
      right: 4,
    });
  });
  it('rectContains + rectToCells', () => {
    const r = { top: 0, left: 0, bottom: 1, right: 1 };
    expect(rectContains(r, { rowIndex: 1, colIndex: 1 })).toBe(true);
    expect(rectContains(r, { rowIndex: 2, colIndex: 0 })).toBe(false);
    expect(rectToCells(r)).toHaveLength(4);
  });
});

describe('row selection (single / multi)', () => {
  it('single keeps only the last id', () => {
    const m = new GridSelectionModel(host('single'));
    m.select([1, 2]);
    expect(m.getSelectedIds()).toEqual([2]);
  });

  it('multi add/deselect/toggle', () => {
    const onChange = vi.fn();
    const m = new GridSelectionModel(host('multi', onChange));
    m.select(1);
    m.add([2, 3]);
    expect(m.getSelectedIds()).toEqual([1, 2, 3]);
    m.deselect(2);
    expect(m.getSelectedIds()).toEqual([1, 3]);
    expect(m.toggle(1)).toBe(false);
    expect(m.isSelected(1)).toBe(false);
    expect(onChange).toHaveBeenCalled();
  });

  it('getSelectedRows resolves models', () => {
    const m = new GridSelectionModel(host('multi'));
    m.select([1, 3]);
    expect(m.getSelectedRows().map((r) => r.name)).toEqual(['a', 'c']);
  });

  it('none mode ignores selection', () => {
    const m = new GridSelectionModel(host('none'));
    m.select(1);
    expect(m.getSelectedIds()).toEqual([]);
  });
});

describe('cell / range selection', () => {
  it('selectCell sets a 1x1 rect + anchor + focus', () => {
    const m = new GridSelectionModel(host('range'));
    m.selectCell({ rowIndex: 1, colIndex: 1 });
    expect(m.getRect()).toEqual({ top: 1, left: 1, bottom: 1, right: 1 });
    expect(m.getAnchor()).toEqual({ rowIndex: 1, colIndex: 1 });
    expect(m.isCellSelected({ rowIndex: 1, colIndex: 1 })).toBe(true);
  });

  it('selectRange builds a normalized rectangle', () => {
    const m = new GridSelectionModel(host('range'));
    m.selectRange({ rowIndex: 2, colIndex: 2 }, { rowIndex: 0, colIndex: 0 });
    expect(m.getRect()).toEqual({ top: 0, left: 0, bottom: 2, right: 2 });
    expect(m.getSelectedCells()).toHaveLength(9);
  });

  it('extendTo grows from the anchor', () => {
    const m = new GridSelectionModel(host('range'));
    m.selectCell({ rowIndex: 0, colIndex: 0 });
    m.extendTo({ rowIndex: 1, colIndex: 2 });
    expect(m.getRect()).toEqual({ top: 0, left: 0, bottom: 1, right: 2 });
  });

  it('cell mode keeps selection to a single cell on extend', () => {
    const m = new GridSelectionModel(host('cell'));
    m.selectRange({ rowIndex: 0, colIndex: 0 }, { rowIndex: 2, colIndex: 2 });
    // cell mode collapses to the `to` cell
    expect(m.getRect()).toEqual({ top: 2, left: 2, bottom: 2, right: 2 });
  });

  it('range over row modes selects spanned rows', () => {
    const m = new GridSelectionModel(host('multi'));
    m.selectRange({ rowIndex: 0, colIndex: 0 }, { rowIndex: 2, colIndex: 0 });
    expect(m.getSelectedIds()).toEqual([1, 2, 3]);
  });

  it('clear resets everything and emits once when non-empty', () => {
    const onChange = vi.fn();
    const m = new GridSelectionModel(host('range', onChange));
    m.selectCell({ rowIndex: 0, colIndex: 0 });
    onChange.mockClear();
    m.clear();
    expect(m.getRect()).toBeNull();
    expect(m.getAnchor()).toBeNull();
    expect(onChange).toHaveBeenCalledTimes(1);
    onChange.mockClear();
    m.clear(); // already empty → no emit
    expect(onChange).not.toHaveBeenCalled();
  });
});
