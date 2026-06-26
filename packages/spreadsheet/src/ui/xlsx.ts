/**
 * Real `.xlsx` (Office Open XML / OOXML) read + write for the spreadsheet.
 *
 * Unlike the legacy SpreadsheetML-2003 single-XML flavor (still available as
 * `workbookToXlsxXml`), this produces and consumes a genuine zipped OOXML
 * package — the format Excel / Google Sheets / LibreOffice actually emit:
 *
 *   [Content_Types].xml
 *   _rels/.rels
 *   xl/workbook.xml              ← sheet list + defined names (named ranges)
 *   xl/_rels/workbook.xml.rels
 *   xl/styles.xml                ← number-format masks (cellXfs)
 *   xl/sharedStrings.xml         ← interned text
 *   xl/worksheets/sheet{N}.xml   ← typed cells, formulas, merges, frozen panes
 *
 * Captured on round-trip: cell values (number/string/boolean), formulas, number
 * formats (per-cell `numFmt`), merged regions (`<mergeCells>`), and frozen panes
 * (`<pane>`), across every sheet. The bytes are returned as a `Uint8Array`;
 * {@link xlsxToWorkbook} parses the same shape back into a `WorkbookModel`.
 *
 * Dependency-free: the zip container is built/parsed by the local {@link zip}
 * module; all XML is hand-emitted / regex-scanned (no DOMParser).
 */

import type {
  CellModel,
  CellValue,
  FrozenPanes,
  MergeRegion,
  SheetModel,
  WorkbookModel,
} from '../contract.js';
import { isCellError } from './format.js';
import { columnIndexToLabel, columnLabelToIndex } from './a1.js';
import { unzipSync, utf8, zipSync, fromUtf8, type ZipEntry } from './zip.js';

/** The Office Open XML MIME type for a `.xlsx` workbook. */
export const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const cellKey = (row: number, col: number): string => `${row},${col}`;
function parseKey(key: string): [number, number] {
  const i = key.indexOf(',');
  return [Number(key.slice(0, i)), Number(key.slice(i + 1))];
}

/* ── XML escaping + addressing ──────────────────────────────────────────── */

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
function unescapeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, '&');
}

/** A1 cell ref from 0-based row/col (e.g. 0,0 → "A1"). */
function a1(row: number, col: number): string {
  return `${columnIndexToLabel(col)}${row + 1}`;
}
/** Parse an A1 ref into 0-based [row,col]. */
function fromA1(ref: string): [number, number] {
  const m = /^([A-Za-z]+)(\d+)$/.exec(ref.trim());
  if (!m) return [0, 0];
  return [parseInt(m[2] as string, 10) - 1, columnLabelToIndex(m[1] as string)];
}

const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS_REL_DOC = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

/* ── shared-string + number-format tables ───────────────────────────────── */

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
 * Interns number-format patterns into cellXfs style indices. Slot 0 is the
 * implicit "General" default every styles part keeps. Custom masks start at
 * numFmtId 164 (ids < 164 are Excel built-ins).
 */
class StyleTable {
  /** pattern → cellXfs index. */
  private readonly xfByPattern = new Map<string, number>();
  /** Ordered (numFmtId, pattern) pairs for the registered custom formats. */
  readonly numFmts: Array<{ id: number; pattern: string }> = [];
  /** cellXfs entries as numFmtId, in slot order (slot 0 = General). */
  readonly xfNumFmtIds: number[] = [0];
  private nextNumFmtId = 164;

  /** Return the cellXfs index for a number-format pattern (0 when none). */
  intern(pattern: string | undefined): number {
    if (!pattern) return 0;
    const existing = this.xfByPattern.get(pattern);
    if (existing !== undefined) return existing;
    const numFmtId = this.nextNumFmtId++;
    this.numFmts.push({ id: numFmtId, pattern });
    const xf = this.xfNumFmtIds.length;
    this.xfNumFmtIds.push(numFmtId);
    this.xfByPattern.set(pattern, xf);
    return xf;
  }
}

/* ── writer ─────────────────────────────────────────────────────────────── */

