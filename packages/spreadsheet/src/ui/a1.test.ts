/** jsdom unit test for the A1 conversion helpers. */
import { describe, it, expect } from 'vitest';
import {
  a1Helpers,
  columnIndexToLabel,
  columnLabelToIndex,
  formatA1,
  parseA1,
  refToA1,
  toRef,
} from './a1.js';

describe('a1 helpers', () => {
  it('converts column index ↔ label', () => {
    expect(columnIndexToLabel(0)).toBe('A');
    expect(columnIndexToLabel(25)).toBe('Z');
    expect(columnIndexToLabel(26)).toBe('AA');
    expect(columnIndexToLabel(701)).toBe('ZZ');
    expect(columnLabelToIndex('A')).toBe(0);
    expect(columnLabelToIndex('Z')).toBe(25);
    expect(columnLabelToIndex('AA')).toBe(26);
    expect(columnLabelToIndex('aa')).toBe(26);
  });

  it('round-trips column conversions', () => {
    for (const i of [0, 1, 25, 26, 27, 51, 52, 700, 16383]) {
      expect(columnLabelToIndex(columnIndexToLabel(i))).toBe(i);
    }
  });

  it('parses a plain A1 address', () => {
    expect(parseA1('B3')).toEqual({ row: 2, col: 1, rowAbsolute: false, colAbsolute: false });
  });

  it('parses $-anchored and sheet-qualified addresses', () => {
    expect(parseA1('$B$3')).toEqual({ row: 2, col: 1, rowAbsolute: true, colAbsolute: true });
    expect(parseA1('Sheet1!$B$3')).toEqual({
      sheet: 'Sheet1',
      row: 2,
      col: 1,
      rowAbsolute: true,
      colAbsolute: true,
    });
    expect(parseA1("'My Sheet'!A1").sheet).toBe('My Sheet');
  });

  it('formats addresses with optional anchors', () => {
    expect(formatA1({ row: 2, col: 1 })).toBe('B3');
    expect(formatA1({ row: 2, col: 1 }, { rowAbsolute: true, colAbsolute: true })).toBe('$B$3');
  });

  it('builds a CellRef and formats it back', () => {
    const ref = toRef('B3', 'sheet-1', () => 'sheet-1');
    expect(ref).toEqual({ sheet: 'sheet-1', row: 2, col: 1 });
    expect(refToA1(ref, 'sheet-1', () => 'Sheet1')).toBe('B3');
    expect(refToA1({ sheet: 'sheet-2', row: 0, col: 0 }, 'sheet-1', () => 'Sheet2')).toBe('Sheet2!A1');
  });

  it('exposes a complete A1Helpers bundle', () => {
    expect(a1Helpers.columnIndexToLabel(2)).toBe('C');
    expect(a1Helpers.parse('A1').col).toBe(0);
  });

  it('throws on malformed input', () => {
    expect(() => parseA1('123')).toThrow();
    expect(() => columnLabelToIndex('A1')).toThrow();
  });
});
