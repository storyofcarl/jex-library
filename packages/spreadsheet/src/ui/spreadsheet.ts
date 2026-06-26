/**
 * Spreadsheet — the top-level multi-sheet workbook UI.
 *
 * Composes a toolbar (reusing @jects/widgets `Toolbar`), a formula bar, a cell
 * grid surface, and a sheet-tab strip, and drives them all through a
 * `SpreadsheetApi` (the engine seam from contract.ts). The UI never
 * recalculates — it reads display values from the engine and writes edits back.
 *
 * Capabilities wired here: cell selection/range, in-cell + formula-bar editing,
 * fill, copy/paste block, merge/split, freeze panes, row/col insert/delete/
 * resize/hide, number formats, styling, data validation (dropdown), undo/redo,
 * sheet add/rename/reorder/delete, and import/export XLSX + CSV + JSON.
 *
 * Token-pure CSS; grid a11y roles + keyboard.
 */

import './styles.css';
import { Widget, type WidgetConfig, type WidgetEvents, createEl, register } from '@jects/core';
import { Toolbar, type ToolbarItem } from '@jects/widgets';
import type {
  CellAddress,
  CellFormat,
  CellModel,
  CellRef,
  CellStyle,
  CellValue,
  CfRange,
  CfRule,
  FrozenPanes,
  SheetModel,
  SpreadsheetApi,
  WorkbookModel,
} from '../contract.js';
import { CellGrid } from './cell-grid.js';
import { FormulaBar } from './formula-bar.js';
import { SheetTabs } from './sheet-tabs.js';
import { createSpreadsheetApi, defaultWorkbook } from './engine.js';
import { History, type Command } from './history.js';
import { ValidationStore, type ValidationRule } from './validation.js';
import { blockToTsv, inferPasted, parsePastedText } from './clipboard.js';
import { fillBlock } from './fill.js';
import { sortRows, filterRows, type SortDir } from './sort-filter.js';
import { createEmbeddedChart, type EmbeddedChartOptions } from './chart-embed.js';
import type { Chart } from '@jects/charts';
import {
  exportWorkbook,
  importWorkbook,
  workbookToXlsxBytes,
  workbookToXlsxBlob,
  xlsxBytesToWorkbook,
  type IoFormat,
} from './io.js';
import { a1Helpers, parseA1 } from './a1.js';
import type { CellRange } from './selection.js';
import { iterateRange } from './selection.js';

export interface SpreadsheetConfig extends WidgetConfig {
  /**
   * The engine seam. When omitted, a built-in in-UI engine is created from
   * `workbook` (or a blank workbook). Pass the production `SpreadsheetApi` to
   * drive the full engine.
   */
  api?: SpreadsheetApi;
  /** Initial workbook (used only when `api` is omitted). */
  workbook?: WorkbookModel;
  /**
   * Convenience initializer: the sheets to start from (used only when both
   * `api` and `workbook` are omitted). Each entry may be a full `SheetModel` or
   * a partial — missing `id`/`name`/`cells`/`rowCount`/`colCount` are filled in.
   * The first sheet becomes active. `new Spreadsheet(el, { sheets })`.
   */
  sheets?: Array<Partial<SheetModel>>;
  /** Show the toolbar. Default `true`. */
  toolbar?: boolean;
  /** Show the formula bar. Default `true`. */
  formulaBar?: boolean;
  /** Show the sheet-tab strip. Default `true`. */
  sheetTabs?: boolean;
  /** Max rendered columns. Default 26. */
  maxCols?: number;
  /** Max rendered rows. Default 100. */
  maxRows?: number;
  /**
   * Show the column-header sort/filter affordance. Default `true`. A plain click
   * on a header's menu button cycles ascending/descending sort of the used range
   * by that column; alt/shift-click applies a quick non-blank filter.
   */
  headerMenu?: boolean;
}

export interface SpreadsheetEvents extends WidgetEvents {
  /** Selection changed (active cell + range). */
  selectionChange: { ref: CellRef; range: CellRange };
  /** A cell input was committed through the UI. */
  cellCommit: { ref: CellRef; input: string };
  /** The active sheet changed. */
  sheetChange: { sheetId: string };
  /** A workbook was imported. */
  import: { format: IoFormat };
  /** An edit was rejected by data validation or sheet/cell protection. */
  editRejected: { address: CellAddress; reason: 'validation' | 'protected'; message?: string };
}

const TOOLBAR_ITEMS: ToolbarItem[] = [
  { id: 'undo', text: 'Undo', label: 'Undo' },
  { id: 'redo', text: 'Redo', label: 'Redo' },
  { separator: true },
  { id: 'bold', text: 'B', label: 'Bold' },
  { id: 'italic', text: 'I', label: 'Italic' },
  { id: 'underline', text: 'U', label: 'Underline' },
  { separator: true },
  { id: 'align-start', text: 'L', label: 'Align left' },
  { id: 'align-center', text: 'C', label: 'Align center' },
  { id: 'align-end', text: 'R', label: 'Align right' },
  { separator: true },
  { id: 'fmt-currency', text: '$', label: 'Currency format' },
  { id: 'fmt-percent', text: '%', label: 'Percent format' },
  { separator: true },
  { id: 'merge', text: 'Merge', label: 'Merge cells' },
  { id: 'freeze', text: 'Freeze', label: 'Freeze panes' },
  { separator: true },
  { id: 'insert-row', text: '+Row', label: 'Insert row' },
  { id: 'insert-col', text: '+Col', label: 'Insert column' },
  { id: 'delete-row', text: '-Row', label: 'Delete row' },
  { id: 'delete-col', text: '-Col', label: 'Delete column' },
  { separator: true },
  { id: 'export-csv', text: 'CSV', label: 'Export CSV' },
  { id: 'export-xlsx', text: 'XLSX', label: 'Export XLSX' },
  { id: 'export-json', text: 'JSON', label: 'Export JSON' },
];

export class Spreadsheet extends Widget<SpreadsheetConfig, SpreadsheetEvents> {
  private declare api: SpreadsheetApi;
  private declare history: History;
  private declare validations: ValidationStore;
  private declare toolbar?: Toolbar;
  private declare formulaBar?: FormulaBar;
  private declare grid: CellGrid;
  private declare tabs?: SheetTabs;
  private declare clipboard: { values: CellValue[][]; range: CellRange } | null;
  private declare subscriptions: Array<() => void>;
  private declare gridHost: HTMLElement;
  /** Embedded (floating) chart objects mounted over the grid. */
  private declare charts: EmbeddedChart[];

