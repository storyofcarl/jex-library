/**
 * `@jects/gantt` — task-grid XLSX (Excel / Office Open XML) export.
 *
 * A dependency-free `.xlsx` writer over the shared {@link ExportTable} produced
 * by {@link serializeTasks}. It mirrors the CSV writer's surface and resolver
 * wiring (same columns / order / hierarchy), but produces a real, native Excel
 * workbook instead of flat text — matching the Bryntum/DHTMLX "export to Excel"
 * behaviour:
 *
 *   - **Typed cells.** Each resolved {@link ExportCell} becomes a properly typed
 *     Excel cell: text → shared string; number → numeric; date → an Excel serial
 *     date (days since 1899-12-30) carrying a date number-format mask; duration →
 *     a numeric working-day count with a `0"d"` mask; percent → a 0..1 fraction
 *     with a `0%` mask. So sorting/filtering/aggregation work in Excel, and dates
 *     render in the user's locale rather than as raw text.
 *   - **Native row grouping.** The serializer's outline `depth` is written as the
 *     row `outlineLevel`, so Excel shows the task tree as collapsible outline
 *     groups (with summary rows above their children, `summaryBelow="0"`) — the
 *     project tree survives the round-trip, not just a textual indent.
 *   - **Column widths.** Each column's character-width hint becomes a `<col>`
 *     width so the sheet opens readable.
 *   - **Injection-safe.** Text cells that would be evaluated as a formula on open
 *     (`=`, `+`, `-`, `@`, leading control chars) are neutralized exactly like the
 *     CSV writer (apostrophe / text-prefix), reusing {@link sanitizeCsvField}.
 *
 * The module is DOM-free for its core: {@link tableToXlsx} / {@link tasksToXlsx}
 * return a `Uint8Array` (the zipped OOXML package); {@link tasksToXlsxBlob}
 * wraps it in a typed `Blob`; {@link downloadXlsx} offers a browser download.
 * The accessible "export ready" preview surface + the disposable controller live
 * lower in the file (mirroring `GanttImageExporter`).
 *
 * The side-effect CSS (the preview panel) is imported here so the panel is
 * themed wherever the writer is used.
 */

import './export-xlsx.css';

import type { Model, RecordId } from '@jects/core';
import {
  serializeTasks,
  cellToText,
  type ExportTable,
  type ExportRow,
  type ExportCell,
  type ExportColumn,
  type SerializeOptions,
  type TaskTreeSource,
} from './serialize.js';
import { sanitizeCsvField } from './export-csv.js';
import { zipSync, utf8, type ZipEntry } from './zip.js';

/* ═══════════════════════════════════════════════════════════════════════════
   0. CONSTANTS
   ═══════════════════════════════════════════════════════════════════════════ */

/** The Office Open XML MIME type for a `.xlsx` workbook. */
export const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Excel's epoch is 1899-12-30 (the famous 1900 leap-year bug offset). A date is
 * stored as the integer day count since that epoch. We compute on UTC ms so the
 * exported serial is timezone-independent and matches {@link isoDate}.
 */
const EXCEL_EPOCH_UTC_MS = Date.UTC(1899, 11, 30);
const MS_PER_DAY = 86_400_000;

/* ═══════════════════════════════════════════════════════════════════════════
   1. OPTIONS
   ═══════════════════════════════════════════════════════════════════════════ */

/** Options for {@link tableToXlsx} / {@link tasksToXlsx}. */
export interface XlsxExportOptions<T extends Model = Model>
  extends SerializeOptions<T> {
  /** Worksheet (tab) name. Default `"Tasks"`. Sanitized to Excel's rules. */
  sheetName?: string;
  /**
   * Indent the Name cell text with this string per outline depth so the textual
   * outline is preserved alongside the native row grouping. Default two spaces;
   * pass `''` to disable (grouping alone then carries the hierarchy).
   */
  indent?: string;
  /**
   * Whether to write native Excel row grouping (`outlineLevel`) from the row
   * depth. Default `true`. When `false`, depth survives only as the Name indent.
   */
  outline?: boolean;
  /**
   * Freeze the header row so it stays visible while scrolling. Default `true`.
   */
  freezeHeader?: boolean;
  /** Date number-format mask. Default `"yyyy-mm-dd"`. */
  dateFormat?: string;
}

