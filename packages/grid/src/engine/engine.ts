/**
 * GridEngine — the headless core of the grid.
 *
 * Owns everything that is independent of a concrete rendering backend:
 *   - the {@link RowModel} (data view: array / Store / TreeStore),
 *   - resolved {@link ColumnLayout} geometry,
 *   - scroll state + viewport dimensions,
 *   - row virtualization via core `computeWindow` (fixed) or `OffsetIndex`
 *     (variable heights), and optional horizontal column virtualization,
 *   - the {@link ViewportWindow} handed to the renderer each paint.
 *
 * The engine is DOM-light: it stores the measured viewport size and scroll
 * position (fed by the {@link Grid} widget from real DOM events) and produces
 * pure geometry. The {@link Grid} widget composes the engine with the renderer,
 * selection, editing, viewport, and feature plumbing.
 */

import {
  OffsetIndex,
  type Store,
  computeWindow,
  type Model,
  type RecordId,
} from '@jects/core';
import type {
  ColumnDef,
  GridDataSource,
  VirtualizationOptions,
  ViewportWindow,
} from '../contract.js';
import { RowModel, type RowEntry, type RowSource } from './row-model.js';
import {
  resolveColumns,
  computeColumnWindow,
  type ColumnLayout,
  type LaidOutColumn,
} from './column-layout.js';

/** Default constants. */
export const DEFAULT_ROW_HEIGHT = 36;
export const DEFAULT_HEADER_HEIGHT = 40;
const DEFAULT_OVERSCAN = 4;

export interface GridEngineOptions<Row extends Model = Model> {
  data: GridDataSource<Row>;
  columns: ColumnDef<Row>[];
  rowHeight?: number;
  headerHeight?: number;
  virtualization?: VirtualizationOptions;
  treeMode?: boolean;
  idField?: string;
  /** Text shown by the renderer when there are no rows. */
  emptyText?: string;
}

/**
 * Headless grid geometry/virtualization engine. Drives the renderer through
 * {@link computeViewportWindow}; the widget feeds it scroll + size updates.
 */
export class GridEngine<Row extends Model = Model> {
  rowModel: RowModel<Row>;

  private columnsDef: ColumnDef<Row>[];
  private layout: ColumnLayout<Row>;
  private readonly idField?: string;
  private readonly treeMode: boolean;

  private _rowHeight: number;
  private _headerHeight: number;
  /** Empty-state text the renderer paints when the view has zero rows. */
  private _emptyText: string;
  private readonly overscan: number;
  private readonly virtEnabled: boolean;
  private readonly horizontal: boolean;
  private readonly variableHeight: boolean;

  /** Per-row offset index for variable heights (lazily built). */
  private offsets: OffsetIndex | null = null;

  /**
   * Offset index built from a row-source that supplies per-row heights (the
   * "row-source height seam", e.g. master-detail). Independent of
   * `variableRowHeight` mode: when a source exposes `heightOf`, the engine
   * accounts for those heights in all geometry so tall detail rows virtualize
   * correctly even in an otherwise fixed-height grid. `null` when no active
   * source provides heights.
   */
  private sourceOffsets: OffsetIndex | null = null;

  private _scrollTop = 0;
  private _scrollLeft = 0;
  private _viewportHeight = 0;
  private _viewportWidth = 0;

  constructor(opts: GridEngineOptions<Row>) {
    if (opts.idField) this.idField = opts.idField;
    this.treeMode = opts.treeMode ?? false;
    this.rowModel = new RowModel<Row>(opts.data, {
      ...(opts.idField ? { idField: opts.idField } : {}),
      treeMode: this.treeMode,
    });
    this.columnsDef = [...opts.columns];
    this._rowHeight = opts.rowHeight ?? DEFAULT_ROW_HEIGHT;
    this._headerHeight = opts.headerHeight ?? DEFAULT_HEADER_HEIGHT;
    this._emptyText = opts.emptyText ?? '';
    const v = opts.virtualization ?? {};
    this.virtEnabled = v.enabled !== false;
    this.overscan = v.overscan ?? DEFAULT_OVERSCAN;
    this.horizontal = v.horizontal === true;
    this.variableHeight = v.variableRowHeight === true;
    this.layout = resolveColumns(this.columnsDef, 0);
    if (this.variableHeight) this.rebuildOffsets();
  }

  /* ── dimensions ──────────────────────────────────────────────────────── */

  get rowHeight(): number {
    return this._rowHeight;
  }
  get headerHeight(): number {
    return this._headerHeight;
  }
  /** Empty-state text shown when the view has no rows. */
  get emptyText(): string {
    return this._emptyText;
  }
  /** Update the empty-state text (e.g. after a widget `update()`). */
  setEmptyText(text: string): void {
    this._emptyText = text;
  }
  get scrollTop(): number {
    return this._scrollTop;
  }
  get scrollLeft(): number {
    return this._scrollLeft;
  }
  get viewportHeight(): number {
    return this._viewportHeight;
  }
  get viewportWidth(): number {
    return this._viewportWidth;
  }
  get columnLayout(): ColumnLayout<Row> {
    return this.layout;
  }
  /** Visible, ordered columns (live geometry view). */
  get columns(): ReadonlyArray<LaidOutColumn<Row>> {
    return this.layout.columns;
  }

