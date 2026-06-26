/**
 * @jects/grid — Jects UI data grid built on @jects/core.
 *
 * Virtualized, pluggable-renderer grid. Cell editors reuse @jects/widgets
 * controls. Importing this module registers the grid with the factory.
 *
 * Side-effect CSS: `import '@jects/grid/style.css'`.
 */

import './styles.css';

/* ── HTML-security helpers (re-exported from @jects/core) ─────────────────
   The one obvious tools for custom cell-renderer authors who interpolate
   untrusted row data into markup: `escape`/`escapeHtml` for plain text and
   `sanitizeHtml` for caller-authored markup. See docs/SECURITY.md surface #2. */
export { escape, escapeHtml, sanitizeHtml } from '@jects/core';

/* ── Frozen public contract (types only) ─────────────────────────────────
   The API surface the three grid build agents (3A engine, 3B/3C modules &
   plugins) code against. See contract.ts. */
export type {
  // Options & columns
  GridOptions,
  ColumnDef,
  ColumnType,
  ColumnAlign,
  FrozenSide,
  // Rendering
  CellRenderer,
  CellRenderContext,
  CellEditor,
  CellEditContext,
  Renderer,
  RendererFactory,
  // Virtualization / viewport
  VirtualizationOptions,
  ViewportWindow,
  Viewport,
  // Selection
  SelectionMode,
  SelectionModel,
  CellAddress,
  // Editing
  EditingOptions,
  EditSession,
  // Tree mode
  TreeModeOptions,
  // Features config + plugin system
  FeaturesConfig,
  SortState,
  FilterState,
  GroupState,
  GridFeature,
  GridFeatureCtor,
  // Public surfaces
  GridApi,
  GridEvents,
  GridCtor,
} from './contract.js';

/* ── Engine (area "grid-engine") ─────────────────────────────────────────
   The keystone runtime barrel. Importing it runs `register('grid', Grid)` so
   the factory knows the grid, and exposes the `Grid` Widget class as a VALUE
   (the implementation of the frozen `GridCtor`/`Grid` contract) plus the
   headless engine and the default DOM-recycling renderer. Without this the
   package entry would export zero values and register nothing.

   NOTE: `Grid` here is the runtime class value (it shadows the contract's
   `Grid` interface, which is structurally identical). The engine barrel also
   owns the canonical `columnId`, `ColumnLayout`, `DEFAULT_COLUMN_WIDTH`, etc.,
   so the columns barrel's duplicate spellings are aliased below. */
export {
  Grid,
  GridEngine,
  DEFAULT_ROW_HEIGHT,
  DEFAULT_HEADER_HEIGHT,
  DomRenderer,
  createDomRenderer,
  RowModel,
  DefaultViewport,
  DefaultSelectionModel,
  DefaultEditSession,
  resolveColumns,
  computeColumnWindow,
  columnId,
  DEFAULT_COLUMN_WIDTH,
  DEFAULT_MIN_COLUMN_WIDTH,
  // Group header / summary row painting (engine seam consumed by GroupFeature).
  paintGroupRow,
  formatAggregate,
  formatGroupValue,
  GROUP_ROW_CLASS,
  GROUP_TOGGLE_CLASS,
  // Merged cells / spans (span-aware renderer + engine bridge).
  SpanDomRenderer,
  createSpanRenderer,
  spanRendererFactory,
  engineSpanHost,
  computeWindowSpanMap,
  hasSpanProviders,
  // RTL helpers.
  gridIsRTL,
  columnInsets,
  positionColumnCell,
  normalizeScrollLeft,
  RTL_CLASS,
} from './engine/index.js';

export type {
  GridEngineOptions,
  RowEntry,
  RowKind,
  RowSource,
  GroupRowData,
  GroupRowPaintOptions,
  ViewportHost,
  SelectionHost,
  EditHost,
  ColumnLayout,
  LaidOutColumn,
} from './engine/index.js';

/* ── Column / cell / selection / clipboard / spans modules ───────────────
   Composable modules + `GridFeature` plugins that talk to the engine via
   `GridApi`. Symbols that collide with the engine barrel (`columnId`,
   `ColumnLayout`, `DEFAULT_COLUMN_WIDTH`, `SelectionHost`) are exported under
   `Column*`-qualified aliases to keep the package entry unambiguous. */
export {
  ColumnModel,
  clampWidth,
  ColumnFeature,
  columnFeature,
  CellRendererRegistry,
  textRenderer,
  numberRenderer,
  dateRenderer,
  checkRenderer,
  actionRenderer,
  formatNumber,
  formatDate,
  toDate,
  toText,
  ratingRenderer,
  widgetCellRenderer,
  rownumberRenderer,
  selectRenderer,
  registerExtraRenderers,
  withExtraColumnRenderers,
  destroyCellWidget,
  coerceRating,
  EXTRA_RENDERERS,
  EXTRA_COLUMN_TYPES,
  SELECT_CELL_CLASS,
  SELECT_INPUT_CLASS,
  WidgetCellEditor,
  EditController,
  resolveEditor,
  controlForColumn,
  EditingFeature,
  editingFeature,
  GridSelectionModel,
  normalizeRect,
  rectContains,
  rectToCells,
  cellKeys,
  SelectionFeature,
  selectionFeature,
  matrixToTSV,
  parseTSV,
  buildCopyText,
  applyPaste,
  cellToText,
  rangeCells,
  resolveSpans,
  normalizeSpan,
  spanProviderFor,
  isCovered,
  originAt,
} from './columns/index.js';

