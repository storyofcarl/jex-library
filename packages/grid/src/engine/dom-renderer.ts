/**
 * DomRenderer — the default DOM-recycling rendering backend (D9).
 *
 * Strategy for smooth 50k+ row scrolling:
 *   - A fixed-size **pool** of row elements is recycled as the window moves;
 *     only `endIndex - startIndex + 1` rows ever exist in the DOM.
 *   - Each row is absolutely positioned and moved with `transform: translateY()`
 *     (compositor-friendly, no layout thrash).
 *   - Cells inside a row are recycled in place; on a window move we re-key each
 *     pooled row to its new absolute row index and repaint its cells.
 *   - A single spacer element sized to `totalSize` drives the native scrollbar.
 *   - `content-visibility: auto` + `contain` on rows lets the browser skip
 *     offscreen work during fast flings.
 *
 * The renderer never reaches into the store directly: it reads geometry + data
 * through the engine handed to it and emits nothing — the Grid widget owns
 * events. It implements the frozen {@link Renderer} interface so a canvas
 * backend can be swapped in later without touching the engine.
 */

import { createEl, type Model } from '@jects/core';
import type {
  CellRenderContext,
  CellRenderer,
  ColumnDef,
  GridApi,
  Renderer,
  ViewportWindow,
} from '../contract.js';
import type { GridEngine } from './engine.js';
import { type LaidOutColumn } from './column-layout.js';
import { CellRendererRegistry } from '../columns/renderers.js';
import { paintGroupRow, GROUP_ROW_CLASS } from './group-row-paint.js';
import { paintDetailRow, DETAIL_ROW_CLASS } from './detail-row-paint.js';
import { gridIsRTL, positionColumnCell, RTL_CLASS } from './rtl.js';
import {
  applyQuickSearchHighlight,
  getActiveQuickSearch,
} from '../features/quick-search-paint.js';

interface PooledRow {
  el: HTMLElement;
  /** Absolute row index currently displayed, or -1 if free. */
  rowIndex: number;
  cells: Map<string, HTMLElement>;
}

export class DomRenderer<Row extends Model = Model> implements Renderer<Row> {
  private api!: GridApi<Row>;

  /**
   * Typed-renderer registry consulted by `paintCell` to resolve a renderer from
   * `column.type` when no explicit per-column `renderer` is set. This is what
   * makes `{ type: 'number' | 'date' | 'rating' | 'action' | 'select' | … }`
   * columns render by type automatically (Bryntum/DHTMLX parity) instead of
   * falling back to `String(value)`. An explicit `column.renderer` still wins.
   * The native `tree`/`check`/`text` paths below stay inline because they layer
   * on the recycling-safe expander, indentation and quick-search highlighting the
   * generic registry renderers don't carry.
   */
  private readonly cellRenderers = new CellRendererRegistry<Row>();

  private headerEl!: HTMLElement;
  private bodyEl!: HTMLElement;
  private spacerEl!: HTMLElement;
  private rowsLayer!: HTMLElement;
  private emptyEl!: HTMLElement;

  /** Recycled row elements keyed by their absolute row index. */
  private pool: PooledRow[] = [];
  private byIndex = new Map<number, PooledRow>();
  private lastWindow: ViewportWindow | null = null;

  /** Cached host for direction resolution (the renderer's mount target). */
  private hostEl: HTMLElement | null = null;
  /** Active reading direction; recomputed each header/viewport paint. */
  private rtl = false;

  constructor(private readonly engine: GridEngine<Row>) {}

  /**
   * Resolve (and cache) the effective reading direction from the host element,
   * toggling the RTL marker class on it so CSS can scope `[dir]`-independent
   * mirror rules. Called at the start of each header/viewport paint so a runtime
   * `dir` flip (e.g. via the widget's `update()`) is honoured without a remount.
   */
  private resolveRtl(): boolean {
    const rtl = gridIsRTL(this.hostEl ?? this.headerEl ?? null);
    this.rtl = rtl;
    if (this.hostEl) this.hostEl.classList.toggle(RTL_CLASS, rtl);
    return rtl;
  }

  /* ── lifecycle ───────────────────────────────────────────────────────── */

