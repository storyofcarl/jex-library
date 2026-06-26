/**
 * Default selection model implementation.
 *
 * Supports the five {@link SelectionMode}s declared in the contract:
 *   - `none`   — selection is inert.
 *   - `single` — at most one row id.
 *   - `multi`  — any number of row ids.
 *   - `cell`   — at most one cell address.
 *   - `range`  — a rectangular block of cell addresses.
 *
 * The model is data-only; it notifies a host callback on every change so the
 * engine can repaint affected rows and emit `selectionChange`.
 */

import type { Model, RecordId } from '@jects/core';
import type { CellAddress, SelectionMode, SelectionModel } from '../contract.js';

/** Minimal host surface the selection model needs from the engine. */
export interface SelectionHost<Row extends Model = Model> {
  /** Resolve a row id → its model (for `getSelectedRows`). */
  getRowById(id: RecordId): Row | undefined;
  /** Called after any mutation so the engine can repaint + emit. */
  onChange(): void;
}

function asArray(ids: RecordId | RecordId[]): RecordId[] {
  return Array.isArray(ids) ? ids : [ids];
}

export class DefaultSelectionModel<Row extends Model = Model> implements SelectionModel<Row> {
  private _mode: SelectionMode;
  private readonly ids = new Set<RecordId>();
  private cells: CellAddress[] = [];

  constructor(
    mode: SelectionMode,
    private readonly host: SelectionHost<Row>,
  ) {
    this._mode = mode;
  }

  get mode(): SelectionMode {
    return this._mode;
  }

  /** Change selection mode, clearing incompatible state. */
  setMode(mode: SelectionMode): void {
    if (mode === this._mode) return;
    this._mode = mode;
    this.ids.clear();
    this.cells = [];
    this.host.onChange();
  }

  getSelectedIds(): RecordId[] {
    return [...this.ids];
  }

  getSelectedRows(): Row[] {
    const out: Row[] = [];
    for (const id of this.ids) {
      const row = this.host.getRowById(id);
      if (row) out.push(row);
    }
    return out;
  }

  getSelectedCells(): CellAddress[] {
    return this.cells.map((c) => ({ ...c }));
  }

  isSelected(id: RecordId): boolean {
    return this.ids.has(id);
  }

  /** True if a given cell is in the current cell/range selection. */
  isCellSelected(rowIndex: number, colIndex: number): boolean {
    return this.cells.some((c) => c.rowIndex === rowIndex && c.colIndex === colIndex);
  }

  select(ids: RecordId | RecordId[]): void {
    if (this._mode === 'none') return;
    const list = asArray(ids);
    this.ids.clear();
    if (this._mode === 'single') {
      const first = list[0];
      if (first !== undefined) this.ids.add(first);
    } else {
      for (const id of list) this.ids.add(id);
    }
    this.host.onChange();
  }

  add(ids: RecordId | RecordId[]): void {
    if (this._mode === 'none') return;
    if (this._mode === 'single') {
      this.select(ids);
      return;
    }
    for (const id of asArray(ids)) this.ids.add(id);
    this.host.onChange();
  }

  deselect(ids: RecordId | RecordId[]): void {
    if (this._mode === 'none') return;
    let changed = false;
    for (const id of asArray(ids)) changed = this.ids.delete(id) || changed;
    if (changed) this.host.onChange();
  }

  /** Toggle a single row id (used by click handlers). */
  toggle(id: RecordId): void {
    if (this.ids.has(id)) this.deselect(id);
    else this.add(id);
  }

  selectRange(from: CellAddress, to: CellAddress): void {
    if (this._mode !== 'range' && this._mode !== 'cell') return;
    const r0 = Math.min(from.rowIndex, to.rowIndex);
    const r1 = Math.max(from.rowIndex, to.rowIndex);
    const c0 = Math.min(from.colIndex, to.colIndex);
    const c1 = Math.max(from.colIndex, to.colIndex);
    const cells: CellAddress[] = [];
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) cells.push({ rowIndex: r, colIndex: c });
    }
    this.cells = this._mode === 'cell' ? cells.slice(0, 1) : cells;
    this.host.onChange();
  }

  /** Select a single cell (cell/range modes). */
  selectCell(address: CellAddress): void {
    if (this._mode !== 'range' && this._mode !== 'cell') return;
    this.cells = [{ ...address }];
    this.host.onChange();
  }

  clear(): void {
    if (this.ids.size === 0 && this.cells.length === 0) return;
    this.ids.clear();
    this.cells = [];
    this.host.onChange();
  }
}
