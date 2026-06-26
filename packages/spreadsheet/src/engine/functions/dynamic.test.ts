import { describe, expect, it } from 'vitest';
import { FormulaEngineImpl } from '../engine.js';
import { makeWorkbook, ref } from '../test-utils.js';
import type { CellValue } from '../../contract.js';

/** Evaluate to an array via the parser+evaluator path. */
function evalArray(formula: string, cells?: Record<string, CellValue>): CellValue | CellValue[][] {
  const e = new FormulaEngineImpl(makeWorkbook(cells));
  // Access the evaluator indirectly by calling a function and reading spill.
  e.setCellFormula(ref(0, 5), formula);
  e.recalc();
  return e.getCellValue(ref(0, 5));
}

describe('dynamic array functions', () => {
  it('SEQUENCE produces a series and spills', () => {
    const e = new FormulaEngineImpl(makeWorkbook());
    e.setCellFormula(ref(0, 0), 'SEQUENCE(3)');
    e.recalc();
    expect(e.getCellValue(ref(0, 0))).toBe(1);
    expect(e.getCellValue(ref(1, 0))).toBe(2);
    expect(e.getCellValue(ref(2, 0))).toBe(3);
  });

  it('SEQUENCE 2D', () => {
    const e = new FormulaEngineImpl(makeWorkbook());
    e.setCellFormula(ref(0, 0), 'SEQUENCE(2,2,1,1)');
    e.recalc();
    expect(e.getCellValue(ref(0, 0))).toBe(1);
    expect(e.getCellValue(ref(0, 1))).toBe(2);
    expect(e.getCellValue(ref(1, 0))).toBe(3);
    expect(e.getCellValue(ref(1, 1))).toBe(4);
  });

  it('marks spill extent on the anchor', () => {
    const e = new FormulaEngineImpl(makeWorkbook());
    e.setCellFormula(ref(0, 0), 'SEQUENCE(3)');
    e.recalc();
    const anchor = e.getWorkbook().sheets[0]!.cells['0,0']!;
    expect(anchor.spill).toEqual({ rows: 3, cols: 1 });
    const member = e.getWorkbook().sheets[0]!.cells['1,0']!;
    expect(member.spillParent).toEqual({ row: 0, col: 0 });
  });

  it('blocked spill → #SPILL!', () => {
    const e = new FormulaEngineImpl(makeWorkbook({ A2: 'blocker' }));
    e.setCellFormula(ref(0, 0), 'SEQUENCE(3)');
    e.recalc();
    expect((e.getCellValue(ref(0, 0)) as { code: string }).code).toBe('#SPILL!');
  });

  it('UNIQUE removes duplicates', () => {
    const e = new FormulaEngineImpl(makeWorkbook({ A1: 1, A2: 2, A3: 2, A4: 3 }));
    e.setCellFormula(ref(0, 2), 'UNIQUE(A1:A4)');
    e.recalc();
    expect(e.getCellValue(ref(0, 2))).toBe(1);
    expect(e.getCellValue(ref(1, 2))).toBe(2);
    expect(e.getCellValue(ref(2, 2))).toBe(3);
  });

  it('SORT ascending/descending', () => {
    const e = new FormulaEngineImpl(makeWorkbook({ A1: 3, A2: 1, A3: 2 }));
    e.setCellFormula(ref(0, 2), 'SORT(A1:A3,1,-1)');
    e.recalc();
    expect(e.getCellValue(ref(0, 2))).toBe(3);
    expect(e.getCellValue(ref(2, 2))).toBe(1);
  });

  it('FILTER keeps matching rows', () => {
    const cells = { A1: 1, A2: 2, A3: 3, A4: 4, B1: 1, B2: 0, B3: 1, B4: 0 };
    const e = new FormulaEngineImpl(makeWorkbook(cells));
    e.setCellFormula(ref(0, 3), 'FILTER(A1:A4,B1:B4)');
    e.recalc();
    expect(e.getCellValue(ref(0, 3))).toBe(1);
    expect(e.getCellValue(ref(1, 3))).toBe(3);
  });

  it('respills (shrinks) when formula changes', () => {
    const e = new FormulaEngineImpl(makeWorkbook());
    e.setCellFormula(ref(0, 0), 'SEQUENCE(3)');
    e.recalc();
    expect(e.getCellValue(ref(2, 0))).toBe(3);
    e.setCellFormula(ref(0, 0), 'SEQUENCE(1)');
    e.recalc();
    // The old spilled member should be cleared.
    expect(e.getCellValue(ref(2, 0))).toBe(null);
  });

  it('SEQUENCE used as range arg in another function', () => {
    expect(evalArray('SUM(SEQUENCE(4))')).toBe(10);
  });
});
