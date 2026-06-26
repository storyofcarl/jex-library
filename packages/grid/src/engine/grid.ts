/**
 * Grid — the keystone Widget that composes the engine, renderer, selection,
 * editing, viewport, and feature plumbing into the public {@link GridApi}.
 *
 * Responsibilities:
 *   - extend the core {@link Widget} (single owned root, lifecycle, events),
 *   - build the scroll container + delegate DOM events (a single set of
 *     listeners on the root → event delegation),
 *   - own a {@link GridEngine} for geometry/virtualization, a {@link DomRenderer}
 *     (or a custom renderer from `options.renderer`), a {@link DefaultViewport},
 *     a {@link DefaultSelectionModel}, and a {@link DefaultEditSession},
 *   - wire the store's `change` event → re-virtualize + repaint,
 *   - implement the full {@link GridApi} so features (3B/3C) extend behavior
 *     purely through it, and
 *   - register `grid.use(feature)` / `removeFeature` lifecycle with leak-safe
 *     disposal (`track`).
 *
 * IS-A `GridApi`; exposes the same surface to consumers + the standard Widget
 * lifecycle (`update`/`getConfig`/`show`/`hide`/`destroy`).
 */

import {
  Widget,
  register,
  createEl,
  type Store,
  type Model,
  type RecordId,
} from '@jects/core';
import type {
  CellAddress,
  ColumnDef,
  EditingOptions,
  Grid as GridContract,
  GridEvents,
  GridFeature,
  GridOptions,
  Renderer,
  SelectionMode,
  Viewport,
} from '../contract.js';
import './grid.css';
import { GridEngine } from './engine.js';
import type { RowSource } from './row-model.js';
import { DomRenderer } from './dom-renderer.js';
import { SpanDomRenderer } from './span-renderer.js';
import { hasSpanProviders } from './span-host.js';
import { DefaultViewport, type ViewportHost } from './viewport.js';
import { DefaultSelectionModel } from './selection.js';
import { DefaultEditSession, type EditHost } from './edit-session.js';
import { columnFeature } from '../columns/column-feature.js';
import { sortFeature } from '../features/sort.js';
import { filterFeature } from '../features/filter.js';
import { groupFeature, type AggregatorSpec } from '../features/group.js';
import { treeFeature } from '../features/tree.js';
import { exportFeature } from '../features/export.js';
import { selectionColumnFeature } from '../features/selection-column.js';
import { responsiveFeature } from '../features/responsive.js';
import { selectionFeature } from '../columns/selection-feature.js';

function normalizeEditing(e: GridOptions['editing']): Required<EditingOptions> {
  const base: Required<EditingOptions> = {
    enabled: false,
    trigger: 'dblclick',
    commitOnBlur: true,
    keyboardNav: true,
  };
  if (e === true) return { ...base, enabled: true };
  if (e && typeof e === 'object') return { ...base, ...e };
  return base;
}

