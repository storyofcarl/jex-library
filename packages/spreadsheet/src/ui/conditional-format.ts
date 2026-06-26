/**
 * Conditional-formatting evaluation. Pure value logic: given a sheet's
 * {@link CfRule}s plus a function to read computed cell values, resolve the
 * visual decoration that should paint over a given cell (a style patch, a
 * scale background token, or a data-bar fill fraction).
 *
 * The cell grid calls {@link resolveConditionalFormat} per cell in `buildCell`
 * and applies the resulting decoration on top of the cell's own `CellStyle`.
 * Later rules win over earlier ones (last-write paints on top), matching the
 * `SheetModel.conditionalFormats` ordering contract.
 */

import type { CellStyle, CellValue, CfRange, CfRule } from '../contract.js';
import { isCellError } from './format.js';

/** What conditional formatting resolved to for a single cell. */
export interface CfDecoration {
  /** A `CellStyle` patch to merge over the cell's own style (cellValue/expression). */
  style?: CellStyle;
  /** A background color token (colorScale), resolved to a `--jects-*` name. */
  backgroundToken?: string;
  /** An in-cell data bar: 0..1 fill fraction + the fill token. */
  dataBar?: { fraction: number; colorToken: string };
}

/** Whether a range contains a (sheet-local) cell coordinate. */
export function cfRangeContains(range: CfRange, row: number, col: number): boolean {
  return row >= range.top && row <= range.bottom && col >= range.left && col <= range.right;
}

/** Coerce a value to a number for scale/comparison math (errors/blanks → null). */
function toNumber(v: CellValue): number | null {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'string') {
    const n = Number(v);
    return v.trim() !== '' && !Number.isNaN(n) ? n : null;
  }
  return null;
}

/** Compare two operands for a `cellValue` rule (numeric when both numeric). */
function compare(a: CellValue, op: string, b: number | string, b2?: number | string): boolean {
  if (isCellError(a) || a === null || a === undefined) return false;
  const an = toNumber(a);
  const bn = typeof b === 'number' ? b : toNumber(b);
  // Numeric comparison when both sides are numbers; otherwise string compare.
  const numeric = an !== null && bn !== null;
  const av: number | string = numeric ? (an as number) : String(a);
  const bv: number | string = numeric ? (bn as number) : String(b);
  switch (op) {
    case '=':
      return av === bv;
    case '<>':
      return av !== bv;
    case '>':
      return av > bv;
    case '>=':
      return av >= bv;
    case '<':
      return av < bv;
    case '<=':
      return av <= bv;
    case 'between':
    case 'notBetween': {
      const b2n = typeof b2 === 'number' ? b2 : toNumber(b2 ?? '');
      if (an === null || bn === null || b2n === null) return false;
      const lo = Math.min(bn, b2n);
      const hi = Math.max(bn, b2n);
      const inside = an >= lo && an <= hi;
      return op === 'between' ? inside : !inside;
    }
    default:
      return false;
  }
}

/** Min/max of the numeric values within a range (for scales/bars). */
function rangeExtent(
  range: CfRange,
  getValue: (row: number, col: number) => CellValue,
): { min: number; max: number } | null {
  let min = Infinity;
  let max = -Infinity;
  let any = false;
  for (let r = range.top; r <= range.bottom; r++) {
    for (let c = range.left; c <= range.right; c++) {
      const n = toNumber(getValue(r, c));
      if (n === null) continue;
      any = true;
      if (n < min) min = n;
      if (n > max) max = n;
    }
  }
  return any ? { min, max } : null;
}

/** Normalize a value into a 0..1 position within `[min,max]` (0 when flat). */
function fraction(value: number, min: number, max: number): number {
  if (max === min) return 0;
  return Math.max(0, Math.min(1, (value - min) / (max - min)));
}

/**
 * Resolve the conditional-format decoration for one cell. Evaluates every rule
 * whose range covers the cell, in order; later rules' decorations override
 * earlier ones (style patches are merged, scale/bar replace). `evalExpression`
 * is supplied by the caller (the engine seam) for `expression` rules; when
 * absent those rules are skipped.
 */
export function resolveConditionalFormat(
  rules: CfRule[] | undefined,
  row: number,
  col: number,
  value: CellValue,
  getValue: (row: number, col: number) => CellValue,
  evalExpression?: (formula: string, row: number, col: number) => CellValue,
): CfDecoration | undefined {
  if (!rules || rules.length === 0) return undefined;
  let deco: CfDecoration | undefined;
  for (const rule of rules) {
    if (!cfRangeContains(rule.range, row, col)) continue;
    switch (rule.kind) {
      case 'cellValue': {
        if (compare(value, rule.op, rule.value, rule.value2)) {
          deco = { ...deco, style: { ...deco?.style, ...rule.style } };
        }
        break;
      }
      case 'expression': {
        if (!evalExpression) break;
        const result = evalExpression(rule.formula, row, col);
        if (truthy(result)) {
          deco = { ...deco, style: { ...deco?.style, ...rule.style } };
        }
        break;
      }
      case 'colorScale': {
        const ext = rangeExtent(rule.range, getValue);
        const n = toNumber(value);
        if (!ext || n === null) break;
        const f = fraction(n, ext.min, ext.max);
        const token = rule.midToken
          ? f < 0.5
            ? f < 0.25
              ? rule.minToken
              : rule.midToken
            : f > 0.75
              ? rule.maxToken
              : rule.midToken
          : f < 0.5
            ? rule.minToken
            : rule.maxToken;
        deco = { ...deco, backgroundToken: token };
        break;
      }
      case 'dataBar': {
        const ext = rangeExtent(rule.range, getValue);
        const n = toNumber(value);
        if (!ext || n === null) break;
        deco = {
          ...deco,
          dataBar: { fraction: fraction(n, ext.min, ext.max), colorToken: rule.colorToken },
        };
        break;
      }
    }
  }
  return deco;
}

/** Truthiness for an `expression` rule result (Excel-ish). */
function truthy(v: CellValue): boolean {
  if (isCellError(v) || v === null || v === undefined) return false;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') return v !== '' && v.toUpperCase() !== 'FALSE';
  return true;
}
