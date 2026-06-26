/**
 * Structural-edit reference transforms.
 *
 * When rows/columns are inserted or deleted, cell *positions* are shifted by the
 * engine's `shiftRows`/`shiftCols`, but every formula that *references* those
 * positions must also be rewritten, otherwise `=A5` keeps reading the old slot.
 * This module rewrites formula sources token-by-token (preserving everything
 * that is not a reference verbatim) and shifts merge regions / frozen panes.
 *
 * Behaviour (matching Excel/Sheets):
 *   - Insert at index `at`, count `n` on an axis: any ref whose coord is `>= at`
 *     moves by `+n` on that axis.
 *   - Delete `[at, at+n)`: a ref *inside* the deleted band becomes `#REF!`; a ref
 *     after the band moves by `-n`.
 *   - Sheet-qualified refs are only transformed when they resolve to the edited
 *     sheet; bare refs are transformed only when the formula lives on the edited
 *     sheet.
 *   - `$`-anchoring is preserved on output.
 *
 * Pure — no engine/DOM state.
 */

import type { MergeRegion, SheetModel } from '../contract.js';
import { columnIndexToLabel, parseA1 } from '../engine/a1.js';
import { tokenize } from '../engine/tokenizer.js';

export type Axis = 'row' | 'col';

interface ShiftSpec {
  axis: Axis;
  /** Insertion/deletion index on the axis. */
  at: number;
  /** Positive for insert, negative for delete. */
  delta: number;
}

/** Resolve a parsed A1 ref's sheet display-name to the edited sheet question. */
function refIsOnEditedSheet(
  refSheet: string | undefined,
  formulaSheetName: string,
  editedSheetName: string,
): boolean {
  const owner = refSheet ?? formulaSheetName;
  return owner.toLowerCase() === editedSheetName.toLowerCase();
}

/** The transformed coordinate, or 'ref' when the cell falls in a deleted band. */
function shiftCoord(coord: number, spec: ShiftSpec): number | 'ref' {
  const { at, delta } = spec;
  if (delta > 0) {
    return coord >= at ? coord + delta : coord;
  }
  const removeStart = at;
  const removeEnd = at - delta - 1; // delta negative
  if (coord >= removeStart && coord <= removeEnd) return 'ref';
  return coord > removeEnd ? coord + delta : coord;
}

/** Re-emit a parsed A1 ref (sheet qualifier preserved) with new row/col. */
function formatRef(
  original: string,
  parsed: ReturnType<typeof parseA1>,
  row: number,
  col: number,
): string {
  const bang = original.lastIndexOf('!');
  const prefix = bang === -1 ? '' : original.slice(0, bang + 1);
  const colStr = (parsed.colAbsolute ? '$' : '') + columnIndexToLabel(col);
  const rowStr = (parsed.rowAbsolute ? '$' : '') + (row + 1);
  return `${prefix}${colStr}${rowStr}`;
}

/**
 * Rewrite a single formula source (no leading `=`) for a structural edit on the
 * sheet named `editedSheetName`. `formulaSheetName` is the sheet the formula
 * itself lives on (so bare refs resolve correctly). Returns the rewritten source.
 */
export function transformFormula(
  source: string,
  formulaSheetName: string,
  editedSheetName: string,
  spec: ShiftSpec,
): string {
  let tokens: ReturnType<typeof tokenize>;
  try {
    tokens = tokenize(source);
  } catch {
    return source; // unparseable — leave as-is
  }
  let out = '';
  let cursor = 0;
  for (const tok of tokens) {
    if (tok.type === 'eof') break;
    // Copy any gap (whitespace) between the previous token and this one verbatim.
    out += source.slice(cursor, tok.pos);
    cursor = tok.pos + tok.text.length;

    if (tok.type !== 'ref') {
      out += tok.text;
      continue;
    }

    let parsed: ReturnType<typeof parseA1>;
    try {
      parsed = parseA1(tok.text);
    } catch {
      out += tok.text;
      continue;
    }
    if (!refIsOnEditedSheet(parsed.sheet, formulaSheetName, editedSheetName)) {
      out += tok.text;
      continue;
    }
    const coord = spec.axis === 'row' ? parsed.row : parsed.col;
    const shifted = shiftCoord(coord, spec);
    if (shifted === 'ref') {
      out += '#REF!';
      continue;
    }
    const newRow = spec.axis === 'row' ? shifted : parsed.row;
    const newCol = spec.axis === 'col' ? shifted : parsed.col;
    out += formatRef(tok.text, parsed, newRow, newCol);
  }
  // Trailing gap after the last real token (before eof).
  out += source.slice(cursor);
  return out;
}

