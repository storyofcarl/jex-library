/**
 * CellGrid — the spreadsheet's cell surface. Renders column headers (A, B, …),
 * row headers (1, 2, …) and a body of addressable cells from a `SheetModel`,
 * driven through `SpreadsheetApi`. Owns selection/range, in-cell editing, fill,
 * merges, and freeze panes. Token-pure CSS; grid a11y roles + keyboard.
 *
 * It is a `Widget` but is normally composed by the top-level `Spreadsheet`
 * widget rather than used standalone. It reads display values from the engine
 * and writes edits back via the API — it never recalculates.
 */

import { Widget, type WidgetConfig, type WidgetEvents, createEl } from '@jects/core';
import type {
  CellAddress,
  CellRef,
  CellValue,
  EvalContext,
  MergeRegion,
  SheetModel,
  SpreadsheetApi,
} from '../contract.js';
import { columnIndexToLabel } from './a1.js';
import {
  addrEquals,
  clampAddress,
  isSingle,
  moveAddress,
  rangeContains,
  rangeOf,
  type CellRange,
  type SelectionState,
} from './selection.js';
import { validate, type ValidationRule } from './validation.js';
import { resolveConditionalFormat } from './conditional-format.js';

const DEFAULT_COL_WIDTH = 96;
const DEFAULT_ROW_HEIGHT = 24;
const ROW_HEADER_WIDTH = 48;

/** Min/max clamps for the column-resize drag (Excel-like guard rails). */
const MIN_COL_WIDTH = 24;
const MAX_COL_WIDTH = 2000;
/** Min/max clamps for the row-resize drag. */
const MIN_ROW_HEIGHT = 16;
const MAX_ROW_HEIGHT = 800;
/** Thickness (px) of the row-resize hit-area at the row header's bottom edge. */
const ROW_RESIZER_SIZE = 6;

export interface CellGridConfig extends WidgetConfig {
  /** The driving API (engine seam). Required. */
  api: SpreadsheetApi;
  /** Default column width in px. */
  colWidth?: number;
  /** Default row height in px. */
  rowHeight?: number;
  /** Max columns to render (the addressable grid may be larger). */
  maxCols?: number;
  /** Max rows to render. */
  maxRows?: number;
  /**
   * Resolve the data-validation rule attached to a sheet-local cell, if any.
   * Wired by the owning `Spreadsheet` from its `ValidationStore`. Drives both
   * commit-time enforcement (invalid input is vetoed) and the `<select>` editor
   * rendered for `list` rules.
   */
  getValidation?: (address: CellAddress) => ValidationRule | undefined;
  /**
   * Show the column-header sort/filter affordance (a small menu button in each
   * column header that emits `headerAction`). Default `false` — the owning
   * `Spreadsheet` opts in.
   */
  headerMenu?: boolean;
  /**
   * Enable interactive column resizing: a drag handle on each column header's
   * right edge. Default `true`. Resizing emits `columnResize` and persists the
   * width onto the sheet's `cols[c].size`.
   */
  columnResize?: boolean;
  /**
   * Enable interactive row resizing: a drag handle on each row header's bottom
   * edge. Default `true`. Resizing emits `rowResize` and persists the height
   * onto the sheet's `rows[r].size`.
   */
  rowResize?: boolean;
  /**
   * Show the row-header multi-select affordance: a checkbox in each row header
   * (and a "select all" checkbox in the corner) with ctrl/shift range support.
   * Default `true`. Toggling emits `rowSelectionChange`.
   */
  rowSelect?: boolean;
}

export interface CellGridEvents extends WidgetEvents {
  /** The active cell / range changed. */
  selectionChange: { active: CellAddress; range: CellRange };
  /** An in-cell edit committed (input string the user typed). */
  cellCommit: { address: CellAddress; input: string };
  /** A cell was activated for editing. */
  editStart: { address: CellAddress };
  /** A request to fill from the current selection by `extra` rows downward. */
  fillRequest: { range: CellRange };
  /**
   * A drag-fill from the active cell into `target` (the dragged-over cell). The
   * owning `Spreadsheet` extends the source block to fill the swept range.
   */
  fillDrag: { source: CellRange; target: CellAddress };
  /** An in-cell edit was rejected (validation or protection). */
  editRejected: { address: CellAddress; reason: 'validation' | 'protected'; message?: string };
  /** A column-header sort/filter affordance was activated. */
  headerAction: { col: number; action: 'sortAsc' | 'sortDesc' | 'filter' };
  /** A column finished resizing (drag or keyboard). `width` is the committed px. */
  columnResize: { col: number; width: number; oldWidth: number };
  /** A row finished resizing (drag or keyboard). `height` is the committed px. */
  rowResize: { row: number; height: number; oldHeight: number };
  /** The set of fully-selected rows (via the row-header checkboxes) changed. */
  rowSelectionChange: { rows: number[] };
}

export class CellGrid extends Widget<CellGridConfig, CellGridEvents> {
  private declare selection: SelectionState;
  private declare editing: {
    address: CellAddress;
    input: HTMLInputElement | HTMLSelectElement;
  } | null;
  private declare bodyEl: HTMLElement;
  private declare headerRowEl: HTMLElement;
  private declare dragging: boolean;
  /** Set while dragging the fill-handle; the anchor the fill extends from. */
  private declare filling: CellAddress | null;
  /**
   * Owns every manually-attached DOM listener: the root `keydown`, the per-render
   * cell/editor/fill-handle listeners, and the window-level drag `mouseup`.
   * Aborting it in `destroy()` removes them all in one shot — crucially the
   * window `mouseup`, which is otherwise only removed on mouseup and would leak
   * (keeping the widget + its closures alive) if the grid is destroyed mid-drag.
   */
  private declare listeners: AbortController;
  /**
   * Live header drag-resize session (column or row), or `null` when idle. The
   * preview is applied to the live header/cell DOM on pointer-move; the model is
   * persisted + the event emitted on pointer-up. Registered listeners are torn
   * down via `dragSizeCleanup` (also aborted by `listeners` on destroy).
   */
  private declare sizeDrag:
    | {
        axis: 'col' | 'row';
        index: number;
        start: number;
        startSize: number;
        oldSize: number;
        pointerId: number;
      }
    | null;
  private declare sizeDragCleanup: (() => void) | null;
  /**
   * Fully-selected rows (via the row-header checkboxes), plus the anchor row for
   * shift-range extension. Distinct from the cell-range selection so a user can
   * select whole rows independently.
   */
  private declare rowSelection: Set<number>;
  private declare rowSelectAnchor: number | null;

