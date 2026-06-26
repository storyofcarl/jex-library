/**
 * PdfExportFeature — PDF export for @jects/grid.
 *
 * Closes the PARITY "Export: Excel + PDF + CSV + print" gap: `ExportFeature`
 * already covers CSV, Excel-XML and print/HTML; this feature adds real PDF
 * output via two complementary pipelines, matching the Bryntum `PdfExport` /
 * DHTMLX `toPDF` behaviour:
 *
 *   - **Direct PDF builder** (`toPdf` / `toPdfBlob` / `downloadPdf`) — a tiny,
 *     dependency-free PDF 1.4 writer. It paints the current grid view as a
 *     paginated table (repeating header on every page, grid lines, title and
 *     page numbers) into a genuine `%PDF-…%%EOF` document using the built-in
 *     Helvetica/Helvetica-Bold standard fonts. No print dialog, no server —
 *     `downloadPdf()` saves a `.pdf` straight from the browser, and `toPdf()`
 *     returns the raw bytes (unit-testable in jsdom).
 *
 *   - **Print-to-PDF pipeline** (`toPdfHtml` / `printPdf`) — a paginated,
 *     print-ready HTML document with `@page` size/orientation/margins, a
 *     repeating `<thead>` per printed page, hard page breaks honouring
 *     `rowsPerPage`, and a footer. `printPdf()` opens it in a window and calls
 *     `print()` so the user can "Save as PDF" with full browser fidelity
 *     (fonts, RTL, wrapping). This mirrors how Bryntum/DHTMLX let the print
 *     path double as a PDF path.
 *
 * Like `ExportFeature`, the string/byte builders are pure and environment-aware:
 * `toPdf*` / `toPdfHtml` work in jsdom; `downloadPdf` / `printPdf` perform the
 * browser-side side effects. The feature honours **visible columns**, the
 * **current view** (filters/sort), and **pagination** (`rowsPerPage`). It adds
 * no persistent listeners, so `destroy()` only empties its disposer bag.
 */

import type { Model } from '@jects/core';
import type { ColumnDef, GridApi, GridFeature } from '../contract.js';
import { Disposers, colId, escapeHtml, getValue, readRows } from './shared.js';

/* ═══════════════════════════════════════════════════════════════════════════
   Config & events
   ═══════════════════════════════════════════════════════════════════════════ */

/** Which columns to include in a PDF export. */
export interface PdfColumnFilter<Row extends Model> {
  (column: ColumnDef<Row>): boolean;
}

/** Page orientation for the generated PDF / print sheet. */
export type PdfOrientation = 'portrait' | 'landscape';

/** Named ISO/US paper size, or an explicit `[width, height]` in PDF points. */
export type PdfPaperSize = 'a4' | 'a3' | 'letter' | 'legal' | [number, number];

/** Page margins in PDF points (1pt = 1/72 inch). */
export interface PdfMargins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface PdfExportOptions<Row extends Model = Model> {
  /** Which columns to include. Default: all non-hidden columns with a header/field. */
  columns?: PdfColumnFilter<Row>;
  /** Include the header row (repeated on every page). Default `true`. */
  header?: boolean;
  /** Format a cell value to a string. Default: ISO for dates, `String`, `''` for null. */
  formatValue?: (value: unknown, column: ColumnDef<Row>, row: Row) => string;
  /** File name (without extension) used by `downloadPdf`. Default `'export'`. */
  fileName?: string;
  /** Document title rendered at the top of page 1 / print sheet. Default = `fileName`. */
  title?: string;
  /** Paper size. Default `'a4'`. */
  paperSize?: PdfPaperSize;
  /** Orientation. Default `'landscape'` (grids are usually wider than tall). */
  orientation?: PdfOrientation;
  /** Page margins in points. Default 36pt (0.5in) on every side. */
  margins?: Partial<PdfMargins>;
  /**
   * Explicit rows-per-page (pagination). When omitted, the builder packs as
   * many rows as fit the printable height. When set, every printed page gets
   * exactly this many data rows (the last page may have fewer). Mirrors
   * Bryntum's `rowsPerPage` / a paginated grid's page size.
   */
  rowsPerPage?: number;
  /** Font size for body cells, in points. Default `9`. */
  fontSize?: number;
  /** Font size for header cells, in points. Default `10`. */
  headerFontSize?: number;
  /** Render a "Page N of M" footer. Default `true`. */
  pageNumbers?: boolean;
  /**
   * Repeat the document title as a header band on every page (not just page 1).
   * Default `false` (title on page 1 only, like a report cover line).
   */
  repeatTitle?: boolean;
}

