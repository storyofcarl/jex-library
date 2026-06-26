/**
 * KNOWN-ANSWER .xlsx round-trip / OOXML-validity fixture suite.
 *
 * Exercises the *public, exported* XLSX surface — the same symbols re-exported
 * verbatim from the package entry (`src/index.ts` → `./ui/io.js` + `./ui/zip.js`):
 *
 *   - workbookToXlsxBytes   (export → real OOXML zip bytes)
 *   - xlsxBytesToWorkbook   (import → WorkbookModel)
 *   - workbookToXlsxBlob    (download wrapper)
 *   - XLSX_MIME
 *   - unzipSync / fromUtf8  (the zip util, mirroring the existing export tests)
 *
 * A single hand-authored fixture workbook carries text, numbers, dates (stored
 * as Excel serials + a date mask — how OOXML actually persists dates), a per-row
 * `=SUM` over a horizontal range, a per-column footer `=SUM`, a named range, and
 * a conditional-format rule. Every asserted value below is a fixed known answer.
 *
 * Coverage:
 *   1. container is a valid ZIP (PK local-header signature + trailing EOCD record)
 *   2. the package holds the required OOXML parts (Content_Types, workbook,
 *      sheet1, sharedStrings) with the correct content-type overrides
 *   3. the worksheet XML carries the expected cell refs, typed values, and the
 *      literal formula strings (`<f>SUM(...)</f>`)
 *   4. a full export→import round-trip reproduces the source cells, values,
 *      formulas, number-format masks, and the named range
 */
import { describe, it, expect } from 'vitest';
import {
  workbookToXlsxBytes,
  xlsxBytesToWorkbook,
  workbookToXlsxBlob,
  XLSX_MIME,
} from './io.js';
import { unzipSync, fromUtf8 } from './zip.js';
import type { CellModel, WorkbookModel } from '../contract.js';

/* ── known-answer fixture ──────────────────────────────────────────────────
   Table on sheet "Budget":

     A        B           C     D      E
   1 Item     Date        Qty   Cost   RowTotal
   2 Widget   2026-01-15  3     10     =SUM(C2:D2)  → 13
   3 Gadget   2026-02-20  5     20     =SUM(C3:D3)  → 25
   4 Gizmo    2026-03-25  7     30     =SUM(C4:D4)  → 37
   5 Total                =SUM  =SUM   =SUM(E2:E4)  → 75
                          (15)  (60)
*/

/** Excel serial date (days since 1899-12-30, UTC). */
const serial = (y: number, m: number, d: number): number =>
  Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000);

// Pinned known answers (see node-computed serials in the fixture build).
const DATE1 = serial(2026, 1, 15); // 46037
const DATE2 = serial(2026, 2, 20); // 46073
const DATE3 = serial(2026, 3, 25); // 46106
const DATE_MASK = 'yyyy-mm-dd';

const num = (value: number): CellModel => ({ value });
const date = (value: number): CellModel => ({ value, format: { numberFormat: DATE_MASK } });
const formula = (src: string, cached: number): CellModel => ({ formula: src, value: cached });

function fixtureWorkbook(): WorkbookModel {
  return {
    sheets: [
      {
        id: 'sheet-1',
        name: 'Budget',
        cells: {
          // Header row (text).
          '0,0': { value: 'Item' },
          '0,1': { value: 'Date' },
          '0,2': { value: 'Qty' },
          '0,3': { value: 'Cost' },
          '0,4': { value: 'RowTotal' },
          // Data rows: text + date serial + numbers + per-row =SUM.
          '1,0': { value: 'Widget' },
          '1,1': date(DATE1),
          '1,2': num(3),
          '1,3': num(10),
          '1,4': formula('SUM(C2:D2)', 13),
          '2,0': { value: 'Gadget' },
          '2,1': date(DATE2),
          '2,2': num(5),
          '2,3': num(20),
          '2,4': formula('SUM(C3:D3)', 25),
          '3,0': { value: 'Gizmo' },
          '3,1': date(DATE3),
          '3,2': num(7),
          '3,3': num(30),
          '3,4': formula('SUM(C4:D4)', 37),
          // Footer row: per-column =SUM.
          '4,0': { value: 'Total' },
          '4,2': formula('SUM(C2:C4)', 15),
          '4,3': formula('SUM(D2:D4)', 60),
          '4,4': formula('SUM(E2:E4)', 75),
        },
        rowCount: 100,
        colCount: 26,
        // Conditional format: highlight Qty > 4 (live UI feature — see notes).
        conditionalFormats: [
          {
            kind: 'cellValue',
            range: { top: 1, left: 2, bottom: 3, right: 2 },
            op: '>',
            value: 4,
            style: { backgroundToken: '--jects-color-accent-subtle' },
          },
        ],
      },
    ],
    activeSheet: 'sheet-1',
    namedRanges: { Quantities: 'Budget!C2:C4' },
    calcMode: 'auto',
  };
}

