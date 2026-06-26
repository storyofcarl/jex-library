/**
 * Pure A1 ↔ index conversion helpers — implements the contract's `A1Helpers`.
 *
 * Stateless and DOM-free, so the UI (name box, formula bar) and tests can use it
 * without an engine. Mirrors Excel/Sheets A1 notation:
 *   - column index 0 ↔ "A", 25 ↔ "Z", 26 ↔ "AA"
 *   - `parse('Sheet1!$B$3')` → { sheet:'Sheet1', row:2, col:1, rowAbsolute:true, colAbsolute:true }
 *   - `format({ row:2, col:1 })` → "B3"
 */

import type { A1Address, A1Helpers, CellAddress, CellRef } from '../contract.js';

/** "A" → 0, "AA" → 26. Throws on a non-letter label. */
export function columnLabelToIndex(label: string): number {
  const up = label.toUpperCase();
  if (!/^[A-Z]+$/.test(up)) throw new Error(`Invalid column label: "${label}"`);
  let n = 0;
  for (let i = 0; i < up.length; i++) {
    n = n * 26 + (up.charCodeAt(i) - 64); // 'A' === 65 → 1
  }
  return n - 1;
}

/** 0 → "A", 26 → "AA". Throws on a negative index. */
export function columnIndexToLabel(index: number): string {
  if (index < 0 || !Number.isFinite(index)) throw new Error(`Invalid column index: ${index}`);
  let n = Math.floor(index) + 1;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/** Parse an A1 string (optionally sheet-qualified, optionally `$`-anchored). */
export function parseA1(a1: string): A1Address {
  const raw = a1.trim();
  // Split optional sheet prefix at the last '!'.
  let sheet: string | undefined;
  let cellPart = raw;
  const bang = raw.lastIndexOf('!');
  if (bang >= 0) {
    let sheetPart = raw.slice(0, bang);
    cellPart = raw.slice(bang + 1);
    if (sheetPart.startsWith("'") && sheetPart.endsWith("'")) {
      sheetPart = sheetPart.slice(1, -1).replace(/''/g, "'");
    }
    sheet = sheetPart;
  }
  const m = /^(\$?)([A-Za-z]+)(\$?)(\d+)$/.exec(cellPart.trim());
  if (!m) throw new Error(`Invalid A1 address: "${a1}"`);
  const colAbsolute = m[1] === '$';
  const col = columnLabelToIndex(m[2] as string);
  const rowAbsolute = m[3] === '$';
  const row = parseInt(m[4] as string, 10) - 1;
  if (row < 0) throw new Error(`Invalid A1 row in "${a1}"`);
  return sheet === undefined
    ? { row, col, rowAbsolute, colAbsolute }
    : { sheet, row, col, rowAbsolute, colAbsolute };
}

/** Format a (sheet-local) address back into an A1 string. */
export function formatA1(
  address: CellAddress,
  opts?: { rowAbsolute?: boolean; colAbsolute?: boolean },
): string {
  const colMark = opts?.colAbsolute ? '$' : '';
  const rowMark = opts?.rowAbsolute ? '$' : '';
  return `${colMark}${columnIndexToLabel(address.col)}${rowMark}${address.row + 1}`;
}

/** Quote a sheet name for A1 output if it needs it. */
function quoteSheet(name: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? name : `'${name.replace(/'/g, "''")}'`;
}

/** Build a fully-qualified `CellRef` from an A1 string + the current sheet id. */
export function toRef(
  a1: string,
  currentSheet: string,
  resolveSheetName: (name: string) => string,
): CellRef {
  const parsed = parseA1(a1);
  const sheet = parsed.sheet ? resolveSheetName(parsed.sheet) : currentSheet;
  return { sheet, row: parsed.row, col: parsed.col };
}

/** Format a `CellRef` back into a (sheet-qualified when needed) A1 string. */
export function refToA1(ref: CellRef, currentSheet: string, sheetName: (id: string) => string): string {
  const local = formatA1({ row: ref.row, col: ref.col });
  if (ref.sheet === currentSheet) return local;
  return `${quoteSheet(sheetName(ref.sheet))}!${local}`;
}

/** A ready-to-use `A1Helpers` bundle the UI can pass around. */
export const a1Helpers: A1Helpers = {
  columnLabelToIndex,
  columnIndexToLabel,
  parse: parseA1,
  format: formatA1,
  toRef,
  refToA1,
};