  protected override defaults(): Partial<SpreadsheetConfig> {
    return { toolbar: true, formulaBar: true, sheetTabs: true, maxCols: 26, maxRows: 100 };
  }

  protected buildEl(): HTMLElement {
    return createEl('div', { className: 'jects-ss', attrs: { 'aria-label': 'Spreadsheet' } });
  }

  protected override render(): void {
    if (this.api === undefined) this.init();
  }

  private init(): void {
    this.history = new History();
    this.validations = new ValidationStore();
    this.clipboard = null;
    this.subscriptions = [];
    this.charts = [];
    this.api =
      this.config.api ??
      createSpreadsheetApi(
        this.config.workbook ?? workbookFromSheets(this.config.sheets) ?? defaultWorkbook(),
      );

    const { toolbar = true, formulaBar = true, sheetTabs = true } = this.config;

    // ── toolbar ──
    if (toolbar) {
      const host = createEl('div', { className: 'jects-ss__toolbar' });
      this.el.appendChild(host);
      this.toolbar = new Toolbar(host, { items: TOOLBAR_ITEMS, label: 'Spreadsheet toolbar' });
      this.toolbar.on('action', ({ id }) => this.onToolbarAction(id));
    }

    // ── formula bar ──
    if (formulaBar) {
      const host = createEl('div', { className: 'jects-ss__fbar' });
      this.el.appendChild(host);
      this.formulaBar = new FormulaBar(host, {});
      this.formulaBar.on('commit', ({ value }) => this.commitFromFormulaBar(value));
      this.formulaBar.on('navigate', ({ name }) => this.navigateTo(name));
    }

    // ── grid ──
    this.gridHost = createEl('div', { className: 'jects-ss__grid' });
    this.el.appendChild(this.gridHost);
    this.grid = new CellGrid(this.gridHost, {
      api: this.api,
      getValidation: (addr) => this.getValidation(addr),
      headerMenu: this.config.headerMenu ?? true,
      ...(this.config.maxCols !== undefined ? { maxCols: this.config.maxCols } : {}),
      ...(this.config.maxRows !== undefined ? { maxRows: this.config.maxRows } : {}),
    });
    this.pendingEditSnapshot = undefined;
    this.grid.on('selectionChange', ({ active, range }) => this.onSelectionChange(active, range));
    this.grid.on('editStart', ({ address }) => {
      this.pendingEditSnapshot = clone(this.api.getCell(this.refOf(address)));
    });
    this.grid.on('cellCommit', ({ address, input }) =>
      this.recordCellCommit(address, input),
    );
    this.grid.on('fillRequest', ({ range }) => this.onFillRequest(range));
    this.grid.on('fillDrag', ({ source, target }) => this.onFillDrag(source, target));
    this.grid.on('editRejected', (e) => this.emit('editRejected', e));
    this.grid.on('headerAction', ({ col, action }) => this.onHeaderAction(col, action));

    // clipboard listeners on the grid root
    this.subscriptions.push(
      bind(this.grid.el, 'keydown', (e) => this.onClipboardKey(e as KeyboardEvent)),
    );

    // ── sheet tabs ──
    if (sheetTabs) {
      const host = createEl('div', { className: 'jects-ss__tabs' });
      this.el.appendChild(host);
      this.tabs = new SheetTabs(host, { api: this.api });
      this.tabs.on('activate', ({ sheetId }) => this.setActiveSheet(sheetId));
      this.tabs.on('add', () => this.addSheet());
      this.tabs.on('rename', ({ sheetId, name }) => {
        this.api.renameSheet(sheetId, name);
        this.tabs?.update({});
      });
      this.tabs.on('remove', ({ sheetId }) => {
        this.api.removeSheet(sheetId);
        this.refreshAll();
      });
      this.tabs.on('reorder', ({ sheetId, toIndex }) => this.reorderSheet(sheetId, toIndex));
    }

    // engine events → repaint
    this.subscriptions.push(
      this.api.events.on('recalc', () => this.grid.update({})),
      this.api.events.on('activeSheetChange', () => this.refreshAll()),
      this.api.events.on('workbookLoad', () => this.refreshAll()),
    );

    this.syncFormulaBar(this.grid.getActive());
  }

  /* ── selection / formula bar ────────────────────────────────────────── */

  private onSelectionChange(active: CellAddress, _range: CellRange): void {
    this.syncFormulaBar(active);
    this.emit('selectionChange', { ref: this.refOf(active), range: this.grid.getRange() });
  }

  private syncFormulaBar(active: CellAddress): void {
    if (!this.formulaBar) return;
    const ref = this.refOf(active);
    const formula = this.api.getFormula(ref);
    const raw = formula != null ? `=${formula}` : this.rawValueText(ref);
    const name = a1Helpers.format(active);
    this.formulaBar.setActive(name, raw);
  }

  private rawValueText(ref: CellRef): string {
    const v = this.api.getValue(ref);
    if (v === null || v === undefined) return '';
    if (typeof v === 'object' && 'kind' in v) return v.code;
    return String(v);
  }

  private commitFromFormulaBar(value: string): void {
    const active = this.grid.getActive();
    this.recordCellCommit(active, value, true);
    this.grid.update({});
  }

  private navigateTo(name: string): void {
    try {
      const parsed = parseA1(name);
      this.grid.setActive({ row: parsed.row, col: parsed.col });
    } catch {
      /* ignore invalid address */
    }
  }

  /* ── editing with undo capture ──────────────────────────────────────── */

  /**
   * Record a single-cell commit as an undoable command. The grid applies inline
   * edits itself before emitting `cellCommit` (so `apply` is false then); the
   * formula bar path passes `apply` to make this method perform the write.
   *
   * The `before` snapshot must be captured BEFORE the inline edit was applied —
   * which is impossible after the fact for the grid path — so we keep a pending
   * pre-edit snapshot taken when an edit starts.
   */
  private recordCellCommit(address: CellAddress, input: string, apply = false): void {
    if (this.history.isApplying) return;
    const ref = this.refOf(address);
    // `null` is a valid snapshot (empty cell); `undefined` means "not captured",
    // so distinguish them explicitly rather than with `??`.
    const before: CellSnapshot =
      this.pendingEditSnapshot !== undefined
        ? this.pendingEditSnapshot
        : clone(this.api.getCell(ref));
    this.pendingEditSnapshot = undefined;
    if (apply) this.api.setCellInput(ref, input);
    const cmd: Command = {
      label: 'Edit cell',
      redo: () => {
        this.api.setCellInput(ref, input);
        this.grid.update({});
      },
      undo: () => {
        this.restoreCell(ref, before);
        this.grid.update({});
      },
    };
    this.history.record(cmd);
    this.emit('cellCommit', { ref, input });
    this.syncFormulaBar(this.grid.getActive());
  }