  protected override defaults(): Partial<CellGridConfig> {
    return {
      colWidth: DEFAULT_COL_WIDTH,
      rowHeight: DEFAULT_ROW_HEIGHT,
      maxCols: 26,
      maxRows: 100,
      columnResize: true,
      rowResize: true,
      rowSelect: true,
    };
  }

  protected buildEl(): HTMLElement {
    this.selection = { active: { row: 0, col: 0 }, anchor: { row: 0, col: 0 } };
    this.editing = null;
    this.dragging = false;
    this.filling = null;
    this.sizeDrag = null;
    this.sizeDragCleanup = null;
    this.rowSelection = new Set();
    this.rowSelectAnchor = null;
    this.listeners = new AbortController();
    const root = createEl('div', {
      className: 'jects-sheet',
      attrs: { role: 'grid', tabindex: '0', 'aria-label': 'Spreadsheet cells' },
    });
    // Valid ARIA grid hierarchy: grid > rowgroup > row > {columnheader|gridcell}.
    // The header lives in its own rowgroup; the body is a rowgroup of data rows.
    const headGroup = createEl('div', { className: 'jects-sheet__headgroup', attrs: { role: 'rowgroup' } });
    this.headerRowEl = createEl('div', { className: 'jects-sheet__head', attrs: { role: 'row' } });
    headGroup.appendChild(this.headerRowEl);
    this.bodyEl = createEl('div', { className: 'jects-sheet__body', attrs: { role: 'rowgroup' } });
    root.append(headGroup, this.bodyEl);
    root.addEventListener('keydown', (e) => this.onKeyDown(e), { signal: this.listeners.signal });
    return root;
  }

  /** AbortSignal every manually-attached listener is registered against. */
  private get sig(): AbortSignal {
    return this.listeners.signal;
  }

  override destroy(): void {
    if (this.isDestroyed) return;
    // Remove every manual listener (root keydown, per-cell handlers, and any
    // in-flight window 'mouseup' from an interrupted drag) before teardown.
    this.listeners.abort();
    this.sizeDragCleanup?.();
    this.sizeDragCleanup = null;
    this.sizeDrag = null;
    this.dragging = false;
    this.editing = null;
    super.destroy();
  }

  /* ── public surface ─────────────────────────────────────────────────── */

  /** The current active cell address. */
  getActive(): CellAddress {
    return { ...this.selection.active };
  }

  /** The current selection rectangle. */
  getRange(): CellRange {
    return rangeOf(this.selection);
  }

  /** Whether the selection is a single cell. */
  isSingleSelection(): boolean {
    return isSingle(this.selection);
  }

  /** Set the active cell (collapsing the range). */
  setActive(addr: CellAddress, extend = false): void {
    const { rowCount, colCount } = this.dims();
    const clamped = clampAddress(addr, rowCount, colCount);
    this.selection.active = clamped;
    if (!extend) this.selection.anchor = { ...clamped };
    this.render();
    this.emitSelection();
  }

  /* ── column / row sizing (public surface) ──────────────────────────────── */

  /**
   * Resize column `col` to `width` px (clamped), persisting it onto the sheet's
   * `cols[col].size`, repainting, and emitting `columnResize`. The programmatic
   * entry point the drag handler and external callers share.
   */
  resizeColumn(col: number, width: number): number {
    const sheet = this.config.api.getActiveSheet();
    const oldWidth = sheet.cols?.[col]?.size ?? this.config.colWidth ?? DEFAULT_COL_WIDTH;
    const w = clampSize(width, MIN_COL_WIDTH, MAX_COL_WIDTH);
    (sheet.cols ??= {})[col] = { ...sheet.cols?.[col], size: w };
    this.render();
    this.emit('columnResize', { col, width: w, oldWidth });
    return w;
  }

  /**
   * Resize row `row` to `height` px (clamped, uniform per-row), persisting it
   * onto the sheet's `rows[row].size`, repainting, and emitting `rowResize`.
   */
  resizeRow(row: number, height: number): number {
    const sheet = this.config.api.getActiveSheet();
    const oldHeight = sheet.rows?.[row]?.size ?? this.config.rowHeight ?? DEFAULT_ROW_HEIGHT;
    const h = clampSize(height, MIN_ROW_HEIGHT, MAX_ROW_HEIGHT);
    (sheet.rows ??= {})[row] = { ...sheet.rows?.[row], size: h };
    this.render();
    this.emit('rowResize', { row, height: h, oldHeight });
    return h;
  }

  /* ── row multi-selection (public surface) ──────────────────────────────── */

  /** The fully-selected row indices, ascending. */
  getSelectedRows(): number[] {
    return [...this.rowSelection].sort((a, b) => a - b);
  }

  /** Replace the selected-row set (clears the anchor), repaint, and emit. */
  setSelectedRows(rows: number[]): void {
    this.rowSelection = new Set(rows);
    this.rowSelectAnchor = rows.length > 0 ? rows[rows.length - 1]! : null;
    this.render();
    this.emitRowSelection();
  }

  /** Whether every addressable row is currently selected. */
  isAllRowsSelected(): boolean {
    const { rowCount } = this.dims();
    if (rowCount === 0) return false;
    if (this.rowSelection.size < rowCount) return false;
    for (let r = 0; r < rowCount; r++) if (!this.rowSelection.has(r)) return false;
    return true;
  }

  /** Select (or clear) every addressable row — the "select all" affordance. */
  toggleAllRows(select?: boolean): void {
    const { rowCount } = this.dims();
    const want = select ?? !this.isAllRowsSelected();
    this.rowSelection = new Set();
    if (want) for (let r = 0; r < rowCount; r++) this.rowSelection.add(r);
    this.rowSelectAnchor = want && rowCount > 0 ? rowCount - 1 : null;
    this.render();
    this.emitRowSelection();
  }

