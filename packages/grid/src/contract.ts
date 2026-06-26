/**
 * @jects/grid — FROZEN GRID CONTRACT (types & interfaces only; no implementation).
 *
 * This file is the stable, contract-first API that the three grid build agents
 * code against:
 *
 *   - 3A (engine)   implements the `Grid` Widget class + core `GridApi` surface,
 *                   the default DOM-recycling `Renderer`, the `Viewport`, and the
 *                   `SelectionModel`/`EditSession` plumbing.
 *   - 3B (modules)  implements sorting/filtering/grouping/tree/column features as
 *                   `GridFeature` plugins that attach via `grid.use(feature)` and
 *                   talk to the engine ONLY through `GridApi`.
 *   - 3C (modules)  implements editing/selection-extension/clipboard/export features,
 *                   also as `GridFeature` plugins over the same `GridApi`.
 *
 * Rules of the contract:
 *   - Nothing here imports DOM-building or runtime logic; it only re-uses the
 *     framework-free types from `@jects/core` (`Store`, `TreeStore`, `Model`,
 *     `RecordId`, `WidgetConfig`, `WidgetEvents`, `EventMap`).
 *   - The `Grid` Widget class itself is implemented by 3A; here we declare ONLY
 *     its public type signature (`GridCtor` + the `Grid` interface shape).
 *   - Features never reach into Grid internals — they extend behavior purely
 *     through the `GridApi` handed to `GridFeature.init(api)`. This is the
 *     "GridApi extension model" (see the engine-extension notes at the bottom).
 */

import type {
  Store,
  TreeStore,
  Model,
  RecordId,
  WidgetConfig,
  WidgetEvents,
  EventMap,
} from '@jects/core';

/* ═══════════════════════════════════════════════════════════════════════════
   1. COLUMNS
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Built-in column cell kinds. `template` defers to a custom `renderer`.
 *
 * `rating`/`widget`/`rownumber` are the additional typed columns (Bryntum/DHTMLX
 * parity), implemented by the renderers in `columns/extra-renderers.ts`:
 *   - `rating`     ★ star rating (editable)
 *   - `widget`     mounts an arbitrary @jects/widgets control per cell
 *   - `rownumber`  auto sequential 1-based view index (frozen-friendly)
 *   - `select`     row-selector checkbox bound to the selection model
 *                  (see `SelectionColumnFeature`)
 */
export type ColumnType =
  | 'text'
  | 'number'
  | 'date'
  | 'check'
  | 'action'
  | 'tree'
  | 'template'
  | 'rating'
  | 'widget'
  | 'rownumber'
  | 'select';

/** Horizontal cell content alignment. */
export type ColumnAlign = 'start' | 'center' | 'end';

/** Which edge a column is pinned to (un-pinned columns scroll). */
export type FrozenSide = 'left' | 'right';

/**
 * Declarative description of a single grid column. Authored by consumers and
 * frozen by the engine into resolved column geometry at render time.
 */
export interface ColumnDef<Row extends Model = Model> {
  /** Dotted/plain path into the row model. Optional for `action`/`template`. */
  field?: keyof Row & string;
  /** Header label (or a renderer that returns header content). */
  header?: string;
  /** Fixed width in px. Ignored when `flex` is set. */
  width?: number;
  /** Minimum width in px when flexing/resizing. */
  minWidth?: number;
  /** Maximum width in px when flexing/resizing. */
  maxWidth?: number;
  /** Flex grow factor; columns with `flex` share leftover horizontal space. */
  flex?: number;
  /** Cell kind. Default `'text'`. */
  type?: ColumnType;
  /** Custom cell renderer (required/used when `type === 'template'`). */
  renderer?: CellRenderer<Row>;
  /** Custom inline editor. When omitted, the engine picks one by `type`. */
  editor?: CellEditor<Row>;
  /** Whether the column participates in sorting. */
  sortable?: boolean;
  /** Whether the column participates in filtering. */
  filterable?: boolean;
  /** Whether the column can be resized by the user. */
  resizable?: boolean;
  /** Whether the column can be reordered by the user. */
  reorderable?: boolean;
  /** Pin the column to an edge. */
  frozen?: FrozenSide;
  /** Content alignment. */
  align?: ColumnAlign;
  /** Hide the column without removing it from the model. */
  hidden?: boolean;
  /** Stable identity; defaults to `field`. Used by features for state keys. */
  id?: string;
  /**
   * Responsive auto-hide priority. Lower priorities are hidden FIRST as the grid
   * narrows (consumed by `ResponsiveFeature` / `features.responsive`); columns
   * without a priority are never auto-hidden. A column may also declare a
   * `minGridWidth` (px) below which it hides regardless of priority ranking.
   */
  responsivePriority?: number;
  /** Hide this column whenever the grid is narrower than this width (px). */
  minGridWidth?: number;
  /** Arbitrary per-column metadata for features. */
  meta?: Record<string, unknown>;
}

