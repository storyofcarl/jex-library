/**
 * Selection — a framework-free `SelectionModel` implementation supporting all
 * contract modes (none/single/multi/cell/range), plus range geometry helpers the
 * clipboard + keyboard-extension features build on.
 *
 * The engine owns row identity (it maps row index ↔ id); this model is supplied a
 * small `SelectionHost` adapter so it stays decoupled from the engine's data
 * access while still resolving ids/rows for the contract methods.
 *
 * Emits a single `change` callback the engine forwards to the `selectionChange`
 * grid event.
 */

import type { Model, RecordId } from '@jects/core';
import type { CellAddress, SelectionMode, SelectionModel } from '../contract.js';

/** Adapter the engine supplies so selection can resolve rows/ids/bounds. */
export interface SelectionHost<Row extends Model = Model> {
  /** Active selection mode. */
  mode: SelectionMode;
  /** Number of rows in the current view. */
  rowCount(): number;
  /** Number of visible columns. */
  colCount(): number;
  /** Row id at a view index. */
  idAt(rowIndex: number): RecordId | undefined;
  /** View index of a row id, or -1. */
  indexOf(id: RecordId): number;
  /** Row model by id. */
  rowById(id: RecordId): Row | undefined;
  /** Notify the engine the selection changed. */
  onChange?(state: { selectedIds: RecordId[]; cells: CellAddress[] }): void;
}

/** Inclusive cell rectangle (normalized so top/left ≤ bottom/right). */
export interface CellRect {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

/** Normalize two corners into a top-left/bottom-right rectangle. */
export function normalizeRect(a: CellAddress, b: CellAddress): CellRect {
  return {
    top: Math.min(a.rowIndex, b.rowIndex),
    bottom: Math.max(a.rowIndex, b.rowIndex),
    left: Math.min(a.colIndex, b.colIndex),
    right: Math.max(a.colIndex, b.colIndex),
  };
}

/** Whether a cell falls within an inclusive rectangle. */
export function rectContains(rect: CellRect, cell: CellAddress): boolean {
  return (
    cell.rowIndex >= rect.top &&
    cell.rowIndex <= rect.bottom &&
    cell.colIndex >= rect.left &&
    cell.colIndex <= rect.right
  );
}

/** Expand a rectangle into the full list of cell addresses it covers. */
export function rectToCells(rect: CellRect): CellAddress[] {
  const cells: CellAddress[] = [];
  for (let r = rect.top; r <= rect.bottom; r++) {
    for (let c = rect.left; c <= rect.right; c++) {
      cells.push({ rowIndex: r, colIndex: c });
    }
  }
  return cells;
}

const cellKey = (c: CellAddress): string => `${c.rowIndex}:${c.colIndex}`;

/**
 * Default selection model. Row-oriented modes (single/multi) track ids; cell/range
 * modes track a cell rectangle (with an anchor for shift-extension). All public
 * methods of the frozen `SelectionModel` are implemented.
 */
export class GridSelectionModel<Row extends Model = Model> implements SelectionModel<Row> {
  /** Selected row ids (single/multi modes). Insertion-ordered. */
  private ids = new Set<RecordId>();
  /** Selected cell rectangle (cell/range modes). */
  private rect: CellRect | null = null;
  /** Range anchor for shift-extension. */
  private anchor: CellAddress | null = null;
  /** The active focused cell (for keyboard nav). */
  private focused: CellAddress | null = null;

  constructor(private host: SelectionHost<Row>) {}

  get mode(): SelectionMode {
    return this.host.mode;
  }

  /** The current focused/active cell, or null. */
  getFocused(): CellAddress | null {
    return this.focused;
  }

  /** Set the focused/active cell (does not change selection). */
  setFocused(cell: CellAddress | null): void {
    this.focused = cell;
  }

  /** The range anchor (range/cell modes). */
  getAnchor(): CellAddress | null {
    return this.anchor;
  }

  /** The selected cell rectangle, or null. */
  getRect(): CellRect | null {
    return this.rect;
  }

  getSelectedIds(): RecordId[] {
    return [...this.ids];
  }

  getSelectedRows(): Row[] {
    const rows: Row[] = [];
    for (const id of this.ids) {
      const row = this.host.rowById(id);
      if (row) rows.push(row);
    }
    return rows;
  }

