/**
 * @jects/spreadsheet engine — public barrel for the headless calculation core.
 *
 * Exposes the `FormulaEngineImpl` (implementing the contract `FormulaEngine`),
 * the A1 helpers, the parser/tokenizer/evaluator, value/error utilities, and the
 * built-in function library. Pure logic — no DOM.
 */

export { FormulaEngineImpl } from './engine.js';
export { Evaluator, type RefCollector, type EvaluatorDeps } from './evaluator.js';
export { parseFormula, parseFormulaStrict, ParseError } from './parser.js';
export { tokenize, TokenizeError, type Token, type TokenType } from './tokenizer.js';

export {
  a1Helpers,
  cellKey,
  columnIndexToLabel,
  columnLabelToIndex,
  formatA1,
  normalizeBox,
  parseA1,
  parseCellKey,
  quoteSheetName,
  refKey,
  refToA1,
  toRef,
} from './a1.js';

export {
  ERR,
  dateToSerial,
  errorCodeFromString,
  formatDateDefault,
  isBlank,
  isError,
  makeError,
  numberToText,
  serialToDate,
  toBoolean,
  toNumber,
  toText,
} from './errors.js';

export {
  type FnArg,
  asScalar,
  compareValues,
  firstError,
  flatten,
  flattenNumbers,
  isMatrix,
  looseEquals,
  makeCriteria,
  wildcardToRegExp,
} from './helpers.js';

export { builtinFunctions, builtinFunctionCount } from './functions/index.js';

/**
 * Construct a ready-to-use formula engine. Convenience factory matching the
 * contract `FormulaEngine` surface.
 */
import { FormulaEngineImpl } from './engine.js';
import type { FormulaEngine, SpreadsheetFunction, WorkbookModel } from '../contract.js';

export function createFormulaEngine(
  workbook?: WorkbookModel,
  functions?: Record<string, SpreadsheetFunction>,
): FormulaEngine {
  return new FormulaEngineImpl(workbook, functions);
}
