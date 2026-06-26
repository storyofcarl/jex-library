/**
 * `@jects/spreadsheet/engine` — additive subpath for the headless calculation
 * core (the FormulaEngine) and its pure building blocks.
 *
 * This entry imports ONLY `src/engine/*` (parser, tokenizer, evaluator, A1
 * helpers, value/error utilities, and the built-in function library) plus the
 * type-only frozen `contract.ts`. It does NOT pull in the DOM UI (`ui/*`), the
 * grid, widgets, or charts — so consumers who want headless formula evaluation
 * (server-side recalc, CSV pipelines, tests) ship none of the rendering layer.
 *
 *   import { createFormulaEngine, builtinFunctions } from '@jects/spreadsheet/engine';
 *
 * The package main entry (`@jects/spreadsheet`) re-exports this same surface and
 * stays tree-shakeable; this subpath is a real separate build chunk.
 */

export * from './engine/index.js';

/* Re-export the engine-relevant frozen contract types for ergonomic typing. */
export type {
  CellRef,
  CellAddress,
  A1Address,
  A1Helpers,
  CellValue,
  CellError,
  CellErrorCode,
  Ast,
  AstNode,
  EvalContext,
  SpreadsheetFunction,
  FormulaEngine,
  CellModel,
  SheetModel,
  WorkbookModel,
} from './contract.js';
