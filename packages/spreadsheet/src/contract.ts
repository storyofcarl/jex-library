/**
 * @jects/spreadsheet — FROZEN SPREADSHEET CONTRACT (types & interfaces only; no
 * implementation).
 *
 * This file is the stable, contract-first API shared by the two spreadsheet
 * build agents:
 *
 *   - ENGINE  implements the headless calculation core: the `FormulaEngine`
 *             (parser → AST, evaluator, dependency graph + recalc, cross-sheet
 *             refs, dynamic-array spill), the workbook/sheet/cell model
 *             mutations, and the `SpreadsheetApi` service surface.
 *   - UI      implements the `Spreadsheet` Widget (grid surface, formula bar,
 *             sheet tabs, selection/editing) by REUSING @jects/grid's `Grid`
 *             for tabular rendering, and drives the engine ONLY through
 *             `SpreadsheetApi` + `FormulaEngine`. The UI never recalculates;
 *             it reads display values from the engine and writes edits back.
 *
 * Rules of the contract:
 *   - Nothing here imports DOM-building or runtime logic; it re-uses only the
 *     framework-free types from `@jects/core` (`RecordId`, `EventMap`).
 *   - The `Spreadsheet` Widget class itself is implemented by the UI agent;
 *     here we declare ONLY the engine/UI shared surface. The two layers are
 *     decoupled: the engine knows nothing about the DOM, the UI knows nothing
 *     about formula internals — they meet at `SpreadsheetApi`.
 */

import type { RecordId, EventMap } from '@jects/core';

/* ═══════════════════════════════════════════════════════════════════════════
   1. CELL ADDRESSING — refs, A1 notation, helpers
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * A fully-qualified, zero-based cell coordinate. `sheet` is the sheet id (not a
 * display name) so refs stay stable across sheet renames. This is the canonical
 * internal address used by the engine's dependency graph.
 */
export interface CellRef {
  /** Owning sheet id (stable across renames). */
  sheet: string;
  /** Zero-based row index. */
  row: number;
  /** Zero-based column index (0 = column A). */
  col: number;
}

/**
 * Sheet-local cell coordinate (no sheet component). Used where the sheet is
 * implied by context (e.g. within a single `SheetModel`).
 */
export interface CellAddress {
  /** Zero-based row index. */
  row: number;
  /** Zero-based column index. */
  col: number;
}

/**
 * A parsed A1-style address, e.g. `Sheet1!$B$3`. `sheet` is optional (absent for
 * same-sheet refs); `$`-anchoring is captured for fill/copy semantics.
 */
export interface A1Address {
  /** Sheet name as written in the A1 string (display name, not id), if any. */
  sheet?: string;
  /** Zero-based row index. */
  row: number;
  /** Zero-based column index. */
  col: number;
  /** Row was written with a `$` anchor (absolute). */
  rowAbsolute: boolean;
  /** Column was written with a `$` anchor (absolute). */
  colAbsolute: boolean;
}

/**
 * Pure A1 ↔ index conversion helpers. Stateless; implemented by the engine and
 * also usable by the UI (e.g. to render the formula bar / name box).
 *
 *   - Column index 0 ↔ "A", 25 ↔ "Z", 26 ↔ "AA".
 *   - `parse('Sheet1!$B$3')` → `{ sheet:'Sheet1', row:2, col:1, rowAbsolute:true, colAbsolute:true }`.
 *   - `format({ row:2, col:1 })` → `"B3"`.
 */
export interface A1Helpers {
  /** "A" → 0, "AA" → 26. */
  columnLabelToIndex(label: string): number;
  /** 0 → "A", 26 → "AA". */
  columnIndexToLabel(index: number): string;
  /** Parse an A1 string (optionally sheet-qualified, optionally `$`-anchored). */
  parse(a1: string): A1Address;
  /** Format a (sheet-local) address back into an A1 string. */
  format(address: CellAddress, opts?: { rowAbsolute?: boolean; colAbsolute?: boolean }): string;
  /** Build a fully-qualified `CellRef` from an A1 string + the current sheet id. */
  toRef(a1: string, currentSheet: string, resolveSheetName: (name: string) => string): CellRef;
  /** Format a `CellRef` back into a (sheet-qualified when needed) A1 string. */
  refToA1(ref: CellRef, currentSheet: string, sheetName: (id: string) => string): string;
}

