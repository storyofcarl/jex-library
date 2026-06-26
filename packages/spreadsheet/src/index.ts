/**
 * @jects/spreadsheet — Jects UI spreadsheet built on @jects/core and @jects/grid.
 *
 * A formula-driven workbook/sheet UI. The UI layer drives a `FormulaEngine`
 * (the headless calculation core) through the `SpreadsheetApi` contract and
 * renders cells by reusing the @jects/grid `Grid`. Importing this module
 * registers the spreadsheet with the factory and pulls in the token-pure CSS.
 *
 *   import { Spreadsheet } from '@jects/spreadsheet';
 *   import '@jects/spreadsheet/style.css';
 *   const ss = new Spreadsheet(el, { sheets: [{ name: 'Sheet1', cells: {} }] });
 *
 * Side-effect CSS: `import '@jects/spreadsheet/style.css'`.
 */

import './styles.css';

/* ── Frozen public contract (types only) ─────────────────────────────────
   The shared API the engine and UI agents code against. See contract.ts. */
export type {
  // Cell addressing
  CellRef,
  CellAddress,
  A1Address,
  A1Helpers,
  // Cell values & errors
  CellValue,
  CellError,
  CellErrorCode,
  // Models
  CellFormat,
  CellStyle,
  CellModel,
  SheetDimension,
  MergeRegion,
  FrozenPanes,
  CfRange,
  CfRule,
  SheetModel,
  WorkbookModel,
  // Formula engine
  Ast,
  AstNode,
  EvalContext,
  SpreadsheetFunction,
  FormulaEngine,
  // UI ↔ engine surface
  SpreadsheetApi,
  SpreadsheetEventBus,
  SpreadsheetEvents as SpreadsheetContractEvents,
} from './contract.js';

/* ── Spreadsheet Widget (registers `spreadsheet` with the factory) ───────── */
export { Spreadsheet } from './ui/spreadsheet.js';
export type { SpreadsheetConfig, SpreadsheetEvents, CfRuleInput } from './ui/spreadsheet.js';

/* ── Composable UI parts ─────────────────────────────────────────────────── */
export { CellGrid } from './ui/cell-grid.js';
export type { CellGridConfig, CellGridEvents } from './ui/cell-grid.js';
export { FormulaBar } from './ui/formula-bar.js';
export type { FormulaBarConfig, FormulaBarEvents } from './ui/formula-bar.js';
export { SheetTabs } from './ui/sheet-tabs.js';
export type { SheetTabsConfig, SheetTabsEvents } from './ui/sheet-tabs.js';

/* ── Engine seam: build a contract `SpreadsheetApi` driving the engine ───── */
export { createSpreadsheetApi, defaultWorkbook } from './ui/engine.js';

/* ── Headless calculation core (the FormulaEngine) ───────────────────────── */
export { FormulaEngineImpl, createFormulaEngine, builtinFunctions } from './engine/index.js';

/* ── Pure helpers (A1, formatting, IO, fill, validation, selection) ──────── */
export {
  a1Helpers,
  columnIndexToLabel,
  columnLabelToIndex,
  formatA1,
  parseA1,
  refToA1,
  toRef,
} from './ui/a1.js';
export { formatValue, parseInput, isCellError, NUMBER_FORMAT_PRESETS } from './ui/format.js';
export {
  exportWorkbook,
  importWorkbook,
  sheetToCsv,
  parseCsv,
  csvToSheet,
  workbookToJson,
  jsonToWorkbook,
  workbookToXlsxXml,
  xlsxXmlToWorkbook,
  workbookToXlsxBytes,
  xlsxBytesToWorkbook,
  workbookToXlsxBlob,
  XLSX_MIME,
  type IoFormat,
} from './ui/io.js';
export { zipSync, unzipSync, crc32, type ZipEntry } from './ui/zip.js';
export { fillSeries, fillBlock, type FillDirection } from './ui/fill.js';
export {
  sortRows,
  filterRows,
  valueInSet,
  distinctColumnValues,
  type SortDir,
  type SortKey,
  type FilterResult,
} from './ui/sort-filter.js';
export {
  validate,
  ValidationStore,
  type ValidationRule,
  type ValidationResult,
} from './ui/validation.js';
export {
  resolveConditionalFormat,
  cfRangeContains,
  type CfDecoration,
} from './ui/conditional-format.js';
export {
  rangeToChartData,
  createEmbeddedChart,
  type ChartData,
  type EmbeddedChartOptions,
} from './ui/chart-embed.js';
export {
  blockToTsv,
  parsePastedText,
  inferPasted,
  type ClipboardBlock,
} from './ui/clipboard.js';
export { History, type Command } from './ui/history.js';
export {
  clampAddress,
  rangeOf,
  rangeContains,
  rangeSize,
  iterateRange,
  moveAddress,
  type CellRange,
  type SelectionState,
} from './ui/selection.js';
