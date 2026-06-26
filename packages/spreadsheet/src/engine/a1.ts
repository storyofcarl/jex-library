/**
 * A1 ↔ index conversion helpers, ref keys, and address parsing.
 *
 * Pure, stateless utilities shared by the tokenizer, parser, evaluator, and
 * (via the contract) the UI. Implements the `A1Helpers` contract surface plus a
 * handful of engine-internal helpers (stable string keys for the dependency
 * graph, range expansion).
 */

import type { A1Address, A1Helpers, CellAddress, CellRef } from '../contract.js';

/** "A" → 0, "Z" → 25, "AA" → 26. Throws on empty/invalid. */
export function columnLabelToIndex(label: string): number {
  const up = label.toUpperCase();
  let n = 0;
  for (let i = 0; i < up.length; i++) {
    const code = up.charCodeAt(i);
    if (code < 65 || code > 90) throw new Error(`Invalid column label: ${label}`);
    n = n * 26 + (code - 64);
  }
  return n - 1;
}

/** 0 → "A", 25 → "Z", 26 → "AA". */
export function columnIndexToLabel(index: number): string {
  if (index < 0 || !Number.isFinite(index)) throw new Error(`Invalid column index: ${index}`);
  let n = Math.floor(index) + 1;
  let label = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    label = String.fromCharCode(65 + rem) + label;
    n = Math.floor((n - 1) / 26);
  }
  return label;
}

/**
 * Parse an A1 string into its parts. Supports an optional sheet qualifier
 * (`Sheet1!`, `'My Sheet'!`) and `$`-anchoring (`$B$3`, `B$3`, `$B3`).
 */
export function parseA1(a1: string): A1Address {
  const raw = a1.trim();
  let sheet: string | undefined;
  let cellPart = raw;

  const bang = splitSheet(raw);
  if (bang) {
    sheet = bang.sheet;
    cellPart = bang.cell;
  }

  const m = /^(\$?)([A-Za-z]+)(\$?)(\d+)$/.exec(cellPart);
  if (!m) throw new Error(`Invalid A1 address: ${a1}`);
  const colAbsolute = m[1] === '$';
  const col = columnLabelToIndex(m[2] as string);
  const rowAbsolute = m[3] === '$';
  const row = parseInt(m[4] as string, 10) - 1;
  if (row < 0) throw new Error(`Invalid A1 row: ${a1}`);
  const base = { row, col, rowAbsolute, colAbsolute };
  return sheet === undefined ? base : { ...base, sheet };
}

/** Split a possibly sheet-qualified reference at the (last) top-level `!`. */
function splitSheet(raw: string): { sheet: string; cell: string } | undefined {
  if (raw.startsWith("'")) {
    // Quoted sheet name: 'My ''Sheet'''!A1
    let i = 1;
    let name = '';
    while (i < raw.length) {
      const ch = raw[i];
      if (ch === "'") {
        if (raw[i + 1] === "'") {
          name += "'";
          i += 2;
          continue;
        }
        i++;
        break;
      }
      name += ch;
      i++;
    }
    if (raw[i] === '!') {
      return { sheet: name, cell: raw.slice(i + 1) };
    }
    return undefined;
  }
  const idx = raw.lastIndexOf('!');
  if (idx === -1) return undefined;
  return { sheet: raw.slice(0, idx), cell: raw.slice(idx + 1) };
}

/** Format a sheet-local address into an A1 string (with optional anchoring). */
export function formatA1(
  address: CellAddress,
  opts?: { rowAbsolute?: boolean; colAbsolute?: boolean },
): string {
  const colPrefix = opts?.colAbsolute ? '$' : '';
  const rowPrefix = opts?.rowAbsolute ? '$' : '';
  return `${colPrefix}${columnIndexToLabel(address.col)}${rowPrefix}${address.row + 1}`;
}

/** Quote a sheet name for A1 output if it needs quoting. */
export function quoteSheetName(name: string): string {
  if (/^[A-Za-z_][A-Za-z0-9_.]*$/.test(name)) return name;
  return `'${name.replace(/'/g, "''")}'`;
}

/** Stable string key for a `CellRef` (used as dependency-graph node id). */
export function refKey(ref: CellRef): string {
  return `${ref.sheet}!${ref.row},${ref.col}`;
}

/** Sheet-local cell key `"row,col"` for the sparse `SheetModel.cells` map. */
export function cellKey(row: number, col: number): string {
  return `${row},${col}`;
}

/** Parse a `"row,col"` key back into an address. */
export function parseCellKey(key: string): CellAddress {
  const [r, c] = key.split(',');
  return { row: parseInt(r as string, 10), col: parseInt(c as string, 10) };
}

/**
 * Build a fully-qualified `CellRef` from an A1 string, resolving any sheet
 * qualifier (display name) to a stable sheet id.
 */
export function toRef(
  a1: string,
  currentSheet: string,
  resolveSheetName: (name: string) => string,
): CellRef {
  const parsed = parseA1(a1);
  const sheet = parsed.sheet ? resolveSheetName(parsed.sheet) : currentSheet;
  return { sheet, row: parsed.row, col: parsed.col };
}

/** Format a `CellRef` into an A1 string (sheet-qualified when off-sheet). */
export function refToA1(
  ref: CellRef,
  currentSheet: string,
  sheetName: (id: string) => string,
): string {
  const base = formatA1({ row: ref.row, col: ref.col });
  if (ref.sheet === currentSheet) return base;
  return `${quoteSheetName(sheetName(ref.sheet))}!${base}`;
}

/** Expand a from/to ref pair into a normalized {top,left,bottom,right} box. */
export function normalizeBox(from: CellRef, to: CellRef): {
  sheet: string;
  top: number;
  left: number;
  bottom: number;
  right: number;
} {
  return {
    sheet: from.sheet,
    top: Math.min(from.row, to.row),
    left: Math.min(from.col, to.col),
    bottom: Math.max(from.row, to.row),
    right: Math.max(from.col, to.col),
  };
}

/** The concrete `A1Helpers` implementation exposed by the engine. */
export const a1Helpers: A1Helpers = {
  columnLabelToIndex,
  columnIndexToLabel,
  parse: parseA1,
  format: formatA1,
  toRef,
  refToA1,
};