/** Locate the End-Of-Central-Directory record signature (PK\x05\x06). */
function hasEocd(bytes: Uint8Array): boolean {
  // No archive comment is written, so the EOCD is the final 22 bytes.
  const p = bytes.length - 22;
  if (p < 0) return false;
  return (
    bytes[p] === 0x50 && bytes[p + 1] === 0x4b && bytes[p + 2] === 0x05 && bytes[p + 3] === 0x06
  );
}

describe('xlsx fixture: OOXML container validity', () => {
  const bytes = workbookToXlsxBytes(fixtureWorkbook());

  it('starts with the ZIP local-file-header (PK\\x03\\x04) signature', () => {
    expect(bytes[0]).toBe(0x50); // 'P'
    expect(bytes[1]).toBe(0x4b); // 'K'
    expect(bytes[2]).toBe(0x03);
    expect(bytes[3]).toBe(0x04);
  });

  it('ends with a valid End-Of-Central-Directory (EOCD) record', () => {
    expect(hasEocd(bytes)).toBe(true);
  });

  it('contains every required OOXML part', () => {
    const files = unzipSync(bytes);
    expect(files.has('[Content_Types].xml')).toBe(true);
    expect(files.has('_rels/.rels')).toBe(true);
    expect(files.has('xl/workbook.xml')).toBe(true);
    expect(files.has('xl/_rels/workbook.xml.rels')).toBe(true);
    expect(files.has('xl/worksheets/sheet1.xml')).toBe(true);
    // sharedStrings is present because the fixture uses text cells.
    expect(files.has('xl/sharedStrings.xml')).toBe(true);
    expect(files.has('xl/styles.xml')).toBe(true);
  });

  it('declares the worksheet + sharedStrings content types', () => {
    const ct = fromUtf8(unzipSync(bytes).get('[Content_Types].xml')!);
    expect(ct).toContain('PartName="/xl/worksheets/sheet1.xml"');
    expect(ct).toContain(
      'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"',
    );
    expect(ct).toContain('PartName="/xl/workbook.xml"');
    expect(ct).toContain('PartName="/xl/sharedStrings.xml"');
  });
});

describe('xlsx fixture: worksheet XML carries the expected cells/values/formulas', () => {
  const files = unzipSync(workbookToXlsxBytes(fixtureWorkbook()));
  const sheetXml = fromUtf8(files.get('xl/worksheets/sheet1.xml')!);
  const sharedXml = fromUtf8(files.get('xl/sharedStrings.xml')!);
  const workbookXml = fromUtf8(files.get('xl/workbook.xml')!);

  it('emits the per-row =SUM formula strings (without leading =)', () => {
    expect(sheetXml).toContain('<f>SUM(C2:D2)</f>');
    expect(sheetXml).toContain('<f>SUM(C3:D3)</f>');
    expect(sheetXml).toContain('<f>SUM(C4:D4)</f>');
  });

  it('emits the per-column footer =SUM formula strings', () => {
    expect(sheetXml).toContain('<f>SUM(C2:C4)</f>');
    expect(sheetXml).toContain('<f>SUM(D2:D4)</f>');
    expect(sheetXml).toContain('<f>SUM(E2:E4)</f>');
  });

  it('carries the cached numeric formula results', () => {
    // Footer row 5 column C/D/E carry the computed sums.
    expect(sheetXml).toContain('<c r="C5"><f>SUM(C2:C4)</f><v>15</v></c>');
    expect(sheetXml).toContain('<c r="E5"><f>SUM(E2:E4)</f><v>75</v></c>');
  });

  it('writes the addressed cell refs and the numeric literals', () => {
    expect(sheetXml).toContain('r="A1"');
    expect(sheetXml).toContain('r="C2"');
    // The date serial is written as a bare number literal.
    expect(sheetXml).toContain(`<v>${DATE1}</v>`);
    // Qty literals.
    expect(sheetXml).toContain('<v>3</v>');
    expect(sheetXml).toContain('<v>30</v>');
  });

  it('interns the text values into sharedStrings', () => {
    for (const text of ['Item', 'Date', 'Qty', 'Widget', 'Gadget', 'Gizmo', 'Total']) {
      expect(sharedXml).toContain(`>${text}</t>`);
    }
  });

  it('records the named range as a definedName in workbook.xml', () => {
    expect(workbookXml).toContain('<definedName name="Quantities">Budget!C2:C4</definedName>');
    expect(workbookXml).toContain('name="Budget"');
  });
});