  /* ── mutation ────────────────────────────────────────────────────────── */

  /** Replace all column definitions and re-resolve geometry. */
  setColumns(columns: ColumnDef<Row>[]): void {
    this.columnsDef = [...columns];
    this.invalidateLayout();
  }

  /** Patch one column by id/field and re-resolve geometry. */
  updateColumn(id: string, patch: Partial<ColumnDef<Row>>): void {
    let found = false;
    this.columnsDef = this.columnsDef.map((c, i) => {
      const cid = c.id ?? c.field ?? `col-${i}`;
      if (cid === id) {
        found = true;
        return { ...c, ...patch };
      }
      return c;
    });
    if (found) this.invalidateLayout();
  }

  /** Recompute resolved column widths/positions for the current viewport width. */
  invalidateLayout(): void {
    this.layout = resolveColumns(this.columnsDef, this._viewportWidth);
  }

  /** Mark the data view stale (after store/tree change). */
  invalidateRows(): void {
    this.rowModel.invalidate();
    if (this.variableHeight) this.rebuildOffsets();
    this.rebuildSourceOffsets();
  }

  /**
   * Install (or clear) a {@link RowSource} that supplies the engine's visible
   * row list — the "row-source seam". A feature (e.g. grouping) uses this to
   * inject interleaved group-header + leaf rows the store alone can't express.
   * Passing `null` restores the default store/tree-driven view. Rebuilds the
   * variable-height offset index since the row count may change.
   */
  setRowSource(source: RowSource<Row> | null): void {
    this.rowModel.setRowSource(source);
    // Always re-materialize: even when the same source object is re-installed,
    // its content (group collapse state, aggregates) may have changed.
    this.rowModel.invalidate();
    if (this.variableHeight) this.rebuildOffsets();
    this.rebuildSourceOffsets();
  }

  /** Whether a row-source override is currently driving the visible rows. */
  hasRowSource(): boolean {
    return this.rowModel.hasRowSource();
  }

  /** Replace the data source, rebuilding the row model. */
  setData(data: GridDataSource<Row>): void {
    this.rowModel = new RowModel<Row>(data, {
      ...(this.idField ? { idField: this.idField } : {}),
      treeMode: this.treeMode,
    });
    if (this.variableHeight) this.rebuildOffsets();
    this.rebuildSourceOffsets();
  }

  /** The current backing store (for the widget to (re)wire change listeners). */
  get store(): Store<Row> {
    return this.rowModel.store;
  }

  /** Set the measured scroll position (from the DOM). Returns true if changed. */
  setScroll(scrollTop: number, scrollLeft: number): boolean {
    const top = Math.max(0, scrollTop);
    const left = Math.max(0, scrollLeft);
    if (top === this._scrollTop && left === this._scrollLeft) return false;
    this._scrollTop = top;
    this._scrollLeft = left;
    return true;
  }

  /** Set the measured viewport size (from the DOM). Returns true if changed. */
  setViewportSize(width: number, height: number): boolean {
    if (width === this._viewportWidth && height === this._viewportHeight) return false;
    const widthChanged = width !== this._viewportWidth;
    this._viewportWidth = width;
    this._viewportHeight = height;
    // Flex columns depend on available width — re-resolve when width changes.
    if (widthChanged) this.invalidateLayout();
    return true;
  }

  /** Set the default row height (fixed mode). */
  setRowHeight(height: number): void {
    this._rowHeight = height;
    if (this.variableHeight) this.rebuildOffsets();
  }

  setHeaderHeight(height: number): void {
    this._headerHeight = height;
  }

  /* ── variable-height tracking ────────────────────────────────────────── */

  private rebuildOffsets(): void {
    const count = this.rowModel.count;
    this.offsets = new OffsetIndex(count, this._rowHeight);
  }

  /**
   * (Re)build the row-source height index. When the active {@link RowSource}
   * supplies per-row heights (`heightOf`), seed an {@link OffsetIndex} with them
   * (default row height for rows that return `undefined`) so offsets/total/window
   * math reflect tall injected rows. Cleared to `null` when no such source is
   * active, restoring the plain fixed/variable paths.
   */
  private rebuildSourceOffsets(): void {
    if (!this.rowModel.hasRowHeights()) {
      this.sourceOffsets = null;
      return;
    }
    const count = this.rowModel.count;
    const idx = new OffsetIndex(count, this._rowHeight);
    for (let i = 0; i < count; i++) {
      const h = this.rowModel.heightOf(i);
      if (h != null && h !== this._rowHeight) idx.setSize(i, h);
    }
    this.sourceOffsets = idx;
  }

