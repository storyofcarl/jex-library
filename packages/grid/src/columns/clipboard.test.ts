/** jsdom unit tests — clipboard TSV (de)serialization + paste anchoring/tiling. */
import { describe, it, expect } from 'vitest';
import {
  matrixToTSV,
  parseTSV,
  buildCopyText,
  applyPaste,
  cellToText,
  type ClipboardHost,
} from './clipboard.js';
import type { Model } from '@jects/core';
import type { CellAddress } from '../contract.js';
import type { CellRect } from './selection.js';

describe('TSV serialization', () => {
  it('cellToText handles null / Date / primitives', () => {
    expect(cellToText(null)).toBe('');
    expect(cellToText(new Date('2024-01-15T00:00:00Z'))).toBe('2024-01-15');
    expect(cellToText(42)).toBe('42');
  });

  it('matrixToTSV joins with tabs/newlines and quotes special fields', () => {
    expect(matrixToTSV([['a', 'b'], ['c', 'd']])).toBe('a\tb\nc\td');
    expect(matrixToTSV([['x\ty']])).toBe('"x\ty"');
    expect(matrixToTSV([['he said "hi"']])).toBe('"he said ""hi"""');
  });

  it('parseTSV round-trips quoted fields with embedded tabs/newlines', () => {
    expect(parseTSV('a\tb\nc\td')).toEqual([['a', 'b'], ['c', 'd']]);
    expect(parseTSV('"x\ty"\tz')).toEqual([['x\ty', 'z']]);
    expect(parseTSV('"line1\nline2"')).toEqual([['line1\nline2']]);
    expect(parseTSV('a\r\nb')).toEqual([['a'], ['b']]);
  });
});

interface Row extends Model {
  id: number;
  a: number;
  b: number;
}

function makeHost(rows: Row[]): ClipboardHost & { rows: Row[] } {
  const fields: (keyof Row)[] = ['a', 'b'];
  return {
    rows,
    getRange: () => null,
    getCellValue: (cell: CellAddress) => rows[cell.rowIndex]?.[fields[cell.colIndex]!],
    setCellValue: (cell, value) => {
      const f = fields[cell.colIndex]!;
      (rows[cell.rowIndex] as Record<string, unknown>)[f] = Number(value);
    },
    rowCount: () => rows.length,
    colCount: () => fields.length,
  };
}

describe('buildCopyText', () => {
  it('serializes the selection rectangle', () => {
    const rows: Row[] = [
      { id: 1, a: 1, b: 2 },
      { id: 2, a: 3, b: 4 },
    ];
    const host = makeHost(rows);
    host.getRange = () => ({ top: 0, left: 0, bottom: 1, right: 1 });
    expect(buildCopyText(host)).toBe('1\t2\n3\t4');
  });

  it('returns empty string with no selection', () => {
    expect(buildCopyText(makeHost([]))).toBe('');
  });
});

describe('applyPaste', () => {
  it('writes a source-sized block anchored at the target cell', () => {
    const rows: Row[] = [
      { id: 1, a: 0, b: 0 },
      { id: 2, a: 0, b: 0 },
    ];
    const host = makeHost(rows);
    const written = applyPaste(host, '7\t8\n9\t10', { rowIndex: 0, colIndex: 0 });
    expect(written).toHaveLength(4);
    expect(rows[0]).toMatchObject({ a: 7, b: 8 });
    expect(rows[1]).toMatchObject({ a: 9, b: 10 });
  });

  it('clips writes to grid bounds', () => {
    const rows: Row[] = [{ id: 1, a: 0, b: 0 }];
    const host = makeHost(rows);
    const written = applyPaste(host, '5\t6\n7\t8', { rowIndex: 0, colIndex: 0 });
    // only row 0 exists → only 2 cells written
    expect(written).toHaveLength(2);
    expect(rows[0]).toMatchObject({ a: 5, b: 6 });
  });

  it('tiles a single source value across a larger selection', () => {
    const rows: Row[] = [
      { id: 1, a: 0, b: 0 },
      { id: 2, a: 0, b: 0 },
    ];
    const host = makeHost(rows);
    const selection: CellRect = { top: 0, left: 0, bottom: 1, right: 1 };
    const written = applyPaste(host, '9', { rowIndex: 0, colIndex: 0 }, { tile: true, selection });
    expect(written).toHaveLength(4);
    expect(rows.every((r) => r.a === 9 && r.b === 9)).toBe(true);
  });
});