  /**
   * Snapshot of the active cell captured when an inline edit begins. `undefined`
   * means "none pending"; `null` means "the cell was empty".
   */
  private declare pendingEditSnapshot: CellSnapshot | undefined;

  private restoreCell(ref: CellRef, snapshot: CellSnapshot): void {
    if (snapshot == null) {
      this.api.clearCell(ref);
    } else if (snapshot.formula != null) {
      this.api.setFormula(ref, snapshot.formula);
    } else {
      this.api.setValue(ref, snapshot.value ?? null);
    }
    if (snapshot?.format) this.api.setFormat(ref, snapshot.format);
    if (snapshot?.style) this.api.setStyle(ref, snapshot.style);
    // Comment + lock state live on the cell model directly (no API setter); patch
    // them onto the (possibly just-cleared) cell so undo/redo round-trips them.
    if (snapshot?.comment !== undefined || snapshot?.locked !== undefined) {
      const sheet = this.api.getActiveSheet();
      const cell = (sheet.cells[`${ref.row},${ref.col}`] ??= {});
      if (snapshot.comment !== undefined) cell.comment = snapshot.comment;
      else delete cell.comment;
      if (snapshot.locked !== undefined) cell.locked = snapshot.locked;
      else delete cell.locked;
    }
  }

  /* ── toolbar actions ────────────────────────────────────────────────── */

  private onToolbarAction(id: string): void {
    switch (id) {
      case 'undo':
        this.undo();
        break;
      case 'redo':
        this.redo();
        break;
      case 'bold':
        this.toggleStyle('bold');
        break;
      case 'italic':
        this.toggleStyle('italic');
        break;
      case 'underline':
        this.toggleStyle('underline');
        break;
      case 'align-start':
        this.applyStyle({ align: 'start' });
        break;
      case 'align-center':
        this.applyStyle({ align: 'center' });
        break;
      case 'align-end':
        this.applyStyle({ align: 'end' });
        break;
      case 'fmt-currency':
        this.applyFormat({ type: 'currency', numberFormat: '#,##0.00' });
        break;
      case 'fmt-percent':
        this.applyFormat({ type: 'percent', numberFormat: '0.00%' });
        break;
      case 'merge':
        this.mergeSelection();
        break;
      case 'freeze':
        this.freezeAtSelection();
        break;
      case 'insert-row':
        this.insertRow();
        break;
      case 'insert-col':
        this.insertColumn();
        break;
      case 'delete-row':
        this.deleteRow();
        break;
      case 'delete-col':
        this.deleteColumn();
        break;
      case 'export-csv':
        this.lastExport = this.exportTo('csv');
        break;
      case 'export-xlsx':
        this.lastExport = this.exportTo('xlsx');
        break;
      case 'export-json':
        this.lastExport = this.exportTo('json');
        break;
    }
  }

  /** Last export string (also returned by `exportTo`) — for headless callers. */
  private declare lastExport: string;

  /* ── styling & formats ──────────────────────────────────────────────── */

  /** Toggle a boolean style key across the current selection. */
  toggleStyle(key: 'bold' | 'italic' | 'underline' | 'strikethrough'): void {
    const range = this.grid.getRange();
    const anchor = this.refOf({ row: range.top, col: range.left });
    const current = this.api.getCell(anchor)?.style?.[key] ?? false;
    this.applyStyle({ [key]: !current } as Partial<CellStyle>);
  }

  /** Apply a style patch to the whole selection (undoable). */
  applyStyle(patch: Partial<CellStyle>): void {
    const range = this.grid.getRange();
    const before = this.snapshotRange(range);
    this.history.push({
      label: 'Style',
      redo: () => {
        for (const addr of iterateRange(range)) this.api.setStyle(this.refOf(addr), patch);
        this.grid.update({});
      },
      undo: () => {
        this.restoreRange(range, before);
        this.grid.update({});
      },
    });
  }

  /** Apply a number format to the selection (undoable). */
  applyFormat(format: CellFormat): void {
    const range = this.grid.getRange();
    const before = this.snapshotRange(range);
    this.history.push({
      label: 'Format',
      redo: () => {
        for (const addr of iterateRange(range)) this.api.setFormat(this.refOf(addr), format);
        this.grid.update({});
      },
      undo: () => {
        this.restoreRange(range, before);
        this.grid.update({});
      },
    });
  }

  /* ── structure ──────────────────────────────────────────────────────── */

  private mergeSelection(): void {
    const range = this.grid.getRange();
    const rows = range.bottom - range.top + 1;
    const cols = range.right - range.left + 1;
    const sheetId = this.api.getActiveSheet().id;
    if (rows === 1 && cols === 1) {
      // single cell → split (unmerge if it is a merge anchor)
      this.api.unmergeCells(sheetId, { row: range.top, col: range.left });
    } else {
      this.api.mergeCells({ sheet: sheetId, row: range.top, col: range.left, rowSpan: rows, colSpan: cols });
    }
    this.grid.update({});
  }

  /** Merge the current selection into one cell. */
  merge(): void {
    this.mergeSelection();
  }

  /** Split (unmerge) the merge anchored at the active cell. */
  split(): void {
    const a = this.grid.getActive();
    this.api.unmergeCells(this.api.getActiveSheet().id, { row: a.row, col: a.col });
    this.grid.update({});
  }

  private freezeAtSelection(): void {
    const a = this.grid.getActive();
    const sheetId = this.api.getActiveSheet().id;
    const current = this.api.getActiveSheet().frozen ?? { rows: 0, cols: 0 };
    const next: FrozenPanes =
      current.rows === a.row && current.cols === a.col ? { rows: 0, cols: 0 } : { rows: a.row, cols: a.col };
    this.api.setFrozen(sheetId, next);
    this.grid.update({});
  }

  /** Set freeze panes explicitly. */
  setFrozen(frozen: FrozenPanes): void {
    this.api.setFrozen(this.api.getActiveSheet().id, frozen);
    this.grid.update({});
  }

  private insertRow(): void {
    const a = this.grid.getActive();
    this.api.insertRows(this.api.getActiveSheet().id, a.row, 1);
    this.grid.update({});
  }

  private insertColumn(): void {
    const a = this.grid.getActive();
    this.api.insertColumns(this.api.getActiveSheet().id, a.col, 1);
    this.grid.update({});
  }