/* ═══════════════════════════════════════════════════════════════════════════
   2. CELL VALUES & ERRORS
   ═══════════════════════════════════════════════════════════════════════════ */

/** Spreadsheet error sentinels (Excel/Sheets-compatible set). */
export type CellErrorCode =
  | '#NULL!'
  | '#DIV/0!'
  | '#VALUE!'
  | '#REF!'
  | '#NAME?'
  | '#NUM!'
  | '#N/A'
  | '#SPILL!'
  | '#CYCLE!'
  | '#CALC!';

/**
 * A first-class error value. Errors propagate through formulas (any operand
 * being a `CellError` yields a `CellError`) instead of throwing.
 */
export interface CellError {
  /** Discriminant so `CellValue` can be narrowed structurally. */
  readonly kind: 'error';
  /** The error sentinel. */
  code: CellErrorCode;
  /** Optional human-readable detail (e.g. the unknown function name). */
  message?: string;
}

/**
 * The concrete value a cell can hold or a formula can evaluate to. `null`/`''`
 * represent an empty cell. `CellError` is a value, not an exception.
 */
export type CellValue = number | string | boolean | Date | CellError | null;

/* ═══════════════════════════════════════════════════════════════════════════
   3. CELL / SHEET / WORKBOOK MODELS
   ═══════════════════════════════════════════════════════════════════════════ */

/** Number/date/text display formatting for a cell (presentation only). */
export interface CellFormat {
  /** Number-format pattern, e.g. `"#,##0.00"`, `"0%"`, `"yyyy-mm-dd"`. */
  numberFormat?: string;
  /** Logical data type hint for parsing/coercion of typed input. */
  type?: 'general' | 'number' | 'currency' | 'percent' | 'date' | 'time' | 'text' | 'boolean';
  /** Currency/locale code used by `currency`/date formats. */
  locale?: string;
}

/** Visual styling for a cell (token-driven; resolved to CSS by the UI). */
export interface CellStyle {
  /** Horizontal alignment. */
  align?: 'start' | 'center' | 'end';
  /** Vertical alignment. */
  verticalAlign?: 'top' | 'middle' | 'bottom';
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  /** Foreground/background as `--jects-*` token names (no raw colors). */
  colorToken?: string;
  backgroundToken?: string;
  /** Whether text wraps within the cell. */
  wrap?: boolean;
  /** Per-edge border presence (UI resolves to token-driven borders). */
  borders?: { top?: boolean; right?: boolean; bottom?: boolean; left?: boolean };
}

/**
 * A single cell. A cell with a `formula` derives its `value` from evaluation
 * (the engine writes the computed `value` back); a literal cell has only
 * `value`. Empty cells are typically absent from the sparse `SheetModel.cells`
 * map rather than stored as empty `CellModel`s.
 */
export interface CellModel {
  /** Literal value, or the engine-computed result when `formula` is set. */
  value?: CellValue;
  /** Formula source WITHOUT the leading `=` (e.g. `"SUM(A1:A3)"`), if any. */
  formula?: string;
  /** Display/number formatting. */
  format?: CellFormat;
  /** Visual style. */
  style?: CellStyle;
  /**
   * A cell comment/note (the small triangle indicator + hover/show popover). Plain
   * text; serialized with the cell so it round-trips through JSON/XLSX.
   */
  comment?: string;
  /**
   * Whether the cell is locked. Only meaningful once its sheet is protected (see
   * {@link SheetModel.protected}): on a protected sheet, edits to a `locked` cell
   * are vetoed, while `locked === false` cells stay editable. Defaults to locked
   * (Excel semantics: every cell is locked until the sheet is protected).
   */
  locked?: boolean;
  /**
   * Set on the anchor cell of a dynamic-array result that spilled into a range,
   * describing the spill extent (rows × cols incl. the anchor). Read-only to UI.
   */
  spill?: { rows: number; cols: number };
  /**
   * Set on cells that are members of another cell's spill range; points back to
   * the spill anchor. Such cells are not independently editable.
   */
  spillParent?: CellAddress;
}

