/**
 * @jects/spreadsheet UI barrel — the Spreadsheet Widget and its composable
 * parts, plus the pure helpers (A1, formatting, IO, fill, validation) the UI is
 * built from. The package barrel (`src/index.ts`) re-exports this surface; until
 * then, consumers can import directly from `@jects/spreadsheet/ui`.
 *
 * Importing this module registers `spreadsheet` (and its parts) with the factory
 * and pulls in the token-pure CSS.
 */

export { Spreadsheet } from './spreadsheet.js';
export type { SpreadsheetConfig, SpreadsheetEvents } from './spreadsheet.js';

export { CellGrid } from './cell-grid.js';
export type { CellGridConfig, CellGridEvents } from './cell-grid.js';

export { FormulaBar } from './formula-bar.js';
export type { FormulaBarConfig, FormulaBarEvents } from './formula-bar.js';

export { SheetTabs } from './sheet-tabs.js';
export type { SheetTabsConfig, SheetTabsEvents } from './sheet-tabs.js';

/* engine seam (default in-UI implementation of the contract) */
export { createSpreadsheetApi, defaultWorkbook } from './engine.js';

/* pure helpers */
export {
  a1Helpers,
  columnIndexToLabel,
  columnLabelToIndex,
  formatA1,
  parseA1,
  refToA1,
  toRef,
} from './a1.js';
export { formatValue, parseInput, isCellError, NUMBER_FORMAT_PRESETS } from './format.js';
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
  type IoFormat,
} from './io.js';
export { fillSeries, fillBlock, type FillDirection } from './fill.js';
export { validate, ValidationStore, type ValidationRule, type ValidationResult } from './validation.js';
export { blockToTsv, parsePastedText, inferPasted, type ClipboardBlock } from './clipboard.js';
export { History, type Command } from './history.js';
export {
  clampAddress,
  rangeOf,
  rangeContains,
  rangeSize,
  iterateRange,
  moveAddress,
  type CellRange,
  type SelectionState,
} from './selection.js';