  private deleteRow(): void {
    const a = this.grid.getActive();
    this.api.deleteRows(this.api.getActiveSheet().id, a.row, 1);
    this.grid.update({});
  }

  private deleteColumn(): void {
    const a = this.grid.getActive();
    this.api.deleteColumns(this.api.getActiveSheet().id, a.col, 1);
    this.grid.update({});
  }

  /** Resize a column to `size` px. */
  resizeColumn(col: number, size: number): void {
    const sheet = this.api.getActiveSheet();
    (sheet.cols ??= {})[col] = { ...sheet.cols?.[col], size };
    this.grid.update({});
  }

  /** Resize a row to `size` px. */
  resizeRow(row: number, size: number): void {
    const sheet = this.api.getActiveSheet();
    (sheet.rows ??= {})[row] = { ...sheet.rows?.[row], size };
    this.grid.update({});
  }

  /** Hide a column. */
  hideColumn(col: number): void {
    const sheet = this.api.getActiveSheet();
    (sheet.cols ??= {})[col] = { ...sheet.cols?.[col], hidden: true };
    this.grid.update({});
  }

  /** Hide a row. */
  hideRow(row: number): void {
    const sheet = this.api.getActiveSheet();
    (sheet.rows ??= {})[row] = { ...sheet.rows?.[row], hidden: true };
    this.grid.update({});
  }

  /* ── fill / clipboard ───────────────────────────────────────────────── */

  private onFillRequest(range: CellRange): void {
    // The fill *begins* on handle mousedown; remember the source block so the
    // drag (resolved in `onFillDrag`) extends from it. Headless callers use
    // `fillDown`/`fillRight`/`fillTo` directly.
    this.fillSource = range;
  }

  /** The selection block a fill-handle drag started from (set on `fillRequest`). */
  private declare fillSource: CellRange | undefined;

  /**
   * Handle a column-header sort/filter affordance: derive the column's used row
   * extent (skipping a header row when one is present) and sort or quick-filter
   * across that range.
   */
  private onHeaderAction(col: number, action: 'sortAsc' | 'sortDesc' | 'filter'): void {
    const range = this.usedRangeForColumn(col);
    if (!range) return;
    if (action === 'filter') {
      // Quick filter: hide rows whose cell in this column is blank.
      this.applyFilter(col, (v) => v !== null && v !== undefined && v !== '', range);
      return;
    }
    this.sortRange({ column: col, dir: action === 'sortDesc' ? 'desc' : 'asc' }, range);
  }

  /**
   * The contiguous block of rows around a column that carries data, spanning the
   * full set of columns that share those rows (so sorting reorders whole records,
   * not just one column). A first row of text headers above numeric data is
   * treated as a header and excluded from the sorted body.
   */
  private usedRangeForColumn(col: number): CellRange | undefined {
    const sheet = this.api.getActiveSheet();
    let top = Infinity;
    let bottom = -1;
    let left = col;
    let right = col;
    for (const key of Object.keys(sheet.cells)) {
      const comma = key.indexOf(',');
      const r = Number(key.slice(0, comma));
      const c = Number(key.slice(comma + 1));
      const v = sheet.cells[key]?.value;
      if (v === null || v === undefined || v === '') continue;
      top = Math.min(top, r);
      bottom = Math.max(bottom, r);
      left = Math.min(left, c);
      right = Math.max(right, c);
    }
    if (bottom < 0) return undefined;
    // Detect a header row: row `top` is all strings while `top+1` has a number.
    const hasHeader =
      bottom > top &&
      this.rowIsAllText(top, left, right) &&
      this.rowHasNumber(top + 1, left, right);
    return { top: hasHeader ? top + 1 : top, bottom, left, right };
  }

  private rowIsAllText(row: number, left: number, right: number): boolean {
    let any = false;
    for (let c = left; c <= right; c++) {
      const v = this.api.getValue(this.refOf({ row, col: c }));
      if (v === null || v === undefined || v === '') continue;
      any = true;
      if (typeof v !== 'string') return false;
    }
    return any;
  }

  private rowHasNumber(row: number, left: number, right: number): boolean {
    for (let c = left; c <= right; c++) {
      if (typeof this.api.getValue(this.refOf({ row, col: c })) === 'number') return true;
    }
    return false;
  }

  /**
   * Resolve a fill-handle drag: extend the original source block to cover the
   * swept-to `target`, filling along the dominant axis (down/up/right/left) with
   * `fillBlock`'s linear/date/list series semantics. Undoable.
   */
  private onFillDrag(swept: CellRange, target: CellAddress): void {
    const source = this.fillSource;
    this.fillSource = undefined;
    if (!source) return;
    this.fillTo(source, target);
    void swept;
  }

  /**
   * Fill from a `source` block to a `target` cell — the programmatic entry point
   * for the drag fill-handle. Picks the axis from the larger overshoot and writes
   * the extrapolated series past the source edge. Undoable.
   */
  fillTo(source: CellRange, target: CellAddress): void {
    const downExtra = target.row - source.bottom;
    const upExtra = source.top - target.row;
    const rightExtra = target.col - source.right;
    const leftExtra = source.left - target.col;
    // Choose the axis/direction with the largest positive overshoot.
    const candidates: Array<{ dir: 'down' | 'up' | 'right' | 'left'; extra: number }> = [
      { dir: 'down', extra: downExtra },
      { dir: 'up', extra: upExtra },
      { dir: 'right', extra: rightExtra },
      { dir: 'left', extra: leftExtra },
    ];
    const best = candidates.reduce((a, b) => (b.extra > a.extra ? b : a));
    if (best.extra <= 0) return;

    const sourceBlock: CellValue[][] = [];
    for (let r = source.top; r <= source.bottom; r++) {
      const row: CellValue[] = [];
      for (let c = source.left; c <= source.right; c++) {
        row.push(this.api.getValue(this.refOf({ row: r, col: c })));
      }
      sourceBlock.push(row);
    }
    const filled = fillBlock(sourceBlock, best.dir, best.extra);

    // Compute the destination rectangle (the cells the series writes into).
    const destRange = this.fillDestRange(source, best.dir, best.extra);
    const before = this.snapshotRange(destRange);
    this.history.push({
      label: 'Fill',
      redo: () => {
        this.writeFill(source, best.dir, filled);
        this.grid.update({});
      },
      undo: () => {
        this.restoreRange(destRange, before);
        this.grid.update({});
      },
    });
  }

