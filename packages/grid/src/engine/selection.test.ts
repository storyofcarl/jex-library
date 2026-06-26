import { describe, it, expect, vi } from 'vitest';
import { DefaultSelectionModel } from './selection.js';
import type { SelectionMode } from '../contract.js';

interface Row {
  id: number;
}

function make(mode: SelectionMode) {
  const onChange = vi.fn();
  const rowsById = new Map<number, Row>([
    [1, { id: 1 }],
    [2, { id: 2 }],
    [3, { id: 3 }],
  ]);
  const sel = new DefaultSelectionModel<Row>(mode, {
    getRowById: (id) => rowsById.get(id as number),
    onChange,
  });
  return { sel, onChange };
}

describe('DefaultSelectionModel', () => {
  it('none mode ignores all mutations', () => {
    const { sel, onChange } = make('none');
    sel.select(1);
    sel.add(2);
    expect(sel.getSelectedIds()).toEqual([]);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('single mode keeps at most one id', () => {
    const { sel, onChange } = make('single');
    sel.select(1);
    sel.select(2);
    expect(sel.getSelectedIds()).toEqual([2]);
    expect(sel.isSelected(2)).toBe(true);
    expect(sel.isSelected(1)).toBe(false);
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('multi mode adds/removes/toggles', () => {
    const { sel } = make('multi');
    sel.select([1, 2]);
    sel.add(3);
    expect(sel.getSelectedIds().sort()).toEqual([1, 2, 3]);
    sel.deselect(2);
    expect(sel.getSelectedIds().sort()).toEqual([1, 3]);
    sel.toggle(1);
    expect(sel.getSelectedIds()).toEqual([3]);
    sel.toggle(5);
    expect(sel.getSelectedIds().sort()).toEqual([3, 5]);
  });

  it('getSelectedRows resolves models', () => {
    const { sel } = make('multi');
    sel.select([1, 3]);
    expect(sel.getSelectedRows().map((r) => r.id).sort()).toEqual([1, 3]);
  });

  it('range mode builds a rectangular cell block', () => {
    const { sel } = make('range');
    sel.selectRange({ rowIndex: 1, colIndex: 1 }, { rowIndex: 2, colIndex: 2 });
    const cells = sel.getSelectedCells();
    expect(cells).toHaveLength(4);
    expect(sel.isCellSelected(1, 1)).toBe(true);
    expect(sel.isCellSelected(2, 2)).toBe(true);
    expect(sel.isCellSelected(0, 0)).toBe(false);
  });

  it('cell mode keeps a single cell', () => {
    const { sel } = make('cell');
    sel.selectCell({ rowIndex: 4, colIndex: 0 });
    expect(sel.getSelectedCells()).toEqual([{ rowIndex: 4, colIndex: 0 }]);
    sel.selectRange({ rowIndex: 0, colIndex: 0 }, { rowIndex: 3, colIndex: 3 });
    expect(sel.getSelectedCells()).toHaveLength(1);
  });

  it('clear empties selection and notifies once when non-empty', () => {
    const { sel, onChange } = make('multi');
    sel.select([1, 2]);
    onChange.mockClear();
    sel.clear();
    expect(sel.getSelectedIds()).toEqual([]);
    expect(onChange).toHaveBeenCalledTimes(1);
    onChange.mockClear();
    sel.clear();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('setMode clears incompatible state', () => {
    const { sel } = make('multi');
    sel.select([1, 2]);
    sel.setMode('single');
    expect(sel.mode).toBe('single');
    expect(sel.getSelectedIds()).toEqual([]);
  });
});