  /** Begin editing the active cell, optionally seeding the input. */
  startEdit(seed?: string): void {
    const addr = this.selection.active;
    const cellEl = this.cellElAt(addr.row, addr.col);
    if (!cellEl) return;
    // Protected, locked cells cannot be edited at all (Excel "Protect Sheet").
    if (this.isProtected(addr)) {
      this.emit('editRejected', { address: { ...addr }, reason: 'protected' });
      this.config.api.events.emit('editRejected', {
        ref: this.refOf(addr),
        reason: 'protected',
      });
      return;
    }
    const api = this.config.api;
    const ref = this.refOf(addr);
    const rule = this.config.getValidation?.(addr);

    // A `list` validation rule renders a native <select> dropdown editor — the
    // enterprise data-validation dropdown affordance.
    if (rule?.kind === 'list') {
      const select = createEl('select', {
        className: 'jects-sheet__editor jects-sheet__editor--select',
        attrs: { 'aria-label': 'Cell value (validated list)' },
      }) as HTMLSelectElement;
      const current = api.getFormula(ref) ?? this.rawText(ref);
      if (rule.allowBlank !== false) {
        const blank = createEl('option', { attrs: { value: '' }, text: '' });
        select.appendChild(blank);
      }
      for (const v of rule.values) {
        const opt = createEl('option', { attrs: { value: v }, text: v }) as HTMLOptionElement;
        if (v === current) opt.selected = true;
        select.appendChild(opt);
      }
      cellEl.textContent = '';
      cellEl.appendChild(select);
      select.focus();
      select.addEventListener('keydown', (e) => this.onEditorKey(e), { signal: this.sig });
      select.addEventListener('change', () => this.commitEdit('down'), { signal: this.sig });
      select.addEventListener('blur', () => this.commitEdit(), { signal: this.sig });
      this.editing = { address: { ...addr }, input: select };
      this.emit('editStart', { address: { ...addr } });
      return;
    }

    const initial = seed ?? api.getFormula(ref) ?? this.rawText(ref);
    const input = createEl('input', {
      className: 'jects-sheet__editor',
      attrs: { type: 'text', 'aria-label': 'Cell editor' },
    });
    input.value = initial;
    cellEl.textContent = '';
    cellEl.appendChild(input);
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
    input.addEventListener('keydown', (e) => this.onEditorKey(e), { signal: this.sig });
    input.addEventListener('blur', () => this.commitEdit(), { signal: this.sig });
    this.editing = { address: { ...addr }, input };
    this.emit('editStart', { address: { ...addr } });
  }

  /** Commit the active edit. */
  commitEdit(advance: 'down' | 'right' | 'none' = 'none'): void {
    if (!this.editing) return;
    const { address, input } = this.editing;
    const value = input.value;
    const ref = this.refOf(address);

    // Protection veto: a locked cell on a protected sheet rejects the edit.
    if (this.isProtected(address)) {
      this.editing = null;
      this.render();
      this.emit('editRejected', { address, reason: 'protected' });
      this.config.api.events.emit('editRejected', { ref, reason: 'protected' });
      return;
    }

    // Validation veto: enforce the cell's rule (if any) on the *parsed* value, so
    // numeric/list/text rules reject before the write reaches the engine.
    const rule = this.config.getValidation?.(address);
    if (rule && !value.startsWith('=')) {
      const result = validate(rule, parseForValidation(value));
      if (!result.valid) {
        this.editing = null;
        this.render();
        const payload = result.message !== undefined
          ? { address, reason: 'validation' as const, message: result.message }
          : { address, reason: 'validation' as const };
        this.emit('editRejected', payload);
        this.config.api.events.emit(
          'editRejected',
          result.message !== undefined
            ? { ref, reason: 'validation', message: result.message }
            : { ref, reason: 'validation' },
        );
        return;
      }
    }

    this.editing = null;
    this.config.api.setCellInput(ref, value);
    this.emit('cellCommit', { address, input: value });
    this.render();
    if (advance === 'down') this.setActive(moveAddress(address, 1, 0, ...this.dimsTuple()));
    else if (advance === 'right') this.setActive(moveAddress(address, 0, 1, ...this.dimsTuple()));
  }

  /** Whether a cell is edit-locked: its sheet is protected and the cell is locked. */
  private isProtected(addr: CellAddress): boolean {
    const sheet = this.config.api.getActiveSheet();
    if (!sheet.protected) return false;
    const cell = sheet.cells[`${addr.row},${addr.col}`];
    // Excel semantics: cells are locked by default; only `locked === false` is open.
    return cell?.locked !== false;
  }

  /** Abandon the active edit. */
  cancelEdit(): void {
    if (!this.editing) return;
    this.editing = null;
    this.render();
  }

  /** Whether an edit is in progress. */
  isEditing(): boolean {
    return this.editing !== null;
  }

  /* ── rendering ──────────────────────────────────────────────────────── */