  mount(host: HTMLElement, api: GridApi<Row>): void {
    this.api = api;
    this.hostEl = host;

    this.headerEl = createEl('div', { className: 'jects-grid__header' });
    this.headerEl.setAttribute('role', 'rowgroup');

    this.bodyEl = createEl('div', { className: 'jects-grid__body' });
    this.bodyEl.setAttribute('role', 'rowgroup');

    this.spacerEl = createEl('div', { className: 'jects-grid__spacer' });
    this.spacerEl.setAttribute('aria-hidden', 'true');

    this.rowsLayer = createEl('div', { className: 'jects-grid__rows' });

    this.emptyEl = createEl('div', { className: 'jects-grid__empty' });
    // No `role=status` here: this element lives inside the `role=rowgroup`/`role=grid`
    // subtree, whose ARIA contract forbids non-row children (aria-required-children).
    // Emptiness is already announced to assistive tech via aria-rowcount=0 on the
    // grid root (see grid.ts). The text remains a visible affordance.
    this.emptyEl.textContent = this.engine.emptyText;
    this.emptyEl.hidden = true;

    this.bodyEl.append(this.spacerEl, this.rowsLayer, this.emptyEl);
    host.append(this.headerEl, this.bodyEl);

    this.renderHeader();
  }

  destroy(): void {
    this.headerEl?.remove();
    this.bodyEl?.remove();
    this.hostEl?.classList.remove(RTL_CLASS);
    this.hostEl = null;
    this.pool = [];
    this.byIndex.clear();
    this.lastWindow = null;
  }

  /* ── header ──────────────────────────────────────────────────────────── */

  /** Build/repaint the (non-virtualized) header row. */
  renderHeader(): void {
    this.resolveRtl();
    const layout = this.engine.columnLayout;
    this.headerEl.style.height = `${this.engine.headerHeight}px`;
    this.headerEl.style.width = `${layout.totalWidth}px`;
    this.headerEl.replaceChildren();

    const row = createEl('div', { className: 'jects-grid__header-row' });
    row.setAttribute('role', 'row');
    // The header is the first row in the grid's 1-based ARIA row numbering.
    row.setAttribute('aria-rowindex', '1');
    layout.columns.forEach((col) => {
      const cell = createEl('div', { className: 'jects-grid__header-cell' });
      cell.setAttribute('role', 'columnheader');
      // 1-based ARIA column position so AT can perceive true column placement
      // even when columns are virtualized/frozen.
      cell.setAttribute('aria-colindex', String(col.index + 1));
      cell.dataset['colId'] = col.id;
      cell.dataset['colIndex'] = String(col.index);
      // Header-feature hook: context menus / filter menus resolve the column via
      // `[data-header-col]`, so stamp it on every header cell.
      cell.dataset['headerCol'] = col.id;
      this.styleColumnCell(cell, col);
      const align = col.def.align;
      if (align) cell.classList.add(`jects-grid__header-cell--${align}`);
      if (col.def.frozen) cell.classList.add('jects-grid__cell--frozen');
      // Sortable headers are keyboard-operable and advertise sort state. The
      // Grid widget wires the actual click/Enter/Space → sort feature and keeps
      // `aria-sort` in sync; here we just establish the affordance + a focusable
      // tab stop so screen-reader/keyboard users can perceive and reach it.
      // A column is sortable unless it opts out via `sortable === false`.
      const sortable = col.def.sortable !== false;
      if (sortable) {
        cell.classList.add('jects-grid__header-cell--sortable');
        cell.dataset['sortable'] = '';
        cell.tabIndex = 0;
        // Default state until the Grid reflects an active sort directive.
        cell.setAttribute('aria-sort', 'none');
      }
      // A column may supply a custom header renderer via `meta.headerRenderer`
      // (used by e.g. the selection column's "select all" checkbox). It returns
      // an element to mount, or `void` after mutating the passed cell in place.
      const headerRenderer = (col.def.meta as { headerRenderer?: (el: HTMLElement) => HTMLElement | void } | undefined)
        ?.headerRenderer;
      if (typeof headerRenderer === 'function') {
        const out = headerRenderer(cell);
        if (out) cell.replaceChildren(out);
      } else {
        cell.textContent = col.def.header ?? col.def.field ?? '';
      }
      row.appendChild(cell);
    });
    this.headerEl.appendChild(row);
  }