const DEFAULT_SHEET_NAME = 'Tasks';
const DEFAULT_INDENT = '  ';
const DEFAULT_DATE_FORMAT = 'yyyy-mm-dd';

/* ═══════════════════════════════════════════════════════════════════════════
   2. NUMBER-FORMAT / STYLE TABLE
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * The cellXfs style indices we register, by purpose. Index 0 is Excel's
 * implicit default ("General") that every styles part must keep at slot 0.
 *   0 = default / text       (no special format)
 *   1 = date                 (dateFormat mask)
 *   2 = duration             (`0"d"`)
 *   3 = percent              (`0%`)
 *   4 = number               (`General`, but a distinct xf for clarity)
 */
const STYLE = {
  DEFAULT: 0,
  DATE: 1,
  DURATION: 2,
  PERCENT: 3,
  NUMBER: 4,
} as const;

// Custom number formats start at id 164 (ids < 164 are Excel built-ins).
const FMT_DATE_ID = 164;
const FMT_DURATION_ID = 165;
const FMT_PERCENT_ID = 9; // built-in "0%"

/* ═══════════════════════════════════════════════════════════════════════════
   3. XML ESCAPING + CELL ADDRESSING
   ═══════════════════════════════════════════════════════════════════════════ */

/** Escape a string for XML text/attribute content. */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Convert a 0-based column index to an Excel column ref (0→A, 26→AA). */
export function columnLetter(index: number): string {
  let n = index;
  let s = '';
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

/** Build an A1 cell reference (0-based col + 1-based row). */
export function cellRef(col: number, row: number): string {
  return `${columnLetter(col)}${row}`;
}

/**
 * Sanitize a worksheet name to Excel's rules: max 31 chars, none of `\ / ? * [ ]
 * :`, not empty. Falls back to the default name.
 */
export function sanitizeSheetName(name: string): string {
  const cleaned = name.replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 31);
  return cleaned.length > 0 ? cleaned : DEFAULT_SHEET_NAME;
}

/* ═══════════════════════════════════════════════════════════════════════════
   4. CELL VALUE MAPPING (typed)
   ═══════════════════════════════════════════════════════════════════════════ */

/** Convert an epoch-ms timestamp to an Excel serial day number (UTC-based). */
export function toExcelSerial(ms: number): number {
  return (ms - EXCEL_EPOCH_UTC_MS) / MS_PER_DAY;
}

/** A writer-internal, fully-typed XLSX cell ready to serialize. */
interface XlsxCell {
  /** `"n"` numeric, `"s"` shared string, or undefined for empty. */
  t: 'n' | 's' | undefined;
  /** The cell value: a number, or a shared-string index. */
  v: number | undefined;
  /** The style (cellXfs) index. */
  s: number;
}

const EMPTY_CELL: XlsxCell = { t: undefined, v: undefined, s: STYLE.DEFAULT };

/**
 * Map a resolved {@link ExportCell} to a typed XLSX cell, registering any text
 * into the shared-string table. `indent` is prepended to text cells (Name
 * column) and the value is run through {@link sanitizeCsvField} so a leading
 * formula trigger cannot execute on open.
 */