  protected override render(): void {
    if (!this.bodyEl) return;
    const api = this.config.api;
    const sheet = api.getActiveSheet();
    const { rowCount, colCount } = this.dims();
    const colW = this.config.colWidth ?? DEFAULT_COL_WIDTH;
    const rowH = this.config.rowHeight ?? DEFAULT_ROW_HEIGHT;
    const frozen = sheet.frozen ?? { rows: 0, cols: 0 };
    const range = rangeOf(this.selection);

    // header
    this.headerRowEl.textContent = '';
    const corner = createEl('div', { className: 'jects-sheet__corner', attrs: { role: 'columnheader' } });
    corner.style.width = `${ROW_HEADER_WIDTH}px`;
    if (this.config.rowSelect) this.appendSelectAll(corner);
    this.headerRowEl.appendChild(corner);
    for (let c = 0; c < colCount; c++) {
      const w = sheet.cols?.[c]?.size ?? colW;
      const hidden = sheet.cols?.[c]?.hidden;
      const th = createEl('div', {
        className: [
          'jects-sheet__colhead',
          c < frozen.cols ? 'jects-sheet__colhead--frozen' : '',
          range.left <= c && c <= range.right ? 'jects-sheet__colhead--active' : '',
        ],
        text: columnIndexToLabel(c),
        attrs: { role: 'columnheader', 'data-col': String(c) },
      });
      th.style.width = `${hidden ? 0 : w}px`;
      if (hidden) th.style.display = 'none';
      if (this.config.headerMenu && !hidden) this.appendHeaderMenu(th, c);
      if (this.config.columnResize && !hidden) this.appendColResizer(th, c);
      this.headerRowEl.appendChild(th);
    }

    // body rows
    this.bodyEl.textContent = '';
    const merges = sheet.merges ?? [];
    const covered = this.coveredCells(merges);
    for (let r = 0; r < rowCount; r++) {
      const hiddenRow = sheet.rows?.[r]?.hidden;
      const rowEl = createEl('div', {
        className: ['jects-sheet__row', r < frozen.rows ? 'jects-sheet__row--frozen' : ''],
        attrs: { role: 'row', 'aria-rowindex': String(r + 1) },
      });
      const h = sheet.rows?.[r]?.size ?? rowH;
      rowEl.style.height = `${hiddenRow ? 0 : h}px`;
      if (hiddenRow) rowEl.style.display = 'none';

      const rowSelected = this.rowSelection.has(r);
      const rowHead = createEl('div', {
        className: [
          'jects-sheet__rowhead',
          range.top <= r && r <= range.bottom ? 'jects-sheet__rowhead--active' : '',
          rowSelected ? 'jects-sheet__rowhead--selected' : '',
        ],
        attrs: { role: 'rowheader', 'data-row': String(r) },
      });
      rowHead.style.width = `${ROW_HEADER_WIDTH}px`;
      if (this.config.rowSelect) this.appendRowSelect(rowHead, r, rowSelected);
      const rowLabel = createEl('span', {
        className: 'jects-sheet__rowhead-label',
        text: String(r + 1),
        attrs: { 'aria-hidden': 'true' },
      });
      rowHead.appendChild(rowLabel);
      if (this.config.rowResize && !hiddenRow) this.appendRowResizer(rowHead, r);
      rowEl.appendChild(rowHead);

      for (let c = 0; c < colCount; c++) {
        if (covered.has(`${r},${c}`)) continue; // merged-away cell
        const w = sheet.cols?.[c]?.size ?? colW;
        if (sheet.cols?.[c]?.hidden) continue;
        const cellEl = this.buildCell(sheet, r, c, range);
        const merge = merges.find((m) => m.row === r && m.col === c);
        if (merge) {
          let spanW = 0;
          for (let cc = c; cc < c + merge.colSpan; cc++) spanW += sheet.cols?.[cc]?.size ?? colW;
          cellEl.style.width = `${spanW}px`;
          cellEl.style.height = `${this.spanHeight(sheet, r, merge, rowH)}px`;
          cellEl.classList.add('jects-sheet__cell--merged');
        } else {
          cellEl.style.width = `${w}px`;
        }
        rowEl.appendChild(cellEl);
      }
      this.bodyEl.appendChild(rowEl);
    }

    // Announce the active cell to assistive tech: point the grid's
    // aria-activedescendant at the active gridcell's stable id so screen readers
    // report the current cell as the user arrows around.
    this.syncActiveDescendant();
  }

  /**
   * Keep `aria-activedescendant` on the grid root pointed at the active cell and
   * move DOM focus to it (roving tabindex) — but only when focus is already
   * within the grid, so re-renders never steal focus from elsewhere.
   */
  private syncActiveDescendant(): void {
    const a = this.selection.active;
    const id = this.cellId(a.row, a.col);
    const root = this.el as HTMLElement;
    root.setAttribute('aria-activedescendant', id);
    const cellEl = this.cellElAt(a.row, a.col);
    if (!cellEl) return;
    const active = document.activeElement;
    const focusInside = active === root || (active instanceof Node && root.contains(active));
    if (focusInside && !this.editing) {
      cellEl.focus();
    }
  }

  /** Stable per-cell DOM id used for aria-activedescendant targeting. */
  private cellId(row: number, col: number): string {
    return `${this.id}-cell-${row}-${col}`;
  }