/** Resolved, fully-defaulted options. */
interface ResolvedPdfOptions<Row extends Model> {
  header: boolean;
  formatValue: (value: unknown, column: ColumnDef<Row>, row: Row) => string;
  fileName: string;
  title: string;
  paperSize: PdfPaperSize;
  orientation: PdfOrientation;
  margins: PdfMargins;
  fontSize: number;
  headerFontSize: number;
  pageNumbers: boolean;
  repeatTitle: boolean;
  columns?: PdfColumnFilter<Row>;
  rowsPerPage?: number;
}

/* ═══════════════════════════════════════════════════════════════════════════
   Paper sizes (PDF points)
   ═══════════════════════════════════════════════════════════════════════════ */

const PAPER_POINTS: Record<Exclude<PdfPaperSize, [number, number]>, [number, number]> = {
  a4: [595.28, 841.89],
  a3: [841.89, 1190.55],
  letter: [612, 792],
  legal: [612, 1008],
};

/** Resolve paper size + orientation to a `[width, height]` in points. */
function resolvePageSize(size: PdfPaperSize, orientation: PdfOrientation): [number, number] {
  const [a, b] = Array.isArray(size) ? size : PAPER_POINTS[size];
  const portrait: [number, number] = a <= b ? [a, b] : [b, a];
  return orientation === 'landscape' ? [portrait[1], portrait[0]] : portrait;
}

const defaultFormat = (value: unknown): string =>
  value == null ? '' : value instanceof Date ? value.toISOString() : String(value);

/* ═══════════════════════════════════════════════════════════════════════════
   Feature
   ═══════════════════════════════════════════════════════════════════════════ */

export class PdfExportFeature<Row extends Model = Model> implements GridFeature<Row> {
  readonly name = 'exportPdf';

  private api!: GridApi<Row>;
  private readonly disposers = new Disposers();
  private readonly opts: ResolvedPdfOptions<Row>;

  constructor(options: PdfExportOptions<Row> = {}) {
    const m = options.margins ?? {};
    this.opts = {
      header: options.header ?? true,
      formatValue: options.formatValue ?? defaultFormat,
      fileName: options.fileName ?? 'export',
      title: options.title ?? options.fileName ?? 'export',
      paperSize: options.paperSize ?? 'a4',
      orientation: options.orientation ?? 'landscape',
      margins: {
        top: m.top ?? 36,
        right: m.right ?? 36,
        bottom: m.bottom ?? 36,
        left: m.left ?? 36,
      },
      fontSize: options.fontSize ?? 9,
      headerFontSize: options.headerFontSize ?? 10,
      pageNumbers: options.pageNumbers ?? true,
      repeatTitle: options.repeatTitle ?? false,
      ...(options.columns ? { columns: options.columns } : {}),
      ...(options.rowsPerPage != null ? { rowsPerPage: options.rowsPerPage } : {}),
    };
  }

  init(grid: GridApi<Row>): void {
    this.api = grid;
    grid.track(() => this.disposers.dispose());
  }

  destroy(): void {
    this.disposers.dispose();
  }

  /* ── view extraction ──────────────────────────────────────────────────── */