/** Row or column size/visibility metadata. */
export interface SheetDimension {
  /** Pixel size (height for rows, width for cols). Falls back to a default. */
  size?: number;
  /** Hidden from view (still addressable by formulas). */
  hidden?: boolean;
}

/** A merged-cell region (anchor at `{row,col}`, spanning rowSpan × colSpan). */
export interface MergeRegion extends CellAddress {
  rowSpan: number;
  colSpan: number;
}

/** Frozen (pinned) row/column counts, counted from the top-left. */
export interface FrozenPanes {
  /** Number of frozen rows pinned at the top. */
  rows: number;
  /** Number of frozen columns pinned at the left. */
  cols: number;
}

/**
 * The rectangular target of a conditional-formatting rule, in sheet-local
 * (zero-based) coordinates (inclusive bounds).
 */
export interface CfRange {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

/**
 * A conditional-formatting rule attached to a sheet. Evaluated live in the UI
 * (`buildCell`) against each cell's computed value:
 *
 *   - `cellValue`  — compare the cell value to operand(s) and apply a style.
 *   - `colorScale` — map the value's position within the range's min→max to a
 *                    background interpolated between two/three token colors.
 *   - `dataBar`    — paint an in-cell horizontal bar proportional to the value's
 *                    position within the range's min→max.
 *   - `expression` — apply a style when a formula (evaluated with the cell as
 *                    origin, `=` optional) returns a truthy value.
 */
export type CfRule =
  | {
      kind: 'cellValue';
      /** The cells this rule applies to. */
      range: CfRange;
      /** Comparison operator. */
      op: '=' | '<>' | '>' | '>=' | '<' | '<=' | 'between' | 'notBetween';
      /** First operand (number or string). */
      value: number | string;
      /** Second operand for `between`/`notBetween`. */
      value2?: number | string;
      /** Style applied to matching cells (token-driven, like `CellStyle`). */
      style: CellStyle;
    }
  | {
      kind: 'colorScale';
      range: CfRange;
      /** Background token at the range minimum. */
      minToken: string;
      /** Optional background token at the midpoint (3-color scale). */
      midToken?: string;
      /** Background token at the range maximum. */
      maxToken: string;
    }
  | {
      kind: 'dataBar';
      range: CfRange;
      /** Fill token for the bar. */
      colorToken: string;
    }
  | {
      kind: 'expression';
      range: CfRange;
      /** Formula source (with or without leading `=`); truthy result → apply. */
      formula: string;
      /** Style applied when the expression is truthy. */
      style: CellStyle;
    };

/**
 * A single sheet/tab. Cells are stored sparsely keyed by `"row,col"` (or the
 * engine's chosen stable key) so blank cells cost nothing.
 */
export interface SheetModel {
  /** Stable sheet id (referenced by `CellRef.sheet`). */
  id: string;
  /** Display name shown on the tab (user-editable). */
  name: string;
  /**
   * Sparse cell map. Key is the sheet-local address encoded as `"row,col"`.
   * Absent keys are empty cells.
   */
  cells: Record<string, CellModel>;
  /** Logical row count (the addressable grid; may exceed populated cells). */
  rowCount: number;
  /** Logical column count. */
  colCount: number;
  /** Per-row overrides keyed by row index. */
  rows?: Record<number, SheetDimension>;
  /** Per-column overrides keyed by column index. */
  cols?: Record<number, SheetDimension>;
  /** Merged regions on this sheet. */
  merges?: MergeRegion[];
  /** Frozen panes for this sheet. */
  frozen?: FrozenPanes;
  /** Tab color as a `--jects-*` token name. */
  tabColorToken?: string;
  /** Sheet is hidden from the tab strip. */
  hidden?: boolean;
  /**
   * Conditional-formatting rules evaluated live by the UI against cell values
   * (see {@link CfRule}). Order matters: later rules paint over earlier ones.
   */
  conditionalFormats?: CfRule[];
  /**
   * Whether the sheet is protected. When `true`, the edit path vetoes writes to
   * `locked` cells (cells are locked by default — see {@link CellModel.locked}),
   * matching Excel's "Protect Sheet" behaviour.
   */
  protected?: boolean;
}

/** The whole workbook: an ordered list of sheets + workbook-level metadata. */
export interface WorkbookModel {
  /** Optional workbook id. */
  id?: string;
  /** Sheets in tab order. */
  sheets: SheetModel[];
  /** Id of the currently active sheet. */
  activeSheet?: string;
  /** Named ranges (name → A1/range string), available to formulas. */
  namedRanges?: Record<string, string>;
  /** Workbook-level recalc mode. */
  calcMode?: 'auto' | 'manual';
}

/* ═══════════════════════════════════════════════════════════════════════════
   4. FORMULA AST
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * The parsed representation of a formula. Opaque-ish tree the evaluator walks;
 * `AstNode` enumerates the node kinds the engine's parser must produce.
 */
export interface Ast {
  /** Root node of the expression. */
  root: AstNode;
  /** The original source (without leading `=`) the AST was parsed from. */
  source: string;
}

/**
 * A formula AST node. The engine parser emits this tree; the evaluator consumes
 * it. Discriminated by `kind`.
 */
export type AstNode =
  | { kind: 'literal'; value: number | string | boolean }
  | { kind: 'ref'; a1: string }
  | { kind: 'range'; from: string; to: string }
  | { kind: 'name'; name: string }
  | { kind: 'unary'; op: '+' | '-' | '%'; operand: AstNode }
  | {
      kind: 'binary';
      op: '+' | '-' | '*' | '/' | '^' | '&' | '=' | '<>' | '<' | '<=' | '>' | '>=';
      left: AstNode;
      right: AstNode;
    }
  | { kind: 'call'; name: string; args: AstNode[] }
  | { kind: 'error'; code: CellErrorCode };

/* ═══════════════════════════════════════════════════════════════════════════
   5. FORMULA ENGINE — parse / evaluate / dependency-graph recalc
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Evaluation context handed to functions and to `evaluate`. Carries the cell the
 * formula is anchored at (so relative refs resolve), plus accessors the function
 * library uses to read other cells/ranges. Provided by the engine per-eval.
 */
export interface EvalContext {
  /** The cell currently being evaluated (anchor for relative refs). */
  readonly origin: CellRef;
  /** The workbook being evaluated against. */
  readonly workbook: WorkbookModel;
  /** Resolve a single ref to its current value (already-computed). */
  getValue(ref: CellRef): CellValue;
  /** Resolve a rectangular range to a 2D array of values. */
  getRange(from: CellRef, to: CellRef): CellValue[][];
  /** Resolve a sheet display name to its id (for cross-sheet refs). */
  resolveSheet(name: string): string | undefined;
}

/**
 * A user/built-in worksheet function. Receives already-evaluated argument values
 * (scalars or 2D arrays for ranges) and the eval context, and returns a value or
 * a 2D array (dynamic-array result that the engine will spill).
 */
export type SpreadsheetFunction = (
  args: ReadonlyArray<CellValue | CellValue[][]>,
  ctx: EvalContext,
) => CellValue | CellValue[][];

/**
 * The headless calculation core. Implemented by the ENGINE agent; consumed by
 * the UI exclusively through `SpreadsheetApi` (which delegates here). Pure
 * model-in / value-out — no DOM.
 *
 * RECALCULATION MODEL (dependency graph):
 *   The engine maintains a directed dependency graph: an edge `A → B` means
 *   cell `B`'s formula references cell `A`, so a change to `A` dirties `B`.
 *   `setCellFormula` re-parses the formula, diffs its precedent set against the
 *   prior one, and updates the graph edges. `recalc(changedRefs)` walks the
 *   transitive dependents of the changed cells in topological order, recomputing
 *   each exactly once (a minimal, incremental recalc — not a full-sheet sweep).
 *   When `changedRefs` is omitted, a full recalc of every formula cell is run.
 *
 * CROSS-SHEET REFERENCES:
 *   Refs and ranges may be sheet-qualified (`Sheet2!A1`, `Sheet2!A1:B3`). The
 *   dependency graph spans sheets, so editing `Sheet2!A1` correctly dirties a
 *   `Sheet1` formula that reads it. Sheet renames update display-name resolution
 *   but never invalidate edges (edges key on the stable sheet id).
 *
 * CYCLE DETECTION:
 *   If recalc detects a dependency cycle, every cell on the cycle resolves to a
 *   `#CYCLE!` `CellError` (rather than looping) and recalc continues for the
 *   rest of the graph.
 *
 * DYNAMIC-ARRAY SPILL:
 *   A formula that returns a 2D array (e.g. `=SEQUENCE(3)`) "spills" from its
 *   anchor cell into the rectangle below/right. The anchor `CellModel` gets a
 *   `spill` extent; covered cells get a `spillParent` pointer and are not
 *   independently editable. If the spill range is blocked by a non-empty cell,
 *   the anchor resolves to `#SPILL!`. Dependents observe each spilled cell's
 *   value individually.
 */
export interface FormulaEngine {
  /** A1 conversion helpers (also exposed for UI consumption). */
  readonly a1: A1Helpers;