export type {
  ColumnFeatureConfig,
  NumberFormatMeta,
  DateFormatMeta,
  CellAction,
  RatingMeta,
  WidgetCellMeta,
  WidgetCellConfig,
  RowNumberMeta,
  ExtraColumnType,
  ControlType,
  EditorMeta,
  EditControllerHooks,
  EditingFeatureConfig,
  CellRect,
  SelectionFeatureConfig,
  ClipboardHost,
  CellSpan,
  SpanContext,
  SpanProvider,
  SpanHost,
  SpanMap,
  SpanOrigin,
} from './columns/index.js';

/* ── Runtime feature plugins (installed via `grid.use(feature)`) ──────────
   Re-exported from the features barrel so consumers of the published package
   can reach every `GridFeature` class and its factory. */
export {
  SortFeature,
  sortFeature,
  FilterFeature,
  filterFeature,
  makeFilterPredicate,
  FilterBarFeature,
  filterBarFeature,
  GroupFeature,
  groupFeature,
  computeAggregate,
  SummaryFeature,
  summaryFeature,
  TreeFeature,
  treeFeature,
  QuickSearchFeature,
  quickSearchFeature,
  CellMenuFeature,
  HeaderMenuFeature,
  cellMenuFeature,
  headerMenuFeature,
  ExportFeature,
  exportFeature,
  ColumnStateFeature,
  columnStateFeature,
  ColumnPickerFeature,
  columnPickerFeature,
  ColumnAutoSizeFeature,
  columnAutoSizeFeature,
  FilterFacetFeature,
  filterFacetFeature,
  computeFacet,
  facetKey,
  BLANK_KEY,
  BLANK_LABEL,
  FillFeature,
  fillFeature,
  boundingRect,
  rectCells,
  rectHas,
  projectTarget,
  detectSeries,
  seriesValueAt,
  RowReorderFeature,
  rowReorderFeature,
  RowResizeFeature,
  rowResizeFeature,
  RowExpanderFeature,
  rowExpanderFeature,
  SelectionColumnFeature,
  selectionColumnFeature,
  renderSelectCell,
  FilterMenuFeature,
  filterMenuFeature,
  operatorsForColumn,
  OPERATOR_LABELS,
  ResponsiveFeature,
  responsiveFeature,
  TooltipFeature,
  tooltipFeature,
  detailTooltip,
  PdfExportFeature,
  pdfExportFeature,
  InfiniteLoadFeature,
  infiniteLoadFeature,
  isLoadingRecord,
  placeholderIdFor,
  LOADING_FLAG,
  UndoRedoFeature,
  undoRedoFeature,
  applyQuickSearchHighlight,
  getActiveQuickSearch,
  isQuickSearchHighlighter,
  SEARCH_MATCH_CELL_CLASS,
  GroupRowSource,
} from './features/index.js';

export type {
  SortFeatureOptions,
  FilterFeatureOptions,
  FilterOperator,
  FilterBarFeatureOptions,
  GroupFeatureOptions,
  GroupViewRow,
  AggregatorKind,
  AggregatorSpec,
  CustomAggregator,
  SummaryRow,
  SummaryFeatureOptions,
  TreeFeatureOptions,
  TreeViewRow,
  QuickSearchFeatureOptions,
  QuickSearchChangeEvent,
  CellMenuFeatureOptions,
  HeaderMenuFeatureOptions,
  CellMenuContext,
  HeaderMenuContext,
  ExportOptions,
  ExportColumnFilter,
  ColumnStateFeatureOptions,
  ColumnState,
  ColumnSnapshot,
  ColumnPickerFeatureOptions,
  ColumnPickerEvents,
  ColumnAutoSizeFeatureOptions,
  ColumnAutoSizeEvent,
  MeasureColumnContent,
  FilterFacetFeatureOptions,
  FilterFacetEvents,
  FacetValue,
  FacetComputeOptions,
  FillFeatureOptions,
  FillEvent,
  FillRect,
  FillDirection,
  FillKind,
  FillSeriesMode,
  RowReorderFeatureOptions,
  RowDragMeta,
  DropTarget,
  DropPosition,
  RowResizeFeatureOptions,
  RowResizeEvent,
  ApplyRowSize,
  RowExpanderFeatureOptions,
  RowExpanderEvents,
  DetailRenderer,
  DetailRenderContext,
  RowSourceHost,
  SelectionColumnFeatureOptions,
  FilterMenuFeatureOptions,
  ResponsiveFeatureOptions,
  ResponsiveBreakpoint,
  TooltipFeatureOptions,
  TooltipFeatureEvents,
  TooltipColumnDef,
  CellTooltipRenderer,
  CellTooltipContext,
  CellTooltipPayload,
  TooltipContent,
  PdfExportOptions,
  PdfColumnFilter,
  PdfOrientation,
  PdfPaperSize,
  PdfMargins,
  InfiniteLoadFeatureOptions,
  RangeRequest,
  RangeResponse,
  LoadRange,
  PageState,
  UndoRedoFeatureOptions,
  UndoRedoState,
  UndoCommand,
  UndoCommandKind,
  QuickSearchHighlighter,
  GroupViewProvider,
} from './features/index.js';

/* ── Grouped / multi-level (stacked) column headers ──────────────────────
   A self-contained, opt-in `GridFeature` (install via
   `grid.use(headerGroupsFeature(...))`). Side-effect-imports its token-pure
   CSS so the stacked-header bands ship in `dist/style.css`. */
export {
  resolveHeaderTree,
  pathsFromGroups,
  hasHeaderGroups,
  HeaderGroupsFeature,
  headerGroupsFeature,
} from './header-groups/index.js';

export type {
  HeaderGroup,
  GroupedColumnExtras,
  GroupedColumnDef,
  LeafColumnInput,
  HeaderCell,
  HeaderBand,
  HeaderTree,
  HeaderGroupsFeatureOptions,
} from './header-groups/index.js';