  /* ── body painting ───────────────────────────────────────────────────── */

  renderViewport(window: ViewportWindow): void {
    this.lastWindow = window;
    this.resolveRtl();
    // Drive the scrollbar.
    this.spacerEl.style.height = `${window.totalSize}px`;

    const count = this.engine.getRowCount();
    const empty = count === 0;
    this.emptyEl.hidden = !empty;
    this.rowsLayer.hidden = empty;
    if (empty) {
      // Keep the empty-state label in sync with the engine (a widget `update()`
      // may have changed `emptyText` since mount).
      if (this.emptyEl.textContent !== this.engine.emptyText) {
        this.emptyEl.textContent = this.engine.emptyText;
      }
      this.releaseAll();
      return;
    }

    const { startIndex, endIndex } = window;
    const needed = new Set<number>();
    for (let i = startIndex; i <= endIndex; i++) needed.add(i);

    // Release rows that scrolled out of the window back into the pool.
    for (const pooled of this.pool) {
      if (pooled.rowIndex !== -1 && !needed.has(pooled.rowIndex)) {
        this.byIndex.delete(pooled.rowIndex);
        pooled.rowIndex = -1;
        pooled.el.hidden = true;
      }
    }

    // Paint each needed row, recycling a free pool entry when possible.
    for (let i = startIndex; i <= endIndex; i++) {
      let pooled = this.byIndex.get(i);
      if (!pooled) {
        pooled = this.acquireRow();
        pooled.rowIndex = i;
        this.byIndex.set(i, pooled);
        pooled.el.hidden = false;
      }
      this.paintRow(pooled, i, window.columns);
    }
  }

  updateCell(rowIndex: number, colIndex: number): void {
    const pooled = this.byIndex.get(rowIndex);
    if (!pooled) return;
    const col = this.engine.columns[colIndex];
    if (!col) return;
    const cellEl = pooled.cells.get(col.id);
    if (cellEl) this.paintCell(cellEl, rowIndex, col);
  }

  /** Repaint a single row by absolute index (e.g. after a model change). */
  refreshRow(rowIndex: number): void {
    const pooled = this.byIndex.get(rowIndex);
    if (pooled && this.lastWindow) this.paintRow(pooled, rowIndex, this.lastWindow.columns);
  }

  /* ── internals ───────────────────────────────────────────────────────── */

  private acquireRow(): PooledRow {
    const free = this.pool.find((p) => p.rowIndex === -1);
    if (free) return free;
    const el = createEl('div', { className: 'jects-grid__row' });
    el.setAttribute('role', 'row');
    const pooled: PooledRow = { el, rowIndex: -1, cells: new Map() };
    this.pool.push(pooled);
    this.rowsLayer.appendChild(el);
    return pooled;
  }

  private releaseAll(): void {
    for (const pooled of this.pool) {
      pooled.rowIndex = -1;
      pooled.el.hidden = true;
    }
    this.byIndex.clear();
  }

