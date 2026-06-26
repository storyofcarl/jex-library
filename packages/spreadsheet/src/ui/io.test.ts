/** jsdom unit test for import/export (CSV / JSON / XLSX). */
import { describe, it, expect } from 'vitest';
import {
  sheetToCsv,
  parseCsv,
  csvToSheet,
  workbookToJson,
  jsonToWorkbook,
  workbookToXlsxXml,
  xlsxXmlToWorkbook,
  exportWorkbook,
  importWorkbook,
} from './io.js';
import type { SheetModel, WorkbookModel } from '../contract.js';

function sampleSheet(): SheetModel {
  return {
    id: 'sheet-1',
    name: 'Sheet1',
    cells: {
      '0,0': { value: 'Name' },
      '0,1': { value: 'Score' },
      '1,0': { value: 'Ada' },
      '1,1': { value: 42 },
      '2,0': { value: 'Bob, Jr' },
      '2,1': { value: 7 },
    },
    rowCount: 3,
    colCount: 2,
  };
}

function sampleWorkbook(): WorkbookModel {
  return { sheets: [sampleSheet()], activeSheet: 'sheet-1', calcMode: 'auto' };
}

describe('CSV', () => {
  it('serializes a sheet, quoting fields with commas', () => {
    const csv = sheetToCsv(sampleSheet());
    expect(csv.split('\r\n')[0]).toBe('Name,Score');
    expect(csv).toContain('"Bob, Jr"');
  });

  it('parses CSV with quoted fields and embedded commas', () => {
    const rows = parseCsv('Name,Score\r\n"Bob, Jr",7');
    expect(rows[1]).toEqual(['Bob, Jr', '7']);
  });

  it('defends against CSV formula injection on export', () => {
    const sheet: SheetModel = {
      id: 's',
      name: 'S',
      cells: { '0,0': { value: '=1+1' }, '0,1': { value: '@SUM(A1)' } },
      rowCount: 1,
      colCount: 2,
    };
    expect(sheetToCsv(sheet)).toBe("'=1+1,'@SUM(A1)");
    // Opt-out preserves the raw (dangerous) text.
    expect(sheetToCsv(sheet, { sanitizeInjection: false })).toBe('=1+1,@SUM(A1)');
  });

  it('round-trips a sheet through CSV (values inferred)', () => {
    const csv = sheetToCsv(sampleSheet());
    const rows = parseCsv(csv);
    const sheet = csvToSheet(rows, 'sheet-1', 'Round');
    expect(sheet.cells['1,1']?.value).toBe(42);
    expect(sheet.cells['2,0']?.value).toBe('Bob, Jr');
  });
});

describe('JSON', () => {
  it('round-trips the workbook losslessly', () => {
    const wb = sampleWorkbook();
    const restored = jsonToWorkbook(workbookToJson(wb));
    expect(restored.sheets[0]?.cells['1,1']?.value).toBe(42);
    expect(restored.activeSheet).toBe('sheet-1');
  });

  it('rejects invalid workbook JSON', () => {
    expect(() => jsonToWorkbook('{"foo":1}')).toThrow();
  });
});

describe('XLSX (SpreadsheetML)', () => {
  it('exports and re-imports cell values and formulas', () => {
    const wb = sampleWorkbook();
    wb.sheets[0]!.cells['3,1'] = { value: 49, formula: 'B2+B3' };
    const xml = workbookToXlsxXml(wb);
    expect(xml).toContain('<Worksheet');
    expect(xml).toContain('ss:Formula="=B2+B3"');
    const back = xlsxXmlToWorkbook(xml);
    expect(back.sheets[0]?.name).toBe('Sheet1');
    expect(back.sheets[0]?.cells['1,1']?.value).toBe(42);
    expect(back.sheets[0]?.cells['3,1']?.formula).toBe('B2+B3');
  });
});

describe('exportWorkbook / importWorkbook', () => {
  it('dispatches by format', () => {
    const wb = sampleWorkbook();
    expect(exportWorkbook(wb, 'json')).toContain('"sheets"');
    expect(exportWorkbook(wb, 'csv').startsWith('Name,Score')).toBe(true);
    expect(exportWorkbook(wb, 'xlsx')).toContain('<Workbook');

    const imported = importWorkbook('a,b\r\n1,2', 'csv');
    expect(imported.sheets[0]?.cells['1,0']?.value).toBe(1);
  });
});