  /** The rectangle a directional fill of `extra` lines writes into. */
  private fillDestRange(source: CellRange, dir: 'down' | 'up' | 'right' | 'left', extra: number): CellRange {
    switch (dir) {
      case 'down':
        return { ...source, top: source.bottom + 1, bottom: source.bottom + extra };
      case 'up':
        return { ...source, bottom: source.top - 1, top: source.top - extra };
      case 'right':
        return { ...source, left: source.right + 1, right: source.right + extra };
      case 'left':
        return { ...source, right: source.left - 1, left: source.left - extra };
    }
  }

  /** Write a `fillBlock` result past the source edge in `dir`. */
  private writeFill(
    source: CellRange,
    dir: 'down' | 'up' | 'right' | 'left',
    filled: CellValue[][],
  ): void {
    filled.forEach((line, i) => {
      line.forEach((v, j) => {
        let row: number;
        let col: number;
        if (dir === 'down') {
          row = source.bottom + 1 + i;
          col = source.left + j;
        } else if (dir === 'up') {
          row = source.top - filled.length + i;
          col = source.left + j;
        } else if (dir === 'right') {
          row = source.top + i;
          col = source.right + 1 + j;
        } else {
          row = source.top + i;
          col = source.left - filled[0]!.length + j;
        }
        this.api.setValue(this.refOf({ row, col }), v);
      });
    });
  }

  /** Fill the top row of the selection down across the rest of the range. */
  fillDown(): void {
    const range = this.grid.getRange();
    const sourceRow: CellValue[] = [];
    for (let c = range.left; c <= range.right; c++) {
      sourceRow.push(this.api.getValue(this.refOf({ row: range.top, col: c })));
    }
    const extra = range.bottom - range.top;
    if (extra <= 0) return;
    const before = this.snapshotRange(range);
    const filled = fillBlock([sourceRow], 'down', extra);
    this.history.push({
      label: 'Fill down',
      redo: () => {
        filled.forEach((rowVals, i) => {
          rowVals.forEach((v, j) => {
            this.api.setValue(this.refOf({ row: range.top + 1 + i, col: range.left + j }), v);
          });
        });
        this.grid.update({});
      },
      undo: () => {
        this.restoreRange(range, before);
        this.grid.update({});
      },
    });
  }

  /** Fill the left column of the selection rightward across the range. */
  fillRight(): void {
    const range = this.grid.getRange();
    const sourceCol: CellValue[] = [];
    for (let r = range.top; r <= range.bottom; r++) {
      sourceCol.push(this.api.getValue(this.refOf({ row: r, col: range.left })));
    }
    const extra = range.right - range.left;
    if (extra <= 0) return;
    const before = this.snapshotRange(range);
    const filled = fillBlock(sourceCol.map((v) => [v]), 'right', extra);
    this.history.push({
      label: 'Fill right',
      redo: () => {
        filled.forEach((rowVals, i) => {
          rowVals.forEach((v, j) => {
            this.api.setValue(this.refOf({ row: range.top + i, col: range.left + 1 + j }), v);
          });
        });
        this.grid.update({});
      },
      undo: () => {
        this.restoreRange(range, before);
        this.grid.update({});
      },
    });
  }

  private onClipboardKey(e: KeyboardEvent): void {
    if (!(e.ctrlKey || e.metaKey)) return;
    const key = e.key.toLowerCase();
    if (key === 'c') {
      this.copy();
    } else if (key === 'x') {
      this.copy();
      this.grid.deleteSelection();
    } else if (key === 'v') {
      void this.paste();
    } else if (key === 'z') {
      e.preventDefault();
      if (e.shiftKey) this.redo();
      else this.undo();
    } else if (key === 'y') {
      e.preventDefault();
      this.redo();
    }
  }

  /** Copy the current selection block to the internal + OS clipboard. */
  copy(): string {
    const range = this.grid.getRange();
    const values: CellValue[][] = [];
    for (let r = range.top; r <= range.bottom; r++) {
      const row: CellValue[] = [];
      for (let c = range.left; c <= range.right; c++) {
        row.push(this.api.getValue(this.refOf({ row: r, col: c })));
      }
      values.push(row);
    }
    this.clipboard = { values, range };
    const tsv = blockToTsv(values);
    void this.writeOsClipboard(tsv);
    return tsv;
  }

  private async writeOsClipboard(text: string): Promise<void> {
    try {
      await navigator.clipboard?.writeText(text);
    } catch {
      /* clipboard unavailable (jsdom) — internal buffer still works */
    }
  }

  /** Paste the internal clipboard (or provided TSV) anchored at the active cell. */
  async paste(tsv?: string): Promise<void> {
    let block: CellValue[][] | null = null;
    if (tsv != null) {
      block = parsePastedText(tsv).map((row) => row.map(inferPasted));
    } else if (this.clipboard) {
      block = this.clipboard.values;
    } else {
      try {
        const text = await navigator.clipboard?.readText();
        if (text) block = parsePastedText(text).map((row) => row.map(inferPasted));
      } catch {
        /* ignore */
      }
    }
    if (!block) return;
    this.pasteBlock(block);
  }

  /** Synchronously paste a value block at the active cell (undoable). */
  pasteBlock(block: CellValue[][]): void {
    const anchor = this.grid.getActive();
    const rows = block.length;
    const cols = Math.max(...block.map((r) => r.length));
    const range: CellRange = {
      top: anchor.row,
      left: anchor.col,
      bottom: anchor.row + rows - 1,
      right: anchor.col + cols - 1,
    };
    const before = this.snapshotRange(range);
    this.history.push({
      label: 'Paste',
      redo: () => {
        block.forEach((rowVals, i) => {
          rowVals.forEach((v, j) => {
            this.api.setValue(this.refOf({ row: anchor.row + i, col: anchor.col + j }), v);
          });
        });
        this.grid.update({});
      },
      undo: () => {
        this.restoreRange(range, before);
        this.grid.update({});
      },
    });
  }

  /* ── data validation ────────────────────────────────────────────────── */

  /** Attach a validation rule to the active cell (or a range). */
  setValidation(rule: ValidationRule, range?: CellRange): void {
    const target = range ?? this.grid.getRange();
    const sheetId = this.api.getActiveSheet().id;
    for (const addr of iterateRange(target)) {
      this.validations.set(sheetId, addr.row, addr.col, rule);
    }
    this.grid.update({});
  }

  /** Read the validation rule at a cell. */
  getValidation(addr: CellAddress): ValidationRule | undefined {
    return this.validations.get(this.api.getActiveSheet().id, addr.row, addr.col);
  }