  /* ── parsing ───────────────────────────────────────────────────────── */
  /**
   * Parse a formula source (with or without the leading `=`) into an `Ast`.
   * Throws/returns an `error`-kind root for malformed input (engine's choice,
   * documented in impl); never evaluates.
   */
  parse(formula: string): Ast;

  /* ── evaluation ────────────────────────────────────────────────────── */
  /**
   * Evaluate a formula source or a previously parsed `Ast` against a context,
   * returning a single `CellValue`. A 2D-array result is reduced to its
   * top-left value here (use `recalc`/`getDisplayValue` for spill semantics).
   */
  evaluate(formula: string | Ast, ctx: EvalContext): CellValue;

  /* ── cell mutation (drives graph + recalc) ─────────────────────────── */
  /**
   * Set (or clear, when `formula` is empty) the formula of a cell. Re-parses,
   * updates dependency edges, and marks the cell + its dependents dirty. Returns
   * the refs that became dirty (the caller may pass them to `recalc`, or rely on
   * auto-recalc when `calcMode === 'auto'`).
   */
  setCellFormula(ref: CellRef, formula: string): CellRef[];

  /**
   * Set a literal (non-formula) value, clearing any formula on the cell. Also
   * dirties dependents. Returns the dirtied refs.
   */
  setCellValue(ref: CellRef, value: CellValue): CellRef[];

