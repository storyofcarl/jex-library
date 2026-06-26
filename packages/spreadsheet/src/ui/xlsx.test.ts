/** jsdom unit test for the real (OOXML zip) .xlsx reader/writer + zip util. */
import { describe, it, expect } from 'vitest';
import { workbookToXlsx, xlsxToWorkbook, XLSX_MIME } from './xlsx.js';
import { zipSync, unzipSync, utf8, fromUtf8 } from './zip.js';
import type { WorkbookModel } from '../contract.js';

function sampleWorkbook(): WorkbookModel {
  return {
    sheets: [
      {
        id: 'sheet-1',
        name: 'Data',
        cells: {
          '0,0': { value: 'Name' },
          '0,1': { value: 'Score' },
          '1,0': { value: 'Ada' },
          '1,1': { value: 42, format: { numberFormat: '#,##0.00' } },
          '2,0': { value: 'Bob, Jr' },
          '2,1': { value: 7 },
          '3,1': { value: 49, formula: 'B2+B3' },
          '4,0': { value: true },
        },
        rowCount: 100,
        colCount: 26,
        merges: [{ row: 0, col: 0, rowSpan: 1, colSpan: 2 }],
        frozen: { rows: 1, cols: 0 },
      },
      {
        id: 'sheet-2',
        name: 'Sheet2',
        cells: { '0,0': { value: 'second' } },
        rowCount: 100,
        colCount: 26,
      },
    ],
    activeSheet: 'sheet-1',
    namedRanges: { Scores: 'Data!B2:B3' },
    calcMode: 'auto',
  };
}

describe('zip util', () => {
  it('round-trips entries through zip/unzip (store method)', () => {
    const bytes = zipSync([
      { path: 'a.txt', bytes: utf8('hello') },
      { path: 'dir/b.xml', bytes: utf8('<x/>') },
    ]);
    // PK signature.
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);
    const files = unzipSync(bytes);
    expect(fromUtf8(files.get('a.txt')!)).toBe('hello');
    expect(fromUtf8(files.get('dir/b.xml')!)).toBe('<x/>');
  });
});

describe('real .xlsx (OOXML)', () => {
  it('produces a valid zip package with the expected parts', () => {
    const bytes = workbookToXlsx(sampleWorkbook());
    expect(bytes[0]).toBe(0x50); // 'P'
    const files = unzipSync(bytes);
    expect(files.has('[Content_Types].xml')).toBe(true);
    expect(files.has('xl/workbook.xml')).toBe(true);
    expect(files.has('xl/styles.xml')).toBe(true);
    expect(files.has('xl/sharedStrings.xml')).toBe(true);
    expect(files.has('xl/worksheets/sheet1.xml')).toBe(true);
    expect(files.has('xl/worksheets/sheet2.xml')).toBe(true);
  });

  it('round-trips values, formulas, formats, merges, frozen panes, names', () => {
    const wb = sampleWorkbook();
    const back = xlsxToWorkbook(workbookToXlsx(wb));

    expect(back.sheets.length).toBe(2);
    const s = back.sheets[0]!;
    expect(s.name).toBe('Data');
    // Values + types.
    expect(s.cells['1,0']?.value).toBe('Ada');
    expect(s.cells['1,1']?.value).toBe(42);
    expect(s.cells['2,0']?.value).toBe('Bob, Jr');
    expect(s.cells['4,0']?.value).toBe(true);
    // Formula.
    expect(s.cells['3,1']?.formula).toBe('B2+B3');
    // Number format mask.
    expect(s.cells['1,1']?.format?.numberFormat).toBe('#,##0.00');
    // Merge.
    expect(s.merges?.[0]).toEqual({ row: 0, col: 0, rowSpan: 1, colSpan: 2 });
    // Frozen panes.
    expect(s.frozen).toEqual({ rows: 1, cols: 0 });
    // Second sheet.
    expect(back.sheets[1]?.cells['0,0']?.value).toBe('second');
    // Named range.
    expect(back.namedRanges?.['Scores']).toBe('Data!B2:B3');
  });

  it('exposes the correct MIME type', () => {
    expect(XLSX_MIME).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
  });
});