/** Shift a merge region for a structural edit; null when it collapses entirely. */
export function shiftMerge(m: MergeRegion, spec: ShiftSpec): MergeRegion | null {
  const start = spec.axis === 'row' ? m.row : m.col;
  const span = spec.axis === 'row' ? m.rowSpan : m.colSpan;
  let newStart = start;
  let newSpan = span;

  if (spec.delta > 0) {
    if (start >= spec.at) {
      newStart = start + spec.delta;
    } else if (start + span > spec.at) {
      // Insertion inside the merge → grow it.
      newSpan = span + spec.delta;
    }
  } else {
    const removeStart = spec.at;
    const removeEnd = spec.at - spec.delta - 1;
    // Overlap of [start, start+span) with [removeStart, removeEnd].
    const overlapLo = Math.max(start, removeStart);
    const overlapHi = Math.min(start + span - 1, removeEnd);
    const overlap = Math.max(0, overlapHi - overlapLo + 1);
    newSpan = span - overlap;
    if (newSpan <= 0) return null;
    // Shift the start left by the portion of the deleted band before it.
    if (start > removeEnd) {
      newStart = start + spec.delta;
    } else if (start >= removeStart) {
      newStart = removeStart;
    }
  }

  if (spec.axis === 'row') {
    return { ...m, row: newStart, rowSpan: newSpan };
  }
  return { ...m, col: newStart, colSpan: newSpan };
}

/** Shift frozen-pane counts for a structural edit (only when the band is before them). */
export function shiftFrozenCount(count: number, spec: ShiftSpec): number {
  if (spec.delta > 0) {
    return spec.at <= count ? count + spec.delta : count;
  }
  const removeStart = spec.at;
  const removeEnd = spec.at - spec.delta - 1;
  if (removeEnd < count) {
    // Whole deleted band sits within the frozen region.
    return count + spec.delta;
  }
  if (removeStart < count) {
    // Partial overlap — clamp to the deletion start.
    return removeStart;
  }
  return count;
}

/**
 * Apply a structural edit's reference transforms across the whole workbook:
 * rewrite every formula (on every sheet) that references `editedSheet`, and
 * shift that sheet's merges + frozen panes. Mutates the sheets in place.
 */
export function applyStructuralRefTransforms(
  sheets: SheetModel[],
  editedSheet: SheetModel,
  spec: ShiftSpec,
): void {
  for (const sheet of sheets) {
    for (const cell of Object.values(sheet.cells)) {
      if (cell.formula === undefined || cell.formula === '') continue;
      const rewritten = transformFormula(cell.formula, sheet.name, editedSheet.name, spec);
      if (rewritten !== cell.formula) cell.formula = rewritten;
    }
  }

  if (editedSheet.merges) {
    editedSheet.merges = editedSheet.merges
      .map((m) => shiftMerge(m, spec))
      .filter((m): m is MergeRegion => m !== null);
  }
  if (editedSheet.frozen) {
    if (spec.axis === 'row') {
      editedSheet.frozen = { ...editedSheet.frozen, rows: shiftFrozenCount(editedSheet.frozen.rows, spec) };
    } else {
      editedSheet.frozen = { ...editedSheet.frozen, cols: shiftFrozenCount(editedSheet.frozen.cols, spec) };
    }
  }
}