  private paintRow(pooled: PooledRow, rowIndex: number, columns: ReadonlyArray<ColumnDef>): void {
    const entry = this.engine.getRowEntry(rowIndex);
    const el = pooled.el;
    const top = this.engine.rowOffset(rowIndex);
    const height = this.engine.rowSize(rowIndex);
    el.style.transform = `translateY(${top}px)`;
    el.style.height = `${height}px`;
    el.style.width = `${this.engine.columnLayout.totalWidth}px`;
    el.dataset['rowIndex'] = String(rowIndex);
    // 1-based ARIA row position. The header occupies row 1, so data rows start
    // at 2 — this lets AT report "row N of aria-rowcount" while virtualized.
    el.setAttribute('aria-rowindex', String(rowIndex + 2));

    // Group-header band: a feature injected this row via the row-source seam.
    // Paint a full-width collapsible group row instead of per-column cells, and
    // recycle the pooled cells away (a recycled row may previously have held
    // data cells we must not leave behind under the group band).
    if (entry?.kind === 'group' && entry.group) {
      // Reset any leftover leaf-row state from a recycled pool entry.
      for (const cellEl of pooled.cells.values()) cellEl.remove();
      pooled.cells.clear();
      el.classList.remove(
        'jects-grid__row--selected',
        'jects-grid__row--odd',
      );
      el.removeAttribute('aria-selected');
      el.removeAttribute('data-row-id');
      const group = this.api.getColumn(entry.group.columnId);
      paintGroupRow(el, entry.group, this.engine.columnLayout, {
        ...(group?.header != null ? { columnHeader: group.header } : {}),
        rtl: this.rtl,
      });
      return;
    }

    // Master-detail band: a row-expander feature injected this detail row via the
    // row-source seam. Paint a full-width consumer-rendered region instead of
    // per-column cells, recycling away any leftover leaf cells (a recycled pool
    // entry may previously have held data cells we must not leave behind).
    if (entry?.kind === 'detail' && entry.detail) {
      for (const cellEl of pooled.cells.values()) cellEl.remove();
      pooled.cells.clear();
      el.classList.remove('jects-grid__row--selected', 'jects-grid__row--odd');
      el.removeAttribute('aria-selected');
      el.removeAttribute('data-row-id');
      if (el.classList.contains(GROUP_ROW_CLASS)) {
        el.classList.remove(GROUP_ROW_CLASS, 'jects-grid-group');
        el.removeAttribute('aria-expanded');
        el.removeAttribute('data-group-key');
        el.removeAttribute('data-group-depth');
      }
      paintDetailRow(el, entry.detail, this.engine.columnLayout);
      return;
    }

    // Leaf data row: clear any detail-band styling a recycled pool entry carried.
    if (el.classList.contains(DETAIL_ROW_CLASS)) {
      el.classList.remove(DETAIL_ROW_CLASS, 'jects-grid-detail');
      el.removeAttribute('data-detail-for');
      el.replaceChildren();
      pooled.cells.clear();
    }

    // Leaf data row: clear any group-band styling a recycled pool entry carried.
    if (el.classList.contains(GROUP_ROW_CLASS)) {
      el.classList.remove(GROUP_ROW_CLASS, 'jects-grid-group');
      el.removeAttribute('aria-expanded');
      el.removeAttribute('data-group-key');
      el.removeAttribute('data-group-depth');
      // Strip the group-band children (lead + agg cells); drop the stale cell map
      // so the leaf cell-recycling loop below rebuilds fresh, attached cells.
      el.replaceChildren();
      pooled.cells.clear();
    }

    if (entry) {
      el.dataset['rowId'] = String(entry.id);
      const selected = this.api.selection.isSelected(entry.id);
      el.classList.toggle('jects-grid__row--selected', selected);
      el.setAttribute('aria-selected', String(selected));
      el.classList.toggle('jects-grid__row--odd', rowIndex % 2 === 1);
    }

    // Recycle/sync cells. Build a key set of columns this paint needs, and stamp
    // each painted cell with its DOM order so the cell sequence in the row matches
    // the visible column order even when features inject columns AFTER some cells
    // were first created (e.g. selection-column + row-expander installed together).
    // Keying by the laid-out column id (not the loop index) keeps cell→column
    // identity stable across paints so `data-col-index` never collides.
    const layout = this.engine.columnLayout;
    // Every column id valid in the CURRENT layout. A pooled cell whose key is not
    // in this set is *orphaned* — its column was removed, or its positional
    // `col-N` fallback id shifted when a feature prepended a column (e.g. the
    // auto `__expander`/`__select` columns shift an id-less `action` column from
    // `col-2` to `col-3`). Orphaned cells must be removed, not merely hidden, or
    // they linger as phantom trailing cells.
    const validIds = new Set(layout.columns.map((c) => c.id));
    const wantIds = new Set<string>();
    const orderedCells: HTMLElement[] = [];
    columns.forEach((def, i) => {
      const laid = layout.columns.find(
        (c) => c.id === (def.id ?? def.field ?? `col-${i}`),
      );
      if (!laid) return;
      const cid = laid.id;
      wantIds.add(cid);
      let cellEl = pooled.cells.get(cid);
      if (!cellEl) {
        cellEl = createEl('div', { className: 'jects-grid__cell' });
        cellEl.setAttribute('role', 'gridcell');
        pooled.cells.set(cid, cellEl);
        el.appendChild(cellEl);
      }
      cellEl.hidden = false;
      this.styleColumnCell(cellEl, laid);
      this.paintCell(cellEl, rowIndex, laid);
      orderedCells.push(cellEl);
    });

    // Reconcile pooled cells not painted this pass:
    //   - Orphaned (key no longer a valid column id): the column was removed or
    //     its positional `col-N` id shifted under a prepended feature column —
    //     remove the cell from the DOM + pool so it can't linger as a phantom
    //     trailing cell (auto-expander/select column + an id-less typed column).
    //   - Still valid but outside this paint's window (horizontal virtualization):
    //     keep it pooled for cheap reuse, but hide it and shed its stale identity
    //     (`data-col-index`/`aria-colindex`/`data-col-id`) so it can't collide
    //     with the live cell that now owns that index.
    for (const [cid, cellEl] of pooled.cells) {
      if (wantIds.has(cid)) continue;
      if (!validIds.has(cid)) {
        cellEl.remove();
        pooled.cells.delete(cid);
        continue;
      }
      cellEl.hidden = true;
      delete cellEl.dataset['colIndex'];
      delete cellEl.dataset['colId'];
      cellEl.removeAttribute('aria-colindex');
    }

    // Re-order the painted cells to match the visible column order. Recycled rows
    // that gained a leading feature column (selection / expander) would otherwise
    // keep their original DOM cell order (data cells first, injected cells last),
    // leaving `data-col-index` out of document order.
    this.reorderCells(el, orderedCells);
  }