  /** Resolve the columns to export (visible, with a field/header). */
  private exportColumns(override?: PdfColumnFilter<Row>): ColumnDef<Row>[] {
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

  /** Build a 2D matrix of formatted strings (header excluded). */
  private bodyMatrix(cols: ColumnDef<Row>[]): string[][] {
    return this.rows().map((row) =>
      cols.map((c) => this.opts.formatValue(getValue(row, c), c, row)),
    );
  }

  /**
   * Slice the body into pages. With `rowsPerPage` set, every page holds exactly
   * that many rows; otherwise `fallbackPerPage` (a height-derived estimate) is
   * used. Always returns at least one (possibly empty) page so an empty grid
   * still yields a valid single-page document.
   */
  private paginate(body: string[][], fallbackPerPage: number): string[][][] {
    const perPage = Math.max(1, this.opts.rowsPerPage ?? fallbackPerPage);
    if (body.length === 0) return [[]];
    const pages: string[][][] = [];
    for (let i = 0; i < body.length; i += perPage) {
      pages.push(body.slice(i, i + perPage));
    }
    return pages;
  }

  /* ═════════════════════════════════════════════════════════════════════════
     1. DIRECT PDF BUILDER
     ═════════════════════════════════════════════════════════════════════════ */

  /**
   * Build the export as a real PDF document and return the raw bytes.
   * Honours visible columns, the current (filtered/sorted) view and pagination.
   */
  toPdf(override?: PdfColumnFilter<Row>): Uint8Array {
    const cols = this.exportColumns(override);
    const headers = cols.map((c) => this.headerLabel(c));
    const body = this.bodyMatrix(cols);

    const [pageW, pageH] = resolvePageSize(this.opts.paperSize, this.opts.orientation);
    const { top, right, bottom, left } = this.opts.margins;
    const contentW = pageW - left - right;

    const fontSize = this.opts.fontSize;
    const headerFontSize = this.opts.headerFontSize;
    const rowH = fontSize + 6; // line height + cell padding
    const headerRowH = headerFontSize + 8;
    const titleH = this.opts.title ? this.opts.headerFontSize + 10 : 0;
    const footerH = this.opts.pageNumbers ? fontSize + 8 : 0;

    // Column widths: proportional to the configured/declared width, else equal.
    const colWeights = cols.map((c) => Math.max(1, c.width ?? c.minWidth ?? 80));
    const totalWeight = colWeights.reduce((a, b) => a + b, 0);
    const colWidths = colWeights.map((w) => (w / totalWeight) * contentW);

    // How many body rows fit one page (after title-on-page-1 + header + footer).
    const usableTop = pageH - top - footerH;
    const usableBottom = bottom;
    const usableH = usableTop - usableBottom;
    const perPageEstimate = Math.floor(
      (usableH - headerRowH - (this.opts.repeatTitle ? titleH : 0)) / rowH,
    );
    const pages = this.paginate(body, perPageEstimate);

    const writer = new PdfWriter();
    const totalPages = pages.length;

    pages.forEach((pageRows, pageIndex) => {
      const ops: string[] = [];
      let y = pageH - top;

      // Title band (page 1 always; every page when repeatTitle).
      if (this.opts.title && (pageIndex === 0 || this.opts.repeatTitle)) {
        ops.push(
          textOp(left, y - headerFontSize, this.opts.title, headerFontSize, true),
        );
        y -= titleH;
      }

      // Header row (repeated on every page when enabled).
      if (this.opts.header) {
        y -= headerRowH;
        ops.push(rectFillOp(left, y, contentW, headerRowH));
        drawRowText(ops, headers, colWidths, left, y, headerRowH, headerFontSize, true);
      }

      // Body rows.
      for (const cells of pageRows) {
        y -= rowH;
        drawRowText(ops, cells, colWidths, left, y, rowH, fontSize, false);
      }

      // Grid lines across the printed band.
      const bandTop =
        pageH -
        top -
        (this.opts.title && (pageIndex === 0 || this.opts.repeatTitle) ? titleH : 0);
      const bandBottom = y;
      drawGrid(ops, left, bandTop, bandBottom, colWidths, contentW);

      // Footer / page numbers.
      if (this.opts.pageNumbers) {
        const label = `Page ${pageIndex + 1} of ${totalPages}`;
        ops.push(textOp(left, bottom - 2, label, fontSize, false));
      }

      writer.addPage(pageW, pageH, ops.join('\n'));
    });

    return writer.build();
  }

  /** Build the export as a PDF `Blob` (browser/Node 18+). */
  toPdfBlob(override?: PdfColumnFilter<Row>): Blob {
    const bytes = this.toPdf(override);
    // Copy into a fresh ArrayBuffer so Blob never sees a SharedArrayBuffer view.
    const buf = bytes.slice();
    return new Blob([buf], { type: 'application/pdf' });
  }

  /** Trigger a `.pdf` file download (browser). */
  downloadPdf(fileName?: string): void {
    if (typeof document === 'undefined') return;
    const blob = this.toPdfBlob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${fileName ?? this.opts.fileName}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  /* ═════════════════════════════════════════════════════════════════════════
     2. PRINT-TO-PDF PIPELINE (paginated print HTML)
     ═════════════════════════════════════════════════════════════════════════ */

  /**
   * Build a paginated, print-ready HTML document. The browser's "Save as PDF"
   * renders this with full fidelity (fonts/RTL/wrapping). Honours visible
   * columns, the current view, and pagination (`rowsPerPage`): each page gets a
   * repeated `<thead>` and a hard page break.
   */
  toPdfHtml(override?: PdfColumnFilter<Row>): string {
    const cols = this.exportColumns(override);
    const headers = cols.map((c) => this.headerLabel(c));
    const body = this.bodyMatrix(cols);
    const pages = this.paginate(body, Number.POSITIVE_INFINITY);

    const [w, h] = resolvePageSize(this.opts.paperSize, this.opts.orientation);
    const { top, right, bottom, left } = this.opts.margins;

    const headHtml = this.opts.header
      ? `<thead><tr>${headers.map((t) => `<th>${escapeHtml(t)}</th>`).join('')}</tr></thead>`
      : '';

    const tables = pages
      .map((pageRows, i) => {
        const bodyHtml = `<tbody>${pageRows
          .map((cells) => `<tr>${cells.map((c) => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`)
          .join('')}</tbody>`;
        const titleHtml =
          this.opts.title && (i === 0 || this.opts.repeatTitle)
            ? `<h1 class="jects-grid-pdf__title">${escapeHtml(this.opts.title)}</h1>`
            : '';
        const footHtml = this.opts.pageNumbers
          ? `<div class="jects-grid-pdf__footer">Page ${i + 1} of ${pages.length}</div>`
          : '';
        const breakCls = i < pages.length - 1 ? ' jects-grid-pdf__page--break' : '';
        return `<section class="jects-grid-pdf__page${breakCls}">${titleHtml}<table class="jects-grid-pdf__table">${headHtml}${bodyHtml}</table>${footHtml}</section>`;
      })
      .join('');

    // `@page` drives the print sheet; class rules reference --jects-* tokens so
    // the printed document stays on-theme. Page geometry uses pt (the print unit).
    const style = `
@page { size: ${w}pt ${h}pt; margin: ${top}pt ${right}pt ${bottom}pt ${left}pt; }
.jects-grid-pdf { font-family: var(--jects-font-family, sans-serif); color: oklch(var(--jects-foreground, 0.2 0 0)); }
.jects-grid-pdf__page { box-sizing: border-box; }
.jects-grid-pdf__page--break { break-after: page; page-break-after: always; }
.jects-grid-pdf__title { font-size: ${this.opts.headerFontSize + 2}pt; margin: 0 0 ${top / 4}pt; font-weight: var(--jects-font-weight-semibold, 600); }
.jects-grid-pdf__table { border-collapse: collapse; width: 100%; font-size: ${this.opts.fontSize}pt; }
.jects-grid-pdf__table th, .jects-grid-pdf__table td { border: 1px solid oklch(var(--jects-border, 0.7 0 0)); padding: 3pt 5pt; text-align: start; vertical-align: top; }
.jects-grid-pdf__table thead th { background: oklch(var(--jects-muted, 0.96 0 0)); font-weight: var(--jects-font-weight-semibold, 600); }
.jects-grid-pdf__table thead { display: table-header-group; }
.jects-grid-pdf__footer { margin-top: ${bottom / 4}pt; font-size: ${this.opts.fontSize}pt; color: oklch(var(--jects-muted-foreground, 0.5 0 0)); text-align: end; }
`.trim();

    return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(
      this.opts.title,
    )}</title><style>${style}</style></head><body class="jects-grid-pdf">${tables}</body></html>`;
  }

  /**
   * Open the paginated PDF-ready HTML in a print window and invoke the print
   * dialog (the user picks "Save as PDF"). Returns the opened window (or `null`
   * when no DOM / blocked by a popup blocker).
   */
  printPdf(): Window | null {
    if (typeof window === 'undefined') return null;
    const win = window.open('', '_blank');
    if (!win) return null;
    win.document.write(this.toPdfHtml());
    win.document.close();
    win.focus();
    win.print();
    return win;
  }
}

/** Convenience factory. */
export function pdfExportFeature<Row extends Model = Model>(
  options?: PdfExportOptions<Row>,
): PdfExportFeature<Row> {
  return new PdfExportFeature<Row>(options);
}

/* ═══════════════════════════════════════════════════════════════════════════
   PDF content-stream helpers (operators in PDF user space, origin bottom-left)
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Escape a string for a PDF literal `( … )` token. Also maps any code point
 * outside the single-byte WinAnsi range to `?`, keeping `s.length` an exact
 * byte count (the writer's `/Length` and xref offsets depend on that).
 */
function pdfString(s: string): string {
  let out = '';
  // Iterate by UTF-16 unit (not code point) so the output length stays an exact
  // count of emitted bytes — including each half of a surrogate pair, which is
  // individually mapped to a single `?`.
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    const code = ch.charCodeAt(0);
    if (ch === '\\') out += '\\\\';
    else if (ch === '(') out += '\\(';
    else if (ch === ')') out += '\\)';
    else if (ch === '\r' || ch === '\n') out += ' ';
    else if (code <= 0xff) out += ch;
    else out += '?';
  }
  return out;
}

/** Emit a text-showing operator at (x, y) using F1 (Helvetica) or F2 (Bold). */
function textOp(x: number, y: number, text: string, size: number, bold: boolean): string {
  const font = bold ? '/F2' : '/F1';
  return `BT ${font} ${fmt(size)} Tf ${fmt(x)} ${fmt(y)} Td (${pdfString(text)}) Tj ET`;
}

/** Fill a rectangle (header band) with the muted grey. */
function rectFillOp(x: number, y: number, w: number, h: number): string {
  return `q 0.94 0.94 0.95 rg ${fmt(x)} ${fmt(y)} ${fmt(w)} ${fmt(h)} re f Q`;
}

/** Truncate a cell to roughly fit a column width (Helvetica ~0.5em/char). */
function fitText(text: string, width: number, size: number): string {
  const max = Math.max(1, Math.floor(width / (size * 0.5)));
  if (text.length <= max) return text;
  // Stay within WinAnsi (Latin-1) so the single-byte content stream is exact;
  // a trailing ".." reads as a clear truncation marker in any viewer.
  return max <= 2 ? text.slice(0, max) : `${text.slice(0, max - 2)}..`;
}

/** Draw one row of cell text across the given column widths. */
function drawRowText(
  ops: string[],
  cells: string[],
  colWidths: number[],
  left: number,
  rowBottom: number,
  rowH: number,
  size: number,
  bold: boolean,
): void {
  let x = left;
  const baseline = rowBottom + (rowH - size) / 2 + 1;
  for (let i = 0; i < colWidths.length; i++) {
    const w = colWidths[i]!;
    const text = fitText(cells[i] ?? '', w - 6, size);
    if (text) ops.push(textOp(x + 3, baseline, text, size, bold));
    x += w;
  }
}

/** Draw the table grid (outer box + column separators + the band top line). */
function drawGrid(
  ops: string[],
  left: number,
  top: number,
  bottom: number,
  colWidths: number[],
  contentW: number,
): void {
  if (top <= bottom) return;
  ops.push('q 0.7 0.7 0.72 RG 0.5 w');
  // Outer rectangle.
  ops.push(`${fmt(left)} ${fmt(bottom)} ${fmt(contentW)} ${fmt(top - bottom)} re S`);
  // Vertical column separators.
  let x = left;
  for (let i = 0; i < colWidths.length - 1; i++) {
    x += colWidths[i]!;
    ops.push(`${fmt(x)} ${fmt(top)} m ${fmt(x)} ${fmt(bottom)} l S`);
  }
  ops.push('Q');
}

/** Format a number for the PDF stream (2dp, no trailing zeros noise). */
function fmt(n: number): string {
  return (Math.round(n * 100) / 100).toString();
}

/* ═══════════════════════════════════════════════════════════════════════════
   Minimal PDF 1.4 writer (no dependencies)
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Assembles a valid single-document PDF with a shared resource dictionary
 * (Helvetica + Helvetica-Bold) and one content stream per page. Produces a
 * cross-reference table and trailer so the output opens in any PDF viewer.
 */
class PdfWriter {
  private readonly pages: Array<{ width: number; height: number; content: string }> = [];

  addPage(width: number, height: number, content: string): void {
    this.pages.push({ width, height, content });
  }

  build(): Uint8Array {
    const objects: string[] = [];
    // Object numbering:
    //   1 = Catalog, 2 = Pages, 3 = Helvetica, 4 = Helvetica-Bold,
    //   then per page: a Page object + its Contents stream object.
    const pageObjStart = 5;
    const kids: number[] = [];
    for (let i = 0; i < this.pages.length; i++) {
      kids.push(pageObjStart + i * 2);
    }

    objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
    objects[2] =
      `<< /Type /Pages /Count ${this.pages.length} /Kids [${kids
        .map((k) => `${k} 0 R`)
        .join(' ')}] >>`;
    objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
    objects[4] =
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';

    this.pages.forEach((page, i) => {
      const pageObj = pageObjStart + i * 2;
      const contentObj = pageObj + 1;
      objects[pageObj] =
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${fmt(page.width)} ${fmt(
          page.height,
        )}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentObj} 0 R >>`;
      const stream = page.content;
      objects[contentObj] = `<< /Length ${byteLength(stream)} >>\nstream\n${stream}\nendstream`;
    });

    // Serialize with a byte-accurate xref table.
    const header = '%PDF-1.4\n%âãÏÓ\n';
    let body = '';
    const offsets: number[] = [];
    let cursor = byteLength(header);
    const maxObj = objects.length - 1;
    for (let n = 1; n <= maxObj; n++) {
      const obj = objects[n]!;
      const chunk = `${n} 0 obj\n${obj}\nendobj\n`;
      offsets[n] = cursor;
      body += chunk;
      cursor += byteLength(chunk);
    }

    const xrefOffset = cursor;
    const count = maxObj + 1;
    let xref = `xref\n0 ${count}\n0000000000 65535 f \n`;
    for (let n = 1; n <= maxObj; n++) {
      xref += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`;
    }
    const trailer = `trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

    return encodeLatin1(header + body + xref + trailer);
  }
}

/** Byte length of a Latin-1 (WinAnsi) string — every char is one byte. */
function byteLength(s: string): number {
  return s.length;
}

/** Encode a string as Latin-1 bytes (PDF content streams are byte-oriented). */
function encodeLatin1(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) {
    out[i] = s.charCodeAt(i) & 0xff;
  }
  return out;
}