function toXlsxCell(
  cell: ExportCell,
  indent: string,
  strings: StringTable,
): XlsxCell {
  switch (cell.kind) {
    case 'empty':
      return indent
        ? { t: 's', v: strings.intern(indent), s: STYLE.DEFAULT }
        : EMPTY_CELL;
    case 'text': {
      const text = sanitizeCsvField(indent + cell.value);
      return { t: 's', v: strings.intern(text), s: STYLE.DEFAULT };
    }
    case 'number':
      return Number.isFinite(cell.value)
        ? { t: 'n', v: cell.value, s: STYLE.NUMBER }
        : EMPTY_CELL;
    case 'date':
      return { t: 'n', v: toExcelSerial(cell.value), s: STYLE.DATE };
    case 'duration':
      return { t: 'n', v: cell.days, s: STYLE.DURATION };
    case 'percent':
      return { t: 'n', v: cell.fraction, s: STYLE.PERCENT };
    default: {
      const _never: never = cell;
      return _never;
    }
  }
}

/* ── shared strings table ───────────────────────────────────────────────── */

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

/* ═══════════════════════════════════════════════════════════════════════════
   5. OOXML PART BUILDERS
   ═══════════════════════════════════════════════════════════════════════════ */

const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const NS_MAIN =
  'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS_REL_DOC =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