  /* ── reads ─────────────────────────────────────────────────────────── */
  /** Current computed value of a cell (post-recalc), or `null` if empty. */
  getCellValue(ref: CellRef): CellValue;
  /**
   * Formatted, display-ready string for a cell — applies the cell's
   * `CellFormat` to its computed value (what the UI paints into the grid cell).
   */
  getDisplayValue(ref: CellRef): string;
  /** The raw formula source of a cell (without `=`), or `undefined`. */
  getCellFormula(ref: CellRef): string | undefined;

  /* ── recalculation ─────────────────────────────────────────────────── */
  /**
   * Recompute formulas. With `changedRefs`, performs an incremental recalc of
   * just the transitive dependents in topological order; without args, performs
   * a full recalc. Returns the set of refs whose value actually changed (so the
   * UI can repaint only those cells).
   */
  recalc(changedRefs?: CellRef[]): CellRef[];

  /* ── dependency introspection ──────────────────────────────────────── */
  /** Cells that directly depend on (reference) `ref` — its immediate dependents. */
  dependentsOf(ref: CellRef): CellRef[];
  /** Cells that `ref`'s formula directly references — its precedents. */
  precedentsOf(ref: CellRef): CellRef[];

  /* ── function library ──────────────────────────────────────────────── */
  /** Register/override a single worksheet function (case-insensitive name). */
  defineFunction(name: string, fn: SpreadsheetFunction): void;
  /** Bulk-register a map of worksheet functions. */
  registerFunctions(map: Record<string, SpreadsheetFunction>): void;
  /** Whether a function name is known to the engine. */
  hasFunction(name: string): boolean;