/* ═══════════════════════════════════════════════════════════════════════════
   2. CELL RENDERING & EDITING
   ═══════════════════════════════════════════════════════════════════════════ */

/** Context handed to a cell renderer for one cell. */
export interface CellRenderContext<Row extends Model = Model> {
  /** The row model. */
  row: Row;
  /** The resolved cell value (`row[column.field]`). */
  value: unknown;
  /** The column definition. */
  column: ColumnDef<Row>;
  /** Absolute row index in the (filtered/sorted) view. */
  rowIndex: number;
  /** Visible column index. */
  colIndex: number;
  /** The cell element to populate (mutate in place, or return new content). */
  el: HTMLElement;
  /** The grid public API, for renderers that need state/services. */
  api: GridApi<Row>;
}

/**
 * Cell renderer. Returning a **string** sets the cell's `textContent` (so the
 * string is escaped and rendered as plain text, never parsed as HTML); returning
 * an element replaces the cell content; returning `void` means the renderer
 * mutated `el` directly.
 *
 * Security (docs/SECURITY.md surface #2): a renderer is author-controlled but may
 * interpolate untrusted row data. Returning a string is always safe. If you must
 * emit markup, build a DOM node, or escape every interpolated value with the
 * `escapeHtml`/`escape` helper before assigning to `el.innerHTML`, or pass
 * caller-authored markup through `sanitizeHtml` from `@jects/core`.
 */
export type CellRenderer<Row extends Model = Model> = (
  ctx: CellRenderContext<Row>,
) => string | HTMLElement | void;

/** Context handed to a cell editor when an edit begins. */
export interface CellEditContext<Row extends Model = Model> {
  /** The row being edited. */
  row: Row;
  /** Current cell value. */
  value: unknown;
  /** The column definition. */
  column: ColumnDef<Row>;
  /** Absolute row index. */
  rowIndex: number;
  /** Visible column index. */
  colIndex: number;
  /** Container the editor should mount into. */
  el: HTMLElement;
  /** Grid public API. */
  api: GridApi<Row>;
}

/**
 * Pluggable inline editor. The engine calls `mount`, reads `getValue` on commit,
 * and calls `destroy` to tear down. Editors typically wrap an @jects/widgets
 * control (TextField, NumberField, etc.).
 */
export interface CellEditor<Row extends Model = Model> {
  /** Build/mount the editor UI; receives the edit context. */
  mount(ctx: CellEditContext<Row>): void;
  /** Return the (possibly coerced) edited value to commit to the store. */
  getValue(): unknown;
  /** Optional validity check; a falsy/string result blocks commit. */
  validate?(): true | string;
  /** Move focus into the editor (called after mount). */
  focus?(): void;
  /** Tear down listeners/DOM. */
  destroy(): void;
}

/* ═══════════════════════════════════════════════════════════════════════════
   3. PLUGGABLE RENDERER (DOM-recycling default; canvas later — D9)
   ═══════════════════════════════════════════════════════════════════════════ */