  /* ── conditional formatting ─────────────────────────────────────────── */

  /**
   * Add a conditional-formatting rule scoped to a range (defaults to the current
   * selection). The rule is stored on the active sheet's `conditionalFormats` and
   * applied live by the grid in `buildCell`. Undoable. Returns the stored rule.
   */
  addConditionalFormat(rule: CfRuleInput, range?: CellRange): CfRule {
    const target = cfRangeFrom(range ?? this.grid.getRange());
    const sheet = this.api.getActiveSheet();
    const built = { ...rule, range: target } as CfRule;
    const list = (sheet.conditionalFormats ??= []);
    this.history.push({
      label: 'Conditional format',
      redo: () => {
        if (!list.includes(built)) list.push(built);
        this.grid.update({});
      },
      undo: () => {
        const i = list.indexOf(built);
        if (i >= 0) list.splice(i, 1);
        this.grid.update({});
      },
    });
    return built;
  }

  /** Remove all conditional-formatting rules from the active sheet (undoable). */
  clearConditionalFormats(): void {
    const sheet = this.api.getActiveSheet();
    const prev = sheet.conditionalFormats ?? [];
    if (prev.length === 0) return;
    this.history.push({
      label: 'Clear conditional formats',
      redo: () => {
        sheet.conditionalFormats = [];
        this.grid.update({});
      },
      undo: () => {
        sheet.conditionalFormats = prev;
        this.grid.update({});
      },
    });
  }

  /** The conditional-formatting rules on the active sheet. */
  getConditionalFormats(): CfRule[] {
    return this.api.getActiveSheet().conditionalFormats ?? [];
  }

  /* ── comments / notes ───────────────────────────────────────────────── */

  /**
   * Set (or clear, when `text` is empty) a cell comment/note. Stored on the
   * `CellModel.comment` so it serializes with the workbook; the grid paints a
   * triangle indicator and a hover/show popover. Undoable.
   */
  setComment(addr: CellAddress, text: string): void {
    const ref = this.refOf(addr);
    const before = this.api.getCell(ref)?.comment;
    this.history.push({
      label: 'Comment',
      redo: () => {
        this.applyComment(ref, text === '' ? undefined : text);
        this.grid.update({});
      },
      undo: () => {
        this.applyComment(ref, before);
        this.grid.update({});
      },
    });
  }

  /** Read the comment at a cell, if any. */
  getComment(addr: CellAddress): string | undefined {
    return this.api.getCell(this.refOf(addr))?.comment;
  }

  /** Write/remove a comment directly on the (ensured) cell model. */
  private applyComment(ref: CellRef, text: string | undefined): void {
    const sheet = this.api.getActiveSheet();
    const key = `${ref.row},${ref.col}`;
    const cell = (sheet.cells[key] ??= {});
    if (text === undefined) {
      delete cell.comment;
      // Drop a now-empty placeholder cell so the sparse map stays clean.
      if (Object.keys(cell).length === 0) delete sheet.cells[key];
    } else {
      cell.comment = text;
    }
  }

  /* ── protection ─────────────────────────────────────────────────────── */

  /**
   * Protect or unprotect the active sheet. While protected, edits to `locked`
   * cells (locked by default) are vetoed by the grid; `unlockCells` opens a range
   * for editing first. Undoable.
   */
  setSheetProtected(protectedOn: boolean): void {
    const sheet = this.api.getActiveSheet();
    const before = sheet.protected ?? false;
    if (before === protectedOn) return;
    this.history.push({
      label: protectedOn ? 'Protect sheet' : 'Unprotect sheet',
      redo: () => {
        sheet.protected = protectedOn;
        this.grid.update({});
      },
      undo: () => {
        sheet.protected = before;
        this.grid.update({});
      },
    });
  }

  /** Whether the active sheet is protected. */
  isSheetProtected(): boolean {
    return this.api.getActiveSheet().protected === true;
  }

  /**
   * Set the `locked` flag on every cell of a range (default: current selection).
   * Pass `false` to leave those cells editable while the sheet is protected.
   * Undoable.
   */
  setCellsLocked(locked: boolean, range?: CellRange): void {
    const target = range ?? this.grid.getRange();
    const before = this.snapshotRange(target);
    this.history.push({
      label: locked ? 'Lock cells' : 'Unlock cells',
      redo: () => {
        const sheet = this.api.getActiveSheet();
        for (const addr of iterateRange(target)) {
          const cell = (sheet.cells[`${addr.row},${addr.col}`] ??= {});
          cell.locked = locked;
        }
        this.grid.update({});
      },
      undo: () => {
        this.restoreRange(target, before);
        this.grid.update({});
      },
    });
  }

  /* ── named ranges ───────────────────────────────────────────────────── */

  /**
   * Define a workbook named range (`name` → A1/range ref, e.g. `"Sheet1!A1:A3"`
   * or `"B2"`). Available to formulas (`=SUM(MyRange)`) and recalculated. Names
   * are case-insensitive to the evaluator. Undoable.
   */
  defineName(name: string, ref: string): void {
    const wb = this.api.getWorkbook();
    const map = (wb.namedRanges ??= {});
    const before = map[name];
    this.history.push({
      label: 'Define name',
      redo: () => {
        (wb.namedRanges ??= {})[name] = ref;
        this.api.engine.setWorkbook(wb);
        this.api.recalculate();
      },
      undo: () => {
        if (before === undefined) delete wb.namedRanges?.[name];
        else (wb.namedRanges ??= {})[name] = before;
        this.api.engine.setWorkbook(wb);
        this.api.recalculate();
      },
    });
  }

  /** Delete a named range (undoable). */
  deleteName(name: string): void {
    const wb = this.api.getWorkbook();
    const before = wb.namedRanges?.[name];
    if (before === undefined) return;
    this.history.push({
      label: 'Delete name',
      redo: () => {
        delete wb.namedRanges?.[name];
        this.api.engine.setWorkbook(wb);
        this.api.recalculate();
      },
      undo: () => {
        (wb.namedRanges ??= {})[name] = before;
        this.api.engine.setWorkbook(wb);
        this.api.recalculate();
      },
    });
  }

  /** List the workbook's named ranges (name → ref). */
  listNames(): Record<string, string> {
    return { ...this.api.getWorkbook().namedRanges };
  }

  /* ── undo / redo ────────────────────────────────────────────────────── */

  /** Undo the last command. */
  undo(): void {
    this.history.undo();
    this.refreshChrome();
  }

  /** Redo the last undone command. */
  redo(): void {
    this.history.redo();
    this.refreshChrome();
  }