  /**
   * Ensure the row's child cells appear in `orderedCells` order. Uses
   * `insertBefore` which MOVES an existing node in place (no recreation), so the
   * cell pool and virtualization recycling are preserved; it is a no-op when a
   * cell is already in position, so a steady-state repaint touches no DOM here.
   */
  private reorderCells(rowEl: HTMLElement, orderedCells: ReadonlyArray<HTMLElement>): void {
    let prev: HTMLElement | null = null;
    for (const cellEl of orderedCells) {
      const expected: Element | null = prev ? prev.nextElementSibling : rowEl.firstElementChild;
      if (expected !== cellEl) {
        rowEl.insertBefore(cellEl, expected);
      }
      prev = cellEl;
    }
  }

  private paintCell(cellEl: HTMLElement, rowIndex: number, col: LaidOutColumn<Row>): void {
    const entry = this.engine.getRowEntry(rowIndex);
    if (!entry) {
      cellEl.replaceChildren();
      return;
    }
    const row = entry.row;
    const def = col.def;
    const value = def.field != null ? (row as Model)[def.field] : undefined;

    cellEl.dataset['colId'] = col.id;
    cellEl.dataset['colIndex'] = String(col.index);
    // 1-based ARIA column position (matches the header's aria-colindex).
    cellEl.setAttribute('aria-colindex', String(col.index + 1));
    const align = def.align;
    cellEl.className = 'jects-grid__cell';
    if (align) cellEl.classList.add(`jects-grid__cell--${align}`);
    if (def.frozen) cellEl.classList.add('jects-grid__cell--frozen');

    // Cell/range selection highlight.
    const sel = this.api.selection as unknown as {
      isCellSelected?: (r: number, c: number) => boolean;
    };
    const cellSelected =
      typeof sel.isCellSelected === 'function' && sel.isCellSelected(rowIndex, col.index);
    cellEl.classList.toggle('jects-grid__cell--selected', cellSelected);

    // Roving tabindex default: every freshly painted cell starts non-tabbable
    // (-1); the Grid promotes exactly one cell to tabindex=0 in
    // `applyRovingTabindex()` after each paint (WCAG 2.1.1 keyboard operability).
    cellEl.tabIndex = -1;

    // Tree indentation + expander.
    if (def.type === 'tree' && entry.depth >= 0) {
      cellEl.style.paddingInlineStart = `${8 + entry.depth * 16}px`;
    }

    const custom = def.renderer;
    if (custom) {
      cellEl.replaceChildren();
      const ctx: CellRenderContext<Row> = {
        row,
        value,
        column: def,
        rowIndex,
        colIndex: col.index,
        el: cellEl,
        api: this.api,
      };
      const result = custom(ctx);
      if (typeof result === 'string') cellEl.textContent = result;
      else if (result instanceof HTMLElement) cellEl.replaceChildren(result);
      return;
    }

    // QuickFind highlight: consult the active quick-search feature (if any) so
    // matched substrings in default-rendered text cells are visually marked,
    // matching Bryntum/DHTMLX behavior. Resolved once per cell paint; `null`
    // when no search is installed/active so the cheap plain-text path is taken
    // and any stale highlight a recycled cell carried is cleared.
    const search = getActiveQuickSearch(this.api);

    if (def.type === 'tree') {
      cellEl.replaceChildren();
      if (entry.hasChildren) {
        const tw = createEl('button', { className: 'jects-grid__tree-toggle' });
        tw.type = 'button';
        tw.setAttribute('aria-expanded', String(entry.expanded));
        tw.dataset['treeToggle'] = '';
        tw.textContent = entry.expanded ? '▾' : '▸'; // ▾ ▸
        cellEl.appendChild(tw);
      }
      const label = createEl('span', { className: 'jects-grid__tree-label' });
      const labelText = value == null ? '' : String(value);
      label.textContent = labelText;
      // Highlight the tree label (not the expander/indent affordance).
      applyQuickSearchHighlight(label, labelText, search);
      cellEl.appendChild(label);
      return;
    }

    if (def.type === 'check') {
      // Boolean check glyph is not searchable text — never highlight it, but do
      // clear any stale highlight a recycled cell carried.
      applyQuickSearchHighlight(cellEl, value ? '✓' : '', null);
      cellEl.textContent = value ? '✓' : '';
      return;
    }

    // Typed columns (number/date/rating/action/select/widget/rownumber/…) render
    // through the registered renderer for their `column.type` — Bryntum/DHTMLX
    // parity: declaring a type is enough, no per-column `renderer` required. Only
    // the plain `text` (and untyped) path falls through to the inline
    // quick-search-highlighted text below. `tree`/`check` were handled above.
    const type = def.type;
    if (type != null && type !== 'text' && type !== 'template') {
      const typed = this.resolveTypedRenderer(type);
      if (typed) {
        // A recycled cell may carry highlight marks from a prior text paint;
        // clear them before the typed renderer rebuilds the cell content.
        applyQuickSearchHighlight(cellEl, '', null);
        const ctx: CellRenderContext<Row> = {
          row,
          value,
          column: def,
          rowIndex,
          colIndex: col.index,
          el: cellEl,
          api: this.api,
        };
        const result = typed(ctx);
        if (typeof result === 'string') cellEl.textContent = result;
        else if (result instanceof HTMLElement) cellEl.replaceChildren(result);
        return;
      }
    }

    const text = value == null ? '' : String(value);
    cellEl.textContent = text;
    applyQuickSearchHighlight(cellEl, text, search);
  }