/** A window of rows/columns the renderer must paint, derived from the viewport. */
export interface ViewportWindow {
  /** First visible row index (inclusive), incl. overscan. */
  startIndex: number;
  /** Last visible row index (exclusive), incl. overscan. */
  endIndex: number;
  /** Pixel offset (translateY) for the first painted row. */
  offset: number;
  /** Total scrollable height of all rows in px. */
  totalSize: number;
  /** Resolved, ordered, visible columns for this paint. */
  columns: ReadonlyArray<ColumnDef>;
  /** Current vertical scroll position in px. */
  scrollTop: number;
  /** Current horizontal scroll position in px. */
  scrollLeft: number;
}

/**
 * Pluggable rendering backend (D9). The default is a DOM row/cell recycler; a
 * canvas renderer can be swapped in later without touching the engine, because
 * the engine drives it ONLY through this interface.
 */
export interface Renderer<Row extends Model = Model> {
  /** Attach to the host element and build static chrome (header, body, scrollers). */
  mount(host: HTMLElement, api: GridApi<Row>): void;
  /** Paint/repaint the given window of rows & columns. */
  renderViewport(window: ViewportWindow): void;
  /** Surgically repaint a single cell (e.g. after an inline edit commit). */
  updateCell(rowIndex: number, colIndex: number): void;
  /** Tear down all DOM/listeners the renderer created. */
  destroy(): void;
}

/** Factory the engine uses to construct the active renderer. */
export type RendererFactory<Row extends Model = Model> = (
  api: GridApi<Row>,
) => Renderer<Row>;

/* ═══════════════════════════════════════════════════════════════════════════
   4. VIRTUALIZATION & VIEWPORT
   ═══════════════════════════════════════════════════════════════════════════ */

/** Tuning for row/column virtualization (maps onto core `computeWindow`). */
export interface VirtualizationOptions {
  /** Enable row virtualization. Default `true`. */
  enabled?: boolean;
  /** Extra rows rendered above/below the viewport. Default a small constant. */
  overscan?: number;
  /** Enable variable row heights (backed by core `OffsetIndex`). */
  variableRowHeight?: boolean;
  /** Enable horizontal (column) virtualization for very wide grids. */
  horizontal?: boolean;
}

/**
 * Read-only viewport/scroll surface exposed to features. The engine owns it;
 * features query geometry and request scrolls but never mutate it directly.
 */
export interface Viewport {
  /** Current vertical scroll in px. */
  readonly scrollTop: number;
  /** Current horizontal scroll in px. */
  readonly scrollLeft: number;
  /** Visible viewport height in px. */
  readonly height: number;
  /** Visible viewport width in px. */
  readonly width: number;
  /** The currently computed render window. */
  readonly window: ViewportWindow;
  /** Programmatically scroll a row into view. */
  scrollToRow(rowIndex: number): void;
  /** Programmatically scroll a column into view. */
  scrollToColumn(colIndex: number): void;
  /** Set the raw scroll position. */
  scrollTo(opts: { top?: number; left?: number }): void;
}

/* ═══════════════════════════════════════════════════════════════════════════
   5. SELECTION
   ═══════════════════════════════════════════════════════════════════════════ */

/** Selection granularity. */
export type SelectionMode = 'none' | 'single' | 'multi' | 'cell' | 'range';

/** A single cell coordinate. */
export interface CellAddress {
  rowIndex: number;
  colIndex: number;
}

/**
 * Selection state surface. The engine provides a default implementation;
 * selection-extension features (3C) read/extend it through `GridApi.selection`.
 */
export interface SelectionModel<Row extends Model = Model> {
  /** Active selection mode. */
  readonly mode: SelectionMode;
  /** Selected row ids (row/multi modes). */
  getSelectedIds(): RecordId[];
  /** Selected row models. */
  getSelectedRows(): Row[];
  /** Selected cells (cell/range modes). */
  getSelectedCells(): CellAddress[];
  /** Whether a given row is selected. */
  isSelected(id: RecordId): boolean;
  /** Replace the selection with the given rows. */
  select(ids: RecordId | RecordId[]): void;
  /** Add to the current selection. */
  add(ids: RecordId | RecordId[]): void;
  /** Remove from the current selection. */
  deselect(ids: RecordId | RecordId[]): void;
  /** Select a contiguous cell range (range/cell modes). */
  selectRange(from: CellAddress, to: CellAddress): void;
  /** Clear all selection. */
  clear(): void;
}