  private buildCell(sheet: SheetModel, r: number, c: number, range: CellRange): HTMLElement {
    const api = this.config.api;
    const ref = this.refOf({ row: r, col: c });
    const model = sheet.cells[`${r},${c}`];
    const display = api.getDisplayValue(ref);
    const active = addrEquals(this.selection.active, { row: r, col: c });
    const inRange = rangeContains(range, r, c);
    const cellEl = createEl('div', {
      className: [
        'jects-sheet__cell',
        active ? 'jects-sheet__cell--active' : '',
        inRange && !active ? 'jects-sheet__cell--range' : '',
        model?.formula ? 'jects-sheet__cell--formula' : '',
      ],
      attrs: {
        id: this.cellId(r, c),
        role: 'gridcell',
        'data-row': String(r),
        'data-col': String(c),
        'aria-colindex': String(c + 1),
        'aria-selected': inRange ? 'true' : 'false',
        // Roving tabindex: the active cell is the single tab stop; others are -1.
        tabindex: active ? '0' : '-1',
      },
    });
    // Conditional formatting: resolve the decoration for this cell and merge its
    // style patch over the cell's own style (later rules paint on top).
    const deco = this.resolveCf(sheet, r, c);
    const st = deco?.style ? { ...model?.style, ...deco.style } : model?.style;
    if (st) {
      if (st.bold) cellEl.classList.add('jects-sheet__cell--bold');
      if (st.italic) cellEl.classList.add('jects-sheet__cell--italic');
      if (st.underline) cellEl.classList.add('jects-sheet__cell--underline');
      if (st.strikethrough) cellEl.classList.add('jects-sheet__cell--strike');
      if (st.wrap) cellEl.classList.add('jects-sheet__cell--wrap');
      if (st.align) cellEl.style.textAlign = st.align === 'start' ? 'left' : st.align === 'end' ? 'right' : 'center';
      if (st.colorToken) cellEl.style.color = `oklch(var(${st.colorToken}))`;
      if (st.backgroundToken) cellEl.style.backgroundColor = `oklch(var(${st.backgroundToken}))`;
      if (st.borders) {
        const b = st.borders;
        const line = '1px solid oklch(var(--jects-border))';
        if (b.top) cellEl.style.borderTop = line;
        if (b.right) cellEl.style.borderRight = line;
        if (b.bottom) cellEl.style.borderBottom = line;
        if (b.left) cellEl.style.borderLeft = line;
      }
    }
    // colorScale background (overrides a style background, by design).
    if (deco?.backgroundToken) {
      cellEl.classList.add('jects-sheet__cell--cf-scale');
      cellEl.style.backgroundColor = `oklch(var(${deco.backgroundToken}))`;
    }
    cellEl.textContent = display;
    // dataBar: an in-cell horizontal bar proportional to the value.
    if (deco?.dataBar) {
      const bar = createEl('div', {
        className: 'jects-sheet__cell-databar',
        attrs: { 'aria-hidden': 'true' },
      });
      bar.style.width = `${Math.round(deco.dataBar.fraction * 100)}%`;
      bar.style.backgroundColor = `oklch(var(${deco.dataBar.colorToken}))`;
      cellEl.appendChild(bar);
    }
    // Comment indicator + protected marker.
    if (model?.comment) {
      cellEl.classList.add('jects-sheet__cell--comment');
      cellEl.title = model.comment;
      cellEl.setAttribute('aria-description', model.comment);
      const flag = createEl('div', {
        className: 'jects-sheet__cell-comment',
        attrs: { 'aria-hidden': 'true' },
      });
      cellEl.appendChild(flag);
    }
    if (sheet.protected && model?.locked !== false) {
      cellEl.classList.add('jects-sheet__cell--locked');
      cellEl.setAttribute('aria-readonly', 'true');
    }
    // active cell gets a fill handle
    if (active) {
      const handle = createEl('div', {
        className: 'jects-sheet__fill-handle',
        attrs: { 'aria-hidden': 'true' },
      });
      handle.addEventListener(
        'mousedown',
        (e) => {
          e.stopPropagation();
          e.preventDefault();
          // Begin a fill-handle drag from the current selection. `fillRequest`
          // keeps the legacy one-shot behaviour for callers/tests; the drag is
          // resolved on mouseup via `fillDrag`.
          this.filling = { ...this.selection.active };
          this.emit('fillRequest', { range: rangeOf(this.selection) });
          const up = (): void => {
            window.removeEventListener('mouseup', up);
            const target = this.selection.active;
            const source = this.filling;
            this.filling = null;
            if (source) this.emit('fillDrag', { source: rangeOf(this.selection), target });
          };
          window.addEventListener('mouseup', up, { signal: this.sig });
        },
        { signal: this.sig },
      );
      cellEl.appendChild(handle);
    }
    cellEl.addEventListener('mousedown', (e) => this.onCellMouseDown(e, r, c), { signal: this.sig });
    cellEl.addEventListener('mouseenter', (e) => this.onCellMouseEnter(e, r, c), { signal: this.sig });
    cellEl.addEventListener(
      'dblclick',
      () => {
        this.setActive({ row: r, col: c });
        this.startEdit();
      },
      { signal: this.sig },
    );
    return cellEl;
  }

  /* ── interaction ────────────────────────────────────────────────────── */

