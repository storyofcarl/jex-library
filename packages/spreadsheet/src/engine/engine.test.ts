import { describe, expect, it } from 'vitest';
import { FormulaEngineImpl } from './engine.js';
import { isError } from './errors.js';
import { makeWorkbook, ref } from './test-utils.js';
import type { WorkbookModel } from '../contract.js';

function twoSheetWorkbook(): WorkbookModel {
  return {
    sheets: [
      { id: 's1', name: 'Sheet1', cells: {}, rowCount: 50, colCount: 26 },
      { id: 's2', name: 'Sheet2', cells: {}, rowCount: 50, colCount: 26 },
    ],
    activeSheet: 's1',
    calcMode: 'auto',
  };
}

describe('cell mutation & recalc', () => {
  it('computes a formula after recalc', () => {
    const e = new FormulaEngineImpl(makeWorkbook({ A1: 2, A2: 3 }));
    e.setCellFormula(ref(0, 2), 'A1+A2'); // C1
    e.recalc();
    expect(e.getCellValue(ref(0, 2))).toBe(5);
  });

  it('recalc returns only refs whose value changed', () => {
    const e = new FormulaEngineImpl(makeWorkbook({ A1: 1 }));
    e.setCellFormula(ref(1, 0), 'A1*10'); // A2 = 10
    e.recalc();
    const changed = e.setCellValue(ref(0, 0), 5);
    const result = e.recalc(changed);
    const keys = result.map((r) => `${r.row},${r.col}`);
    expect(keys).toContain('1,0'); // A2 recomputed
    expect(e.getCellValue(ref(1, 0))).toBe(50);
  });

  it('incremental recalc propagates through a chain', () => {
    const e = new FormulaEngineImpl(makeWorkbook({ A1: 1 }));
    e.setCellFormula(ref(1, 0), 'A1+1'); // A2
    e.setCellFormula(ref(2, 0), 'A2+1'); // A3
    e.setCellFormula(ref(3, 0), 'A3+1'); // A4
    e.recalc();
    expect(e.getCellValue(ref(3, 0))).toBe(4);
    const dirty = e.setCellValue(ref(0, 0), 10);
    e.recalc(dirty);
    expect(e.getCellValue(ref(3, 0))).toBe(13);
  });
});

describe('dynamic-array spill recalc', () => {
  it('re-spilling an anchor recomputes formulas that read a spilled member', () => {
    const e = new FormulaEngineImpl(makeWorkbook({}));
    e.setCellFormula(ref(0, 0), 'SEQUENCE(3)'); // A1 spills A1:A3 → 1,2,3
    e.setCellFormula(ref(0, 2), 'A2'); // C1 = A2 (a spill member)
    e.recalc();
    expect(e.getCellValue(ref(0, 2))).toBe(2);
    // Change the anchor's formula so it re-spills new member values.
    const dirty = e.setCellFormula(ref(0, 0), 'SEQUENCE(3,1,10)'); // → 10,11,12
    e.recalc(dirty);
    expect(e.getCellValue(ref(1, 0))).toBe(11); // A2 member updated
    expect(e.getCellValue(ref(0, 2))).toBe(11); // C1 follows A2 — must not be stale
  });

  it('overwriting a spill anchor with a literal re-dirties member readers', () => {
    const e = new FormulaEngineImpl(makeWorkbook({}));
    e.setCellFormula(ref(0, 0), 'SEQUENCE(3)'); // A1:A3 → 1,2,3
    e.setCellFormula(ref(0, 2), 'A2+100'); // C1 = 102
    e.recalc();
    expect(e.getCellValue(ref(0, 2))).toBe(102);
    // Overwriting the anchor clears the spill → A2 becomes blank; C1 must recompute.
    const dirty = e.setCellValue(ref(0, 0), 99);
    e.recalc(dirty);
    expect(e.getCellValue(ref(0, 2))).toBe(100); // A2 blank → 0 + 100
  });

  it('shrinking a spill re-dirties readers of dropped members', () => {
    const e = new FormulaEngineImpl(makeWorkbook({}));
    e.setCellFormula(ref(0, 0), 'SEQUENCE(3)'); // A1:A3
    e.setCellFormula(ref(0, 2), 'A3+100'); // C1 = 103
    e.recalc();
    expect(e.getCellValue(ref(0, 2))).toBe(103);
    const dirty = e.setCellFormula(ref(0, 0), 'SEQUENCE(2)'); // A3 dropped → blank
    e.recalc(dirty);
    expect(e.getCellValue(ref(0, 2))).toBe(100); // A3 blank → 0 + 100
  });
});

