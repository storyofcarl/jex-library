/**
 * Selection geometry for the cell grid: an active cell plus an optional
 * rectangular range (anchor → focus). Pure value logic so it is trivially
 * unit-testable; the cell-grid surface owns an instance and renders from it.
 */

import type { CellAddress } from '../contract.js';

/** A normalized rectangular block of cells (inclusive bounds). */
export interface CellRange {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

/** The full selection state: where the active cell is + the extended range. */
export interface SelectionState {
  /** The active ("current") cell — where typing lands. */
  active: CellAddress;
  /** The anchor the range extends from (defaults to `active`). */
  anchor: CellAddress;
}

/** Clamp an address into a `[0, rowCount) × [0, colCount)` grid. */
export function clampAddress(addr: CellAddress, rowCount: number, colCount: number): CellAddress {
  return {
    row: Math.max(0, Math.min(rowCount - 1, addr.row)),
    col: Math.max(0, Math.min(colCount - 1, addr.col)),
  };
}

/** The normalized rectangle spanning anchor → active (inclusive). */
export function rangeOf(state: SelectionState): CellRange {
  return {
    top: Math.min(state.anchor.row, state.active.row),
    bottom: Math.max(state.anchor.row, state.active.row),
    left: Math.min(state.anchor.col, state.active.col),
    right: Math.max(state.anchor.col, state.active.col),
  };
}

/** Whether a cell is inside the selection rectangle. */
export function rangeContains(range: CellRange, row: number, col: number): boolean {
  return row >= range.top && row <= range.bottom && col >= range.left && col <= range.right;
}

/** Number of rows × cols a range covers. */
export function rangeSize(range: CellRange): { rows: number; cols: number } {
  return { rows: range.bottom - range.top + 1, cols: range.right - range.left + 1 };
}

/** True when the selection is a single cell. */
export function isSingle(state: SelectionState): boolean {
  return state.active.row === state.anchor.row && state.active.col === state.anchor.col;
}

/** Iterate every address in a range, row-major. */
export function* iterateRange(range: CellRange): Generator<CellAddress> {
  for (let row = range.top; row <= range.bottom; row++) {
    for (let col = range.left; col <= range.right; col++) {
      yield { row, col };
    }
  }
}

/** Address equality. */
export function addrEquals(a: CellAddress, b: CellAddress): boolean {
  return a.row === b.row && a.col === b.col;
}

/**
 * A directional move ("arrow key") from an address, clamped to the grid. Used by
 * both single-cell navigation and shift-extend (which moves the active, keeping
 * the anchor).
 */
export function moveAddress(
  addr: CellAddress,
  dRow: number,
  dCol: number,
  rowCount: number,
  colCount: number,
): CellAddress {
  return clampAddress({ row: addr.row + dRow, col: addr.col + dCol }, rowCount, colCount);
}