/* ═══════════════════════════════════════════════════════════════════════════
   6. EDITING
   ═══════════════════════════════════════════════════════════════════════════ */

/** Editing behavior options. */
export interface EditingOptions {
  /** Master on/off switch. Default `false`. */
  enabled?: boolean;
  /** What starts an edit. Default `'dblclick'`. */
  trigger?: 'click' | 'dblclick' | 'manual';
  /** Commit the active edit when focus leaves the cell. Default `true`. */
  commitOnBlur?: boolean;
  /** Allow committing/advancing with Enter/Tab. Default `true`. */
  keyboardNav?: boolean;
}

/**
 * An in-progress edit. The engine creates it; editing features (3C) can observe
 * and drive it via `GridApi.editing`.
 */
export interface EditSession<Row extends Model = Model> {
  /** Cell currently being edited, or `null` when idle. */
  readonly active: CellAddress | null;
  /** The row currently being edited, or `null` when idle. */
  readonly activeRow: Row | null;
  /** Begin editing a cell. */
  start(address: CellAddress): void;
  /** Commit the current edit to the store (validates first). */
  commit(): boolean;
  /** Abandon the current edit without writing. */
  cancel(): void;
  /** Whether an edit is currently active. */
  isEditing(): boolean;
}

/* ═══════════════════════════════════════════════════════════════════════════
   7. TREE MODE
   ═══════════════════════════════════════════════════════════════════════════ */

/** Options for hierarchical (tree) grids, backed by a core `TreeStore`. */
export interface TreeModeOptions {
  /** Enable tree mode. Requires the data source to be a `TreeStore`. */
  enabled?: boolean;
  /** Column id that hosts the expand/collapse affordance. */
  treeColumn?: string;
  /** Child indentation in px per depth level. */
  indent?: number;
  /** Initially expanded node ids. */
  expanded?: RecordId[];
  /** Lazy children loader (delegates to `TreeStore.loader`). */
  lazy?: boolean;
}

/* ═══════════════════════════════════════════════════════════════════════════
   8. FEATURE STATE SHAPES (sort/filter/group)
   ═══════════════════════════════════════════════════════════════════════════ */

/** One column's sort directive. */
export interface SortState {
  columnId: string;
  direction: 'asc' | 'desc';
}

/** One column's filter directive (operator + operand are feature-defined). */
export interface FilterState {
  columnId: string;
  operator: string;
  value: unknown;
}

/** Grouping state. */
export interface GroupState {
  /** Ordered group-by column ids. */
  columnIds: string[];
  /** Collapsed group keys. */
  collapsed?: string[];
}

/** Declarative enable/config for built-in feature modules (3B/3C). */
export interface FeaturesConfig {
  /** Sorting (single/multi) — implemented by a 3B feature. */
  sort?: boolean | { multi?: boolean; initial?: SortState[] };
  /** Filtering — implemented by a 3B feature. */
  filter?: boolean | { initial?: FilterState[] };
  /**
   * Grouping — implemented by a 3B feature. The object form additionally allows
   * declaring per-group `aggregations` and grand-total `footerAggregations`
   * (each an `AggregatorSpec` map keyed by column id, kept loosely typed here so
   * the frozen contract does not depend on the feature's aggregator types).
   */
  group?:
    | boolean
    | {
        initial?: GroupState;
        aggregations?: Record<string, unknown>;
        footerAggregations?: Record<string, unknown>;
      };
  /** Column resize. */
  columnResize?: boolean;
  /** Column reorder. */
  columnReorder?: boolean;
  /** Clipboard copy/paste — implemented by a 3C feature. */
  clipboard?: boolean;
  /** Data export (CSV/etc.) — implemented by a 3C feature. */
  export?: boolean;
  /**
   * Built-in row-selector checkbox column — implemented by `SelectionColumnFeature`.
   * `true` auto-prepends the selector column (header "select all" + per-row
   * checkboxes); the object form refines its id/width/header behaviour.
   */
  selectionColumn?:
    | boolean
    | { columnId?: string; columnWidth?: number; headerCheckbox?: boolean };
  /**
   * Viewport-width-based column auto-hide — implemented by `ResponsiveFeature`.
   * `true` enables it (using each column's `responsivePriority`/`minGridWidth`);
   * the object form can supply explicit `breakpoints` (px → hidden column ids).
   */
  responsive?:
    | boolean
    | { breakpoints?: Array<{ maxWidth: number; hide: string[] }> };
}