  /** Whether an undo is available. */
  canUndo(): boolean {
    return this.history.canUndo;
  }

  /** Whether a redo is available. */
  canRedo(): boolean {
    return this.history.canRedo;
  }

  /* ── sheets ─────────────────────────────────────────────────────────── */

  /** Switch the active sheet. */
  setActiveSheet(sheetId: string): void {
    this.api.setActiveSheet(sheetId);
    this.emit('sheetChange', { sheetId });
  }

  /** Add a sheet (and activate it). */
  addSheet(name?: string): string {
    const id = this.api.addSheet(name);
    this.api.setActiveSheet(id);
    this.refreshAll();
    return id;
  }

  private reorderSheet(sheetId: string, toIndex: number): void {
    const wb = this.api.getWorkbook();
    const from = wb.sheets.findIndex((s) => s.id === sheetId);
    if (from < 0) return;
    const [moved] = wb.sheets.splice(from, 1);
    if (!moved) return;
    wb.sheets.splice(toIndex, 0, moved);
    this.tabs?.update({});
  }

  /* ── import / export ────────────────────────────────────────────────── */

  /** Export the workbook (or active sheet for CSV) as a string. */
  exportTo(format: IoFormat): string {
    return exportWorkbook(this.api.getWorkbook(), format, this.api.getActiveSheet().id);
  }

  /** Import a string of `format`, replacing the current workbook. */
  importFrom(text: string, format: IoFormat): void {
    const wb = importWorkbook(text, format);
    this.api.loadWorkbook(wb);
    this.history.clear();
    this.refreshAll();
    this.emit('import', { format });
  }

  /**
   * Export the workbook as real `.xlsx` (Office Open XML) bytes — typed cells,
   * formulas, number formats, merges, frozen panes, and named ranges, zipped as
   * the format Excel/Sheets/LibreOffice read natively. (The legacy
   * SpreadsheetML-2003 string flavor is still available via `exportTo('xlsx')`.)
   */
  exportXlsx(): Uint8Array {
    return workbookToXlsxBytes(this.api.getWorkbook());
  }

  /** Export the workbook as a real `.xlsx` Blob (for browser download). */
  exportXlsxBlob(): Blob {
    return workbookToXlsxBlob(this.api.getWorkbook());
  }

  /** Import a real `.xlsx` (OOXML) byte package, replacing the current workbook. */
  importXlsx(bytes: Uint8Array): void {
    const wb = xlsxBytesToWorkbook(bytes);
    this.api.loadWorkbook(wb);
    this.history.clear();
    this.refreshAll();
    this.emit('import', { format: 'xlsx' });
  }

  /* ── sort / filter ──────────────────────────────────────────────────── */

  /**
   * Sort the rows of a range by a key column (defaults to the current
   * selection). `column` is absolute (sheet column index, not block-local). The
   * reordered values are written back through the API so dependents recalc.
   * Stable sort. Undoable.
   */
  sortRange(opts: { column: number; dir?: SortDir }, range?: CellRange): void {
    const target = range ?? this.grid.getRange();
    const rows = this.readBlock(target);
    const sorted = sortRows(rows, { column: opts.column - target.left, ...(opts.dir ? { dir: opts.dir } : {}) });
    const before = this.snapshotRange(target);
    this.history.push({
      label: 'Sort',
      redo: () => {
        this.writeBlock(target, sorted);
        this.grid.update({});
      },
      undo: () => {
        this.restoreRange(target, before);
        this.grid.update({});
      },
    });
  }

  /**
   * Filter rows of the active sheet by a predicate over a column's value, hiding
   * rows that fail. `range` (default: current selection) bounds which rows are
   * considered and the column is absolute. Hidden rows are restored by
   * {@link clearFilter}. Undoable.
   */
  applyFilter(
    column: number,
    predicate: (value: CellValue, row: CellValue[]) => boolean,
    range?: CellRange,
  ): void {
    const target = range ?? this.grid.getRange();
    const sheet = this.api.getActiveSheet();
    const rows = this.readBlock(target);
    const { hidden } = filterRows(rows, column - target.left, predicate);
    const hiddenRows = hidden.map((i) => target.top + i);
    // Snapshot prior row-hidden state so undo restores it exactly.
    const prevHidden = new Map<number, boolean | undefined>();
    for (const r of hiddenRows) prevHidden.set(r, sheet.rows?.[r]?.hidden);
    this.history.push({
      label: 'Filter',
      redo: () => {
        for (const r of hiddenRows) {
          (sheet.rows ??= {})[r] = { ...sheet.rows?.[r], hidden: true };
        }
        this.grid.update({});
      },
      undo: () => {
        for (const r of hiddenRows) {
          const prev = prevHidden.get(r);
          if (prev === undefined) {
            if (sheet.rows?.[r]) delete sheet.rows[r].hidden;
          } else {
            (sheet.rows ??= {})[r] = { ...sheet.rows?.[r], hidden: prev };
          }
        }
        this.grid.update({});
      },
    });
  }

  /** Reveal every row of the active sheet (clears a `applyFilter` hide). Undoable. */
  clearFilter(): void {
    const sheet = this.api.getActiveSheet();
    const hiddenRows = Object.entries(sheet.rows ?? {})
      .filter(([, dim]) => dim.hidden)
      .map(([k]) => Number(k));
    if (hiddenRows.length === 0) return;
    this.history.push({
      label: 'Clear filter',
      redo: () => {
        for (const r of hiddenRows) if (sheet.rows?.[r]) delete sheet.rows[r].hidden;
        this.grid.update({});
      },
      undo: () => {
        for (const r of hiddenRows) (sheet.rows ??= {})[r] = { ...sheet.rows?.[r], hidden: true };
        this.grid.update({});
      },
    });
  }

  /** Read a range into a 2D block of values (row-major). */
  private readBlock(range: CellRange): CellValue[][] {
    const out: CellValue[][] = [];
    for (let r = range.top; r <= range.bottom; r++) {
      const row: CellValue[] = [];
      for (let c = range.left; c <= range.right; c++) {
        row.push(this.api.getValue(this.refOf({ row: r, col: c })));
      }
      out.push(row);
    }
    return out;
  }

  /** Write a 2D block of values back over a range (top-left anchored). */
  private writeBlock(range: CellRange, block: CellValue[][]): void {
    block.forEach((row, i) => {
      row.forEach((v, j) => {
        this.api.setValue(this.refOf({ row: range.top + i, col: range.left + j }), v);
      });
    });
  }

