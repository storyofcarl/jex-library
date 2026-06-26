/**
 * Test-only helpers: build a single-sheet workbook + an `EvalContext` for
 * exercising the function library directly, and assertion shorthands.
 */

import type { CellRef, CellValue, EvalContext, WorkbookModel } from '../contract.js';
import { FormulaEngineImpl } from './engine.js';
import { isError } from './errors.js';

/** Build a fresh single-sheet workbook with the given cell literals. */
export function makeWorkbook(
  cells?: Record<string, CellValue>,
  opts?: { rowCount?: number; colCount?: number; sheetName?: string },
): WorkbookModel {
  const wb: WorkbookModel = {
    sheets: [
      {
        id: 's1',
        name: opts?.sheetName ?? 'Sheet1',
        cells: {},
        rowCount: opts?.rowCount ?? 100,
        colCount: opts?.colCount ?? 26,
      },
    ],
    activeSheet: 's1',
    calcMode: 'auto',
  };
  if (cells) {
    for (const [a1, v] of Object.entries(cells)) {
      const ref = wb.sheets[0]!.cells;
      const parsed = parseSimpleA1(a1);
      ref[`${parsed.row},${parsed.col}`] = { value: v };
    }
  }
  return wb;
}

function parseSimpleA1(a1: string): { row: number; col: number } {
  const m = /^([A-Za-z]+)(\d+)$/.exec(a1);
  if (!m) throw new Error(`bad a1 ${a1}`);
  let col = 0;
  const letters = m[1]!.toUpperCase();
  for (const ch of letters) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { row: parseInt(m[2]!, 10) - 1, col: col - 1 };
}

/** Create an engine bound to a workbook (defaults to empty single sheet). */
export function makeEngine(cells?: Record<string, CellValue>): FormulaEngineImpl {
  return new FormulaEngineImpl(makeWorkbook(cells));
}

/** Evaluate a formula string against a fresh engine/workbook, return value. */
export function evalFormula(
  formula: string,
  cells?: Record<string, CellValue>,
  origin: CellRef = { sheet: 's1', row: 0, col: 0 },
): CellValue {
  const engine = new FormulaEngineImpl(makeWorkbook(cells));
  const ctx: EvalContext = {
    origin,
    workbook: engine.getWorkbook(),
    getValue: (ref) => engine.getCellValue(ref),
    getRange: (from, to) => readRange(engine, from, to),
    resolveSheet: (name) => engine.getWorkbook().sheets.find((s) => s.name === name)?.id,
  };
  return engine.evaluate(formula, ctx);
}

function readRange(engine: FormulaEngineImpl, from: CellRef, to: CellRef): CellValue[][] {
  const top = Math.min(from.row, to.row);
  const bottom = Math.max(from.row, to.row);
  const left = Math.min(from.col, to.col);
  const right = Math.max(from.col, to.col);
  const out: CellValue[][] = [];
  for (let r = top; r <= bottom; r++) {
    const row: CellValue[] = [];
    for (let c = left; c <= right; c++) {
      row.push(engine.getCellValue({ sheet: from.sheet, row: r, col: c }));
    }
    out.push(row);
  }
  return out;
}

/** Assertion shorthand: a value is the given error code. */
export function isErrorCode(v: CellValue, code: string): boolean {
  return isError(v) && v.code === code;
}

/** Cell ref shorthand for sheet `s1`. */
export function ref(row: number, col: number, sheet = 's1'): CellRef {
  return { sheet, row, col };
}
