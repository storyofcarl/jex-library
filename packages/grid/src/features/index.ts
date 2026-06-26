/**
 * @jects/grid — feature plugins (area "grid-features").
 *
 * Every export here is a `GridFeature` (see ../contract.js) installed via
 * `grid.use(feature)`. Features talk to the engine ONLY through `GridApi` and
 * release everything they create on `destroy()`.
 *
 * Token-pure feature CSS lives in `features.css` and is imported here so the
 * filter bar, footer summary, tree affordance, search highlight, group rows,
 * and context-menu popup styles ship in `dist/style.css`. No hardcoded colors —
 * only `--jects-*` tokens.
 */

import './features.css';

/* ── Sorting ─────────────────────────────────────────────────────────── */
export { SortFeature, sortFeature, type SortFeatureOptions } from './sort.js';

/* ── Filtering ───────────────────────────────────────────────────────── */
export {
  FilterFeature,
  filterFeature,
  makeFilterPredicate,
  type FilterFeatureOptions,
  type FilterOperator,
} from './filter.js';
export {
  FilterBarFeature,
  filterBarFeature,
  type FilterBarFeatureOptions,
} from './filter-bar.js';

/* ── Grouping + summaries ────────────────────────────────────────────── */
export {
  GroupFeature,
  groupFeature,
  computeAggregate,
  type GroupFeatureOptions,
  type GroupViewRow,
  type AggregatorKind,
  type AggregatorSpec,
  type CustomAggregator,
  type SummaryRow,
} from './group.js';
export {
  SummaryFeature,
  summaryFeature,
  type SummaryFeatureOptions,
} from './summary.js';

/* ── Tree-grid mode ──────────────────────────────────────────────────── */
export {
  TreeFeature,
  treeFeature,
  type TreeFeatureOptions,
  type TreeViewRow,
} from './tree.js';

/* ── Quick search / highlight ────────────────────────────────────────── */
export {
  QuickSearchFeature,
  quickSearchFeature,
  type QuickSearchFeatureOptions,
  type QuickSearchChangeEvent,
} from './quick-search.js';

/* ── Cell / header context menus (reuse @jects/widgets Menu) ─────────── */
export {
  CellMenuFeature,
  HeaderMenuFeature,
  cellMenuFeature,
  headerMenuFeature,
  type CellMenuFeatureOptions,
  type HeaderMenuFeatureOptions,
  type CellMenuContext,
  type HeaderMenuContext,
} from './context-menus.js';

/* ── Export (CSV / Excel-XML / print) ────────────────────────────────── */
export {
  ExportFeature,
  exportFeature,
  type ExportOptions,
  type ExportColumnFilter,
} from './export.js';

/* ── Column state persistence ────────────────────────────────────────── */
export {
  ColumnStateFeature,
  columnStateFeature,
  type ColumnStateFeatureOptions,
  type ColumnState,
  type ColumnSnapshot,
} from './column-state.js';

/* ── Column picker / chooser panel (reuse @jects/widgets Checkbox) ────── */
export {
  ColumnPickerFeature,
  columnPickerFeature,
  type ColumnPickerFeatureOptions,
  type ColumnPickerEvents,
} from './column-picker.js';

/* ── Column auto-size (double-click header divider to fit) ───────────── */
export {
  ColumnAutoSizeFeature,
  columnAutoSizeFeature,
  type ColumnAutoSizeFeatureOptions,
  type ColumnAutoSizeEvent,
  type MeasureColumnContent,
} from './column-auto-size.js';

/* ── Faceted filter (distinct-value checklist) ───────────────────────── */
export {
  FilterFacetFeature,
  filterFacetFeature,
  type FilterFacetFeatureOptions,
  type FilterFacetEvents,
} from './filter-facet.js';
export {
  computeFacet,
  facetKey,
  BLANK_KEY,
  BLANK_LABEL,
  type FacetValue,
  type FacetComputeOptions,
} from './filter.js';