function contentTypesXml(): string {
  return (
    `${XML_DECL}` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
    `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
    `<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>` +
    `</Types>`
  );
}

function rootRelsXml(): string {
  return (
    `${XML_DECL}` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
    `</Relationships>`
  );
}

function workbookXml(sheetName: string): string {
  return (
    `${XML_DECL}` +
    `<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_REL_DOC}">` +
    `<sheets>` +
    `<sheet name="${escapeXml(sheetName)}" sheetId="1" r:id="rId1"/>` +
    `</sheets>` +
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

function stylesXml(dateFormat: string): string {
  return (
    `${XML_DECL}` +
    `<styleSheet xmlns="${NS_MAIN}">` +
    `<numFmts count="2">` +
    `<numFmt numFmtId="${FMT_DATE_ID}" formatCode="${escapeXml(dateFormat)}"/>` +
    `<numFmt numFmtId="${FMT_DURATION_ID}" formatCode="0&quot;d&quot;"/>` +
    `</numFmts>` +
    `<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>` +
    `<fills count="1"><fill><patternFill patternType="none"/></fill></fills>` +
    `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
    `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
    // cellXfs — slot order must match the STYLE map.
    `<cellXfs count="5">` +
    `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` + // DEFAULT
    `<xf numFmtId="${FMT_DATE_ID}" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` + // DATE
    `<xf numFmtId="${FMT_DURATION_ID}" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` + // DURATION
    `<xf numFmtId="${FMT_PERCENT_ID}" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` + // PERCENT
    `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` + // NUMBER
    `</cellXfs>` +
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
    `<sst xmlns="${NS_MAIN}" count="${strings.count}" uniqueCount="${strings.count}">` +
    `${items}</sst>`
  );
}

/** Build the `<cols>` element from the columns' width hints. */
function colsXml(columns: ExportColumn[]): string {
  const cols = columns
    .map((c, i) => {
      // Excel width is ~ character count + a small padding; default 12.
      const width = (c.width ?? 12) + 2;
      const n = i + 1;
      return `<col min="${n}" max="${n}" width="${width}" customWidth="1"/>`;
    })
    .join('');
  return cols ? `<cols>${cols}</cols>` : '';
}

/** Serialize one XLSX cell to its `<c>` element (or '' when truly empty). */
function cellXml(ref: string, cell: XlsxCell): string {
  if (cell.v === undefined) {
    // Carry style only if non-default (e.g. an indented-empty handled elsewhere).
    return cell.s === STYLE.DEFAULT ? '' : `<c r="${ref}" s="${cell.s}"/>`;
  }
  const styleAttr = cell.s !== STYLE.DEFAULT ? ` s="${cell.s}"` : '';
  if (cell.t === 's') {
    return `<c r="${ref}"${styleAttr} t="s"><v>${cell.v}</v></c>`;
  }
  // Numeric (default type when omitted in OOXML is 'n').
  return `<c r="${ref}"${styleAttr}><v>${numToXml(cell.v)}</v></c>`;
}

/** Render a number for XML (finite, no exponent surprises for whole serials). */
function numToXml(n: number): string {
  if (!Number.isFinite(n)) return '0';
  return String(n);
}

/**
 * Build `xl/worksheets/sheet1.xml` — the header row + every data row, with
 * native outline levels, a frozen header pane, and the column widths.
 */
function worksheetXml(
  table: ExportTable,
  cellMatrix: XlsxCell[][],
  headerCells: XlsxCell[],
  options: Required<
    Pick<XlsxExportOptions, 'outline' | 'freezeHeader'>
  >,
  rows: ExportRow[],
): string {
  const colCount = table.columns.length;
  const lastCol = columnLetter(Math.max(0, colCount - 1));
  const lastRow = rows.length + 1; // +1 for the header row
  const dimension = `A1:${lastCol}${lastRow}`;

  // Header row (row 1).
  const headerXml =
    `<row r="1">` +
    headerCells
      .map((c, i) => cellXml(cellRef(i, 1), c))
      .join('') +
    `</row>`;

  // Data rows (rows 2..n).
  let maxOutline = 0;
  const bodyXml = cellMatrix
    .map((cells, ri) => {
      const rowNum = ri + 2;
      const depth = rows[ri]!.depth;
      const level = options.outline && depth > 0 ? depth : 0;
      if (level > maxOutline) maxOutline = level;
      const outlineAttr = level > 0 ? ` outlineLevel="${level}"` : '';
      const cellsXml = cells
        .map((c, ci) => cellXml(cellRef(ci, rowNum), c))
        .join('');
      return `<row r="${rowNum}"${outlineAttr}>${cellsXml}</row>`;
    })
    .join('');

  const sheetPr =
    options.outline && maxOutline > 0
      ? `<sheetPr><outlinePr summaryBelow="0" summaryRight="0"/></sheetPr>`
      : '';

  // Freeze the header row (split below row 1) when requested.
  const sheetViews = options.freezeHeader
    ? `<sheetViews><sheetView workbookViewId="0">` +
      `<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>` +
      `<selection pane="bottomLeft" activeCell="A2" sqref="A2"/>` +
      `</sheetView></sheetViews>`
    : '';

  // sheetFormatPr carries the outlineLevelRow hint for the grouping UI.
  const formatPr =
    maxOutline > 0
      ? `<sheetFormatPr defaultRowHeight="15" outlineLevelRow="${maxOutline}"/>`
      : `<sheetFormatPr defaultRowHeight="15"/>`;

  return (
    `${XML_DECL}` +
    `<worksheet xmlns="${NS_MAIN}" xmlns:r="${NS_REL_DOC}">` +
    sheetPr +
    `<dimension ref="${dimension}"/>` +
    sheetViews +
    formatPr +
    colsXml(table.columns) +
    `<sheetData>${headerXml}${bodyXml}</sheetData>` +
    `</worksheet>`
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   6. WRITERS
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Serialize an already-resolved {@link ExportTable} to `.xlsx` bytes. Most
 * callers use {@link tasksToXlsx}; this is exposed for callers holding their own
 * table (and for unit tests).
 */
export function tableToXlsx(
  table: ExportTable,
  options: XlsxExportOptions = {},
): Uint8Array {
  const sheetName = sanitizeSheetName(options.sheetName ?? DEFAULT_SHEET_NAME);
  const indentUnit = options.indent ?? DEFAULT_INDENT;
  const outline = options.outline !== false;
  const freezeHeader = options.freezeHeader !== false;
  const dateFormat = options.dateFormat ?? DEFAULT_DATE_FORMAT;

  const strings = new StringTable();
  const nameCol = table.columns.findIndex((c) => c.field === 'name');

  // Header cells are shared strings (style default).
  const headerCells: XlsxCell[] = table.columns.map((c) => ({
    t: 's',
    v: strings.intern(c.header ?? c.field),
    s: STYLE.DEFAULT,
  }));

  // Body matrix.
  const cellMatrix: XlsxCell[][] = table.rows.map((row) =>
    row.cells.map((cell, ci) => {
      const indent =
        ci === nameCol && indentUnit && row.depth > 0
          ? indentUnit.repeat(row.depth)
          : '';
      return toXlsxCell(cell, indent, strings);
    }),
  );

  const parts: ZipEntry[] = [
    { path: '[Content_Types].xml', bytes: utf8(contentTypesXml()) },
    { path: '_rels/.rels', bytes: utf8(rootRelsXml()) },
    { path: 'xl/workbook.xml', bytes: utf8(workbookXml(sheetName)) },
    { path: 'xl/_rels/workbook.xml.rels', bytes: utf8(workbookRelsXml()) },
    { path: 'xl/styles.xml', bytes: utf8(stylesXml(dateFormat)) },
    {
      path: 'xl/worksheets/sheet1.xml',
      bytes: utf8(
        worksheetXml(
          table,
          cellMatrix,
          headerCells,
          { outline, freezeHeader },
          table.rows,
        ),
      ),
    },
    { path: 'xl/sharedStrings.xml', bytes: utf8(sharedStringsXml(strings)) },
  ];

  return zipSync(parts);
}

/**
 * Serialize a task tree directly to `.xlsx` bytes. Walks the tree via
 * {@link serializeTasks} (preserving hierarchy/WBS/types), then writes the
 * workbook. The resolver wiring (`predecessorsOf` / `resourcesOf` / `hoursPerDay`)
 * exactly mirrors the CSV writer.
 */
export function tasksToXlsx<T extends Model = Model>(
  source: TaskTreeSource<T>,
  options: XlsxExportOptions<T> = {},
): Uint8Array {
  const table = serializeTasks(source, options);
  return tableToXlsx(table, options);
}

/** Wrap {@link tableToXlsx} output in a typed `.xlsx` Blob. */
export function tableToXlsxBlob(
  table: ExportTable,
  options: XlsxExportOptions = {},
): Blob {
  return bytesToXlsxBlob(tableToXlsx(table, options));
}

/** Serialize a task tree to a typed `.xlsx` Blob. */
export function tasksToXlsxBlob<T extends Model = Model>(
  source: TaskTreeSource<T>,
  options: XlsxExportOptions<T> = {},
): Blob {
  return bytesToXlsxBlob(tasksToXlsx(source, options));
}

/** Wrap raw `.xlsx` bytes in a typed Blob (a fresh copy so the buffer is owned). */
export function bytesToXlsxBlob(bytes: Uint8Array): Blob {
  // Copy into a standalone ArrayBuffer so the Blob owns contiguous bytes.
  const copy = bytes.slice();
  return new Blob([copy], { type: XLSX_MIME });
}

/* ═══════════════════════════════════════════════════════════════════════════
   7. DOWNLOAD PATH
   ═══════════════════════════════════════════════════════════════════════════ */

/** Ensure a filename ends in `.xlsx`. */
function withXlsxExt(name: string): string {
  return /\.xlsx$/i.test(name) ? name : `${name.replace(/\.$/, '')}.xlsx`;
}

/**
 * Trigger a browser download of `.xlsx` `bytes` (or a `Blob`) as `filename`.
 * No-op in hosts without the object-URL API (jsdom), so callers can still
 * produce + return the payload without a DOM side effect. Returns whether a
 * download was actually offered.
 */
export function downloadXlsx(
  data: Uint8Array | Blob,
  filename: string,
): boolean {
  const blob = data instanceof Blob ? data : bytesToXlsxBlob(data);
  if (
    typeof URL === 'undefined' ||
    typeof URL.createObjectURL !== 'function' ||
    typeof document === 'undefined'
  ) {
    return false;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = withXlsxExt(filename);
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return true;
}

/* ═══════════════════════════════════════════════════════════════════════════
   8. ACCESSIBLE "EXPORT READY" PREVIEW PANEL
   ═══════════════════════════════════════════════════════════════════════════ */

/** Options for {@link buildXlsxPreview}. */
export interface XlsxPreviewOptions {
  /** The filename shown / used by the download button. Default `"tasks.xlsx"`. */
  filename?: string;
  /** Accessible title for the panel. Default `"Excel export preview"`. */
  title?: string;
  /** Max number of body rows to render in the preview table. Default `50`. */
  maxRows?: number;
}

/**
 * Build a small, accessible HTML preview of the export: a labelled panel with a
 * caption, an ARIA `table` showing the typed cells (using the shared
 * {@link cellToText} display formatting), and a download `<button>` wired to
 * {@link downloadXlsx}. This is the visual/interaction surface the a11y + visual
 * browser test exercises (the workbook bytes themselves carry no DOM).
 *
 * The returned object exposes the root `el` and a `destroy()` that removes the
 * click listener — the caller owns mounting/unmounting.
 */
export function buildXlsxPreview(
  table: ExportTable,
  options: XlsxPreviewOptions = {},
): { el: HTMLElement; destroy(): void } {
  const filename = withXlsxExt(options.filename ?? 'tasks.xlsx');
  const title = options.title ?? 'Excel export preview';
  const maxRows = options.maxRows ?? 50;

  const root = document.createElement('section');
  root.className = 'jects-gantt-xlsx-preview';
  root.setAttribute('aria-label', title);

  const heading = document.createElement('h2');
  heading.className = 'jects-gantt-xlsx-preview__title';
  heading.textContent = title;
  root.appendChild(heading);

  const tableEl = document.createElement('table');
  tableEl.className = 'jects-gantt-xlsx-preview__table';

  const caption = document.createElement('caption');
  caption.className = 'jects-gantt-xlsx-preview__caption';
  caption.textContent = `${table.rows.length} task row${
    table.rows.length === 1 ? '' : 's'
  } across ${table.columns.length} column${
    table.columns.length === 1 ? '' : 's'
  }, ready to download as ${filename}.`;
  tableEl.appendChild(caption);

  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  for (const col of table.columns) {
    const th = document.createElement('th');
    th.scope = 'col';
    th.textContent = col.header ?? col.field;
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  tableEl.appendChild(thead);

  const nameCol = table.columns.findIndex((c) => c.field === 'name');
  const tbody = document.createElement('tbody');
  const shown = table.rows.slice(0, maxRows);
  for (const row of shown) {
    const tr = document.createElement('tr');
    if (row.summary) tr.classList.add('jects-gantt-xlsx-preview__row--summary');
    row.cells.forEach((cell, ci) => {
      const td = document.createElement('td');
      const indent =
        ci === nameCol && row.depth > 0 ? '  '.repeat(row.depth) : '';
      td.textContent = cellToText(cell, indent ? { indent } : undefined);
      // Right-align numeric-ish columns for a spreadsheet-like read.
      if (
        cell.kind === 'number' ||
        cell.kind === 'date' ||
        cell.kind === 'duration' ||
        cell.kind === 'percent'
      ) {
        td.classList.add('jects-gantt-xlsx-preview__cell--num');
      }
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  }
  tableEl.appendChild(tbody);
  root.appendChild(tableEl);

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'jects-gantt-xlsx-preview__download';
  button.textContent = `Download ${filename}`;
  const onClick = (): void => {
    downloadXlsx(tableToXlsxBlob(table, options as XlsxExportOptions), filename);
  };
  button.addEventListener('click', onClick);
  root.appendChild(button);

  return {
    el: root,
    destroy(): void {
      button.removeEventListener('click', onClick);
      root.remove();
    },
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   9. DISPOSABLE CONTROLLER (feature/mixin shape — like GanttImageExporter)
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * The resolver bundle the Gantt widget supplies when wiring XLSX export — the
 * same shape the CSV path uses, so a single wiring serves both writers.
 */
export interface XlsxExporterResolvers {
  /** Render a task's predecessors (same notation as the task tree / CSV). */
  predecessorsOf?(taskId: RecordId): string;
  /** Render a task's assigned resources as a label. */
  resourcesOf?(taskId: RecordId): string;
  /** Working hours/day used for effort→person-day conversion. Default 8. */
  hoursPerDay?: number;
}

/** Construction config for {@link GanttXlsxExporter}. */
export interface GanttXlsxExporterConfig<T extends Model = Model>
  extends XlsxExporterResolvers {
  /** The live task tree source (a `TreeStore` or compatible shape). */
  source: TaskTreeSource<T>;
}

/** Options for {@link GanttXlsxExporter.export}. */
export interface GanttXlsxExportOptions<T extends Model = Model>
  extends XlsxExportOptions<T> {
  /** When set, the produced workbook is offered as a browser download. */
  download?: string;
}

/**
 * Wraps the XLSX-export functions as a small disposable controller, mirroring
 * `GanttImageExporter`. Construct it with the live task tree source + the same
 * resolver callbacks the CSV path uses, then call `export()` to get the `.xlsx`
 * bytes (optionally auto-downloading), `exportBlob()` for a typed Blob,
 * `exportTable()` for the resolved table, or `buildPreview()` for the accessible
 * panel.
 *
 * It is intentionally decoupled from the `Gantt` widget — it takes a tree source
 * + resolvers so it can be installed as a feature/mixin without touching the
 * widget class.
 */
export class GanttXlsxExporter<T extends Model = Model> {
  private readonly source: TaskTreeSource<T>;
  private readonly resolvers: XlsxExporterResolvers;
  private destroyed = false;

  constructor(config: GanttXlsxExporterConfig<T>) {
    this.source = config.source;
    this.resolvers = {
      ...(config.predecessorsOf ? { predecessorsOf: config.predecessorsOf } : {}),
      ...(config.resourcesOf ? { resourcesOf: config.resourcesOf } : {}),
      ...(config.hoursPerDay !== undefined
        ? { hoursPerDay: config.hoursPerDay }
        : {}),
    };
  }

  /** Resolve the live tree into a writer-neutral {@link ExportTable}. */
  exportTable(options: GanttXlsxExportOptions<T> = {}): ExportTable {
    return serializeTasks(this.source, this.mergeOptions(options));
  }

  /**
   * Serialize the live Gantt to `.xlsx` bytes. When `opts.download` is set (and
   * the host supports it), also offers the workbook as a file.
   */
  export(options: GanttXlsxExportOptions<T> = {}): Uint8Array {
    const bytes = tasksToXlsx(this.source, this.mergeOptions(options));
    if (options.download) downloadXlsx(bytes, options.download);
    return bytes;
  }

  /** Serialize the live Gantt to a typed `.xlsx` Blob. */
  exportBlob(options: GanttXlsxExportOptions<T> = {}): Blob {
    return bytesToXlsxBlob(this.export(options));
  }

  /** Build the accessible "export ready" preview panel for the live data. */
  buildPreview(
    options: GanttXlsxExportOptions<T> & XlsxPreviewOptions = {},
  ): { el: HTMLElement; destroy(): void } {
    return buildXlsxPreview(this.exportTable(options), options);
  }

  /** Idempotent teardown. The controller owns no resources; this marks it inert. */
  destroy(): void {
    this.destroyed = true;
  }

  /** Whether `destroy()` has been called. */
  get isDestroyed(): boolean {
    return this.destroyed;
  }

  private mergeOptions(
    options: GanttXlsxExportOptions<T>,
  ): XlsxExportOptions<T> {
    if (this.destroyed) return options;
    const merged: XlsxExportOptions<T> = { ...this.resolvers, ...options };
    return merged;
  }
}

/** Convenience factory mirroring `createProgressLine` et al. */
export function createGanttXlsxExporter<T extends Model = Model>(
  config: GanttXlsxExporterConfig<T>,
): GanttXlsxExporter<T> {
  return new GanttXlsxExporter<T>(config);
}