describe('dynamic-array spill dependents', () => {
  it('recomputes a formula that reads a spilled member (original probe)', () => {
    // B1 spills SEQUENCE(3) -> B1=1, B2=2, B3=3. A2 reads the spilled member B2.
    // Before the fix A2 stayed 0 because the spilled B2 never re-dirtied A2.
    const e = new FormulaEngineImpl(makeWorkbook({}));
    e.setCellFormula(ref(0, 1), 'SEQUENCE(3)'); // B1:B3
    e.setCellFormula(ref(1, 0), 'B2*10'); // A2
    e.recalc();
    expect(e.getCellValue(ref(0, 1))).toBe(1); // B1 anchor
    expect(e.getCellValue(ref(1, 1))).toBe(2); // B2 member
    expect(e.getCellValue(ref(1, 0))).toBe(20); // A2 reads B2 -> 20
  });

  it('re-dirties a member reader on incremental recalc from the anchor', () => {
    const e = new FormulaEngineImpl(makeWorkbook({ A1: 3 }));
    e.setCellFormula(ref(0, 1), 'SEQUENCE(A1)'); // B1.. spills, depends on A1
    e.setCellFormula(ref(1, 0), 'B2*10'); // A2 reads member B2
    e.recalc();
    expect(e.getCellValue(ref(1, 0))).toBe(20);
    // Re-spill via an incremental recalc seeded only from the anchor's precedent.
    const dirty = e.setCellValue(ref(0, 0), 4); // A1=4 → spill of 4, B2 still 2
    e.recalc(dirty);
    expect(e.getCellValue(ref(1, 1))).toBe(2);
    expect(e.getCellValue(ref(1, 0))).toBe(20);
  });

  it('re-dirties spill-member readers when the anchor recalculates', () => {
    const e = new FormulaEngineImpl(makeWorkbook({ A1: 3 }));
    e.setCellFormula(ref(0, 1), 'SEQUENCE(A1)'); // B1.. depends on A1
    e.setCellFormula(ref(1, 0), 'B2*10'); // A2 reads member B2
    e.recalc();
    expect(e.getCellValue(ref(1, 0))).toBe(20);
    const dirty = e.setCellValue(ref(0, 0), 5); // A1=5 → spill grows, B2 still 2
    e.recalc(dirty);
    expect(e.getCellValue(ref(1, 0))).toBe(20);
  });
});

describe('dependency graph introspection', () => {
  it('tracks precedents and dependents', () => {
    const e = new FormulaEngineImpl(makeWorkbook({ A1: 1, B1: 2 }));
    e.setCellFormula(ref(0, 2), 'A1+B1'); // C1
    const precedents = e.precedentsOf(ref(0, 2)).map((r) => `${r.row},${r.col}`);
    expect(precedents.sort()).toEqual(['0,0', '0,1']);
    const deps = e.dependentsOf(ref(0, 0)).map((r) => `${r.row},${r.col}`);
    expect(deps).toContain('0,2');
  });

  it('updates edges when a formula changes', () => {
    const e = new FormulaEngineImpl(makeWorkbook({ A1: 1, B1: 2 }));
    e.setCellFormula(ref(0, 2), 'A1'); // C1 → A1
    expect(e.dependentsOf(ref(0, 0)).length).toBe(1);
    e.setCellFormula(ref(0, 2), 'B1'); // C1 → B1 now
    expect(e.dependentsOf(ref(0, 0)).length).toBe(0);
    expect(e.dependentsOf(ref(0, 1)).length).toBe(1);
  });
});

