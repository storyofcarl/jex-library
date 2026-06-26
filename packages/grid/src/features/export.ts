/**
 * ExportFeature — data export for @jects/grid: CSV, Excel-compatible XML
 * (SpreadsheetML), and print.
 *
 * Serializes the current grid view (respecting filters/sort and visible
 * columns) using each column's value accessor. The feature is environment-aware:
 * `toCsv` / `toExcelXml` / `toHtml` are pure string builders (unit-testable in
 * jsdom), while `downloadCsv` / `downloadExcel` / `print` perform the
 * browser-side side effects. No persistent listeners are added, so `destroy()`
 * is a no-op beyond the disposer bag.
 */

import type { Model } from '@jects/core';
import type { ColumnDef, GridApi, GridFeature } from '../contract.js';
import { Disposers, colId, escapeHtml, getValue, readRows } from './shared.js';

export interface ExportColumnFilter<Row extends Model> {
  (column: ColumnDef<Row>): boolean;
}

export interface ExportOptions<Row extends Model = Model> {
  /** Which columns to include. Default: all non-hidden columns with a header/field. */
  columns?: ExportColumnFilter<Row>;
  /** Include a header row. Default `true`. */
  header?: boolean;
  /** Field/CSV delimiter. Default `','`. */
  delimiter?: string;
  /** Line terminator. Default `'\r\n'`. */
  newline?: string;
  /** Format a cell value to a string. Default: `String`, `''` for null. */
  formatValue?: (value: unknown, column: ColumnDef<Row>, row: Row) => string;
  /** File name (without extension) used by the download helpers. Default `'export'`. */
  fileName?: string;
  /**
   * Guard against CSV/formula injection: a cell whose text begins with one of
   * `= + - @` or a leading TAB/CR is interpreted as a formula when the exported
   * file is opened in Excel/Sheets (e.g. `=cmd|'/c calc'!A1`, `=HYPERLINK(...)`).
   * When enabled (the default), such fields are prefixed with a single quote so
   * the spreadsheet treats them as literal text. Set to `false` to opt out (e.g.
   * when the values are known-safe and a literal leading `=` must round-trip).
   */
  sanitizeFormulas?: boolean;
}

/** Characters that trigger formula interpretation in spreadsheet apps. */
const FORMULA_TRIGGERS = ['=', '+', '-', '@', '\t', '\r'];

/**
 * Neutralize a leading formula trigger by prefixing a single quote, so the
 * spreadsheet treats the field as literal text rather than a formula. Empty
 * strings and non-triggering fields are returned unchanged.
 */
function guardFormula(s: string): string {
  if (s.length > 0 && FORMULA_TRIGGERS.includes(s[0]!)) return `'${s}`;
  return s;
}

const defaultFormat = (value: unknown): string =>
  value == null ? '' : value instanceof Date ? value.toISOString() : String(value);

export class ExportFeature<Row extends Model = Model> implements GridFeature<Row> {
  readonly name = 'export';

  private api!: GridApi<Row>;
  private readonly disposers = new Disposers();
  private readonly opts: {
    header: boolean;
    delimiter: string;
    newline: string;
    formatValue: (value: unknown, column: ColumnDef<Row>, row: Row) => string;
    fileName: string;
    sanitizeFormulas: boolean;
    columns?: ExportColumnFilter<Row>;
  };

  constructor(options: ExportOptions<Row> = {}) {
    this.opts = {
      header: options.header ?? true,
      delimiter: options.delimiter ?? ',',
      newline: options.newline ?? '\r\n',
      formatValue: options.formatValue ?? defaultFormat,
      fileName: options.fileName ?? 'export',
      sanitizeFormulas: options.sanitizeFormulas ?? true,
      ...(options.columns ? { columns: options.columns } : {}),
    };
  }

  /** Apply the formula-injection guard when enabled. */
  private guard(s: string): string {
    return this.opts.sanitizeFormulas ? guardFormula(s) : s;
  }

  init(grid: GridApi<Row>): void {
    this.api = grid;
    grid.track(() => this.disposers.dispose());
  }

  /** Resolve the columns to export (visible, with a field). */
  private exportColumns(override?: ExportColumnFilter<Row>): ColumnDef<Row>[] {
    const filter = override ?? this.opts.columns;
    return this.api.columns.filter((c) => {
      if (c.hidden) return false;
      if (!c.field && !c.header) return false;
      return filter ? filter(c) : true;
    });
  }

  private headerLabel(column: ColumnDef<Row>): string {
    return column.header ?? colId(column);
  }

  private rows(): Row[] {
    return readRows(this.api);
  }

