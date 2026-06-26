/**
 * Range sort + column filter — pure value logic over a 2D block of cell values.
 *
 * The widget reads the selected range into a `CellValue[][]`, runs these helpers,
 * and writes the reordered/filtered rows back through the API (so formulas
 * recalc). Kept DOM-free and side-effect-free for unit testing.
 *
 *   - {@link sortRows}  — stable sort of rows by one (or several) key columns,
 *                         ascending/descending, with a spreadsheet type order
 *                         (numbers < strings < booleans < errors < blanks).
 *   - {@link filterRows} — partition rows into the ones a predicate keeps vs the
 *                         ones it hides (the caller hides hidden rows).
 */

import type { CellValue } from '../contract.js';
import { isCellError } from './format.js';

/** Sort direction. */
export type SortDir = 'asc' | 'desc';

/** A single sort key: the (block-local) column index + direction. */
export interface SortKey {
  /** Column index relative to the block's left edge. */
  column: number;
  /** Direction. Default `'asc'`. */
  dir?: SortDir;
}

/**
 * Spreadsheet value-order rank: numbers first, then text, then booleans, then
 * errors, then blanks last (Excel's ascending sort order). Used as the coarse
 * comparator before comparing within a type.
 */
function typeRank(v: CellValue): number {
  if (v === null || v === undefined || v === '') return 5;
  if (isCellError(v)) return 4;
  if (typeof v === 'boolean') return 3;
  if (typeof v === 'string') return 2;
  return 1; // number / Date
}

function toComparable(v: CellValue): number | string {
  if (typeof v === 'number') return v;
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (isCellError(v)) return v.code;
  return String(v ?? '');
}

/** Compare two cell values within the same type rank. */
function compareSameRank(a: CellValue, b: CellValue): number {
  const ca = toComparable(a);
  const cb = toComparable(b);
  if (typeof ca === 'number' && typeof cb === 'number') return ca - cb;
  return String(ca) < String(cb) ? -1 : String(ca) > String(cb) ? 1 : 0;
}

/** Compare two cells for sorting: type rank first, then within-type order. */
function compareCells(a: CellValue, b: CellValue): number {
  const ra = typeRank(a);
  const rb = typeRank(b);
  if (ra !== rb) return ra - rb;
  return compareSameRank(a, b);
}

/**
 * Stable sort of `rows` by one or more `keys`. Returns a NEW array (the input is
 * not mutated). Stability is preserved by tagging each row with its original
 * index and using it as the final tiebreaker.
 */
export function sortRows(rows: CellValue[][], keys: SortKey | SortKey[]): CellValue[][] {
  const keyList = Array.isArray(keys) ? keys : [keys];
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      for (const key of keyList) {
        const dir = key.dir === 'desc' ? -1 : 1;
        const cmp = compareCells(a.row[key.column] ?? null, b.row[key.column] ?? null);
        if (cmp !== 0) return cmp * dir;
      }
      return a.index - b.index; // stable
    })
    .map((r) => r.row);
}

/** The result of filtering: which row indices stay visible vs are hidden. */
export interface FilterResult {
  /** Original indices of rows the predicate kept. */
  visible: number[];
  /** Original indices of rows the predicate hid. */
  hidden: number[];
}

/**
 * Partition `rows` by a predicate over each row's value in `column`. Returns the
 * original row indices in each bucket (the caller hides the `hidden` rows). The
 * predicate receives the cell value and the whole row.
 */
export function filterRows(
  rows: CellValue[][],
  column: number,
  predicate: (value: CellValue, row: CellValue[]) => boolean,
): FilterResult {
  const visible: number[] = [];
  const hidden: number[] = [];
  rows.forEach((row, i) => {
    if (predicate(row[column] ?? null, row)) visible.push(i);
    else hidden.push(i);
  });
  return { visible, hidden };
}

/** A common "value is in a set of allowed strings" filter predicate factory. */
export function valueInSet(allowed: Iterable<string>): (value: CellValue) => boolean {
  const set = new Set([...allowed].map(String));
  return (value) => set.has(String(value ?? ''));
}

/** Distinct (string-rendered) values appearing in a column of a block. */
export function distinctColumnValues(rows: CellValue[][], column: number): string[] {
  const seen = new Set<string>();
  for (const row of rows) seen.add(String(row[column] ?? ''));
  return [...seen];
}