  private onCellMouseDown(e: MouseEvent, r: number, c: number): void {
    if (this.editing) this.commitEdit();
    if (e.shiftKey) {
      this.selection.active = clampAddress({ row: r, col: c }, ...this.dimsTuple());
    } else {
      this.selection.active = { row: r, col: c };
      this.selection.anchor = { row: r, col: c };
    }
    this.dragging = true;
    // Registered against the widget's AbortController so a destroy mid-drag (or
    // the next render) removes it even if the user never releases over the window.
    const up = (): void => {
      this.dragging = false;
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mouseup', up, { signal: this.sig });
    this.render();
    this.emitSelection();
    (this.el as HTMLElement).focus();
  }

  private onCellMouseEnter(_e: MouseEvent, r: number, c: number): void {
    // Extend either a selection drag or a fill-handle drag by moving the active
    // cell while keeping the anchor (so `rangeOf` sweeps out the filled extent).
    if (!this.dragging && !this.filling) return;
    this.selection.active = clampAddress({ row: r, col: c }, ...this.dimsTuple());
    this.render();
    this.emitSelection();
  }

  /**
   * Append the column-header sort/filter affordance: a small popover with
   * ascending/descending sort + a filter trigger. Each choice emits
   * `headerAction` for the owning widget to act on.
   */
  private appendHeaderMenu(th: HTMLElement, col: number): void {
    const btn = createEl('button', {
      className: 'jects-sheet__colmenu',
      attrs: { type: 'button', 'aria-label': `Sort or filter column ${columnIndexToLabel(col)}` },
      text: '▾', // ▾
    }) as HTMLButtonElement;
    const fire = (action: 'sortAsc' | 'sortDesc' | 'filter') => (e: Event): void => {
      e.stopPropagation();
      this.emit('headerAction', { col, action });
    };
    // The button cycles asc → desc on plain click; alt/shift-click filters. This
    // keeps it keyboard- and pointer-reachable without a floating popover layer.
    let descNext = false;
    btn.addEventListener(
      'click',
      (e) => {
        e.stopPropagation();
        if (e.altKey || e.shiftKey) {
          fire('filter')(e);
          return;
        }
        fire(descNext ? 'sortDesc' : 'sortAsc')(e);
        descNext = !descNext;
      },
      { signal: this.sig },
    );
    th.appendChild(btn);
  }

  /* ── column resize affordance ──────────────────────────────────────────── */

  /**
   * Append a thin drag handle pinned to the column header's right edge. Pointer
   * drag live-previews the width on the header (the body re-flows on commit) and
   * commits to the model on pointer-up. ArrowLeft/Right nudge by 8px (×4 with
   * Shift) for keyboard operability. The handle carries `role="separator"`.
   */
  private appendColResizer(th: HTMLElement, col: number): void {
    const handle = createEl('div', {
      className: 'jects-sheet__col-resizer',
      attrs: {
        role: 'separator',
        'aria-orientation': 'vertical',
        'aria-label': `Resize column ${columnIndexToLabel(col)}`,
        tabindex: '0',
        'data-col-resizer': String(col),
      },
    });
    const sheet = this.config.api.getActiveSheet();
    const w = sheet.cols?.[col]?.size ?? this.config.colWidth ?? DEFAULT_COL_WIDTH;
    handle.setAttribute('aria-valuenow', String(Math.round(w)));
    handle.setAttribute('aria-valuemin', String(MIN_COL_WIDTH));
    handle.setAttribute('aria-valuemax', String(MAX_COL_WIDTH));
    handle.addEventListener(
      'pointerdown',
      (e) => this.beginSizeDrag(e, 'col', col, th),
      { signal: this.sig },
    );
    handle.addEventListener(
      'keydown',
      (e) => this.onResizerKey(e, 'col', col),
      { signal: this.sig },
    );
    // Don't let a click on the resizer also trigger a header sort/selection.
    handle.addEventListener('click', (e) => e.stopPropagation(), { signal: this.sig });
    handle.addEventListener('dblclick', (e) => e.stopPropagation(), { signal: this.sig });
    th.appendChild(handle);
  }

  /* ── row resize affordance ─────────────────────────────────────────────── */

  /**
   * Append a thin drag handle pinned to the row header's bottom edge. Pointer
   * drag live-previews the height on the whole row and commits on pointer-up.
   * ArrowUp/Down nudge by 4px (×4 with Shift). `role="separator"`.
   */
  private appendRowResizer(rowHead: HTMLElement, row: number): void {
    const handle = createEl('div', {
      className: 'jects-sheet__row-resizer',
      attrs: {
        role: 'separator',
        'aria-orientation': 'horizontal',
        'aria-label': `Resize row ${row + 1}`,
        tabindex: '0',
        'data-row-resizer': String(row),
      },
    });
    handle.style.height = `${ROW_RESIZER_SIZE}px`;
    const sheet = this.config.api.getActiveSheet();
    const h = sheet.rows?.[row]?.size ?? this.config.rowHeight ?? DEFAULT_ROW_HEIGHT;
    handle.setAttribute('aria-valuenow', String(Math.round(h)));
    handle.setAttribute('aria-valuemin', String(MIN_ROW_HEIGHT));
    handle.setAttribute('aria-valuemax', String(MAX_ROW_HEIGHT));
    handle.addEventListener(
      'pointerdown',
      (e) => this.beginSizeDrag(e, 'row', row, rowHead),
      { signal: this.sig },
    );
    handle.addEventListener(
      'keydown',
      (e) => this.onResizerKey(e, 'row', row),
      { signal: this.sig },
    );
    rowHead.appendChild(handle);
  }

  /**
   * Begin a header drag-resize session for a column or row. Captures the start
   * pointer position + current size, live-previews on pointer-move, and commits
   * on pointer-up. Window listeners are torn down via `sizeDragCleanup` (also
   * aborted by the widget's AbortController on destroy mid-drag).
   */
  private beginSizeDrag(
    e: PointerEvent,
    axis: 'col' | 'row',
    index: number,
    headerEl: HTMLElement,
  ): void {
    e.preventDefault();
    e.stopPropagation();
    if (this.editing) this.commitEdit();
    const sheet = this.config.api.getActiveSheet();
    const startSize =
      axis === 'col'
        ? sheet.cols?.[index]?.size ?? this.config.colWidth ?? DEFAULT_COL_WIDTH
        : sheet.rows?.[index]?.size ?? this.config.rowHeight ?? DEFAULT_ROW_HEIGHT;
    this.sizeDrag = {
      axis,
      index,
      start: axis === 'col' ? e.clientX : e.clientY,
      startSize,
      oldSize: startSize,
      pointerId: e.pointerId,
    };
    headerEl.classList.add(
      axis === 'col' ? 'jects-sheet__colhead--resizing' : 'jects-sheet__rowhead--resizing',
    );
    const target = e.target as HTMLElement;
    try {
      target.setPointerCapture(e.pointerId);
    } catch {
      /* setPointerCapture unsupported (jsdom) — window listeners cover it */
    }
    const onMove = (ev: Event): void => this.onSizeDragMove(ev as PointerEvent);
    const onUp = (ev: Event): void => this.onSizeDragEnd(ev as PointerEvent);
    window.addEventListener('pointermove', onMove, { signal: this.sig });
    window.addEventListener('pointerup', onUp, { signal: this.sig });
    window.addEventListener('pointercancel', onUp, { signal: this.sig });
    this.sizeDragCleanup = (): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }

  /** Live-preview the dragged column width / row height on the painted DOM. */
  private onSizeDragMove(e: PointerEvent): void {
    const drag = this.sizeDrag;
    if (!drag || e.pointerId !== drag.pointerId) return;
    if (drag.axis === 'col') {
      const next = clampSize(
        drag.startSize + (e.clientX - drag.start),
        MIN_COL_WIDTH,
        MAX_COL_WIDTH,
      );
      this.previewColWidth(drag.index, next);
    } else {
      const next = clampSize(
        drag.startSize + (e.clientY - drag.start),
        MIN_ROW_HEIGHT,
        MAX_ROW_HEIGHT,
      );
      this.previewRowHeight(drag.index, next);
    }
  }

  /** Commit the drag-resize to the model (persist + emit), then repaint. */
  private onSizeDragEnd(e: PointerEvent): void {
    const drag = this.sizeDrag;
    if (!drag || e.pointerId !== drag.pointerId) return;
    this.sizeDragCleanup?.();
    this.sizeDragCleanup = null;
    this.sizeDrag = null;
    const delta = (drag.axis === 'col' ? e.clientX : e.clientY) - drag.start;
    if (drag.axis === 'col') this.resizeColumn(drag.index, drag.startSize + delta);
    else this.resizeRow(drag.index, drag.startSize + delta);
  }

  /** Apply a live width preview to a column's header + every painted cell in it. */
  private previewColWidth(col: number, width: number): void {
    const th = this.headerRowEl.querySelector<HTMLElement>(
      `.jects-sheet__colhead[data-col="${col}"]`,
    );
    if (th) th.style.width = `${width}px`;
    const cells = this.bodyEl.querySelectorAll<HTMLElement>(
      `.jects-sheet__cell[data-col="${col}"]:not(.jects-sheet__cell--merged)`,
    );
    cells.forEach((cell) => (cell.style.width = `${width}px`));
  }

  /** Apply a live height preview to a row's element. */
  private previewRowHeight(row: number, height: number): void {
    const rowEl = this.bodyEl.querySelectorAll<HTMLElement>('.jects-sheet__row')[row];
    if (rowEl) rowEl.style.height = `${height}px`;
  }

  /** Keyboard resize on a focused resizer handle (Arrow keys; Shift ×4). */
  private onResizerKey(e: KeyboardEvent, axis: 'col' | 'row', index: number): void {
    e.stopPropagation();
    const sheet = this.config.api.getActiveSheet();
    const factor = e.shiftKey ? 4 : 1;
    if (axis === 'col') {
      const cur = sheet.cols?.[index]?.size ?? this.config.colWidth ?? DEFAULT_COL_WIDTH;
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        this.resizeColumn(index, cur + 8 * factor);
        this.refocusResizer('col', index);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        this.resizeColumn(index, cur - 8 * factor);
        this.refocusResizer('col', index);
      }
    } else {
      const cur = sheet.rows?.[index]?.size ?? this.config.rowHeight ?? DEFAULT_ROW_HEIGHT;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.resizeRow(index, cur + 4 * factor);
        this.refocusResizer('row', index);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        this.resizeRow(index, cur - 4 * factor);
        this.refocusResizer('row', index);
      }
    }
  }

  /** Return keyboard focus to a resizer after a render-replacing keyboard nudge. */
  private refocusResizer(axis: 'col' | 'row', index: number): void {
    const sel = axis === 'col'
      ? `[data-col-resizer="${index}"]`
      : `[data-row-resizer="${index}"]`;
    (this.el as HTMLElement).querySelector<HTMLElement>(sel)?.focus();
  }

  /* ── row multi-selection affordance ────────────────────────────────────── */

  /** Append the "select all rows" checkbox to the grid corner. */
  private appendSelectAll(corner: HTMLElement): void {
    const cb = createEl('input', {
      className: 'jects-sheet__selectall',
      attrs: { type: 'checkbox', 'aria-label': 'Select all rows' },
    }) as HTMLInputElement;
    const all = this.isAllRowsSelected();
    cb.checked = all;
    cb.indeterminate = !all && this.rowSelection.size > 0;
    cb.addEventListener(
      'change',
      () => this.toggleAllRows(cb.checked),
      { signal: this.sig },
    );
    cb.addEventListener('mousedown', (e) => e.stopPropagation(), { signal: this.sig });
    corner.appendChild(cb);
  }

  /**
   * Append a per-row select checkbox to a row header. Plain toggle flips that one
   * row; Shift extends a contiguous range from the anchor; Ctrl/Cmd toggles a
   * single row while keeping the rest. Updates `rowSelection` + emits.
   */
  private appendRowSelect(rowHead: HTMLElement, row: number, selected: boolean): void {
    const cb = createEl('input', {
      className: 'jects-sheet__rowselect',
      attrs: { type: 'checkbox', 'aria-label': `Select row ${row + 1}`, 'data-row-select': String(row) },
    }) as HTMLInputElement;
    cb.checked = selected;
    // Use click (not change) so we can read the modifier keys for range/toggle.
    cb.addEventListener(
      'click',
      (e) => {
        e.stopPropagation();
        this.onRowSelectClick(row, e);
      },
      { signal: this.sig },
    );
    cb.addEventListener('mousedown', (e) => e.stopPropagation(), { signal: this.sig });
    rowHead.appendChild(cb);
  }

  /** Resolve a row-header checkbox click into the new selection (with modifiers). */
  private onRowSelectClick(row: number, e: MouseEvent): void {
    if (e.shiftKey && this.rowSelectAnchor !== null) {
      // Shift-range: select the contiguous block anchor..row (replacing prior set
      // unless Ctrl/Cmd is also held, which unions the range in).
      const lo = Math.min(this.rowSelectAnchor, row);
      const hi = Math.max(this.rowSelectAnchor, row);
      if (!(e.ctrlKey || e.metaKey)) this.rowSelection = new Set();
      for (let r = lo; r <= hi; r++) this.rowSelection.add(r);
    } else if (e.ctrlKey || e.metaKey) {
      // Ctrl/Cmd-toggle a single row, keeping the rest.
      if (this.rowSelection.has(row)) this.rowSelection.delete(row);
      else this.rowSelection.add(row);
      this.rowSelectAnchor = row;
    } else {
      // Plain toggle of this one row.
      if (this.rowSelection.has(row) && this.rowSelection.size === 1) {
        this.rowSelection.delete(row);
        this.rowSelectAnchor = null;
      } else {
        this.rowSelection = new Set([row]);
        this.rowSelectAnchor = row;
      }
    }
    if (e.shiftKey && this.rowSelectAnchor === null) this.rowSelectAnchor = row;
    this.render();
    this.emitRowSelection();
  }

  private emitRowSelection(): void {
    this.emit('rowSelectionChange', { rows: this.getSelectedRows() });
  }

  /**
   * Resolve the conditional-formatting decoration for a cell. Reads computed
   * values through the engine; `expression` rules evaluate against the engine
   * (cell as origin) so a formula like `=A1>5` works.
   */
  private resolveCf(sheet: SheetModel, r: number, c: number) {
    const rules = sheet.conditionalFormats;
    if (!rules || rules.length === 0) return undefined;
    const api = this.config.api;
    const readVal = (row: number, col: number): CellValue =>
      api.getValue({ sheet: sheet.id, row, col });
    const evalExpr = (formula: string, row: number, col: number): CellValue => {
      const src = formula.startsWith('=') ? formula.slice(1) : formula;
      return api.engine.evaluate(src, makeCfEvalContext(api, sheet.id, row, col));
    };
    return resolveConditionalFormat(rules, r, c, readVal(r, c), readVal, evalExpr);
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (this.editing) return; // editor handles its own keys
    const a = this.selection.active;
    const ext = e.shiftKey;
    switch (e.key) {
      case 'ArrowUp':
        e.preventDefault();
        this.setActive(moveAddress(a, -1, 0, ...this.dimsTuple()), ext);
        break;
      case 'ArrowDown':
        e.preventDefault();
        this.setActive(moveAddress(a, 1, 0, ...this.dimsTuple()), ext);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        this.setActive(moveAddress(a, 0, -1, ...this.dimsTuple()), ext);
        break;
      case 'ArrowRight':
        e.preventDefault();
        this.setActive(moveAddress(a, 0, 1, ...this.dimsTuple()), ext);
        break;
      case 'Tab':
        e.preventDefault();
        this.setActive(moveAddress(a, 0, e.shiftKey ? -1 : 1, ...this.dimsTuple()));
        break;
      case 'Enter':
        e.preventDefault();
        this.startEdit();
        break;
      case 'F2':
        e.preventDefault();
        this.startEdit();
        break;
      case 'Delete':
      case 'Backspace':
        e.preventDefault();
        this.deleteSelection();
        break;
      case 'Escape':
        break;
      default:
        // start editing on a printable character
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
          e.preventDefault();
          this.startEdit(e.key);
        }
    }
  }

  private onEditorKey(e: KeyboardEvent): void {
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      this.commitEdit('down');
      (this.el as HTMLElement).focus();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      this.commitEdit('right');
      (this.el as HTMLElement).focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      this.cancelEdit();
      (this.el as HTMLElement).focus();
    }
  }

  /** Clear values in every cell of the current selection (skipping protected cells). */
  deleteSelection(): void {
    const range = rangeOf(this.selection);
    for (let r = range.top; r <= range.bottom; r++)
      for (let c = range.left; c <= range.right; c++) {
        if (this.isProtected({ row: r, col: c })) continue;
        this.config.api.clearCell(this.refOf({ row: r, col: c }), { keepFormat: true });
      }
    this.render();
  }

  /* ── helpers ────────────────────────────────────────────────────────── */

  private emitSelection(): void {
    this.emit('selectionChange', { active: { ...this.selection.active }, range: rangeOf(this.selection) });
    const ref = this.refOf(this.selection.active);
    this.config.api.events.emit('selectionChange', { ref });
  }

  private refOf(addr: CellAddress): CellRef {
    return { sheet: this.config.api.getActiveSheet().id, row: addr.row, col: addr.col };
  }

  private rawText(ref: CellRef): string {
    const cell = this.config.api.getCell(ref);
    const v = cell?.value ?? null;
    if (v === null) return '';
    if (typeof v === 'object' && 'kind' in v) return v.code;
    return String(v);
  }

  private dims(): { rowCount: number; colCount: number } {
    const sheet = this.config.api.getActiveSheet();
    return {
      rowCount: Math.min(sheet.rowCount, this.config.maxRows ?? sheet.rowCount),
      colCount: Math.min(sheet.colCount, this.config.maxCols ?? sheet.colCount),
    };
  }

  private dimsTuple(): [number, number] {
    const d = this.dims();
    return [d.rowCount, d.colCount];
  }

  private cellElAt(row: number, col: number): HTMLElement | null {
    return this.bodyEl.querySelector(
      `.jects-sheet__cell[data-row="${row}"][data-col="${col}"]`,
    ) as HTMLElement | null;
  }

  private coveredCells(merges: MergeRegion[]): Set<string> {
    const set = new Set<string>();
    for (const m of merges) {
      for (let r = m.row; r < m.row + m.rowSpan; r++)
        for (let c = m.col; c < m.col + m.colSpan; c++) {
          if (r === m.row && c === m.col) continue;
          set.add(`${r},${c}`);
        }
    }
    return set;
  }

  private spanHeight(sheet: SheetModel, r: number, merge: MergeRegion, rowH: number): number {
    let h = 0;
    for (let rr = r; rr < r + merge.rowSpan; rr++) h += sheet.rows?.[rr]?.size ?? rowH;
    return h;
  }
}

