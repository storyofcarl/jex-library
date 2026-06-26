import { describe, expect, it } from 'vitest';
import {
  columnIndexToLabel,
  columnLabelToIndex,
  formatA1,
  parseA1,
  refKey,
  refToA1,
  toRef,
} from './a1.js';

describe('column conversions', () => {
  it('label → index', () => {
    expect(columnLabelToIndex('A')).toBe(0);
    expect(columnLabelToIndex('Z')).toBe(25);
    expect(columnLabelToIndex('AA')).toBe(26);
    expect(columnLabelToIndex('AB')).toBe(27);
    expect(columnLabelToIndex('ZZ')).toBe(701);
  });

  it('index → label', () => {
    expect(columnIndexToLabel(0)).toBe('A');
    expect(columnIndexToLabel(25)).toBe('Z');
    expect(columnIndexToLabel(26)).toBe('AA');
    expect(columnIndexToLabel(701)).toBe('ZZ');
  });

  it('round-trips', () => {
    for (const i of [0, 5, 26, 100, 701, 702]) {
      expect(columnLabelToIndex(columnIndexToLabel(i))).toBe(i);
    }
  });
});

describe('parseA1', () => {
  it('parses a plain ref', () => {
    expect(parseA1('B3')).toMatchObject({ row: 2, col: 1, rowAbsolute: false, colAbsolute: false });
  });

  it('parses absolute anchors', () => {
    expect(parseA1('$B$3')).toMatchObject({ row: 2, col: 1, rowAbsolute: true, colAbsolute: true });
    expect(parseA1('B$3')).toMatchObject({ rowAbsolute: true, colAbsolute: false });
    expect(parseA1('$B3')).toMatchObject({ rowAbsolute: false, colAbsolute: true });
  });

  it('parses sheet-qualified', () => {
    expect(parseA1('Sheet1!$B$3')).toMatchObject({ sheet: 'Sheet1', row: 2, col: 1 });
  });

  it('parses quoted sheet names', () => {
    expect(parseA1("'My Sheet'!A1")).toMatchObject({ sheet: 'My Sheet', row: 0, col: 0 });
  });
});

describe('formatA1', () => {
  it('formats an address', () => {
    expect(formatA1({ row: 2, col: 1 })).toBe('B3');
  });
  it('formats with anchors', () => {
    expect(formatA1({ row: 2, col: 1 }, { rowAbsolute: true, colAbsolute: true })).toBe('$B$3');
  });
});

describe('toRef / refToA1', () => {
  const resolve = (name: string): string => (name === 'Sheet2' ? 's2' : 's1');
  const sheetName = (id: string): string => (id === 's2' ? 'Sheet2' : 'Sheet1');

  it('builds a same-sheet ref', () => {
    expect(toRef('B3', 's1', resolve)).toEqual({ sheet: 's1', row: 2, col: 1 });
  });

  it('builds a cross-sheet ref', () => {
    expect(toRef('Sheet2!A1', 's1', resolve)).toEqual({ sheet: 's2', row: 0, col: 0 });
  });

  it('formats a same-sheet ref without qualifier', () => {
    expect(refToA1({ sheet: 's1', row: 2, col: 1 }, 's1', sheetName)).toBe('B3');
  });

  it('formats a cross-sheet ref with qualifier', () => {
    expect(refToA1({ sheet: 's2', row: 0, col: 0 }, 's1', sheetName)).toBe('Sheet2!A1');
  });
});

describe('refKey', () => {
  it('is stable and unique', () => {
    expect(refKey({ sheet: 's1', row: 0, col: 0 })).toBe('s1!0,0');
    expect(refKey({ sheet: 's2', row: 5, col: 3 })).toBe('s2!5,3');
  });
});