/* ═══════════════════════════════════════════════════════════════════════════
   9. GRID OPTIONS (the top-level config)
   ═══════════════════════════════════════════════════════════════════════════ */

/** Data source: a core `Store`/`TreeStore`, or a raw row array the grid wraps. */
export type GridDataSource<Row extends Model = Model> =
  | Store<Row>
  | TreeStore<Row & { children?: Row[] }>
  | Row[];

/**
 * Top-level grid configuration. Extends `WidgetConfig` so the `Grid` widget
 * inherits `cls`/`style`/`hidden`/`disabled` and the standard lifecycle.
 */
export interface GridOptions<Row extends Model = Model> extends WidgetConfig {
  /** Data source. Required. */
  data: GridDataSource<Row>;
  /** Column definitions, in display order. Required. */
  columns: ColumnDef<Row>[];
  /** Default row height in px (variable heights via virtualization opts). */
  rowHeight?: number;
  /** Header row height in px. */
  headerHeight?: number;
  /** Virtualization tuning. */
  virtualization?: VirtualizationOptions;
  /** Selection mode. Default `'none'`. */
  selection?: SelectionMode;
  /** Editing config (or a boolean shorthand for `{ enabled }`). */
  editing?: boolean | EditingOptions;
  /** Tree-mode config (or a boolean shorthand for `{ enabled }`). */
  treeMode?: boolean | TreeModeOptions;
  /** Built-in feature enable/config. */
  features?: FeaturesConfig;
  /** Override the rendering backend (D9; default DOM recycler). */
  renderer?: RendererFactory<Row>;
  /** Plugins to install at construction time. */
  plugins?: GridFeature<Row>[];
  /** Field used as the unique row id (forwarded to the Store). */
  idField?: string;
  /** Empty-state text/content when there are no rows. */
  emptyText?: string;
}

/* ═══════════════════════════════════════════════════════════════════════════
   10. EVENTS
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Typed grid event map. Follows the house veto convention: `beforeX` events are
 * vetoable (a handler returning `false` cancels the action); plain/`afterX`
 * events are notifications.
 */
export interface GridEvents<Row extends Model = Model> extends WidgetEvents, EventMap {
  /** A cell was clicked. */
  cellClick: { row: Row; column: ColumnDef<Row>; address: CellAddress; event: MouseEvent };
  /** A cell was double-clicked. */
  cellDblClick: { row: Row; column: ColumnDef<Row>; address: CellAddress; event: MouseEvent };
  /** Vetoable: an inline edit is about to begin. */
  beforeCellEdit: { row: Row; column: ColumnDef<Row>; address: CellAddress; value: unknown };
  /** An inline edit committed. */
  cellEdit: { row: Row; column: ColumnDef<Row>; address: CellAddress; oldValue: unknown; value: unknown };
  /** The selection changed. */
  selectionChange: { selectedIds: RecordId[]; cells: CellAddress[] };
  /** Sort directives changed. */
  sortChange: { sort: SortState[] };
  /** Filter directives changed. */
  filterChange: { filter: FilterState[] };
  /** Grouping changed. */
  groupChange: { group: GroupState };
  /** A tree row expanded or collapsed. */
  rowExpand: { row: Row; id: RecordId; expanded: boolean };
  /** The viewport scrolled. */
  scroll: { scrollTop: number; scrollLeft: number };
  /** A column finished resizing. */
  columnResize: { columnId: string; width: number };
  /** Columns were reordered. */
  columnReorder: { columnId: string; fromIndex: number; toIndex: number };
  /** The set of rendered rows changed (window moved). */
  viewportChange: { window: ViewportWindow };

