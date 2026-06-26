/**
 * @jects/pivot engine barrel — the framework-free pivot computation layer.
 */

export {
  AggregatorRegistry,
  AGGREGATOR_LABELS,
  toNumber,
  type Aggregator,
  type AggregatorName,
} from './aggregators.js';

export {
  PivotEngine,
  readField,
  type PivotField,
  type PivotValue,
  type PivotFilter,
  type PivotFilterOperator,
  type PivotTotals,
  type PivotMode,
  type PivotCollapse,
  type PivotConfig,
  type PivotAxisNode,
  type PivotColumnLeaf,
  type PivotMatrixRow,
  type PivotResult,
} from './engine.js';

export {
  formatNumber,
  makeNumberFormat,
  type NumberFormatOptions,
} from './format.js';

export {
  buildColumnStats,
  evaluateConditional,
  type ConditionalFormat,
  type ConditionalCallback,
  type ConditionalRule,
  type CellValueRule,
  type ColorScaleRule,
  type DataBarRule,
  type ConditionalContext,
  type CellStyle,
  type ColumnStat,
  type ColumnStats,
} from './conditional.js';

export {
  toExportMatrix,
  toCsv,
  toExcelXml,
  downloadCsv,
  downloadXlsx,
  downloadXls,
  type PivotExportOptions,
} from './export.js';

export { toXlsx, XLSX_MIME } from './xlsx.js';
export { zipSync, crc32, utf8, type ZipEntry } from './zip.js';
