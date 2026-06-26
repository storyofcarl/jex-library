/**
 * Import / export for the spreadsheet: CSV, JSON, and a minimal XLSX
 * (SpreadsheetML) reader/writer. All pure string/array transforms so they run in
 * jsdom without a DOM or filesystem.
 *
 *   - CSV   : RFC-4180-ish quoting; one sheet at a time.
 *   - JSON  : the `WorkbookModel` itself (round-trips losslessly).
 *   - XLSX  : a tiny SpreadsheetML 2003 (`.xml`) flavor — a self-describing,
 *             dependency-free subset that captures cell values per sheet. (Full
 *             OOXML zip packaging is out of scope for the contract-free UI; this
 *             keeps import/export usable and testable end-to-end.)
 */

import type { CellValue, SheetModel, WorkbookModel } from '../contract.js';
import { escapeCsvInjection } from './csv-safe.js';
import { formatValue, isCellError } from './format.js';
import { columnIndexToLabel } from './a1.js';
import { workbookToXlsx, xlsxToWorkbook, XLSX_MIME } from './xlsx.js';

/** Options controlling CSV export. */
export interface CsvExportOptions {
  /** Field delimiter (default `,`). */
  delimiter?: string;
  /**
   * Neutralise CSV formula injection by prefixing fields beginning with a
   * dangerous character (`=`/`+`/`-`/`@`) with an apostrophe. Default `true`.
   */
  sanitizeInjection?: boolean;
}

const cellKey = (row: number, col: number): string => `${row},${col}`;

/** Decode a `"row,col"` cell key into a numeric tuple. */
function parseKey(key: string): [number, number] {
  const i = key.indexOf(',');
  return [Number(key.slice(0, i)), Number(key.slice(i + 1))];
}

/* ── CSV ─────────────────────────────────────────────────────────────────── */

/** Quote a CSV field if it contains a comma, quote, or newline. */
function csvQuote(s: string): string {
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Display-format a value for CSV/text output. */
function cellText(value: CellValue): string {
  if (value === null || value === undefined) return '';
  if (isCellError(value)) return value.code;
  return formatValue(value);
}

/**
 * Serialize one sheet to CSV (using computed/literal values).
 *
 * Accepts either a delimiter string (back-compat) or an options object. By
 * default, exported fields are guarded against CSV formula injection.
 */
export function sheetToCsv(sheet: SheetModel, options?: string | CsvExportOptions): string {
  const opts: CsvExportOptions = typeof options === 'string' ? { delimiter: options } : options ?? {};
  const delimiter = opts.delimiter ?? ',';
  const guard = opts.sanitizeInjection !== false;
  let maxRow = 0;
  let maxCol = 0;
  for (const key of Object.keys(sheet.cells)) {
    const [r, c] = parseKey(key);
    if (r > maxRow) maxRow = r;
    if (c > maxCol) maxCol = c;
  }
  const lines: string[] = [];
  for (let r = 0; r <= maxRow; r++) {
    const fields: string[] = [];
    for (let c = 0; c <= maxCol; c++) {
      const cell = sheet.cells[cellKey(r, c)];
      const text = cellText(cell?.value ?? null);
      fields.push(csvQuote(guard ? escapeCsvInjection(text) : text));
    }
    lines.push(fields.join(delimiter));
  }
  return lines.join('\r\n');
}

/** Parse CSV text into a 2D array of raw string fields. */
export function parseCsv(text: string, delimiter = ','): string[][] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  let i = 0;
  const push = (): void => {
    row.push(field);
    field = '';
  };
  const pushRow = (): void => {
    push();
    rows.push(row);
    row = [];
  };
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === delimiter) {
      push();
      i++;
      continue;
    }
    if (ch === '\r') {
      i++;
      continue;
    }
    if (ch === '\n') {
      pushRow();
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  // trailing field/row
  if (field !== '' || row.length > 0) pushRow();
  return rows;
}

/** Build a `SheetModel` from parsed CSV rows. Numbers/booleans are inferred. */
export function csvToSheet(rows: string[][], id: string, name: string): SheetModel {
  const sheet: SheetModel = {
    id,
    name,
    cells: {},
    rowCount: Math.max(rows.length, 1),
    colCount: Math.max(...rows.map((r) => r.length), 1),
  };
  rows.forEach((cols, r) => {
    cols.forEach((raw, c) => {
      if (raw === '') return;
      sheet.cells[cellKey(r, c)] = { value: inferValue(raw) };
    });
  });
  return sheet;
}