  /**
   * Vetoable: a row drag-reorder is about to commit (a handler returning `false`
   * cancels the move and the drop indicator is dismissed). Fired for both
   * same-grid reorders and cross-grid transfers.
   *
   * For a same-grid reorder `sourceGrid === targetGrid` and `fromIndex` is the
   * source view index. For a cross-grid drop `sourceGrid !== targetGrid`,
   * `fromIndex` is the source index within the source grid and the row is being
   * inserted into THIS (target) grid at `toIndex`.
   */
  beforeRowReorder: RowReorderPayload<Row>;
  /**
   * A row drag-reorder committed. Same payload shape as `beforeRowReorder`; this
   * is the notification fired after the store mutation (same-grid `store.move`,
   * or cross-grid remove-from-source + add-to-target) completes.
   */
  rowReorder: RowReorderPayload<Row>;
}

/**
 * Payload for the `beforeRowReorder` (vetoable) and `rowReorder` (notification)
 * events. Describes a single row being moved within a grid, or transferred
 * between two grids.
 */
export interface RowReorderPayload<Row extends Model = Model> {
  /** The dragged row model. */
  row: Row;
  /** Id of the dragged row. */
  recordId: RecordId;
  /** Source view index within `sourceGrid`. */
  fromIndex: number;
  /** Target insertion view index within `targetGrid`. */
  toIndex: number;
  /** Whether the drop lands above (`'before'`) or below (`'after'`) `toIndex`. */
  position: 'before' | 'after';
  /** The grid the row was dragged from. */
  sourceGrid: GridApi<Row>;
  /** The grid the row is dropping into. */
  targetGrid: GridApi<Row>;
  /** `true` when `sourceGrid !== targetGrid` (a cross-grid transfer). */
  crossGrid: boolean;
}

/* ═══════════════════════════════════════════════════════════════════════════
   11. GRID FEATURE / PLUGIN INTERFACE
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * A grid feature/plugin. Features are how 3B/3C add behavior. They receive the
 * `GridApi` in `init` and MUST confine all interaction with the grid to that
 * surface (no reaching into engine internals). `destroy` must release every
 * listener/effect/DOM the feature created.
 */
export interface GridFeature<Row extends Model = Model> {
  /** Unique feature name (used as the registry key on `GridApi.features`). */
  readonly name: string;
  /** Called once when the feature is installed; wire up via the API here. */
  init(grid: GridApi<Row>): void;
  /** Called when the grid (or the feature) is torn down; release everything. */
  destroy(): void;
}

/** Constructor form, for features that take config at construction. */
export type GridFeatureCtor<Row extends Model = Model> = new (
  config?: Record<string, unknown>,
) => GridFeature<Row>;

/* ═══════════════════════════════════════════════════════════════════════════
   12. GRID API (the surface the Grid class exposes to features)
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * The public service surface the `Grid` engine exposes to features/plugins and
 * advanced consumers. This is the extension seam: 3B/3C build entirely against
 * `GridApi`. The engine (3A) implements it.
 */
export interface GridApi<Row extends Model = Model> {
  /** The backing data store (always a `Store`; a `TreeStore` in tree mode). */
  readonly store: Store<Row>;
  /** The resolved, ordered column definitions (live view). */
  readonly columns: ReadonlyArray<ColumnDef<Row>>;
  /** The viewport/scroll surface. */
  readonly viewport: Viewport;
  /** The selection model. */
  readonly selection: SelectionModel<Row>;
  /** The edit session. */
  readonly editing: EditSession<Row>;
  /** The active rendering backend. */
  readonly renderer: Renderer<Row>;
  /** The grid root element. */
  readonly el: HTMLElement;
  /** Installed features, keyed by `feature.name`. */
  readonly features: ReadonlyMap<string, GridFeature<Row>>;