  /** Build a 2D matrix of formatted strings (header + data). */
  toMatrix(override?: ExportColumnFilter<Row>): string[][] {
    const cols = this.exportColumns(override);
    const matrix: string[][] = [];
    if (this.opts.header) matrix.push(cols.map((c) => this.headerLabel(c)));
    for (const row of this.rows()) {
      matrix.push(cols.map((c) => this.opts.formatValue(getValue(row, c), c, row)));
    }
    return matrix;
  }

  /** Serialize the view to CSV (RFC-4180-ish quoting). */
  toCsv(override?: ExportColumnFilter<Row>): string {
    const { delimiter, newline } = this.opts;
    const quote = (raw: string): string => {
      // Neutralize formula triggers BEFORE quoting so a guarded leading char is
      // still inside the quoted field if quoting is otherwise required.
      const s = this.guard(raw);
      if (s.includes(delimiter) || s.includes('"') || /[\r\n]/.test(s)) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    };
    return this.toMatrix(override)
      .map((line) => line.map(quote).join(delimiter))
      .join(newline);
  }

  /** Serialize the view to Excel SpreadsheetML 2003 XML. */
  toExcelXml(override?: ExportColumnFilter<Row>): string {
    const cols = this.exportColumns(override);
    const rows = this.rows();
    const cell = (value: unknown, column: ColumnDef<Row>, row: Row): string => {
      const num = column.type === 'number' && typeof value === 'number';
      const type = num ? 'Number' : 'String';
      // String cells are formula-guarded too: Excel evaluates a leading `=` in an
      // imported String cell. Numeric cells carry their own ss:Type="Number" and
      // are never formula-interpreted.
      const text = num
        ? String(value)
        : escapeXml(this.guard(this.opts.formatValue(value, column, row)));
      return `<Cell><Data ss:Type="${type}">${text}</Data></Cell>`;
    };
    const headerRow = this.opts.header
      ? `<Row>${cols.map((c) => `<Cell><Data ss:Type="String">${escapeXml(this.guard(this.headerLabel(c)))}</Data></Cell>`).join('')}</Row>`
      : '';
    const dataRows = rows
      .map((row) => `<Row>${cols.map((c) => cell(getValue(row, c), c, row)).join('')}</Row>`)
      .join('');
    return [
      '<?xml version="1.0"?>',
      '<?mso-application progid="Excel.Sheet"?>',
      '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">',
      '<Worksheet ss:Name="Sheet1"><Table>',
      headerRow,
      dataRows,
      '</Table></Worksheet></Workbook>',
    ].join('');
  }

  /** Build a styled, print-ready HTML table of the view. */
  toHtml(override?: ExportColumnFilter<Row>): string {
    const cols = this.exportColumns(override);
    const head = this.opts.header
      ? `<thead><tr>${cols.map((c) => `<th>${escapeHtml(this.headerLabel(c))}</th>`).join('')}</tr></thead>`
      : '';
    const body = `<tbody>${this.rows()
      .map(
        (row) =>
          `<tr>${cols
            .map((c) => `<td>${escapeHtml(this.opts.formatValue(getValue(row, c), c, row))}</td>`)
            .join('')}</tr>`,
      )
      .join('')}</tbody>`;
    return `<table class="jects-grid-export">${head}${body}</table>`;
  }

  /** Trigger a CSV file download (browser). */
  downloadCsv(fileName?: string): void {
    this.triggerDownload(this.toCsv(), `${fileName ?? this.opts.fileName}.csv`, 'text/csv;charset=utf-8;');
  }

  /** Trigger an Excel (.xls SpreadsheetML) download (browser). */
  downloadExcel(fileName?: string): void {
    this.triggerDownload(
      this.toExcelXml(),
      `${fileName ?? this.opts.fileName}.xls`,
      'application/vnd.ms-excel;charset=utf-8;',
    );
  }

  /** Open a print window/dialog containing the view as an HTML table. */
  print(title?: string): void {
    const html = this.toHtml();
    const doc = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(
      title ?? this.opts.fileName,
    )}</title><style>table{border-collapse:collapse;width:100%;font-family:sans-serif}th,td{border:1px solid oklch(var(--jects-border, 0.7 0 0));padding:4px 8px;text-align:left}</style></head><body>${html}</body></html>`;
    const win = typeof window !== 'undefined' ? window.open('', '_blank') : null;
    if (!win) return;
    win.document.write(doc);
    win.document.close();
    win.focus();
    win.print();
  }

  private triggerDownload(content: string, fileName: string, mime: string): void {
    if (typeof document === 'undefined') return;
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Revoke on the next tick so the click had a chance to start the download.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  destroy(): void {
    this.disposers.dispose();
  }
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Convenience factory. */
export function exportFeature<Row extends Model = Model>(
  options?: ExportOptions<Row>,
): ExportFeature<Row> {
  return new ExportFeature<Row>(options);
}