  /**
   * Resolve the registered renderer for a column `type`, or `undefined` for a
   * plain text/unregistered type (so the caller takes the inline text path).
   * Resolution is stable across repaints (the registry is built once in the
   * constructor), so DOM recycling/cell-index bookkeeping is unaffected.
   */
  private resolveTypedRenderer(type: NonNullable<ColumnDef<Row>['type']>): CellRenderer<Row> | undefined {
    return this.cellRenderers.get(type);
  }

  private styleColumnCell(el: HTMLElement, col: LaidOutColumn<Row>): void {
    // All frozen/centre absolute-positioning math — including the RTL mirror
    // (logical inset-inline-start/-end under dir=rtl, physical left/right in LTR)
    // — lives in the shared `positionColumnCell` helper so header cells, body
    // cells, and group aggregate cells stay pixel-consistent. `this.rtl` is
    // resolved once per paint in renderHeader()/renderViewport(). Frozen cells
    // stack above scrolling cells (z-index 2).
    positionColumnCell(el, col, this.engine.columnLayout, this.rtl, '2');
  }

  /** Expose for tests/inspection: number of pooled row nodes in the DOM. */
  get poolSize(): number {
    return this.pool.length;
  }
}

/** Default renderer factory — used when no custom renderer is supplied. */
export function createDomRenderer<Row extends Model = Model>(
  engine: GridEngine<Row>,
): DomRenderer<Row> {
  return new DomRenderer<Row>(engine);
}
