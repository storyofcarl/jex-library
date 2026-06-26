/**
 * @jects/pivot — Jects UI pivot table built on @jects/core and @jects/grid.
 *
 * Pivots/aggregates a flat dataset into a cross-tab and renders it by reusing
 * the @jects/grid `Grid` for tabular output. Importing this module registers
 * the pivot with the factory (`create({ type: 'pivottable', ... })`).
 *
 * Side-effect CSS: `import '@jects/pivot/style.css'`.
 */

import './styles.css';

/* ── Engine (framework-free aggregation) ─────────────────────────────────── */
export {
  PivotEngine,
  AggregatorRegistry,
  AGGREGATOR_LABELS,
  toNumber,
  readField,
  formatNumber,
  makeNumberFormat,
  toExportMatrix,
  toCsv,
  toExcelXml,
  downloadCsv,
  downloadXlsx,
  downloadXls,
  toXlsx,
  XLSX_MIME,
  zipSync,
  crc32,
  utf8,
  buildColumnStats,
  evaluateConditional,
} from './engine/index.js';

export type {
  Aggregator,
  AggregatorName,
  PivotField,
  PivotValue,
  PivotFilter,
  PivotFilterOperator,
  PivotTotals,
  PivotMode,
  PivotCollapse,
  PivotConfig,
  PivotAxisNode,
  PivotColumnLeaf,
  PivotMatrixRow,
  PivotResult,
  NumberFormatOptions,
  PivotExportOptions,
  ZipEntry,
  ConditionalFormat,
  ConditionalCallback,
  ConditionalRule,
  CellValueRule,
  ColorScaleRule,
  DataBarRule,
  ConditionalContext,
  CellStyle,
  ColumnStat,
  ColumnStats,
} from './engine/index.js';

/* ── Projection (PivotResult → Grid columns/rows) ────────────────────────── */
export {
  projectColumns,
  projectRows,
  leafHeader,
  PIVOT_META,
} from './table/project.js';

export type {
  PivotGridRow,
  PivotCellTemplate,
  ProjectOptions,
} from './table/project.js';

/* ── PivotTable widget ───────────────────────────────────────────────────── */
export {
  PivotTable,
  type PivotTableConfig,
  type PivotTableEvents,
  type PivotAxis,
  type PivotFieldSpec,
} from './table/pivot-table.js';