/** Serialize a `WorkbookModel` to real `.xlsx` (OOXML) bytes. */
export function workbookToXlsx(workbook: WorkbookModel): Uint8Array {
  const strings = new StringTable();
  const styles = new StyleTable();

  const sheetXmls = workbook.sheets.map((sheet) => worksheetXml(sheet, strings, styles));

  const parts: ZipEntry[] = [
    { path: '[Content_Types].xml', bytes: utf8(contentTypesXml(workbook.sheets.length)) },
    { path: '_rels/.rels', bytes: utf8(rootRelsXml()) },
    { path: 'xl/workbook.xml', bytes: utf8(workbookXml(workbook)) },
    { path: 'xl/_rels/workbook.xml.rels', bytes: utf8(workbookRelsXml(workbook.sheets.length)) },
    { path: 'xl/styles.xml', bytes: utf8(stylesXml(styles)) },
    { path: 'xl/sharedStrings.xml', bytes: utf8(sharedStringsXml(strings)) },
    ...sheetXmls.map((xml, i) => ({
      path: `xl/worksheets/sheet${i + 1}.xml`,
      bytes: utf8(xml),
    })),
  ];
  return zipSync(parts);
}

function contentTypesXml(sheetCount: number): string {
  const sheetOverrides = Array.from(
    { length: sheetCount },
    (_v, i) =>
      `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
  ).join('');
  return (
    `${XML_DECL}` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
    `<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>` +
    sheetOverrides +
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

function workbookXml(workbook: WorkbookModel): string {
  const sheets = workbook.sheets
    .map((s, i) => `<sheet name="${escapeXml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
    .join('');
  // Defined names (named ranges) survive the round-trip.
  const names = workbook.namedRanges
    ? Object.entries(workbook.namedRanges)
        .map(
          ([name, ref]) =>
            `<definedName name="${escapeXml(name)}">${escapeXml(ref)}</definedName>`,
        )
        .join('')
    : '';
  const definedNames = names ? `<definedNames>${names}</definedNames>` : '';
  return (
    `${XML_DECL}` +
    `<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_REL_DOC}">` +
    `<sheets>${sheets}</sheets>` +
    definedNames +
    `</workbook>`
  );
}

function workbookRelsXml(sheetCount: number): string {
  const styleId = sheetCount + 1;
  const sstId = sheetCount + 2;
  const sheetRels = Array.from(
    { length: sheetCount },
    (_v, i) =>
      `<Relationship Id="rId${i + 1}" Type="${NS_REL_DOC}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
  ).join('');
  return (
    `${XML_DECL}` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    sheetRels +
    `<Relationship Id="rId${styleId}" Type="${NS_REL_DOC}/styles" Target="styles.xml"/>` +
    `<Relationship Id="rId${sstId}" Type="${NS_REL_DOC}/sharedStrings" Target="sharedStrings.xml"/>` +
    `</Relationships>`
  );
}

function stylesXml(styles: StyleTable): string {
  const numFmts = styles.numFmts.length
    ? `<numFmts count="${styles.numFmts.length}">` +
      styles.numFmts
        .map((f) => `<numFmt numFmtId="${f.id}" formatCode="${escapeXml(f.pattern)}"/>`)
        .join('') +
      `</numFmts>`
    : '';
  const cellXfs =
    `<cellXfs count="${styles.xfNumFmtIds.length}">` +
    styles.xfNumFmtIds
      .map((id) =>
        id === 0
          ? `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>`
          : `<xf numFmtId="${id}" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>`,
      )
      .join('') +
    `</cellXfs>`;
  return (
    `${XML_DECL}` +
    `<styleSheet xmlns="${NS_MAIN}">` +
    numFmts +
    `<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>` +
    `<fills count="1"><fill><patternFill patternType="none"/></fill></fills>` +
    `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
    `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
    cellXfs +
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

function worksheetXml(sheet: SheetModel, strings: StringTable, styles: StyleTable): string {
  // Group populated cells into rows.
  const rowMap = new Map<number, Array<{ col: number; cell: CellModel }>>();
  let maxRow = 0;
  let maxCol = 0;
  for (const [key, cell] of Object.entries(sheet.cells)) {
    const [r, c] = parseKey(key);
    if (cell.spillParent) continue; // spilled members are recomputed on open
    maxRow = Math.max(maxRow, r);
    maxCol = Math.max(maxCol, c);
    let list = rowMap.get(r);
    if (!list) {
      list = [];
      rowMap.set(r, list);
    }
    list.push({ col: c, cell });
  }

  const rowsXml = [...rowMap.keys()]
    .sort((a, b) => a - b)
    .map((r) => {
      const cells = rowMap.get(r)!.sort((a, b) => a.col - b.col);
      const cellsXml = cells.map(({ col, cell }) => cellXml(r, col, cell, strings, styles)).join('');
      return `<row r="${r + 1}">${cellsXml}</row>`;
    })
    .join('');

  const dimension = `A1:${a1(Math.max(0, maxRow), Math.max(0, maxCol))}`;

  // Frozen panes.
  const frozen = sheet.frozen;
  const sheetViews = frozenPaneXml(frozen);

  // Merges.
  const merges = sheet.merges ?? [];
  const mergeXml = merges.length
    ? `<mergeCells count="${merges.length}">` +
      merges
        .map(
          (m) =>
            `<mergeCell ref="${a1(m.row, m.col)}:${a1(m.row + m.rowSpan - 1, m.col + m.colSpan - 1)}"/>`,
        )
        .join('') +
      `</mergeCells>`
    : '';

  return (
    `${XML_DECL}` +
    `<worksheet xmlns="${NS_MAIN}" xmlns:r="${NS_REL_DOC}">` +
    `<dimension ref="${dimension}"/>` +
    sheetViews +
    `<sheetData>${rowsXml}</sheetData>` +
    mergeXml +
    `</worksheet>`
  );
}

function frozenPaneXml(frozen: FrozenPanes | undefined): string {
  if (!frozen || (frozen.rows === 0 && frozen.cols === 0)) return '';
  const topLeft = a1(frozen.rows, frozen.cols);
  const activePane =
    frozen.cols > 0 && frozen.rows > 0
      ? 'bottomRight'
      : frozen.cols > 0
        ? 'topRight'
        : 'bottomLeft';
  const splitAttrs =
    (frozen.cols > 0 ? ` xSplit="${frozen.cols}"` : '') +
    (frozen.rows > 0 ? ` ySplit="${frozen.rows}"` : '');
  return (
    `<sheetViews><sheetView workbookViewId="0">` +
    `<pane${splitAttrs} topLeftCell="${topLeft}" activePane="${activePane}" state="frozen"/>` +
    `</sheetView></sheetViews>`
  );
}

function cellXml(
  row: number,
  col: number,
  cell: CellModel,
  strings: StringTable,
  styles: StyleTable,
): string {
  const ref = a1(row, col);
  const styleIdx = styles.intern(cell.format?.numberFormat);
  const styleAttr = styleIdx !== 0 ? ` s="${styleIdx}"` : '';
  const v = cell.value ?? null;

  // Formula cell: write <f> plus the cached <v> (so it shows before recalc).
  if (cell.formula) {
    const cached = numericString(v);
    const cachedXml =
      cached !== undefined
        ? `<v>${cached}</v>`
        : v !== null && !isCellError(v)
          ? `<v>${escapeXml(String(v))}</v>`
          : '';
    const tAttr = cached === undefined && typeof v === 'string' ? ' t="str"' : '';
    return `<c r="${ref}"${styleAttr}${tAttr}><f>${escapeXml(cell.formula)}</f>${cachedXml}</c>`;
  }

  if (v === null) return styleAttr ? `<c r="${ref}"${styleAttr}/>` : '';
  if (isCellError(v)) {
    return `<c r="${ref}"${styleAttr} t="e"><v>${escapeXml(v.code)}</v></c>`;
  }
  if (typeof v === 'boolean') {
    return `<c r="${ref}"${styleAttr} t="b"><v>${v ? 1 : 0}</v></c>`;
  }
  if (typeof v === 'number') {
    return `<c r="${ref}"${styleAttr}><v>${numToXml(v)}</v></c>`;
  }
  // String → shared string.
  const idx = strings.intern(String(v));
  return `<c r="${ref}"${styleAttr} t="s"><v>${idx}</v></c>`;
}

function numericString(v: CellValue): string | undefined {
  return typeof v === 'number' ? numToXml(v) : typeof v === 'boolean' ? (v ? '1' : '0') : undefined;
}
function numToXml(n: number): string {
  return Number.isFinite(n) ? String(n) : '0';
}

/* ── reader ─────────────────────────────────────────────────────────────── */

/** Parse real `.xlsx` (OOXML) bytes into a `WorkbookModel`. */
export function xlsxToWorkbook(bytes: Uint8Array): WorkbookModel {
  const files = unzipSync(bytes);

  const workbookXmlText = textOf(files, 'xl/workbook.xml');
  if (!workbookXmlText) throw new Error('Invalid .xlsx: missing xl/workbook.xml');

  // Sheet name + relationship id, in order.
  const sheetDefs: Array<{ name: string; rid: string }> = [];
  const sheetRe = /<sheet\b[^>]*\/?>/g;
  let sm: RegExpExecArray | null;
  while ((sm = sheetRe.exec(workbookXmlText))) {
    const tag = sm[0];
    const name = unescapeXml(attr(tag, 'name') ?? `Sheet${sheetDefs.length + 1}`);
    const rid = attr(tag, 'r:id') ?? `rId${sheetDefs.length + 1}`;
    sheetDefs.push({ name, rid });
  }

  // rId → worksheet target path.
  const relsText = textOf(files, 'xl/_rels/workbook.xml.rels') ?? '';
  const ridToTarget = new Map<string, string>();
  const relRe = /<Relationship\b[^>]*\/?>/g;
  let rm: RegExpExecArray | null;
  while ((rm = relRe.exec(relsText))) {
    const id = attr(rm[0], 'Id');
    const target = attr(rm[0], 'Target');
    if (id && target) ridToTarget.set(id, target.replace(/^\//, ''));
  }

  const sharedStrings = parseSharedStrings(textOf(files, 'xl/sharedStrings.xml') ?? '');
  const numFmtById = parseStyles(textOf(files, 'xl/styles.xml') ?? '');

  const sheets: SheetModel[] = sheetDefs.map((def, i) => {
    const target = ridToTarget.get(def.rid) ?? `worksheets/sheet${i + 1}.xml`;
    const path = target.startsWith('xl/') ? target : `xl/${target}`;
    const xml = textOf(files, path) ?? '';
    return parseWorksheet(xml, `sheet-${i + 1}`, def.name, sharedStrings, numFmtById);
  });

  if (sheets.length === 0) throw new Error('Invalid .xlsx: no worksheets');

  const wb: WorkbookModel = {
    sheets,
    activeSheet: sheets[0]!.id,
    calcMode: 'auto',
  };
  const names = parseDefinedNames(workbookXmlText);
  if (Object.keys(names).length) wb.namedRanges = names;
  return wb;
}

function parseDefinedNames(workbookXmlText: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /<definedName\b[^>]*name="([^"]+)"[^>]*>([\s\S]*?)<\/definedName>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(workbookXmlText))) {
    out[unescapeXml(m[1] as string)] = unescapeXml((m[2] as string).trim());
  }
  return out;
}

function parseSharedStrings(xml: string): string[] {
  const out: string[] = [];
  const siRe = /<si>([\s\S]*?)<\/si>/g;
  let m: RegExpExecArray | null;
  while ((m = siRe.exec(xml))) {
    // Concatenate every <t> within the <si> (rich text runs).
    const body = m[1] ?? '';
    const tRe = /<t[^>]*>([\s\S]*?)<\/t>/g;
    let tm: RegExpExecArray | null;
    let text = '';
    while ((tm = tRe.exec(body))) text += unescapeXml(tm[1] ?? '');
    out.push(text);
  }
  return out;
}

/** cellXfs index → number-format pattern (custom + the handful of built-ins we emit). */
function parseStyles(xml: string): Map<number, string> {
  // numFmtId → pattern (custom).
  const fmtById = new Map<number, string>();
  const fmtRe = /<numFmt\b[^>]*\/?>/g;
  let fm: RegExpExecArray | null;
  while ((fm = fmtRe.exec(xml))) {
    const id = Number(attr(fm[0], 'numFmtId'));
    const code = unescapeXml(attr(fm[0], 'formatCode') ?? '');
    if (Number.isFinite(id)) fmtById.set(id, code);
  }
  // cellXfs slot → numFmtId → pattern.
  const xfPattern = new Map<number, string>();
  const cellXfsBlock = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(xml);
  if (cellXfsBlock) {
    const xfRe = /<xf\b[^>]*\/?>/g;
    let xm: RegExpExecArray | null;
    let slot = 0;
    while ((xm = xfRe.exec(cellXfsBlock[1] ?? ''))) {
      const id = Number(attr(xm[0], 'numFmtId') ?? '0');
      const pattern = fmtById.get(id);
      if (pattern) xfPattern.set(slot, pattern);
      slot++;
    }
  }
  return xfPattern;
}

function parseWorksheet(
  xml: string,
  id: string,
  name: string,
  sharedStrings: string[],
  xfPattern: Map<number, string>,
): SheetModel {
  const sheet: SheetModel = { id, name, cells: {}, rowCount: 1, colCount: 1 };

  const cellRe = /<c\b([^>]*)(?:\/>|>([\s\S]*?)<\/c>)/g;
  let cm: RegExpExecArray | null;
  while ((cm = cellRe.exec(xml))) {
    const attrs = cm[1] ?? '';
    const body = cm[2] ?? '';
    const ref = attr(attrs, 'r');
    if (!ref) continue;
    const [row, col] = fromA1(ref);
    const type = attr(attrs, 't') ?? 'n';
    const styleIdx = Number(attr(attrs, 's') ?? '');

    const fMatch = /<f[^>]*>([\s\S]*?)<\/f>/.exec(body);
    const vMatch = /<v[^>]*>([\s\S]*?)<\/v>/.exec(body);
    const rawV = vMatch ? unescapeXml(vMatch[1] ?? '') : '';

    let value: CellValue = null;
    if (type === 's') value = sharedStrings[Number(rawV)] ?? '';
    else if (type === 'b') value = rawV === '1';
    else if (type === 'e') value = { kind: 'error', code: rawV as never };
    else if (type === 'str') value = rawV;
    else if (rawV !== '') value = Number(rawV);

    const cell: CellModel = {};
    if (fMatch) cell.formula = unescapeXml(fMatch[1] ?? '');
    if (value !== null) cell.value = value;
    const pattern = Number.isFinite(styleIdx) ? xfPattern.get(styleIdx) : undefined;
    if (pattern) cell.format = { numberFormat: pattern };

    // Skip truly empty cells (no value, formula, or format).
    if (cell.value === undefined && !cell.formula && !cell.format) continue;
    sheet.cells[cellKey(row, col)] = cell;
    sheet.rowCount = Math.max(sheet.rowCount, row + 1);
    sheet.colCount = Math.max(sheet.colCount, col + 1);
  }

  // Merges.
  const merges = parseMerges(xml);
  if (merges.length) {
    sheet.merges = merges;
    for (const m of merges) {
      sheet.rowCount = Math.max(sheet.rowCount, m.row + m.rowSpan);
      sheet.colCount = Math.max(sheet.colCount, m.col + m.colSpan);
    }
  }

  // Frozen panes.
  const frozen = parseFrozen(xml);
  if (frozen) sheet.frozen = frozen;

  // Pad out to a usable editable grid.
  sheet.rowCount = Math.max(sheet.rowCount, 100);
  sheet.colCount = Math.max(sheet.colCount, 26);
  return sheet;
}

function parseMerges(xml: string): MergeRegion[] {
  const out: MergeRegion[] = [];
  const re = /<mergeCell\b[^>]*ref="([^"]+)"[^>]*\/?>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const range = m[1] ?? '';
    const [from, to] = range.split(':');
    if (!from || !to) continue;
    const [r0, c0] = fromA1(from);
    const [r1, c1] = fromA1(to);
    out.push({ row: r0, col: c0, rowSpan: r1 - r0 + 1, colSpan: c1 - c0 + 1 });
  }
  return out;
}

function parseFrozen(xml: string): FrozenPanes | undefined {
  const m = /<pane\b[^>]*\/?>/.exec(xml);
  if (!m) return undefined;
  const tag = m[0];
  if ((attr(tag, 'state') ?? '') !== 'frozen') return undefined;
  const cols = Number(attr(tag, 'xSplit') ?? '0') || 0;
  const rows = Number(attr(tag, 'ySplit') ?? '0') || 0;
  if (rows === 0 && cols === 0) return undefined;
  return { rows, cols };
}

/* ── tiny attribute / file helpers ──────────────────────────────────────── */

function attr(tag: string, name: string): string | undefined {
  const re = new RegExp(`\\b${name.replace(':', '\\:')}="([^"]*)"`);
  const m = re.exec(tag);
  return m ? (m[1] as string) : undefined;
}

function textOf(files: Map<string, Uint8Array>, path: string): string | undefined {
  const bytes = files.get(path);
  return bytes ? fromUtf8(bytes) : undefined;
}