describe('cross-sheet references', () => {
  it('reads from another sheet', () => {
    const e = new FormulaEngineImpl(twoSheetWorkbook());
    e.setCellValue({ sheet: 's2', row: 0, col: 0 }, 99); // Sheet2!A1
    e.setCellFormula(ref(0, 0), 'Sheet2!A1+1'); // Sheet1!A1
    e.recalc();
    expect(e.getCellValue(ref(0, 0))).toBe(100);
  });

  it('dirties cross-sheet dependents', () => {
    const e = new FormulaEngineImpl(twoSheetWorkbook());
    e.setCellValue({ sheet: 's2', row: 0, col: 0 }, 10);
    e.setCellFormula(ref(0, 0), 'Sheet2!A1*2');
    e.recalc();
    const dirty = e.setCellValue({ sheet: 's2', row: 0, col: 0 }, 20);
    e.recalc(dirty);
    expect(e.getCellValue(ref(0, 0))).toBe(40);
  });
});

describe('circular reference detection', () => {
  it('resolves a 2-cycle to #CYCLE!', () => {
    const e = new FormulaEngineImpl(makeWorkbook());
    e.setCellFormula(ref(0, 0), 'A2'); // A1 → A2
    e.setCellFormula(ref(1, 0), 'A1'); // A2 → A1
    e.recalc();
    expect(isError(e.getCellValue(ref(0, 0)))).toBe(true);
    expect((e.getCellValue(ref(0, 0)) as { code: string }).code).toBe('#CYCLE!');
  });

  it('self-reference is a cycle', () => {
    const e = new FormulaEngineImpl(makeWorkbook());
    e.setCellFormula(ref(0, 0), 'A1+1');
    e.recalc();
    expect((e.getCellValue(ref(0, 0)) as { code: string }).code).toBe('#CYCLE!');
  });

  it('non-cycle cells still compute when a cycle exists', () => {
    const e = new FormulaEngineImpl(makeWorkbook({ B1: 5 }));
    e.setCellFormula(ref(0, 0), 'A2');
    e.setCellFormula(ref(1, 0), 'A1');
    e.setCellFormula(ref(0, 2), 'B1*2'); // C1, independent
    e.recalc();
    expect(e.getCellValue(ref(0, 2))).toBe(10);
  });
});

describe('display values', () => {
  it('formats numbers and errors', () => {
    const e = new FormulaEngineImpl(makeWorkbook({ A1: 3.5 }));
    expect(e.getDisplayValue(ref(0, 0))).toBe('3.5');
    e.setCellFormula(ref(0, 1), '1/0');
    e.recalc();
    expect(e.getDisplayValue(ref(0, 1))).toBe('#DIV/0!');
  });

  it('applies number format', () => {
    const wb = makeWorkbook({ A1: 1234.5 });
    wb.sheets[0]!.cells['0,0']!.format = { numberFormat: '#,##0.00' };
    const e = new FormulaEngineImpl(wb);
    expect(e.getDisplayValue(ref(0, 0))).toBe('1,234.50');
  });
});

describe('custom function registration', () => {
  it('registers and invokes a custom function', () => {
    const e = new FormulaEngineImpl(makeWorkbook({ A1: 4 }));
    e.defineFunction('DOUBLE', (args) => {
      const v = args[0];
      return typeof v === 'number' ? v * 2 : 0;
    });
    expect(e.hasFunction('double')).toBe(true);
    e.setCellFormula(ref(0, 1), 'DOUBLE(A1)');
    e.recalc();
    expect(e.getCellValue(ref(0, 1))).toBe(8);
  });
});