  /** Record a measured height for a row (variable-height mode). */
  measureRow(rowIndex: number, height: number): void {
    if (!this.variableHeight || !this.offsets) return;
    if (rowIndex < 0 || rowIndex >= this.offsets.count) return;
    if (this.offsets.sizeOf(rowIndex) !== height) {
      this.offsets.setSize(rowIndex, height);
    }
  }

  /** The active offset index (user variable-height first, else source heights). */
  private activeOffsets(): OffsetIndex | null {
    if (this.variableHeight && this.offsets) return this.offsets;
    return this.sourceOffsets;
  }

  /** Top pixel offset of a row. */
  rowOffset(rowIndex: number): number {
    const idx = this.activeOffsets();
    if (idx) return idx.offsetOf(rowIndex);
    return rowIndex * this._rowHeight;
  }

  /** Height of a row. */
  rowSize(rowIndex: number): number {
    const idx = this.activeOffsets();
    if (idx) {
      const s = idx.sizeOf(rowIndex);
      return s > 0 ? s : this._rowHeight;
    }
    return this._rowHeight;
  }

  /** Total scrollable body height (px). */
  totalSize(): number {
    const idx = this.activeOffsets();
    if (idx) return idx.total();
    return this.rowModel.count * this._rowHeight;
  }

  /* ── column geometry helpers ─────────────────────────────────────────── */

  columnOffset(colIndex: number): number {
    return this.layout.columns[colIndex]?.left ?? 0;
  }
  columnSize(colIndex: number): number {
    return this.layout.columns[colIndex]?.width ?? 0;
  }

  /* ── virtualization ──────────────────────────────────────────────────── */

  /** Compute the inclusive row index range to paint. */
  private computeRowRange(): { startIndex: number; endIndex: number; offset: number; totalSize: number } {
    const count = this.rowModel.count;
    if (count === 0) return { startIndex: 0, endIndex: -1, offset: 0, totalSize: 0 };
    if (!this.virtEnabled) {
      return { startIndex: 0, endIndex: count - 1, offset: 0, totalSize: this.totalSize() };
    }
    const offIdx = this.activeOffsets();
    if (offIdx) {
      const total = offIdx.total();
      const clampedTop = Math.max(0, Math.min(this._scrollTop, Math.max(0, total - this._viewportHeight)));
      const first = offIdx.indexAt(clampedTop);
      // Walk forward until we've covered the viewport.
      let last = first;
      let acc = offIdx.offsetOf(first);
      const limit = this._scrollTop + this._viewportHeight;
      while (last < count - 1 && acc < limit) {
        acc += offIdx.sizeOf(last);
        last++;
      }
      const startIndex = Math.max(0, first - this.overscan);
      const endIndex = Math.min(count - 1, last + this.overscan);
      return {
        startIndex,
        endIndex,
        offset: offIdx.offsetOf(startIndex),
        totalSize: total,
      };
    }
    const w = computeWindow({
      scrollTop: this._scrollTop,
      viewportHeight: this._viewportHeight,
      itemSize: this._rowHeight,
      count,
      overscan: this.overscan,
    });
    return w;
  }

  /**
   * Produce the {@link ViewportWindow} the renderer must paint. Columns in the
   * window are the laid-out visible columns; when horizontal virtualization is
   * on, scrolling columns outside the viewport (excluding frozen) are dropped.
   */
  computeViewportWindow(): ViewportWindow {
    const { startIndex, endIndex, offset, totalSize } = this.computeRowRange();

    let columns: ReadonlyArray<ColumnDef>;
    if (this.horizontal && this.layout.center.length > 0 && this._viewportWidth > 0) {
      const band = computeColumnWindow(
        this.layout.center,
        this._scrollLeft,
        this._viewportWidth,
        1,
      );
      const centerSlice =
        band.end < band.start ? [] : this.layout.center.slice(band.start, band.end + 1);
      columns = [...this.layout.left, ...centerSlice, ...this.layout.right].map(
        (c) => c.def as ColumnDef,
      );
    } else {
      columns = this.layout.columns.map((c) => c.def as ColumnDef);
    }

    return {
      startIndex,
      endIndex,
      offset,
      totalSize,
      columns,
      scrollTop: this._scrollTop,
      scrollLeft: this._scrollLeft,
    };
  }

  /* ── row access pass-throughs ────────────────────────────────────────── */

  getRow(rowIndex: number): Row | undefined {
    return this.rowModel.rowAt(rowIndex);
  }
  getRowEntry(rowIndex: number): RowEntry<Row> | undefined {
    return this.rowModel.entryAt(rowIndex);
  }
  getRowById(id: RecordId): Row | undefined {
    return this.rowModel.rowById(id);
  }
  getRowIndex(id: RecordId): number {
    return this.rowModel.indexOf(id);
  }
  getRowCount(): number {
    return this.rowModel.count;
  }
}