describe('xlsx fixture: full export → import round-trip', () => {
  const source = fixtureWorkbook();
  const back = xlsxBytesToWorkbook(workbookToXlsxBytes(source));
  const s = back.sheets[0]!;

  it('preserves the sheet identity', () => {
    expect(back.sheets.length).toBe(1);
    expect(s.name).toBe('Budget');
  });

  it('round-trips text cells', () => {
    expect(s.cells['0,0']?.value).toBe('Item');
    expect(s.cells['0,4']?.value).toBe('RowTotal');
    expect(s.cells['1,0']?.value).toBe('Widget');
    expect(s.cells['3,0']?.value).toBe('Gizmo');
    expect(s.cells['4,0']?.value).toBe('Total');
  });

  it('round-trips numeric cells', () => {
    expect(s.cells['1,2']?.value).toBe(3);
    expect(s.cells['1,3']?.value).toBe(10);
    expect(s.cells['3,2']?.value).toBe(7);
    expect(s.cells['3,3']?.value).toBe(30);
  });

  it('round-trips date serials and their number-format mask', () => {
    expect(s.cells['1,1']?.value).toBe(DATE1);
    expect(s.cells['2,1']?.value).toBe(DATE2);
    expect(s.cells['3,1']?.value).toBe(DATE3);
    expect(s.cells['1,1']?.format?.numberFormat).toBe(DATE_MASK);
  });

  it('round-trips the per-row =SUM formulas and cached results', () => {
    expect(s.cells['1,4']?.formula).toBe('SUM(C2:D2)');
    expect(s.cells['1,4']?.value).toBe(13);
    expect(s.cells['2,4']?.formula).toBe('SUM(C3:D3)');
    expect(s.cells['2,4']?.value).toBe(25);
    expect(s.cells['3,4']?.formula).toBe('SUM(C4:D4)');
    expect(s.cells['3,4']?.value).toBe(37);
  });

  it('round-trips the per-column footer =SUM formulas and cached results', () => {
    expect(s.cells['4,2']?.formula).toBe('SUM(C2:C4)');
    expect(s.cells['4,2']?.value).toBe(15);
    expect(s.cells['4,3']?.formula).toBe('SUM(D2:D4)');
    expect(s.cells['4,3']?.value).toBe(60);
    expect(s.cells['4,4']?.formula).toBe('SUM(E2:E4)');
    expect(s.cells['4,4']?.value).toBe(75);
  });

  it('round-trips the named range', () => {
    expect(back.namedRanges?.['Quantities']).toBe('Budget!C2:C4');
  });

  it('is idempotent across a second round-trip', () => {
    const twice = xlsxBytesToWorkbook(workbookToXlsxBytes(back));
    const s2 = twice.sheets[0]!;
    expect(s2.cells['4,4']?.formula).toBe('SUM(E2:E4)');
    expect(s2.cells['4,4']?.value).toBe(75);
    expect(s2.cells['1,1']?.value).toBe(DATE1);
    expect(twice.namedRanges?.['Quantities']).toBe('Budget!C2:C4');
  });
});

describe('xlsx fixture: Blob wrapper + conditional-format robustness', () => {
  it('workbookToXlsxBlob yields a typed, non-empty .xlsx blob', () => {
    const blob = workbookToXlsxBlob(fixtureWorkbook());
    expect(blob.type).toBe(XLSX_MIME);
    expect(blob.size).toBeGreaterThan(0);
    // Same byte length as the raw export.
    expect(blob.size).toBe(workbookToXlsxBytes(fixtureWorkbook()).length);
  });

  it('exports a valid package even though the source carries a conditional format', () => {
    // The fixture sheet declares a `conditionalFormats` rule. CF is a live-UI
    // feature and is intentionally NOT serialized into the OOXML package, so the
    // export must still succeed and stay a valid, importable package.
    const bytes = workbookToXlsxBytes(fixtureWorkbook());
    expect(hasEocd(bytes)).toBe(true);
    const back = xlsxBytesToWorkbook(bytes);
    expect(back.sheets[0]?.conditionalFormats).toBeUndefined();
  });
});