  getSelectedCells(): CellAddress[] {
    if (this.rect) return rectToCells(this.rect);
    // Row modes: expose each selected row's full width as cells too.
    if (this.ids.size === 0) return [];
    const cols = this.host.colCount();
    const cells: CellAddress[] = [];
    for (const id of this.ids) {
      const r = this.host.indexOf(id);
      if (r < 0) continue;
      for (let c = 0; c < cols; c++) cells.push({ rowIndex: r, colIndex: c });
    }
    return cells;
  }

  isSelected(id: RecordId): boolean {
    return this.ids.has(id);
  }

  /** Whether a specific cell is in the current cell/range selection. */
  isCellSelected(cell: CellAddress): boolean {
    return this.rect != null && rectContains(this.rect, cell);
  }

  select(ids: RecordId | RecordId[]): void {
    if (this.mode === 'none') return;
    const arr = Array.isArray(ids) ? ids : [ids];
    this.ids.clear();
    this.rect = null;
    if (this.mode === 'single' && arr.length > 1) {
      this.ids.add(arr[arr.length - 1]!);
    } else {
      for (const id of arr) this.ids.add(id);
    }
    this.emit();
  }

  add(ids: RecordId | RecordId[]): void {
    if (this.mode === 'none' || this.mode === 'single') {
      return this.select(ids);
    }
    const arr = Array.isArray(ids) ? ids : [ids];
    for (const id of arr) this.ids.add(id);
    this.emit();
  }

  deselect(ids: RecordId | RecordId[]): void {
    const arr = Array.isArray(ids) ? ids : [ids];
    let changed = false;
    for (const id of arr) changed = this.ids.delete(id) || changed;
    if (changed) this.emit();
  }

  /** Toggle a single row id (multi mode); returns the new selected state. */
  toggle(id: RecordId): boolean {
    if (this.ids.has(id)) {
      this.deselect(id);
      return false;
    }
    this.add(id);
    return true;
  }

  selectRange(from: CellAddress, to: CellAddress): void {
    if (this.mode === 'none') return;
    if (this.mode === 'single' || this.mode === 'multi') {
      // Row modes: select every row spanned by the range.
      const top = Math.min(from.rowIndex, to.rowIndex);
      const bottom = Math.max(from.rowIndex, to.rowIndex);
      this.ids.clear();
      for (let r = top; r <= bottom; r++) {
        const id = this.host.idAt(r);
        if (id != null) this.ids.add(id);
      }
      this.rect = null;
      this.anchor = from;
      this.emit();
      return;
    }
    // cell/range modes
    this.anchor = from;
    this.focused = to;
    this.rect = this.mode === 'cell' ? normalizeRect(to, to) : normalizeRect(from, to);
    this.ids.clear();
    this.emit();
  }

  /** Select a single cell (cell/range modes), resetting the anchor. */
  selectCell(cell: CellAddress): void {
    if (this.mode === 'none') return;
    if (this.mode === 'cell' || this.mode === 'range') {
      this.anchor = cell;
      this.focused = cell;
      this.rect = normalizeRect(cell, cell);
      this.ids.clear();
      this.emit();
      return;
    }
    // Row modes: selecting a cell selects its row.
    const id = this.host.idAt(cell.rowIndex);
    this.focused = cell;
    if (id != null) this.select(id);
  }

  /**
   * Extend the selection to `cell` from the current anchor (shift+click / shift+
   * arrow). Falls back to a plain selectCell when there is no anchor.
   */
  extendTo(cell: CellAddress): void {
    if (!this.anchor) {
      this.selectCell(cell);
      return;
    }
    this.selectRange(this.anchor, cell);
  }

  clear(): void {
    const had = this.ids.size > 0 || this.rect != null;
    this.ids.clear();
    this.rect = null;
    this.anchor = null;
    if (had) this.emit();
  }

  private emit(): void {
    this.host.onChange?.({ selectedIds: this.getSelectedIds(), cells: this.getSelectedCells() });
  }
}

/** Stable string keys for a set of cells (useful for renderer diffing). */
export function cellKeys(cells: CellAddress[]): Set<string> {
  return new Set(cells.map(cellKey));
}