/* ── Range fill (fill handle / drag-fill + series) ───────────────────── */
export {
  FillFeature,
  fillFeature,
  boundingRect,
  rectCells,
  rectHas,
  projectTarget,
  detectSeries,
  seriesValueAt,
  type FillFeatureOptions,
  type FillEvent,
  type FillRect,
  type FillDirection,
  type FillKind,
  type FillSeriesMode,
} from './fill.js';

/* ── Row reordering (incl. between grids) ────────────────────────────── */
export {
  RowReorderFeature,
  rowReorderFeature,
  type RowReorderFeatureOptions,
  type RowDragMeta,
  type DropTarget,
  type DropPosition,
} from './row-reorder.js';

/* ── Row resize (per-row height drag) ────────────────────────────────── */
export {
  RowResizeFeature,
  rowResizeFeature,
  type RowResizeFeatureOptions,
  type RowResizeEvent,
  type ApplyRowSize,
} from './row-resize.js';

/* ── Selection column (row-selector checkbox) ────────────────────────── */
export {
  SelectionColumnFeature,
  selectionColumnFeature,
  renderSelectCell,
  type SelectionColumnFeatureOptions,
} from './selection-column.js';

/* ── Filter operator menu (per-column operator chooser) ──────────────── */
export {
  FilterMenuFeature,
  filterMenuFeature,
  operatorsForColumn,
  OPERATOR_LABELS,
  type FilterMenuFeatureOptions,
} from './filter-menu.js';

/* ── Responsive column auto-hide (viewport-width breakpoints) ────────── */
export {
  ResponsiveFeature,
  responsiveFeature,
  type ResponsiveFeatureOptions,
  type ResponsiveBreakpoint,
} from './responsive.js';

/* ── Row expander / master-detail ────────────────────────────────────── */
export {
  RowExpanderFeature,
  rowExpanderFeature,
  type RowExpanderFeatureOptions,
  type RowExpanderEvents,
  type DetailRenderer,
  type DetailRenderContext,
  type RowSourceHost,
} from './row-expander.js';

/* ── Cell tooltips (reuse @jects/widgets Tooltip overlay) ────────────── */
export {
  TooltipFeature,
  tooltipFeature,
  detailTooltip,
  type TooltipFeatureOptions,
  type TooltipFeatureEvents,
  type TooltipColumnDef,
  type CellTooltipRenderer,
  type CellTooltipContext,
  type CellTooltipPayload,
  type TooltipContent,
} from './tooltip.js';

/* ── PDF export (direct PDF builder + print-to-PDF) ──────────────────── */
export {
  PdfExportFeature,
  pdfExportFeature,
  type PdfExportOptions,
  type PdfColumnFilter,
  type PdfOrientation,
  type PdfPaperSize,
  type PdfMargins,
} from './export-pdf.js';

/* ── Lazy / infinite (load-on-demand) row loading ───────────────────── */
export {
  InfiniteLoadFeature,
  infiniteLoadFeature,
  isLoadingRecord,
  placeholderIdFor,
  LOADING_FLAG,
  type InfiniteLoadFeatureOptions,
  type RangeRequest,
  type RangeResponse,
  type LoadRange,
  type PageState,
} from './infinite-load.js';

/* ── Undo / redo (StateTracking) ─────────────────────────────────────── */
export {
  UndoRedoFeature,
  undoRedoFeature,
  type UndoRedoFeatureOptions,
  type UndoRedoState,
  type UndoCommand,
  type UndoCommandKind,
} from './undo-redo.js';

/* ── QuickFind highlight hook (for custom renderer authors) ──────────── */
export {
  applyQuickSearchHighlight,
  getActiveQuickSearch,
  isQuickSearchHighlighter,
  SEARCH_MATCH_CELL_CLASS,
  type QuickSearchHighlighter,
} from './quick-search-paint.js';

/* ── Group row source (engine seam used by GroupFeature) ─────────────── */
export {
  GroupRowSource,
  type GroupViewProvider,
} from './group-row-source.js';

/* ── Shared helpers (re-exported for feature authors / tests) ────────── */
export {
  colId,
  getValue,
  readPath,
  compareValues,
  toNumber,
  readRows,
  readStoreRows,
  escapeHtml,
  Disposers,
} from './shared.js';
