/** jsdom unit tests for structural-edit reference transforms. */
import { describe, expect, it } from 'vitest';
import type { MergeRegion, SheetModel } from '../contract.js';
import {
  applyStructuralRefTransforms,
  shiftFrozenCount,
  shiftMerge,
  transformFormula,
} from './ref-transform.js';

const SHEET = 'Sheet1';

describe('transformFormula — row inserts', () => {
  it('shifts refs at/after the insertion point down', () => {
    expect(transformFormula('A5', SHEET, SHEET, { axis: 'row', at: 0, delta: 1 })).toBe('A6');
    expect(transformFormula('A5+B1', SHEET, SHEET, { axis: 'row', at: 2, delta: 1 })).toBe('A6+B1');
  });

  it('leaves refs above the insertion point untouched', () => {
    expect(transformFormula('A2', SHEET, SHEET, { axis: 'row', at: 5, delta: 1 })).toBe('A2');
  });

  it('preserves $-anchoring and function calls', () => {
    expect(transformFormula('SUM($A$5:$A$9)', SHEET, SHEET, { axis: 'row', at: 0, delta: 1 })).toBe(
      'SUM($A$6:$A$10)',
    );
  });
});

describe('transformFormula — row deletes', () => {
  it('shifts refs after the deleted band up', () => {
    expect(transformFormula('A6', SHEET, SHEET, { axis: 'row', at: 0, delta: -1 })).toBe('A5');
  });

  it('turns refs inside the deleted band into #REF!', () => {
    expect(transformFormula('A3', SHEET, SHEET, { axis: 'row', at: 2, delta: -1 })).toBe('#REF!');
    expect(transformFormula('A1+A3', SHEET, SHEET, { axis: 'row', at: 2, delta: -2 })).toBe('A1+#REF!');
  });
});

describe('transformFormula — columns', () => {
  it('shifts column refs on insert', () => {
    expect(transformFormula('C1', SHEET, SHEET, { axis: 'col', at: 0, delta: 1 })).toBe('D1');
  });
  it('#REF! for a deleted column', () => {
    expect(transformFormula('B1', SHEET, SHEET, { axis: 'col', at: 1, delta: -1 })).toBe('#REF!');
  });
});

describe('transformFormula — sheet scoping', () => {
  it('only rewrites refs that resolve to the edited sheet', () => {
    // Formula on Sheet2; bare ref resolves to Sheet2, not the edited Sheet1.
    expect(transformFormula('A5', 'Sheet2', 'Sheet1', { axis: 'row', at: 0, delta: 1 })).toBe('A5');
    // Qualified ref to the edited sheet IS rewritten.
    expect(transformFormula('Sheet1!A5', 'Sheet2', 'Sheet1', { axis: 'row', at: 0, delta: 1 })).toBe(
      'Sheet1!A6',
    );
  });
});

describe('shiftMerge', () => {
  const m: MergeRegion = { row: 5, col: 0, rowSpan: 2, colSpan: 2 };
  it('moves a merge below an inserted row', () => {
    expect(shiftMerge(m, { axis: 'row', at: 0, delta: 1 })).toMatchObject({ row: 6, rowSpan: 2 });
  });
  it('grows a merge when a row is inserted inside it', () => {
    expect(shiftMerge(m, { axis: 'row', at: 6, delta: 1 })).toMatchObject({ row: 5, rowSpan: 3 });
  });
  it('drops a merge fully deleted', () => {
    expect(shiftMerge({ row: 2, col: 0, rowSpan: 1, colSpan: 1 }, { axis: 'row', at: 2, delta: -1 })).toBeNull();
  });
});

describe('shiftFrozenCount', () => {
  it('grows frozen rows when inserting above the freeze', () => {
    expect(shiftFrozenCount(2, { axis: 'row', at: 0, delta: 1 })).toBe(3);
  });
  it('shrinks frozen rows when deleting within the freeze', () => {
    expect(shiftFrozenCount(3, { axis: 'row', at: 0, delta: -1 })).toBe(2);
  });
  it('leaves frozen rows untouched when editing below the freeze', () => {
    expect(shiftFrozenCount(2, { axis: 'row', at: 5, delta: 1 })).toBe(2);
  });
});

describe('applyStructuralRefTransforms', () => {
  it('rewrites every sheet referencing the edited sheet and shifts merges', () => {
    const edited: SheetModel = {
      id: 's1',
      name: 'Sheet1',
      cells: { '4,0': { formula: 'A1+A4' } },
      rowCount: 50,
      colCount: 26,
      merges: [{ row: 5, col: 0, rowSpan: 2, colSpan: 1 }],
      frozen: { rows: 1, cols: 0 },
    };
    const other: SheetModel = {
      id: 's2',
      name: 'Sheet2',
      cells: { '0,0': { formula: 'Sheet1!A4' } },
      rowCount: 50,
      colCount: 26,
    };
    applyStructuralRefTransforms([edited, other], edited, { axis: 'row', at: 0, delta: 1 });
    expect(edited.cells['4,0']?.formula).toBe('A2+A5');
    expect(other.cells['0,0']?.formula).toBe('Sheet1!A5');
    expect(edited.merges?.[0]).toMatchObject({ row: 6 });
    expect(edited.frozen?.rows).toBe(2);
  });
});