function inferValue(raw: string): CellValue {
  if (/^(true|false)$/i.test(raw)) return /^true$/i.test(raw);
  if (/^-?\d+(\.\d+)?$/.test(raw)) return parseFloat(raw);
  return raw;
}

/* ── JSON ────────────────────────────────────────────────────────────────── */

/** Serialize a whole workbook to a JSON string. */
export function workbookToJson(workbook: WorkbookModel): string {
  return JSON.stringify(workbook, null, 2);
}

/** Parse a workbook JSON string back to a `WorkbookModel`. */
export function jsonToWorkbook(json: string): WorkbookModel {
  const wb = JSON.parse(json) as WorkbookModel;
  if (!Array.isArray(wb.sheets)) throw new Error('Invalid workbook JSON: missing sheets');
  return wb;
}

/* ── XLSX (SpreadsheetML 2003 subset) ─────────────────────────────────────── */

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Export the workbook to a SpreadsheetML 2003 XML string. */
export function workbookToXlsxXml(workbook: WorkbookModel): string {
  const sheetsXml = workbook.sheets
    .map((sheet) => {
      let maxRow = 0;
      let maxCol = 0;
      for (const key of Object.keys(sheet.cells)) {
        const [r, c] = parseKey(key);
        maxRow = Math.max(maxRow, r);
        maxCol = Math.max(maxCol, c);
      }
      const rowsXml: string[] = [];
      for (let r = 0; r <= maxRow; r++) {
        const cellsXml: string[] = [];
        for (let c = 0; c <= maxCol; c++) {
          const cell = sheet.cells[cellKey(r, c)];
          if (!cell || cell.value == null) continue;
          const v = cell.value;
          const type = typeof v === 'number' ? 'Number' : typeof v === 'boolean' ? 'Boolean' : 'String';
          const data = isCellError(v) ? v.code : typeof v === 'boolean' ? (v ? '1' : '0') : String(v);
          const formulaAttr = cell.formula ? ` ss:Formula="=${xmlEscape(cell.formula)}"` : '';
          cellsXml.push(
            `<Cell ss:Index="${c + 1}"${formulaAttr}><Data ss:Type="${type}">${xmlEscape(data)}</Data></Cell>`,
          );
        }
        rowsXml.push(`<Row ss:Index="${r + 1}">${cellsXml.join('')}</Row>`);
      }
      return `<Worksheet ss:Name="${xmlEscape(sheet.name)}"><Table>${rowsXml.join('')}</Table></Worksheet>`;
    })
    .join('');
  return (
    `<?xml version="1.0"?>\n` +
    `<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" ` +
    `xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">${sheetsXml}</Workbook>`
  );
}

/**
 * Parse a SpreadsheetML 2003 XML string into a `WorkbookModel`. Uses a tolerant
 * regex scan (no DOMParser dependency) over `<Worksheet>/<Row>/<Cell>/<Data>`.
 */
