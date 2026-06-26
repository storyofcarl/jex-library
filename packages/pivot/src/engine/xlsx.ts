/**
 * Real `.xlsx` (Office Open XML / OOXML) export of a computed {@link PivotResult}.
 *
 * Unlike the legacy SpreadsheetML-2003 single-XML flavor (still available as
 * `toExcelXml` / `downloadXls`), this produces a genuine zipped OOXML package —
 * the format Excel / Google Sheets / LibreOffice actually emit:
 *
 *   [Content_Types].xml
 *   _rels/.rels
 *   xl/workbook.xml
 *   xl/_rels/workbook.xml.rels
 *   xl/styles.xml
 *   xl/sharedStrings.xml         ← interned header/label text
 *   xl/worksheets/sheet1.xml     ← typed cells (the pivot matrix)
 *
 * The worksheet mirrors the on-screen pivot: header lines (one per column-axis
 * depth + the value-field line) followed by the data rows, row-header columns
 * first. String cells are interned into `sharedStrings.xml`; numeric data cells
 * are written inline. Dependency-free: the zip container is built by the local
 * {@link zipSync}; all XML is hand-emitted.
 */

import type { PivotResult } from './engine.js';
import { toExportMatrix, type PivotExportOptions } from './export.js';
import { utf8, zipSync, type ZipEntry } from './zip.js';

/** The Office Open XML MIME type for a `.xlsx` workbook. */
export const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS_REL_DOC = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** A1 column label from a 0-based index (0 → "A", 26 → "AA"). */
function columnLabel(index: number): string {
  let n = index;
  let label = '';
  do {
    label = String.fromCharCode(65 + (n % 26)) + label;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return label;
}

const FORMULA_TRIGGERS = ['=', '+', '-', '@', '\t', '\r'];
function guardFormula(s: string, on: boolean): string {
  if (on && s.length > 0 && FORMULA_TRIGGERS.includes(s[0]!)) return `'${s}`;
  return s;
}

/** Interns strings so each distinct text appears once in `sharedStrings.xml`. */
class StringTable {
  private readonly map = new Map<string, number>();
  readonly values: string[] = [];
  intern(value: string): number {
    const existing = this.map.get(value);
    if (existing !== undefined) return existing;
    const index = this.values.length;
    this.map.set(value, index);
    this.values.push(value);
    return index;
  }
  get count(): number {
    return this.values.length;
  }
}

/**
 * Serialize a pivot result to real `.xlsx` (OOXML) bytes. The data section's
 * value cells (everything past the row-header columns, below the header lines)
 * are written as numbers when they parse cleanly; all other cells are strings.
 */
export function toXlsx(result: PivotResult, options: PivotExportOptions = {}): Uint8Array {
  const sanitize = options.sanitizeFormulas ?? true;
  const matrix = toExportMatrix(result, options);
  const headerLines = Math.max(result.columnFieldCount, 0) + 1;
  const rowHeaderWidth = Math.max(result.rowFieldCount, 1);

  const strings = new StringTable();

  const rowsXml = matrix
    .map((line, r) => {
      const isData = r >= headerLines;
      const cells = line
        .map((text, c) => {
          const ref = `${columnLabel(c)}${r + 1}`;
          const isValueCol = isData && c >= rowHeaderWidth;
          const numeric = isValueCol && text !== '' && Number.isFinite(Number(text));
          if (numeric) {
            return `<c r="${ref}"><v>${Number(text)}</v></c>`;
          }
          if (text === '') return '';
          const idx = strings.intern(guardFormula(text, sanitize));
          return `<c r="${ref}" t="s"><v>${idx}</v></c>`;
        })
        .join('');
      return `<row r="${r + 1}">${cells}</row>`;
    })
    .join('');

  const lastCol = matrix.reduce((m, line) => Math.max(m, line.length), 1);
  const dimension = `A1:${columnLabel(Math.max(0, lastCol - 1))}${Math.max(1, matrix.length)}`;

  const sheetXml =
    `${XML_DECL}` +
    `<worksheet xmlns="${NS_MAIN}" xmlns:r="${NS_REL_DOC}">` +
    `<dimension ref="${dimension}"/>` +
    `<sheetData>${rowsXml}</sheetData>` +
    `</worksheet>`;

  const parts: ZipEntry[] = [
    { path: '[Content_Types].xml', bytes: utf8(contentTypesXml()) },
    { path: '_rels/.rels', bytes: utf8(rootRelsXml()) },
    { path: 'xl/workbook.xml', bytes: utf8(workbookXml()) },
    { path: 'xl/_rels/workbook.xml.rels', bytes: utf8(workbookRelsXml()) },
    { path: 'xl/styles.xml', bytes: utf8(stylesXml()) },
    { path: 'xl/sharedStrings.xml', bytes: utf8(sharedStringsXml(strings)) },
    { path: 'xl/worksheets/sheet1.xml', bytes: utf8(sheetXml) },
  ];
  return zipSync(parts);
}

function contentTypesXml(): string {
  return (
    `${XML_DECL}` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
    `<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>` +
    `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
    `</Types>`
  );
}

function rootRelsXml(): string {
  return (
    `${XML_DECL}` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="${NS_REL_DOC}/officeDocument" Target="xl/workbook.xml"/>` +
    `</Relationships>`
  );
}

function workbookXml(): string {
  return (
    `${XML_DECL}` +
    `<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_REL_DOC}">` +
    `<sheets><sheet name="Pivot" sheetId="1" r:id="rId1"/></sheets>` +
    `</workbook>`
  );
}

function workbookRelsXml(): string {
  return (
    `${XML_DECL}` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="${NS_REL_DOC}/worksheet" Target="worksheets/sheet1.xml"/>` +
    `<Relationship Id="rId2" Type="${NS_REL_DOC}/styles" Target="styles.xml"/>` +
    `<Relationship Id="rId3" Type="${NS_REL_DOC}/sharedStrings" Target="sharedStrings.xml"/>` +
    `</Relationships>`
  );
}

function stylesXml(): string {
  return (
    `${XML_DECL}` +
    `<styleSheet xmlns="${NS_MAIN}">` +
    `<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>` +
    `<fills count="1"><fill><patternFill patternType="none"/></fill></fills>` +
    `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
    `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
    `<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>` +
    `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
    `</styleSheet>`
  );
}

function sharedStringsXml(strings: StringTable): string {
  const items = strings.values
    .map((s) => `<si><t xml:space="preserve">${escapeXml(s)}</t></si>`)
    .join('');
  return (
    `${XML_DECL}` +
    `<sst xmlns="${NS_MAIN}" count="${strings.count}" uniqueCount="${strings.count}">${items}</sst>`
  );
}
