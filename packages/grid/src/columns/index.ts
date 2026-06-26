/**
 * @jects/grid — columns / cells / editing / selection / clipboard / spans.
 *
 * Composable modules + `GridFeature` plugins the Grid engine wires in via the
 * frozen contract (see ../contract.ts). Everything here is framework-free and
 * interacts with the engine ONLY through `GridApi`. Importing this barrel also
 * pulls in the token-pure CSS so cell/selection/frozen styles ship in the bundle.
 */

import './columns.css';

/* ── column model (resize / reorder / hide / frozen / auto-width) ─────── */
export {
  ColumnModel,
  columnId,
  clampWidth,
  DEFAULT_COLUMN_WIDTH,
  DEFAULT_MIN_WIDTH,
  type ResolvedColumn,
  type ColumnLayout,
} from './column-model.js';

export {
  ColumnFeature,
  columnFeature,
  type ColumnFeatureConfig,
} from './column-feature.js';

/* ── typed cell renderers ──────────────────────────────────────────────── */
export {
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
  escapeHtml,
  type NumberFormatMeta,
  type DateFormatMeta,
  type CellAction,
} from './renderers.js';

/* ── additional typed columns (rating / widget / rownumber) ────────────── */
export {
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
  type RatingMeta,
  type WidgetCellMeta,
  type WidgetCellConfig,
  type RowNumberMeta,
  type ExtraColumnType,
} from './extra-renderers.js';

/* ── editors (reuse @jects/widgets controls) + edit lifecycle ──────────── */
export {
  WidgetCellEditor,
  EditController,
  resolveEditor,
  controlForColumn,
  type ControlType,
  type EditorMeta,
  type EditControllerHooks,
} from './editors.js';

export {
  EditingFeature,
  editingFeature,
  type EditingFeatureConfig,
} from './editing-feature.js';

/* ── selection (cell / row / range) ────────────────────────────────────── */
export {
  GridSelectionModel,
  normalizeRect,
  rectContains,
  rectToCells,
  cellKeys,
  type SelectionHost,
  type CellRect,
} from './selection.js';

export {
  SelectionFeature,
  selectionFeature,
  type SelectionFeatureConfig,
} from './selection-feature.js';

/* ── clipboard (copy / paste TSV) ──────────────────────────────────────── */
export {
  matrixToTSV,
  parseTSV,
  buildCopyText,
  applyPaste,
  cellToText,
  rangeCells,
  type ClipboardHost,
} from './clipboard.js';

/* ── cell spans (col / row span) ───────────────────────────────────────── */
export {
  resolveSpans,
  normalizeSpan,
  spanProviderFor,
  isCovered,
  originAt,
  type CellSpan,
  type SpanContext,
  type SpanProvider,
  type SpanHost,
  type SpanMap,
  type SpanOrigin,
} from './spans.js';