export function xlsxXmlToWorkbook(xml: string): WorkbookModel {
  const sheets: SheetModel[] = [];
  const sheetRe = /<Worksheet[^>]*ss:Name="([^"]*)"[^>]*>([\s\S]*?)<\/Worksheet>/g;
  let sm: RegExpExecArray | null;
  let seq = 0;
  while ((sm = sheetRe.exec(xml))) {
    const name = xmlUnescape(sm[1] ?? '');
    const body = sm[2] ?? '';
    const sheet: SheetModel = { id: `sheet-${++seq}`, name, cells: {}, rowCount: 1, colCount: 1 };
    const rowRe = /<Row([^>]*)>([\s\S]*?)<\/Row>/g;
    let rm: RegExpExecArray | null;
    let autoRow = 0;
    while ((rm = rowRe.exec(body))) {
      const rowIndexAttr = /ss:Index="(\d+)"/.exec(rm[1] ?? '');
      const rowIndex = rowIndexAttr ? parseInt(rowIndexAttr[1] as string, 10) - 1 : autoRow;
      autoRow = rowIndex + 1;
      const cellRe = /<Cell([^>]*)>([\s\S]*?)<\/Cell>/g;
      let cm: RegExpExecArray | null;
      let autoCol = 0;
      while ((cm = cellRe.exec(rm[2] ?? ''))) {
        const attrs = cm[1] ?? '';
        const colIndexAttr = /ss:Index="(\d+)"/.exec(attrs);
        const colIndex = colIndexAttr ? parseInt(colIndexAttr[1] as string, 10) - 1 : autoCol;
        autoCol = colIndex + 1;
        const formulaAttr = /ss:Formula="=([^"]*)"/.exec(attrs);
        const dataMatch = /<Data[^>]*ss:Type="([^"]*)"[^>]*>([\s\S]*?)<\/Data>/.exec(cm[2] ?? '');
        const type = dataMatch?.[1] ?? 'String';
        const raw = xmlUnescape(dataMatch?.[2] ?? '');
        let value: CellValue = raw;
        if (type === 'Number') value = Number(raw);
        else if (type === 'Boolean') value = raw === '1' || /^true$/i.test(raw);
        const cell: SheetModel['cells'][string] = { value };
        if (formulaAttr) cell.formula = xmlUnescape(formulaAttr[1] ?? '');
        sheet.cells[cellKey(rowIndex, colIndex)] = cell;
        sheet.rowCount = Math.max(sheet.rowCount, rowIndex + 1);
        sheet.colCount = Math.max(sheet.colCount, colIndex + 1);
      }
    }
    sheets.push(sheet);
  }
  if (sheets.length === 0) throw new Error('No worksheets found in XLSX XML');
  return { sheets, activeSheet: (sheets[0] as SheetModel).id, calcMode: 'auto' };
}

function xmlUnescape(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/* ── high-level helpers ───────────────────────────────────────────────────── */

/** Supported import/export formats. */
export type IoFormat = 'csv' | 'json' | 'xlsx';

/** Export a workbook (or its active sheet for CSV) to a string of `format`. */
export function exportWorkbook(workbook: WorkbookModel, format: IoFormat, activeSheetId?: string): string {
  switch (format) {
    case 'json':
      return workbookToJson(workbook);
    case 'xlsx':
      return workbookToXlsxXml(workbook);
    case 'csv': {
      const sheet =
        workbook.sheets.find((s) => s.id === (activeSheetId ?? workbook.activeSheet)) ?? workbook.sheets[0];
      if (!sheet) return '';
      return sheetToCsv(sheet);
    }
  }
}

/** Import a string of `format` into a `WorkbookModel`. */
export function importWorkbook(text: string, format: IoFormat): WorkbookModel {
  switch (format) {
    case 'json':
      return jsonToWorkbook(text);
    case 'xlsx':
      return xlsxXmlToWorkbook(text);
    case 'csv': {
      const rows = parseCsv(text);
      const sheet = csvToSheet(rows, 'sheet-1', 'Imported');
      return { sheets: [sheet], activeSheet: sheet.id, calcMode: 'auto' };
    }
  }
}

/* ── real XLSX (OOXML zip) ─────────────────────────────────────────────────── */

/**
 * Export the workbook as a real `.xlsx` (Office Open XML) byte package — the
 * format Excel / Sheets / LibreOffice natively read/write, with typed cells,
 * formulas, number formats, merges, frozen panes, and defined names (named
 * ranges). Returns the zipped OOXML bytes; wrap in a Blob for download via
 * {@link workbookToXlsxBlob}.
 */
export function workbookToXlsxBytes(workbook: WorkbookModel): Uint8Array {
  return workbookToXlsx(workbook);
}

/** Parse a real `.xlsx` (OOXML) byte package back into a `WorkbookModel`. */
export function xlsxBytesToWorkbook(bytes: Uint8Array): WorkbookModel {
  return xlsxToWorkbook(bytes);
}

/** Wrap real `.xlsx` bytes in a typed Blob (owns a contiguous copy). */
export function workbookToXlsxBlob(workbook: WorkbookModel): Blob {
  const bytes = workbookToXlsx(workbook);
  return new Blob([bytes.slice()], { type: XLSX_MIME });
}

export { XLSX_MIME } from './xlsx.js';

/** A1-style label for a column (re-exported for IO consumers/tests). */
export { columnIndexToLabel as columnLabel };
