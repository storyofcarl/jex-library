/**
 * Pivot export — CSV, real `.xlsx` (OOXML), and legacy `.xls` (SpreadsheetML
 * 2003 XML) serialization of a computed {@link PivotResult}.
 *
 * Pure builders (`toCsv` / `toExcelXml`, and `toXlsx` in `./xlsx.ts`) are
 * unit-testable in jsdom/node; `downloadCsv` / `downloadXlsx` / `downloadXls`
 * perform the browser-side side effects. `downloadXlsx` produces a genuine
 * zipped OOXML package; `downloadXls` keeps the old SpreadsheetML for
 * back-compat. The exported matrix mirrors the on-screen pivot: row-header
 * columns followed by one column per `columnLeaf`.
 */

import type { PivotResult, PivotColumnLeaf } from './engine.js';
import { toXlsx, XLSX_MIME } from './xlsx.js';

export interface PivotExportOptions {
  /** Format a numeric cell to a string. Default: `String`, `''` for null. */
  formatValue?: (value: number | null, leaf: PivotColumnLeaf) => string;
  /** CSV delimiter. Default `','`. */
  delimiter?: string;
  /** CSV line terminator. Default `'\r\n'`. */
  newline?: string;
  /** File name (no extension) for the download helpers. Default `'pivot'`. */
  fileName?: string;
  /**
   * Guard against CSV/formula injection in spreadsheet apps by prefixing a
   * single quote to fields beginning with `= + - @` / TAB / CR. Default `true`.
   */
  sanitizeFormulas?: boolean;
  /** Labels for the leading row-field header columns. */
  rowFieldLabels?: string[];
}

const FORMULA_TRIGGERS = ['=', '+', '-', '@', '\t', '\r'];

function guardFormula(s: string, on: boolean): string {
  if (on && s.length > 0 && FORMULA_TRIGGERS.includes(s[0]!)) return `'${s}`;
  return s;
}

const defaultFormat = (value: number | null): string => (value == null ? '' : String(value));

/**
 * Build the 2D export matrix: a header section (one line per column-axis
 * depth + the value-field line) followed by one line per matrix row.
 */
export function toExportMatrix(result: PivotResult, options: PivotExportOptions = {}): string[][] {
  const format = options.formatValue ?? defaultFormat;
  const rowLabels = options.rowFieldLabels ?? [];
  const out: string[][] = [];

  const rowHeaderWidth = Math.max(result.rowFieldCount, 1);
  const colDepth = Math.max(result.columnFieldCount, 0);

  // Column header lines (one per column-axis level). Each leaf contributes its
  // member label at that depth; total leaves are labeled "Total".
  for (let d = 0; d < colDepth; d++) {
    const line: string[] = [];
    for (let i = 0; i < rowHeaderWidth; i++) line.push(d === 0 ? (rowLabels[i] ?? '') : '');
    for (const leaf of result.columnLeaves) {
      line.push(leaf.isTotal ? (d === 0 ? 'Total' : '') : (leaf.path[d] ?? ''));
    }
    out.push(line);
  }

  // Value-field label line (always present so the measure is identified).
  {
    const line: string[] = [];
    for (let i = 0; i < rowHeaderWidth; i++) {
      line.push(colDepth === 0 ? (rowLabels[i] ?? '') : '');
    }
    for (const leaf of result.columnLeaves) line.push(leaf.valueLabel);
    out.push(line);
  }

  // Data rows.
  for (const row of result.matrix) {
    const line: string[] = [];
    for (let i = 0; i < rowHeaderWidth; i++) line.push(row.headers[i] ?? '');
    for (const leaf of result.columnLeaves) line.push(format(row.cells[leaf.key] ?? null, leaf));
    out.push(line);
  }
  return out;
}

/** Serialize a pivot result to CSV (RFC-4180-ish quoting). */
export function toCsv(result: PivotResult, options: PivotExportOptions = {}): string {
  const delimiter = options.delimiter ?? ',';
  const newline = options.newline ?? '\r\n';
  const sanitize = options.sanitizeFormulas ?? true;
  const quote = (raw: string): string => {
    const s = guardFormula(raw, sanitize);
    if (s.includes(delimiter) || s.includes('"') || /[\r\n]/.test(s)) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  return toExportMatrix(result, options)
    .map((line) => line.map(quote).join(delimiter))
    .join(newline);
}

/** Serialize a pivot result to Excel SpreadsheetML 2003 XML (`.xls`). */
export function toExcelXml(result: PivotResult, options: PivotExportOptions = {}): string {
  const sanitize = options.sanitizeFormulas ?? true;
  const matrix = toExportMatrix(result, options);
  // Number of header/value lines preceding the data section.
  const headerLines = Math.max(result.columnFieldCount, 0) + 1;
  const rowHeaderWidth = Math.max(result.rowFieldCount, 1);

  const cell = (text: string, numeric: boolean): string => {
    if (numeric) return `<Cell><Data ss:Type="Number">${text}</Data></Cell>`;
    return `<Cell><Data ss:Type="String">${escapeXml(guardFormula(text, sanitize))}</Data></Cell>`;
  };

  const lines = matrix.map((line, lineIndex) => {
    const isData = lineIndex >= headerLines;
    const cells = line
      .map((text, colIndex) => {
        const isValueCol = isData && colIndex >= rowHeaderWidth;
        const numeric = isValueCol && text !== '' && Number.isFinite(Number(text));
        return cell(text, numeric);
      })
      .join('');
    return `<Row>${cells}</Row>`;
  });

  return [
    '<?xml version="1.0"?>',
    '<?mso-application progid="Excel.Sheet"?>',
    '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">',
    '<Worksheet ss:Name="Pivot"><Table>',
    ...lines,
    '</Table></Worksheet></Workbook>',
  ].join('');
}

/** Trigger a CSV download (browser). */
export function downloadCsv(result: PivotResult, options: PivotExportOptions = {}): void {
  triggerDownload(toCsv(result, options), `${options.fileName ?? 'pivot'}.csv`, 'text/csv;charset=utf-8;');
}

/**
 * Trigger a real `.xlsx` (OOXML, zipped) download (browser). This is the format
 * Excel / Google Sheets / LibreOffice natively read; see {@link toXlsx}.
 */
export function downloadXlsx(result: PivotResult, options: PivotExportOptions = {}): void {
  triggerDownload(toXlsx(result, options), `${options.fileName ?? 'pivot'}.xlsx`, XLSX_MIME);
}

/**
 * Trigger a legacy `.xls` (SpreadsheetML 2003 XML) download (browser). Retained
 * for back-compat; new callers should prefer {@link downloadXlsx}.
 */
export function downloadXls(result: PivotResult, options: PivotExportOptions = {}): void {
  triggerDownload(
    toExcelXml(result, options),
    `${options.fileName ?? 'pivot'}.xls`,
    'application/vnd.ms-excel;charset=utf-8;',
  );
}

function triggerDownload(content: string | Uint8Array, fileName: string, mime: string): void {
  if (typeof document === 'undefined') return;
  const blob = new Blob([content as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