export class Grid<Row extends Model = Model>
  extends Widget<GridOptions<Row>, GridEvents<Row>>
  implements GridContract<Row>
{
  // NOTE: `super()` (Widget ctor) calls render() BEFORE subclass field
  // initializers run. With `useDefineForClassFields`, a normal field declaration
  // emits `this.x = undefined` after super(), which would WIPE values render()
  // assigned during construction. `declare` prevents any emitted slot init, so
  // the assignments render() makes survive. These are all assigned in render().
  private declare engine: GridEngine<Row>;
  private declare _renderer: Renderer<Row>;
  private declare _viewport: Viewport;
  private declare _selection: DefaultSelectionModel<Row>;
  private declare _editing: DefaultEditSession<Row>;
  private declare _features: Map<string, GridFeature<Row>>;
  private declare scrollEl: HTMLElement;
  private declare rafPending: boolean;
  private declare editingOpts: Required<EditingOptions>;
  private declare resizeObserver: ResizeObserver | null;
  private declare storeUnsub: (() => void) | null;
  /**
   * The cell that holds the roving tabindex (the single tabbable cell per the
   * WAI-ARIA grid pattern). `null` until the first cell is rendered, at which
   * point the top-left cell becomes the entry point.
   */
  private declare focusedCell: CellAddress | null;

  protected override defaults(): Partial<GridOptions<Row>> {
    return {
      rowHeight: 36,
      headerHeight: 40,
      selection: 'none',
      emptyText: 'No data',
    } as Partial<GridOptions<Row>>;
  }

  protected buildEl(): HTMLElement {
    return createEl('div', { className: 'jects-grid' });
  }

  protected override render(): void {
    // First render: build everything. Subsequent renders happen via refresh().
    if (this.engine) {
      this.refresh();
      return;
    }
    // Initialize state here (NOT via field initializers, which run after super()).
    this._features = new Map<string, GridFeature<Row>>();
    this.rafPending = false;
    this.resizeObserver = null;
    this.focusedCell = null;

    const cfg = this.config;
    const el = this.el;
    el.setAttribute('role', 'grid');
    el.classList.add('jects-grid');
    el.style.position = 'relative';

    this.editingOpts = normalizeEditing(cfg.editing);

    // Engine.
    this.engine = new GridEngine<Row>({
      data: cfg.data,
      columns: cfg.columns,
      ...(cfg.rowHeight != null ? { rowHeight: cfg.rowHeight } : {}),
      ...(cfg.headerHeight != null ? { headerHeight: cfg.headerHeight } : {}),
      ...(cfg.virtualization ? { virtualization: cfg.virtualization } : {}),
      ...(cfg.idField ? { idField: cfg.idField } : {}),
      ...(cfg.emptyText != null ? { emptyText: cfg.emptyText } : {}),
      treeMode:
        cfg.treeMode === true ||
        (typeof cfg.treeMode === 'object' && cfg.treeMode?.enabled === true),
    });

    // Scroll container — owns the native scrollbar; the renderer paints inside.
    this.scrollEl = createEl('div', { className: 'jects-grid__scroller' });
    this.scrollEl.setAttribute('role', 'presentation');
    el.appendChild(this.scrollEl);

    // Selection.
    this._selection = new DefaultSelectionModel<Row>((cfg.selection ?? 'none') as SelectionMode, {
      getRowById: (id) => this.engine.getRowById(id),
      onChange: () => this.onSelectionChange(),
    });

    // Viewport.
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    const vHost: ViewportHost = {
      get scrollTop() {
        return self.engine.scrollTop;
      },
      get scrollLeft() {
        return self.engine.scrollLeft;
      },
      get height() {
        return self.engine.viewportHeight;
      },
      get width() {
        return self.engine.viewportWidth;
      },
      get window() {
        return self.engine.computeViewportWindow();
      },
      rowOffset: (i) => this.engine.rowOffset(i),
      rowSize: (i) => this.engine.rowSize(i),
      columnOffset: (i) => this.engine.columnOffset(i),
      columnSize: (i) => this.engine.columnSize(i),
      applyScroll: (opts) => this.applyScroll(opts),
    };
    this._viewport = new DefaultViewport(vHost);

    // Editing.
    const editHost: EditHost<Row> = {
      api: this,
      resolve: (address) => this.resolveCell(address),
      write: (id, column, value) => {
        if (column.field != null) this.store.update(id, { [column.field]: value } as Partial<Row>);
      },
      repaintCell: (address) => this.refreshCell(address.rowIndex, address.colIndex),
    };
    this._editing = new DefaultEditSession<Row>(editHost);

    // Renderer (custom, span-aware, or default DOM recycler). When any column
    // declares a merged-cell span provider (`column.meta.span`), auto-select the
    // span-aware renderer so merged cells paint with no extra config; an explicit
    // `options.renderer` always wins.
    this._renderer = cfg.renderer
      ? cfg.renderer(this)
      : hasSpanProviders(this.engine)
        ? new SpanDomRenderer<Row>(this.engine)
        : new DomRenderer<Row>(this.engine);
    this._renderer.mount(this.scrollEl, this);

    // Wire store changes.
    this.storeUnsub = null;
    this.wireStore();

    // DOM events — single delegated set on the root/scroller (event delegation).
    this.bindDomEvents();

    // Size observation. The header was built by the renderer's mount() before
    // any measurement (available width = 0), so flex columns fell back to their
    // minimum widths there. measureViewport() now feeds the real width to the
    // engine and invalidates the column layout; re-render the header so its flex
    // columns adopt the measured widths and stay aligned with the body, which
    // paints from the same (post-measure) layout below.
    this.measureViewport();
    this.rerenderHeader();
    this.observeResize();

    // Auto-register the standard feature plugins so a plain
    // `new Grid(el, { data, columns })` works with column ops, sorting,
    // filtering, selection, editing, grouping and tree mode out of the box.
    this.autoRegisterFeatures();

    // Install construction-time plugins (after standard ones, so user plugins
    // can override a same-named built-in via `use()`'s replace semantics).
    if (cfg.plugins) for (const f of cfg.plugins) this.use(f);

    // Initial paint.
    this.refresh();
    // Reflect any initial sort directive onto the freshly painted header cells.
    this.reflectSortAria();
  }

  /**
   * Wire the standard `GridFeature` plugins from declarative config. Each is a
   * pure `GridApi` consumer (it never reaches into engine internals), so this is
   * just translating `GridOptions` → feature installs. Defaults make the common
   * case (sortable/filterable columns, selection, editing) work with no extra
   * setup; the `features`/`selection`/`editing`/`treeMode` options refine it.
   */
  private autoRegisterFeatures(): void {
    const cfg = this.config;
    const features = cfg.features ?? {};

    // Column ops (resize / reorder / hide / freeze) — on unless explicitly off.
    if (features.columnResize !== false || features.columnReorder !== false) {
      this.use(
        columnFeature<Row>({
          resize: features.columnResize !== false,
          reorder: features.columnReorder !== false,
        }),
      );
    }

    // Sorting — on by default (per-column `sortable` still gates each column).
    if (features.sort !== false) {
      const opt = typeof features.sort === 'object' ? features.sort : {};
      this.use(
        sortFeature<Row>({
          multi: opt.multi ?? false,
          ...(opt.initial ? { initial: opt.initial } : {}),
        }),
      );
    }

    // Filtering — on by default (per-column `filterable` still gates).
    if (features.filter !== false) {
      const opt = typeof features.filter === 'object' ? features.filter : {};
      this.use(
        filterFeature<Row>({
          ...(opt.initial ? { initial: opt.initial } : {}),
        }),
      );
    }

    // Grouping — only when explicitly requested (changes the row view shape).
    if (features.group) {
      const opt = typeof features.group === 'object' ? features.group : {};
      const aggregations = opt.aggregations as
        | Record<string, AggregatorSpec<Row>>
        | undefined;
      const footerAggregations = opt.footerAggregations as
        | Record<string, AggregatorSpec<Row>>
        | undefined;
      this.use(
        groupFeature<Row>({
          ...(opt.initial ? { initial: opt.initial } : {}),
          ...(aggregations ? { aggregations } : {}),
          ...(footerAggregations ? { footerAggregations } : {}),
        }),
      );
    }

    // NOTE: selection and editing are provided out of the box by the engine's
    // built-in `DefaultSelectionModel` / `DefaultEditSession` (driven from the
    // delegated click/dblclick/keydown handlers above). The columns-area
    // `selectionFeature` / `editingFeature` are richer opt-in alternatives a
    // consumer can install via `plugins`/`use()`; they are NOT auto-registered
    // here to avoid double-handling the same interactions.

    // Export (CSV / Excel-XML / print) — install when `features.export` is set.
    // Previously this config key was declared but never consumed (a dead key);
    // wiring it here makes `features: { export: true }` actually ship the feature.
    if (features.export) {
      this.use(exportFeature<Row>());
    }

    // Clipboard copy/paste — install the columns-area selection+clipboard feature
    // when `features.clipboard` is set (also previously a dead key). It registers
    // copy/paste over a cell/range selection model + the contract selection events.
    if (features.clipboard) {
      const mode =
        cfg.selection === 'range' || cfg.selection === 'cell' ? cfg.selection : 'range';
      this.use(selectionFeature<Row>({ mode, clipboard: true }));
    }

    // Built-in row-selector checkbox column — install when `features.selectionColumn`
    // is set. Binds to the engine selection model (`api.selection`); a `multi`
    // selection mode makes the header "select all" + per-row checkboxes meaningful.
    if (features.selectionColumn) {
      const opt =
        typeof features.selectionColumn === 'object' ? features.selectionColumn : {};
      this.use(
        selectionColumnFeature<Row>({
          ...(opt.columnId != null ? { columnId: opt.columnId } : {}),
          ...(opt.columnWidth != null ? { columnWidth: opt.columnWidth } : {}),
          ...(opt.headerCheckbox != null ? { headerCheckbox: opt.headerCheckbox } : {}),
        }),
      );
    }

    // Responsive column auto-hide — install when `features.responsive` is set.
    // Priority mode uses each column's `responsivePriority`/`minGridWidth`; the
    // object form supplies explicit breakpoints. Observes the grid root width.
    if (features.responsive) {
      const opt = typeof features.responsive === 'object' ? features.responsive : {};
      this.use(
        responsiveFeature<Row>({
          ...(opt.breakpoints ? { breakpoints: opt.breakpoints } : {}),
        }),
      );
    }

    // Tree mode — install when enabled and the store supports hierarchy.
    const treeEnabled =
      cfg.treeMode === true ||
      (typeof cfg.treeMode === 'object' && cfg.treeMode?.enabled === true);
    if (treeEnabled) {
      const tm = typeof cfg.treeMode === 'object' ? cfg.treeMode : {};
      this.use(
        treeFeature<Row>({
          ...(tm.treeColumn ? { treeColumn: tm.treeColumn } : {}),
          ...(tm.indent != null ? { indent: tm.indent } : {}),
        }),
      );
    }
  }

  /** (Re)subscribe to the active store's `change` event. */
  private wireStore(): void {
    this.storeUnsub?.();
    const unsub = this.store.events.on('change', () => {
      this.engine.invalidateRows();
      this.scheduleRefresh();
    });
    this.storeUnsub = unsub;
    this.track(() => this.storeUnsub?.());
  }

  /* ── DOM event delegation (single listener set) ──────────────────────── */

  private bindDomEvents(): void {
    // NOTE: handlers are bound here (not via arrow class fields) because field
    // initializers run AFTER super()→render(); arrow fields would be undefined
    // when this binding code runs during construction.
    const onScroll = (): void => this.onScroll();
    this.scrollEl.addEventListener('scroll', onScroll, { passive: true });
    this.track(() => this.scrollEl.removeEventListener('scroll', onScroll));

    // One click listener on the root → resolve target cell/row (event delegation).
    // A click on a sortable column header drives sorting and must NOT fall through
    // to cell/row selection, so it is handled first and short-circuits.
    this.listen('click', (e) => {
      if (this.onHeaderActivate(e)) return;
      this.onClick(e);
    });
    this.listen('dblclick', (e) => this.onDblClick(e));

    // Commit-on-blur for inline edits.
    const onFocusOut = (): void => this.onFocusOut();
    this.scrollEl.addEventListener('focusout', onFocusOut, true);
    this.track(() => this.scrollEl.removeEventListener('focusout', onFocusOut, true));

    // Keyboard navigation for edits + cell nav + header sort activation.
    this.listen('keydown', (e) => this.onKeyDown(e));

    // Keep `aria-sort` in sync as the sort directives change.
    this.track(this.on('sortChange', () => this.reflectSortAria()));
  }

  /**
   * Handle activation (click or Enter/Space) on a sortable column header by
   * forwarding to the sort feature's `handleHeaderActivate`, which cycles the
   * column asc → desc → none (honoring the multi-sort modifier on the event).
   * Returns `true` when the event targeted a column header and was consumed, so
   * the caller can stop (a header is not a body cell). `aria-sort` is refreshed
   * by the `sortChange` listener wired in {@link bindDomEvents}.
   */
  private onHeaderActivate(e: MouseEvent | KeyboardEvent): boolean {
    const target = e.target as HTMLElement | null;
    const headerCell = target?.closest<HTMLElement>('.jects-grid__header-cell');
    if (!headerCell) return false;
    const colId = headerCell.dataset['colId'];
    if (colId == null) return true;
    // Only sortable headers carry the affordance; still consume the event so a
    // non-sortable header click doesn't fall through to the body handler.
    if (headerCell.dataset['sortable'] == null) return true;

    const sort = this._features.get('sort') as
      | { handleHeaderActivate?: (id: string, ev?: MouseEvent | KeyboardEvent) => void }
      | undefined;
    sort?.handleHeaderActivate?.(colId, e);
    return true;
  }

  /**
   * Reflect the active sort directives onto each column header's `aria-sort`
   * (and a `--sorted-asc/desc` class for styling). Reads the sort feature's
   * state if present; every sortable header without a directive is reset to
   * `none`. Called after every `sortChange` and after a header rerender.
   */
  private reflectSortAria(): void {
    if (!this.scrollEl) return;
    const sort = this._features.get('sort') as
      | { directionOf?: (id: string) => 'asc' | 'desc' | null }
      | undefined;
    const headers = this.scrollEl.querySelectorAll<HTMLElement>('.jects-grid__header-cell');
    headers.forEach((cell) => {
      if (cell.dataset['sortable'] == null) return;
      const id = cell.dataset['colId'];
      const dir = id != null ? (sort?.directionOf?.(id) ?? null) : null;
      cell.setAttribute('aria-sort', dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : 'none');
      cell.classList.toggle('jects-grid__header-cell--sorted-asc', dir === 'asc');
      cell.classList.toggle('jects-grid__header-cell--sorted-desc', dir === 'desc');
    });
  }

  private onScroll(): void {
    const changed = this.engine.setScroll(this.scrollEl.scrollTop, this.scrollEl.scrollLeft);
    if (!changed) return;
    this.emit('scroll', {
      scrollTop: this.engine.scrollTop,
      scrollLeft: this.engine.scrollLeft,
    });
    this.scheduleRefresh();
  }

  private onFocusOut(): void {
    if (this.editingOpts.commitOnBlur && this._editing.isEditing()) {
      // Defer so focus has settled; if still editing (focus left the editor), commit.
      queueMicrotask(() => {
        if (this._editing.isEditing()) this._editing.commit();
      });
    }
  }

  private onClick(e: MouseEvent): void {
    const target = e.target as HTMLElement;
    // Tree expander.
    const toggle = target.closest<HTMLElement>('[data-tree-toggle]');
    if (toggle) {
      this.handleTreeToggle(toggle);
      return;
    }
    const address = this.addressFromEvent(target);
    if (!address) return;
    const entry = this.engine.getRowEntry(address.rowIndex);
    const col = this.engine.columns[address.colIndex];
    if (!entry || !col) return;

    this.emit('cellClick', {
      row: entry.row,
      column: col.def,
      address,
      event: e,
    });

    // Move the roving tabindex to the clicked cell so keyboard nav resumes here.
    this.focusedCell = address;
    this.applyRovingTabindex();

    // Selection behavior.
    this.applyClickSelection(address, entry.id, e);

    if (this.editingOpts.enabled && this.editingOpts.trigger === 'click') {
      this._editing.start(address);
    }
  }

  private onDblClick(e: MouseEvent): void {
    const target = e.target as HTMLElement;
    const address = this.addressFromEvent(target);
    if (!address) return;
    const entry = this.engine.getRowEntry(address.rowIndex);
    const col = this.engine.columns[address.colIndex];
    if (!entry || !col) return;
    this.emit('cellDblClick', { row: entry.row, column: col.def, address, event: e });
    if (this.editingOpts.enabled && this.editingOpts.trigger === 'dblclick') {
      this._editing.start(address);
    }
  }

  private onKeyDown(e: KeyboardEvent): void {
    const evTarget = e.target as HTMLElement | null;
    // Column-header activation (WAI-ARIA: Enter/Space on a columnheader sorts).
    if (evTarget?.closest('.jects-grid__header-cell')) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
        if (this.onHeaderActivate(e)) e.preventDefault();
      }
      return;
    }
    if (!this._editing.isEditing()) {
      // Cell navigation (WAI-ARIA grid pattern) when not editing. Only act on
      // keys that originate within the grid body (a focused gridcell).
      const target = e.target as HTMLElement | null;
      if (target && target.closest('.jects-grid__cell')) {
        const NAV_KEYS = new Set([
          'ArrowDown',
          'ArrowUp',
          'ArrowLeft',
          'ArrowRight',
          'Home',
          'End',
          'PageDown',
          'PageUp',
        ]);
        if (NAV_KEYS.has(e.key) && this.handleNavKey(e)) {
          e.preventDefault();
          return;
        }
        // Enter / F2 begin editing the focused cell (WAI-ARIA grid convention).
        if ((e.key === 'Enter' || e.key === 'F2') && this.editingOpts.enabled && this.focusedCell) {
          e.preventDefault();
          this._editing.start({ ...this.focusedCell });
        }
      }
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      this._editing.commit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      this._editing.cancel();
    } else if (e.key === 'Tab' && this.editingOpts.keyboardNav) {
      const active = this._editing.active;
      if (!active) return;
      e.preventDefault();
      // Only advance if the current cell committed cleanly. A blocked commit
      // (validation failure) keeps the current editor mounted; advancing anyway
      // would orphan it (leaked editor + DOM, stale editing state).
      if (!this._editing.commit()) return;
      const nextCol = active.colIndex + (e.shiftKey ? -1 : 1);
      if (nextCol >= 0 && nextCol < this.engine.columns.length) {
        this._editing.start({ rowIndex: active.rowIndex, colIndex: nextCol });
      }
    }
  }

  private applyClickSelection(address: CellAddress, id: RecordId, e: MouseEvent): void {
    const mode = this._selection.mode;
    if (mode === 'none') return;
    if (mode === 'single') {
      this._selection.select(id);
    } else if (mode === 'multi') {
      if (e.ctrlKey || e.metaKey) this._selection.toggle(id);
      else this._selection.select(id);
    } else if (mode === 'cell') {
      this._selection.selectCell(address);
    } else if (mode === 'range') {
      const cells = this._selection.getSelectedCells();
      if (e.shiftKey && cells.length > 0) {
        this._selection.selectRange(cells[0]!, address);
      } else {
        this._selection.selectCell(address);
      }
    }
  }

  private async handleTreeToggle(toggle: HTMLElement): Promise<void> {
    const row = toggle.closest<HTMLElement>('.jects-grid__row');
    const rowId = row?.dataset['rowId'];
    if (rowId == null) return;
    const idx = Number(row!.dataset['rowIndex']);
    const entry = this.engine.getRowEntry(idx);
    if (!entry) return;
    const store = this.store as unknown as {
      isExpanded?: (id: RecordId) => boolean;
      expand?: (id: RecordId) => Promise<void>;
      collapse?: (id: RecordId) => void;
    };
    if (typeof store.isExpanded !== 'function') return;
    const expanded = store.isExpanded(entry.id);
    if (expanded) store.collapse?.(entry.id);
    else await store.expand?.(entry.id);
    this.emit('rowExpand', { row: entry.row, id: entry.id, expanded: !expanded });
    // store 'change' (from expand/collapse) triggers a refresh; ensure it happens.
    this.engine.invalidateRows();
    this.scheduleRefresh();
  }

  /** Resolve a DOM target → cell address, or undefined. */
  private addressFromEvent(target: HTMLElement): CellAddress | undefined {
    const cell = target.closest<HTMLElement>('.jects-grid__cell');
    const row = target.closest<HTMLElement>('.jects-grid__row');
    if (!cell || !row) return undefined;
    const rowIndex = Number(row.dataset['rowIndex']);
    const colIndex = Number(cell.dataset['colIndex']);
    if (Number.isNaN(rowIndex) || Number.isNaN(colIndex)) return undefined;
    return { rowIndex, colIndex };
  }

  private resolveCell(address: CellAddress):
    | { row: Row; id: RecordId; column: ColumnDef<Row>; value: unknown; el: HTMLElement }
    | undefined {
    const entry = this.engine.getRowEntry(address.rowIndex);
    const col = this.engine.columns[address.colIndex];
    if (!entry || !col) return undefined;
    const el = this.scrollEl.querySelector<HTMLElement>(
      `.jects-grid__row[data-row-index="${address.rowIndex}"] .jects-grid__cell[data-col-index="${address.colIndex}"]`,
    );
    if (!el) return undefined;
    const value = col.def.field != null ? (entry.row as Model)[col.def.field] : undefined;
    return { row: entry.row, id: entry.id, column: col.def, value, el };
  }

  /* ── sizing / scheduling ─────────────────────────────────────────────── */

  private measureViewport(): void {
    const rect = this.scrollEl.getBoundingClientRect();
    // jsdom returns 0 for layout — fall back to clientWidth/Height or attribute hints.
    const width = rect.width || this.scrollEl.clientWidth || 0;
    const height = rect.height || this.scrollEl.clientHeight || 0;
    this.engine.setViewportSize(width, height);
  }

  private observeResize(): void {
    if (typeof ResizeObserver === 'undefined') return;
    this.resizeObserver = new ResizeObserver(() => {
      // A container resize changes the available width, which flex columns use
      // to compute their rendered widths. paint() re-renders only the body, so
      // the header would keep its mount-time widths and drift out of alignment.
      // Re-render the header too whenever the layout actually changed.
      if (this.measureAndMaybeRefresh()) {
        this.rerenderHeader();
        this.scheduleRefresh();
      }
    });
    this.resizeObserver.observe(this.scrollEl);
    this.track(() => {
      this.resizeObserver?.disconnect();
      this.resizeObserver = null;
    });
  }

  private measureAndMaybeRefresh(): boolean {
    const rect = this.scrollEl.getBoundingClientRect();
    const width = rect.width || this.scrollEl.clientWidth || 0;
    const height = rect.height || this.scrollEl.clientHeight || 0;
    return this.engine.setViewportSize(width, height);
  }

  private scheduleRefresh(): void {
    if (this.rafPending) return;
    this.rafPending = true;
    const run = (): void => {
      this.rafPending = false;
      if (this.isDestroyed) return;
      this.paint();
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
    else queueMicrotask(run);
  }

  private paint(): void {
    this.syncGridAria();
    const window = this.engine.computeViewportWindow();
    this._renderer.renderViewport(window);
    this.applyRovingTabindex();
    this.emit('viewportChange', { window });
  }

  /* ── keyboard cell navigation (WAI-ARIA grid pattern) ────────────────── */

  /**
   * Maintain a single tabbable cell (roving tabindex): exactly one rendered
   * `gridcell` carries `tabindex=0`; all others get `tabindex=-1`. Called after
   * every paint so recycled/repainted cells stay consistent. The entry point is
   * the top-left cell until the user moves focus.
   */
  private applyRovingTabindex(): void {
    if (!this.scrollEl) return;
    const count = this.engine.getRowCount();
    const colCount = this.engine.columns.length;
    if (count === 0 || colCount === 0) {
      this.focusedCell = null;
      return;
    }
    // Default the entry point to the first cell; clamp a stale focus to bounds.
    if (!this.focusedCell) {
      this.focusedCell = { rowIndex: 0, colIndex: 0 };
    } else {
      this.focusedCell = {
        rowIndex: Math.min(this.focusedCell.rowIndex, count - 1),
        colIndex: Math.min(this.focusedCell.colIndex, colCount - 1),
      };
    }
    const focused = this.focusedCell;
    const cells = this.scrollEl.querySelectorAll<HTMLElement>('.jects-grid__cell');
    cells.forEach((cell) => {
      const r = Number(cell.closest<HTMLElement>('.jects-grid__row')?.dataset['rowIndex']);
      const c = Number(cell.dataset['colIndex']);
      const isFocused = r === focused.rowIndex && c === focused.colIndex;
      cell.tabIndex = isFocused ? 0 : -1;
    });
  }

  /** The DOM element for a cell address, if currently rendered. */
  private cellElAt(address: CellAddress): HTMLElement | null {
    return this.scrollEl.querySelector<HTMLElement>(
      `.jects-grid__row[data-row-index="${address.rowIndex}"] .jects-grid__cell[data-col-index="${address.colIndex}"]`,
    );
  }

  /**
   * Move keyboard focus to a cell: clamp to bounds, scroll it into view, repaint
   * (so the freshly painted cell can receive the roving `tabindex=0`), then
   * focus the actual DOM element. Used by the arrow/Home/End/PageUp/PageDown
   * handlers to traverse the grid per the WAI-ARIA grid pattern.
   */
  private focusCell(address: CellAddress): void {
    const count = this.engine.getRowCount();
    const colCount = this.engine.columns.length;
    if (count === 0 || colCount === 0) return;
    const target: CellAddress = {
      rowIndex: Math.max(0, Math.min(address.rowIndex, count - 1)),
      colIndex: Math.max(0, Math.min(address.colIndex, colCount - 1)),
    };
    this.focusedCell = target;
    // Bring it into view (vertical + horizontal); this may repaint via applyScroll.
    this._viewport.scrollToRow(target.rowIndex);
    this._viewport.scrollToColumn(target.colIndex);
    // Ensure the target row/cell is painted and tabindex is up to date.
    this.paint();
    const el = this.cellElAt(target);
    el?.focus();
  }

  /** Approximate number of fully visible rows for PageUp/PageDown paging. */
  private pageRows(): number {
    const rowH = this.engine.rowSize(this.focusedCell?.rowIndex ?? 0) || 1;
    return Math.max(1, Math.floor(this.engine.viewportHeight / rowH) || 1);
  }

  /**
   * Handle grid-level navigation keys (not while editing). Implements the
   * WAI-ARIA grid keyboard model: arrows move one cell, Home/End jump to the
   * row's first/last column (Ctrl+Home/End to the grid corners), PageUp/PageDown
   * page by a viewport of rows. Returns `true` if the key was handled.
   */
  private handleNavKey(e: KeyboardEvent): boolean {
    const cur = this.focusedCell;
    if (!cur) return false;
    const count = this.engine.getRowCount();
    const colCount = this.engine.columns.length;
    const page = this.pageRows();
    switch (e.key) {
      case 'ArrowDown':
        this.focusCell({ rowIndex: cur.rowIndex + 1, colIndex: cur.colIndex });
        return true;
      case 'ArrowUp':
        this.focusCell({ rowIndex: cur.rowIndex - 1, colIndex: cur.colIndex });
        return true;
      case 'ArrowRight':
        this.focusCell({ rowIndex: cur.rowIndex, colIndex: cur.colIndex + 1 });
        return true;
      case 'ArrowLeft':
        this.focusCell({ rowIndex: cur.rowIndex, colIndex: cur.colIndex - 1 });
        return true;
      case 'Home':
        this.focusCell(
          e.ctrlKey || e.metaKey
            ? { rowIndex: 0, colIndex: 0 }
            : { rowIndex: cur.rowIndex, colIndex: 0 },
        );
        return true;
      case 'End':
        this.focusCell(
          e.ctrlKey || e.metaKey
            ? { rowIndex: count - 1, colIndex: colCount - 1 }
            : { rowIndex: cur.rowIndex, colIndex: colCount - 1 },
        );
        return true;
      case 'PageDown':
        this.focusCell({ rowIndex: cur.rowIndex + page, colIndex: cur.colIndex });
        return true;
      case 'PageUp':
        this.focusCell({ rowIndex: cur.rowIndex - page, colIndex: cur.colIndex });
        return true;
      default:
        return false;
    }
  }

  /**
   * Publish the *true* row/column totals on the role="grid" root so assistive
   * tech can perceive them even though only the virtualized window is in the
   * DOM (C5). `aria-rowcount` counts the header row + every data row; per-row
   * `aria-rowindex` / per-cell `aria-colindex` are set by the renderer.
   */
  private syncGridAria(): void {
    const dataRows = this.engine.getRowCount();
    const cols = this.engine.columns.length;
    // +1 for the header rowgroup's single header row.
    this.el.setAttribute('aria-rowcount', String(dataRows + 1));
    this.el.setAttribute('aria-colcount', String(cols));
  }

  private applyScroll(opts: { top?: number; left?: number }): void {
    if (opts.top != null) this.scrollEl.scrollTop = opts.top;
    if (opts.left != null) this.scrollEl.scrollLeft = opts.left;
    // jsdom won't fire scroll; sync engine directly.
    this.engine.setScroll(this.scrollEl.scrollTop, this.scrollEl.scrollLeft);
    this.scheduleRefresh();
  }

  private onSelectionChange(): void {
    // Repaint currently rendered rows (cheap) + emit.
    this.paint();
    this.emit('selectionChange', {
      selectedIds: this._selection.getSelectedIds(),
      cells: this._selection.getSelectedCells(),
    });
  }

  /* ════════════════════════════════════════════════════════════════════════
     GridApi implementation
     ════════════════════════════════════════════════════════════════════════ */

  get store(): Store<Row> {
    return this.engine.rowModel.store;
  }
  get columns(): ReadonlyArray<ColumnDef<Row>> {
    return this.engine.columns.map((c) => c.def);
  }
  get viewport(): Viewport {
    return this._viewport;
  }
  get selection(): DefaultSelectionModel<Row> {
    return this._selection;
  }
  get editing(): DefaultEditSession<Row> {
    return this._editing;
  }
  get renderer(): Renderer<Row> {
    return this._renderer;
  }
  /**
   * The underlying headless {@link GridEngine}. Exposed so the span-aware
   * renderer factory ({@link spanRendererFactory}) and advanced consumers can
   * build engine-backed views (merged cells, custom backends) through the public
   * widget rather than reaching into private state. Not part of the frozen
   * {@link GridApi}; additive.
   */
  getEngine(): GridEngine<Row> {
    return this.engine;
  }
  get features(): ReadonlyMap<string, GridFeature<Row>> {
    return this._features;
  }

  getRow(rowIndex: number): Row | undefined {
    return this.engine.getRow(rowIndex);
  }
  getRowById(id: RecordId): Row | undefined {
    return this.engine.getRowById(id);
  }
  getRowIndex(id: RecordId): number {
    return this.engine.getRowIndex(id);
  }
  getRowCount(): number {
    return this.engine.getRowCount();
  }

  getColumn(id: string): ColumnDef<Row> | undefined {
    return this.engine.columns.find((c) => c.id === id)?.def;
  }
  setColumns(columns: ColumnDef<Row>[]): void {
    this.engine.setColumns(columns);
    this.rerenderHeader();
    this.scheduleRefresh();
  }
  updateColumn(id: string, patch: Partial<ColumnDef<Row>>): void {
    this.engine.updateColumn(id, patch);
    this.rerenderHeader();
    this.scheduleRefresh();
  }

  refresh(): void {
    this.paint();
  }
  refreshRow(id: RecordId): void {
    const idx = this.engine.getRowIndex(id);
    if (idx < 0) return;
    const r = this._renderer as DomRenderer<Row>;
    if (typeof r.refreshRow === 'function') r.refreshRow(idx);
    else this.paint();
  }
  refreshCell(rowIndex: number, colIndex: number): void {
    this._renderer.updateCell(rowIndex, colIndex);
  }
  invalidateLayout(): void {
    this.engine.invalidateLayout();
    this.rerenderHeader();
    this.scheduleRefresh();
  }

  /**
   * Install (or clear, with `null`) an engine row-source override — the seam a
   * grouping feature uses to supply interleaved group-header + leaf rows the
   * store alone can't express. Additive, non-`GridApi` surface duck-typed by
   * {@link GroupFeature} (see `GroupRowSourceHost`); restores the default
   * store/tree view when passed `null`. Repaints after re-materializing.
   */
  setRowSource(source: RowSource<Row> | null): void {
    this.engine.setRowSource(source);
    this.scheduleRefresh();
  }

  private rerenderHeader(): void {
    const r = this._renderer as DomRenderer<Row>;
    if (typeof r.renderHeader === 'function') r.renderHeader();
    // A freshly built header resets `aria-sort` to 'none'; reflect any active
    // sort directive back onto the new header cells.
    this.reflectSortAria();
  }

  /* ── feature lifecycle ───────────────────────────────────────────────── */

  use(feature: GridFeature<Row>): GridFeature<Row> {
    if (this._features.has(feature.name)) {
      this.removeFeature(feature.name);
    }
    this._features.set(feature.name, feature);
    feature.init(this);
    return feature;
  }

  removeFeature(name: string): void {
    const f = this._features.get(name);
    if (!f) return;
    this._features.delete(name);
    try {
      f.destroy();
    } catch {
      /* ignore feature teardown errors */
    }
  }

  /* ── events: re-expose Widget emitter as GridApi.on/off/once/emit ────── */
  // (Widget already provides on/once/off/emit with the right signatures.)

  /** Register a disposer the grid runs on destroy (GridApi.track). */
  override track(disposer: () => void): void {
    super.track(disposer);
  }

  /* ── Widget lifecycle ────────────────────────────────────────────────── */

  override update(patch: Partial<GridOptions<Row>>): this {
    super.update(patch);
    if (!this.engine) return this;
    if (patch.columns) this.setColumns(patch.columns);
    if (patch.rowHeight != null) this.engine.setRowHeight(patch.rowHeight);
    if (patch.headerHeight != null) {
      this.engine.setHeaderHeight(patch.headerHeight);
      this.rerenderHeader();
    }
    if (patch.selection) this._selection.setMode(patch.selection);
    if (patch.emptyText != null) this.engine.setEmptyText(patch.emptyText);
    if (patch.editing !== undefined) this.editingOpts = normalizeEditing(patch.editing);
    if (patch.data) {
      this.engine.setData(patch.data);
      this.wireStore();
    }
    this.scheduleRefresh();
    return this;
  }

  override destroy(): void {
    if (this.isDestroyed) return;
    // Tear down features first (they registered via track too, but call destroy explicitly).
    for (const name of [...this._features.keys()]) this.removeFeature(name);
    this._editing?.dispose();
    this._renderer?.destroy();
    super.destroy();
  }
}

// Register for declarative composition: create({ type: 'grid', data, columns }).
register(
  'grid',
  Grid as unknown as new (host: HTMLElement | string, config?: Record<string, unknown>) => Grid,
);