/**
 * Build an `EvalContext` for a conditional-format `expression` rule, anchored at
 * the cell under test so relative refs (and the implicit current cell) resolve.
 * Reads values through the API/engine; sheet-name resolution walks the workbook.
 */
function makeCfEvalContext(
  api: SpreadsheetApi,
  sheetId: string,
  row: number,
  col: number,
): EvalContext {
  const wb = api.getWorkbook();
  return {
    origin: { sheet: sheetId, row, col },
    workbook: wb,
    getValue: (ref) => api.getValue(ref),
    getRange: (from, to) => {
      const out: CellValue[][] = [];
      for (let r = Math.min(from.row, to.row); r <= Math.max(from.row, to.row); r++) {
        const line: CellValue[] = [];
        for (let c = Math.min(from.col, to.col); c <= Math.max(from.col, to.col); c++) {
          line.push(api.getValue({ sheet: from.sheet, row: r, col: c }));
        }
        out.push(line);
      }
      return out;
    },
    resolveSheet: (name) => wb.sheets.find((s) => s.name.toLowerCase() === name.toLowerCase())?.id,
  };
}

/**
 * Coerce a raw editor string into the typed value a `ValidationRule` expects:
 * blanks → null, numerals → number, everything else stays a string. Mirrors the
 * engine's literal-input typing so a `number` rule validates the parsed number.
 */
function parseForValidation(input: string): CellValue {
  const t = input.trim();
  if (t === '') return null;
  if (/^-?\d+(\.\d+)?$/.test(t.replace(/,/g, ''))) return parseFloat(t.replace(/,/g, ''));
  return input;
}

/** Clamp + round a header drag size into `[min, max]` (integral px). */
function clampSize(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}