  /* ── workbook binding ──────────────────────────────────────────────── */
  /** Bind/replace the workbook the engine operates on (rebuilds the graph). */
  setWorkbook(workbook: WorkbookModel): void;
  /** The currently bound workbook. */
  getWorkbook(): WorkbookModel;
}

/* ═══════════════════════════════════════════════════════════════════════════
   6. SPREADSHEET API — the surface the UI calls into the engine
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * The service surface the `Spreadsheet` UI uses to drive the engine. It is the
 * single seam between the two agents: the UI mutates cells, switches sheets, and
 * reads display values exclusively through this API; the engine implements it by
 * delegating to `FormulaEngine` and mutating the `WorkbookModel`. All write
 * methods are sheet-aware via `CellRef`, and emit events on `events`.
 */
export interface SpreadsheetApi {
  /** The underlying calculation engine (advanced/UI-shared access). */
  readonly engine: FormulaEngine;
  /** Typed event surface the UI subscribes to for repaint/notification. */
  readonly events: SpreadsheetEventBus;

  /* ── workbook / sheet structure ────────────────────────────────────── */
  /** The current workbook model (read-only view; mutate via the methods). */
  getWorkbook(): WorkbookModel;
  /** Load/replace the entire workbook (rebinds the engine, full recalc). */
  loadWorkbook(workbook: WorkbookModel): void;
  /** The active sheet model. */
  getActiveSheet(): SheetModel;
  /** Switch the active sheet by id. */
  setActiveSheet(sheetId: string): void;
  /** Add a sheet (optionally at an index); returns its id. */
  addSheet(name?: string, atIndex?: number): string;
  /** Remove a sheet by id. */
  removeSheet(sheetId: string): void;
  /** Rename a sheet (display name; id and formula edges are unaffected). */
  renameSheet(sheetId: string, name: string): void;

  /* ── cell reads ────────────────────────────────────────────────────── */
  /** The full cell model at a ref (or `undefined` if the cell is empty). */
  getCell(ref: CellRef): CellModel | undefined;
  /** Computed value of a cell. */
  getValue(ref: CellRef): CellValue;
  /** Display-formatted string for a cell (what the grid paints). */
  getDisplayValue(ref: CellRef): string;
  /** Raw formula source (without `=`) at a cell, if it is a formula cell. */
  getFormula(ref: CellRef): string | undefined;

  /* ── cell writes (each triggers recalc + events) ───────────────────── */
  /**
   * Write user input to a cell. Strings beginning with `=` are treated as
   * formulas; everything else is parsed as a literal per the cell's format.
   * Recalculates and emits `cellChange` (+ `recalc`) for affected cells.
   */
  setCellInput(ref: CellRef, input: string): void;
  /** Set a literal value directly (bypasses `=` detection). */
  setValue(ref: CellRef, value: CellValue): void;
  /** Set a formula directly (without the leading `=`). */
  setFormula(ref: CellRef, formula: string): void;
  /** Clear a cell's value/formula (keeps structural format/style unless told). */
  clearCell(ref: CellRef, opts?: { keepFormat?: boolean }): void;
  /** Apply a format patch to a cell. */
  setFormat(ref: CellRef, format: Partial<CellFormat>): void;
  /** Apply a style patch to a cell. */
  setStyle(ref: CellRef, style: Partial<CellStyle>): void;

  /* ── structure mutation ────────────────────────────────────────────── */
  /** Insert `count` rows before `rowIndex` (shifts refs; rewrites formulas). */
  insertRows(sheetId: string, rowIndex: number, count: number): void;
  /** Delete `count` rows at `rowIndex` (shifts refs; #REF!s broken formulas). */
  deleteRows(sheetId: string, rowIndex: number, count: number): void;
  /** Insert `count` columns before `colIndex`. */
  insertColumns(sheetId: string, colIndex: number, count: number): void;
  /** Delete `count` columns at `colIndex`. */
  deleteColumns(sheetId: string, colIndex: number, count: number): void;
  /** Merge a region; the anchor keeps its value, others are cleared. */
  mergeCells(region: MergeRegion & { sheet: string }): void;
  /** Unmerge any merge whose anchor is at `address`. */
  unmergeCells(sheet: string, address: CellAddress): void;
  /** Set frozen-pane counts for a sheet. */
  setFrozen(sheetId: string, frozen: FrozenPanes): void;