  /* ── data / row access ─────────────────────────────────────────────── */
  /** Row model at an absolute (post sort/filter) view index. */
  getRow(rowIndex: number): Row | undefined;
  /** Row model by id. */
  getRowById(id: RecordId): Row | undefined;
  /** View index of a row id, or -1. */
  getRowIndex(id: RecordId): number;
  /** Number of rows in the current (filtered) view. */
  getRowCount(): number;

  /* ── columns ───────────────────────────────────────────────────────── */
  /** Look up a column by id/field. */
  getColumn(id: string): ColumnDef<Row> | undefined;
  /** Replace/patch column definitions and re-resolve geometry. */
  setColumns(columns: ColumnDef<Row>[]): void;
  /** Update one column in place (width, hidden, frozen, ...). */
  updateColumn(id: string, patch: Partial<ColumnDef<Row>>): void;

  /* ── rendering ─────────────────────────────────────────────────────── */
  /** Recompute the window and repaint the viewport. */
  refresh(): void;
  /** Repaint a single row (e.g. after a model change). */
  refreshRow(id: RecordId): void;
  /** Repaint a single cell. */
  refreshCell(rowIndex: number, colIndex: number): void;
  /** Recompute resolved column widths/positions. */
  invalidateLayout(): void;

  /* ── feature lifecycle ─────────────────────────────────────────────── */
  /** Install a feature/plugin (calls `feature.init(this)`); returns it. */
  use(feature: GridFeature<Row>): GridFeature<Row>;
  /** Remove a feature by name (calls its `destroy`). */
  removeFeature(name: string): void;

  /* ── events ────────────────────────────────────────────────────────── */
  /** Subscribe to a typed grid event; returns an unsubscribe fn. */
  on<K extends keyof GridEvents<Row>>(
    event: K,
    fn: (payload: GridEvents<Row>[K]) => unknown,
  ): () => void;
  /** Subscribe once. */
  once<K extends keyof GridEvents<Row>>(
    event: K,
    fn: (payload: GridEvents<Row>[K]) => unknown,
  ): () => void;
  /** Unsubscribe. */
  off<K extends keyof GridEvents<Row>>(
    event: K,
    fn?: (payload: GridEvents<Row>[K]) => unknown,
  ): void;
  /** Emit a grid event; returns `false` if a vetoable `beforeX` was cancelled. */
  emit<K extends keyof GridEvents<Row>>(event: K, payload: GridEvents<Row>[K]): boolean;

  /* ── disposal registration for features ────────────────────────────── */
  /** Register a disposer the grid will run on `destroy()` (leak-safe helper). */
  track(disposer: () => void): void;
}

/* ═══════════════════════════════════════════════════════════════════════════
   13. GRID WIDGET — PUBLIC TYPE SIGNATURE ONLY (implemented by 3A engine)
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Public shape of the `Grid` Widget instance. The concrete class extends
 * `Widget<GridOptions, GridEvents>` from `@jects/core` and is authored by the
 * engine agent (3A); only its public type signature is frozen here.
 *
 * `Grid` IS-A `GridApi` (it exposes the same surface to consumers), plus the
 * standard Widget lifecycle (`update`/`getConfig`/`show`/`hide`/`destroy`).
 */
export interface Grid<Row extends Model = Model> extends GridApi<Row> {
  /** Stable instance id (from Widget). */
  readonly id: string;
  /** The grid root element (from Widget). */
  readonly el: HTMLElement;
  /** Merge options and re-render. */
  update(patch: Partial<GridOptions<Row>>): this;
  /** Current resolved options (read-only). */
  getConfig(): Readonly<GridOptions<Row>>;
  /** Show/hide the grid root. */
  show(): this;
  hide(): this;
  /** Whether the instance has been destroyed. */
  readonly isDestroyed: boolean;
  /** Vetoable teardown (`beforeDestroy`); disposes renderer, features, store wiring. */
  destroy(): void;
}

/**
 * Constructor signature of the `Grid` Widget class (implemented by 3A).
 * Mirrors `new Grid(host, options)` and the factory `register('grid', Grid)`.
 */
export interface GridCtor {
  new <Row extends Model = Model>(
    host: HTMLElement | string,
    options: GridOptions<Row>,
  ): Grid<Row>;
}