  /* ── embedded charts ────────────────────────────────────────────────── */

  /**
   * Insert a chart built from a range of data (defaults to the current
   * selection), mounted as a floating object over the grid. The first
   * text column becomes the category axis and each numeric column a series (a
   * textual first row supplies series names). Returns the live `Chart` widget so
   * callers can reconfigure it; remove it with {@link removeChart}.
   */
  insertChart(range?: CellRange, options: EmbeddedChartOptions = {}): Chart {
    const target = range ?? this.grid.getRange();
    const block = this.readBlock(target);
    const host = createEl('div', {
      className: 'jects-ss__chart',
      attrs: { role: 'group', 'aria-label': 'Embedded chart' },
    });
    // Float over the grid; position roughly below the source range.
    host.style.position = 'absolute';
    host.style.left = '24px';
    host.style.top = '24px';
    host.style.zIndex = '5';
    this.gridHost.style.position ||= 'relative';
    this.gridHost.appendChild(host);
    const chart = createEmbeddedChart(host, block, options);
    const embedded: EmbeddedChart = { chart, host, range: { ...target } };
    this.charts.push(embedded);
    return chart;
  }

  /** The live embedded chart widgets, in insertion order. */
  getCharts(): Chart[] {
    return this.charts.map((c) => c.chart);
  }

  /** Remove an embedded chart (destroying the widget + its host). */
  removeChart(chart: Chart): void {
    const i = this.charts.findIndex((c) => c.chart === chart);
    if (i < 0) return;
    const [removed] = this.charts.splice(i, 1);
    removed!.chart.destroy();
    removed!.host.remove();
  }

  /* ── helpers ────────────────────────────────────────────────────────── */

  /** The driving API (engine seam). */
  getApi(): SpreadsheetApi {
    return this.api;
  }

  /** The cell grid surface. */
  getGrid(): CellGrid {
    return this.grid;
  }

  private refOf(addr: CellAddress): CellRef {
    return { sheet: this.api.getActiveSheet().id, row: addr.row, col: addr.col };
  }

  private snapshotRange(range: CellRange): Map<string, ReturnType<typeof clone>> {
    const snap = new Map<string, ReturnType<typeof clone>>();
    for (const addr of iterateRange(range)) {
      snap.set(`${addr.row},${addr.col}`, clone(this.api.getCell(this.refOf(addr))));
    }
    return snap;
  }

  private restoreRange(range: CellRange, snap: Map<string, ReturnType<typeof clone>>): void {
    for (const addr of iterateRange(range)) {
      this.restoreCell(this.refOf(addr), snap.get(`${addr.row},${addr.col}`) ?? null);
    }
  }

  private refreshAll(): void {
    this.grid.update({});
    this.tabs?.update({});
    this.refreshChrome();
    this.syncFormulaBar(this.grid.getActive());
  }

  private refreshChrome(): void {
    this.grid.update({});
    this.toolbar?.update({
      items: TOOLBAR_ITEMS.map((it) =>
        it.id === 'undo'
          ? { ...it, disabled: !this.canUndo() }
          : it.id === 'redo'
            ? { ...it, disabled: !this.canRedo() }
            : it,
      ),
    });
  }

  override destroy(): void {
    if (this.isDestroyed) return;
    for (const d of this.subscriptions ?? []) d();
    for (const c of this.charts ?? []) {
      c.chart.destroy();
      c.host.remove();
    }
    this.toolbar?.destroy();
    this.formulaBar?.destroy();
    this.grid?.destroy();
    this.tabs?.destroy();
    super.destroy();
  }
}

/* ── module-local utils ───────────────────────────────────────────────────── */

/**
 * A conditional-format rule as supplied to `addConditionalFormat` — the same as
 * a `CfRule` but without the `range` (which the method derives from the target
 * selection / argument).
 */
export type CfRuleInput =
  | Omit<Extract<CfRule, { kind: 'cellValue' }>, 'range'>
  | Omit<Extract<CfRule, { kind: 'colorScale' }>, 'range'>
  | Omit<Extract<CfRule, { kind: 'dataBar' }>, 'range'>
  | Omit<Extract<CfRule, { kind: 'expression' }>, 'range'>;

/** Convert a selection `CellRange` into the contract's `CfRange` shape. */
function cfRangeFrom(range: CellRange): CfRange {
  return { top: range.top, left: range.left, bottom: range.bottom, right: range.right };
}

/** A mounted floating chart object + its source range and host element. */
interface EmbeddedChart {
  chart: Chart;
  host: HTMLElement;
  range: CellRange;
}

/** A deep-cloned cell model snapshot (or `null` for an empty cell). */
type CellSnapshot = CellModel | null;

/** Deep-clone a cell model for the undo stack; `undefined` collapses to `null`. */
function clone(v: CellModel | undefined): CellSnapshot {
  return v === undefined ? null : (JSON.parse(JSON.stringify(v)) as CellSnapshot);
}

/**
 * Build a `WorkbookModel` from a partial `sheets` array (the `{ sheets }`
 * convenience config). Fills in stable ids, names, and a default 100×26 grid;
 * the first sheet is activated. Returns `undefined` when no sheets were given.
 */
function workbookFromSheets(
  sheets: Array<Partial<SheetModel>> | undefined,
): WorkbookModel | undefined {
  if (!sheets || sheets.length === 0) return undefined;
  const built: SheetModel[] = sheets.map((s, i) => ({
    id: s.id ?? `sheet-${i + 1}`,
    name: s.name ?? `Sheet${i + 1}`,
    cells: s.cells ?? {},
    rowCount: s.rowCount ?? 100,
    colCount: s.colCount ?? 26,
    ...(s.rows ? { rows: s.rows } : {}),
    ...(s.cols ? { cols: s.cols } : {}),
    ...(s.merges ? { merges: s.merges } : {}),
    ...(s.frozen ? { frozen: s.frozen } : {}),
    ...(s.tabColorToken ? { tabColorToken: s.tabColorToken } : {}),
    ...(s.hidden ? { hidden: s.hidden } : {}),
  }));
  return { sheets: built, activeSheet: built[0]!.id, calcMode: 'auto' };
}

function bind(
  el: HTMLElement,
  evt: keyof HTMLElementEventMap,
  fn: (e: Event) => void,
): () => void {
  el.addEventListener(evt, fn);
  return () => el.removeEventListener(evt, fn);
}

register(
  'spreadsheet',
  Spreadsheet as unknown as new (host: HTMLElement | string, config?: Record<string, unknown>) => Spreadsheet,
);