  /* ── recalculation ─────────────────────────────────────────────────── */
  /** Force a (full or targeted) recalc; emits `recalc` with changed refs. */
  recalculate(changedRefs?: CellRef[]): void;
  /** Set workbook calc mode (`auto` recalcs on every write; `manual` defers). */
  setCalcMode(mode: 'auto' | 'manual'): void;

  /* ── serialization ─────────────────────────────────────────────────── */
  /** Snapshot the workbook to a plain serializable object. */
  serialize(): WorkbookModel;
}

/* ═══════════════════════════════════════════════════════════════════════════
   7. EVENTS — engine → UI notifications
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Typed spreadsheet event map. Follows the house veto convention: `beforeX`
 * events are vetoable (a handler returning `false` cancels the action); plain
 * events are notifications the UI repaints from.
 */
export interface SpreadsheetEvents extends EventMap {
  /** Vetoable: a cell edit is about to be committed. */
  beforeCellChange: { ref: CellRef; oldValue: CellValue; input: string };
  /** A cell's value/formula changed. */
  cellChange: { ref: CellRef; oldValue: CellValue; value: CellValue };
  /**
   * A recalc completed; `changed` is the exact set of refs whose value moved, so
   * the UI repaints only those grid cells.
   */
  recalc: { changed: CellRef[] };
  /** A dynamic-array formula spilled (or its extent changed). */
  spill: { anchor: CellRef; rows: number; cols: number };
  /** A cell resolved to an error value. */
  cellError: { ref: CellRef; error: CellError };
  /** The active sheet changed. */
  activeSheetChange: { sheetId: string; previous?: string };
  /** A sheet was added. */
  sheetAdd: { sheetId: string; index: number };
  /** A sheet was removed. */
  sheetRemove: { sheetId: string };
  /** A sheet was renamed. */
  sheetRename: { sheetId: string; name: string; previous: string };
  /** Rows/columns were inserted or deleted (UI must re-measure geometry). */
  structureChange: {
    sheetId: string;
    op: 'insertRows' | 'deleteRows' | 'insertColumns' | 'deleteColumns';
    index: number;
    count: number;
  };
  /** The selection changed (driven by the UI; mirrored for plugins). */
  selectionChange: { ref: CellRef; range?: { from: CellRef; to: CellRef } };
  /** The whole workbook was (re)loaded. */
  workbookLoad: { workbook: WorkbookModel };
  /**
   * A cell edit was rejected — by data validation, by sheet/cell protection, or
   * by a `beforeCellChange` veto. The UI surfaces this (e.g. a transient note).
   */
  editRejected: { ref: CellRef; reason: 'validation' | 'protected' | 'veto'; message?: string };
}

/**
 * The typed event bus exposed by `SpreadsheetApi.events`. Mirrors the core
 * `EventEmitter` veto convention (`emit` returns `false` when a vetoable
 * `beforeX` handler cancels).
 */
export interface SpreadsheetEventBus {
  /** Subscribe to a typed event; returns an unsubscribe fn. */
  on<K extends keyof SpreadsheetEvents>(
    event: K,
    fn: (payload: SpreadsheetEvents[K]) => unknown,
  ): () => void;
  /** Subscribe once. */
  once<K extends keyof SpreadsheetEvents>(
    event: K,
    fn: (payload: SpreadsheetEvents[K]) => unknown,
  ): () => void;
  /** Unsubscribe. */
  off<K extends keyof SpreadsheetEvents>(
    event: K,
    fn?: (payload: SpreadsheetEvents[K]) => unknown,
  ): void;
  /** Emit; returns `false` if a vetoable `beforeX` handler cancelled. */
  emit<K extends keyof SpreadsheetEvents>(event: K, payload: SpreadsheetEvents[K]): boolean;
}

/* ═══════════════════════════════════════════════════════════════════════════
   8. RE-EXPORTS — keep `RecordId` available to downstream model code
   ═══════════════════════════════════════════════════════════════════════════ */

export type { RecordId };
