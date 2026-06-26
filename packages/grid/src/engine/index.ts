/**
 * @jects/grid engine (3A) — public barrel.
 *
 * Exports the keystone {@link Grid} Widget class (the hub implementing
 * {@link GridApi}) and the headless {@link GridEngine}, plus the default
 * DOM-recycling renderer and the engine's selection / editing / viewport /
 * column-layout building blocks so features and advanced consumers can compose
 * against them. Importing this module registers the grid with the factory and
 * pulls in the token-pure engine CSS.
 */

export { Grid } from './grid.js';
export { GridEngine, DEFAULT_ROW_HEIGHT, DEFAULT_HEADER_HEIGHT } from './engine.js';
export type { GridEngineOptions } from './engine.js';

export { DomRenderer, createDomRenderer } from './dom-renderer.js';

export {
  SpanDomRenderer,
  createSpanRenderer,
  spanRendererFactory,
} from './span-renderer.js';
export {
  engineSpanHost,
  computeWindowSpanMap,
  hasSpanProviders,
} from './span-host.js';

export { RowModel } from './row-model.js';
export type { RowEntry, RowKind, RowSource, GroupRowData } from './row-model.js';

export {
  paintGroupRow,
  formatAggregate,
  formatGroupValue,
  GROUP_ROW_CLASS,
  GROUP_TOGGLE_CLASS,
} from './group-row-paint.js';
export type { GroupRowPaintOptions } from './group-row-paint.js';

export { DefaultViewport } from './viewport.js';
export type { ViewportHost } from './viewport.js';

export { DefaultSelectionModel } from './selection.js';
export type { SelectionHost } from './selection.js';

export { DefaultEditSession } from './edit-session.js';
export type { EditHost } from './edit-session.js';

export {
  resolveColumns,
  computeColumnWindow,
  columnId,
  DEFAULT_COLUMN_WIDTH,
  DEFAULT_MIN_COLUMN_WIDTH,
} from './column-layout.js';
export type { ColumnLayout, LaidOutColumn } from './column-layout.js';

export {
  gridIsRTL,
  columnInsets,
  positionColumnCell,
  normalizeScrollLeft,
  RTL_CLASS,
} from './rtl.js';
