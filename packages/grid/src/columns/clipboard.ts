/**
 * Clipboard — copy/paste of a cell range as TSV (the de-facto spreadsheet
 * interchange format, round-trips with Excel/Sheets). Framework-free: it
 * serializes a 2-D matrix of values to a TSV string and parses TSV back into a
 * matrix the engine writes into the store.
 *
 * The engine supplies a `ClipboardHost` adapter (read a cell value, write a cell
 * value, know the selection rectangle). This module owns the (de)serialization,
 * the rectangle→matrix mapping, and the paste anchoring/tiling rules.
 */

import type { CellAddress } from '../contract.js';
import { type CellRect, normalizeRect, rectToCells } from './selection.js';

/** Adapter the engine supplies for clipboard read/write. */
export interface ClipboardHost {
  /** The current selection rectangle (top-left/bottom-right), or null. */
  getRange(): CellRect | null;
  /** Display/copy value at a cell. */
  getCellValue(cell: CellAddress): unknown;
  /** Write a parsed value into a cell (the engine validates/persists). */
  setCellValue(cell: CellAddress, value: string): void;
  /** Row count (paste is clipped to bounds). */
  rowCount(): number;
  /** Column count (paste is clipped to bounds). */
  colCount(): number;
}

/** Serialize a value to its clipboard cell text. */
export function cellToText(value: unknown): string {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value);
}

/** Characters that trigger formula interpretation in spreadsheet apps. */
const FORMULA_TRIGGERS = ['=', '+', '-', '@', '\t', '\r'];

/**
 * Guard against formula/CSV injection: a field beginning with `= + - @` or a
 * leading TAB/CR is evaluated as a formula when pasted into Excel/Sheets
 * (e.g. `=cmd|'/c calc'!A1`). Prefixing a single quote makes the spreadsheet
 * treat it as literal text. Applied to copied cell text so a copy→paste into a
 * spreadsheet cannot smuggle in an executable formula.
 */
function guardFormula(s: string): string {
  if (s.length > 0 && FORMULA_TRIGGERS.includes(s[0]!)) return `'${s}`;
  return s;
}

/** Escape a TSV field if it contains tabs/newlines/quotes (Excel rules). */
function escapeField(s: string): string {
  const guarded = guardFormula(s);
  if (/[\t\n\r"]/.test(guarded)) {
    return `"${guarded.replace(/"/g, '""')}"`;
  }
  return guarded;
}

/** Convert a 2-D matrix of strings to a TSV string. */
export function matrixToTSV(matrix: string[][]): string {
  return matrix.map((row) => row.map(escapeField).join('\t')).join('\n');
}

/**
 * Parse a TSV (or CSV-ish) clipboard string into a 2-D matrix. Handles quoted
 * fields with embedded tabs/newlines and doubled-quote escapes.
 */
export function parseTSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const n = text.length;

  const pushField = (): void => {
    row.push(field);
    field = '';
  };
  const pushRow = (): void => {
    pushField();
    rows.push(row);
    row = [];
  };

  while (i < n) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === '\t') {
      pushField();
      i++;
      continue;
    }
    if (ch === '\n') {
      pushRow();
      i++;
      continue;
    }
    if (ch === '\r') {
      // CRLF / lone CR → row break (swallow following \n)
      pushRow();
      i += text[i + 1] === '\n' ? 2 : 1;
      continue;
    }
    field += ch;
    i++;
  }
  // trailing field/row (ignore a single trailing empty row from a final newline)
  if (field !== '' || row.length > 0) pushRow();
  return rows;
}

/**
 * Build the copy payload (TSV) for the host's current selection rectangle.
 * Returns `''` when there is no selection.
 */
export function buildCopyText(host: ClipboardHost): string {
  const rect = host.getRange();
  if (!rect) return '';
  const matrix: string[][] = [];
  for (let r = rect.top; r <= rect.bottom; r++) {
    const line: string[] = [];
    for (let c = rect.left; c <= rect.right; c++) {
      line.push(cellToText(host.getCellValue({ rowIndex: r, colIndex: c })));
    }
    matrix.push(line);
  }
  return matrixToTSV(matrix);
}

/**
 * Apply a pasted TSV string anchored at `anchor`. The matrix is written
 * left-to-right / top-to-bottom from the anchor, clipped to the grid bounds.
 * When the selection is larger than the source and `tile` is true, the source is
 * repeated to fill the selection (spreadsheet behavior). Returns the list of
 * cells actually written.
 */
export function applyPaste(
  host: ClipboardHost,
  text: string,
  anchor: CellAddress,
  opts: { tile?: boolean; selection?: CellRect | null } = {},
): CellAddress[] {
  const matrix = parseTSV(text);
  if (matrix.length === 0) return [];
  const srcRows = matrix.length;
  const srcCols = matrix.reduce((m, r) => Math.max(m, r.length), 0);

  const rowCount = host.rowCount();
  const colCount = host.colCount();
  const written: CellAddress[] = [];

  // Determine the target rectangle: either the explicit selection (tiled) or the
  // source-sized block anchored at `anchor`.
  const sel = opts.selection ?? null;
  const target: CellRect =
    opts.tile && sel
      ? normalizeRect(
          { rowIndex: sel.top, colIndex: sel.left },
          { rowIndex: sel.bottom, colIndex: sel.right },
        )
      : normalizeRect(anchor, {
          rowIndex: anchor.rowIndex + srcRows - 1,
          colIndex: anchor.colIndex + srcCols - 1,
        });

  for (let r = target.top; r <= target.bottom; r++) {
    if (r < 0 || r >= rowCount) continue;
    for (let c = target.left; c <= target.right; c++) {
      if (c < 0 || c >= colCount) continue;
      const sr = (r - target.top) % srcRows;
      const sc = (c - target.left) % srcCols;
      const value = matrix[sr]?.[sc] ?? '';
      const cell = { rowIndex: r, colIndex: c };
      host.setCellValue(cell, value);
      written.push(cell);
    }
  }
  return written;
}

/** Convenience: cells covered by a rectangle (re-exported for feature wiring). */
export function rangeCells(rect: CellRect): CellAddress[] {
  return rectToCells(rect);
}
