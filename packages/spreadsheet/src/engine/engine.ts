/**
 * `FormulaEngineImpl` — the headless calculation core implementing the contract
 * `FormulaEngine`. Owns:
 *   - the bound `WorkbookModel` (sparse cell maps),
 *   - the function registry (built-ins + custom),
 *   - a directed dependency graph (precedents/dependents) keyed on stable
 *     `CellRef`s, with cross-sheet edges,
 *   - topological, incremental recalc with circular-reference detection,
 *   - dynamic-array spill (anchor + spillParent bookkeeping).
 *
 * Pure logic — no DOM.
 */

import type {
  A1Helpers,
  Ast,
  CellModel,
  CellRef,
  CellValue,
  EvalContext,
  FormulaEngine,
  SheetModel,
  SpreadsheetFunction,
  WorkbookModel,
} from '../contract.js';
import { a1Helpers, cellKey, normalizeBox, parseCellKey, refKey } from './a1.js';
import { ERR, formatDateDefault, isBlank, isError, numberToText, serialToDate, toText } from './errors.js';
import { Evaluator, type RefCollector } from './evaluator.js';
import { formatNumberPattern } from './functions/text.js';
import { builtinFunctions } from './functions/index.js';
import { type FnArg, isMatrix } from './helpers.js';
import { parseFormula } from './parser.js';

/** Internal per-cell graph node. */
interface CellNode {
  ref: CellRef;
  /** Parsed formula AST (undefined for literal cells). */
  ast?: Ast;
  /** Refs this cell directly reads. */
  precedents: Set<string>;
  /** Refs that directly read this cell. */
  dependents: Set<string>;
}

export class FormulaEngineImpl implements FormulaEngine {
  readonly a1: A1Helpers = a1Helpers;

  private workbook: WorkbookModel;
  private readonly functions = new Map<string, SpreadsheetFunction>();
  private readonly evaluator: Evaluator;

  /** Graph nodes keyed by refKey. Only formula cells have precedents. */
  private readonly nodes = new Map<string, CellNode>();
  /** Reverse index: refKey of a cell → set of dependent refKeys. */
  private readonly dependentsIndex = new Map<string, Set<string>>();

  constructor(workbook?: WorkbookModel, functions?: Record<string, SpreadsheetFunction>) {
    this.workbook = workbook ?? { sheets: [{ id: 's1', name: 'Sheet1', cells: {}, rowCount: 100, colCount: 26 }] };
    this.registerFunctions(builtinFunctions);
    if (functions) this.registerFunctions(functions);
    this.evaluator = new Evaluator({
      getFunction: (name) => this.functions.get(name.toUpperCase()),
      resolveName: (name) => this.workbook.namedRanges?.[name] ?? this.workbook.namedRanges?.[name.toUpperCase()],
    });
    this.rebuildGraph();
  }

  /* ── parsing ───────────────────────────────────────────────────────── */
  parse(formula: string): Ast {
    return parseFormula(formula);
  }

  /* ── workbook binding ──────────────────────────────────────────────── */
  setWorkbook(workbook: WorkbookModel): void {
    this.workbook = workbook;
    this.rebuildGraph();
    this.recalc();
  }
  getWorkbook(): WorkbookModel {
    return this.workbook;
  }

  /* ── sheet helpers ─────────────────────────────────────────────────── */
  private sheetById(id: string): SheetModel | undefined {
    return this.workbook.sheets.find((s) => s.id === id);
  }
  private sheetByName(name: string): SheetModel | undefined {
    return this.workbook.sheets.find((s) => s.name.toLowerCase() === name.toLowerCase());
  }
  private resolveSheetName(name: string): string | undefined {
    return this.sheetByName(name)?.id;
  }
  private cell(ref: CellRef): CellModel | undefined {
    return this.sheetById(ref.sheet)?.cells[cellKey(ref.row, ref.col)];
  }
  private ensureCell(ref: CellRef): CellModel {
    const sheet = this.sheetById(ref.sheet);
    if (!sheet) throw new Error(`Unknown sheet: ${ref.sheet}`);
    const key = cellKey(ref.row, ref.col);
    let c = sheet.cells[key];
    if (!c) {
      c = {};
      sheet.cells[key] = c;
    }
    return c;
  }

  /* ── eval context ──────────────────────────────────────────────────── */
  private makeContext(origin: CellRef): EvalContext {
    return {
      origin,
      workbook: this.workbook,
      getValue: (ref) => this.getCellValue(ref),
      getRange: (from, to) => this.readRange(from, to),
      resolveSheet: (name) => this.resolveSheetName(name),
    };
  }

  private readRange(from: CellRef, to: CellRef): CellValue[][] {
    const box = normalizeBox(from, to);
    const out: CellValue[][] = [];
    for (let r = box.top; r <= box.bottom; r++) {
      const row: CellValue[] = [];
      for (let c = box.left; c <= box.right; c++) {
        row.push(this.getCellValue({ sheet: box.sheet, row: r, col: c }));
      }
      out.push(row);
    }
    return out;
  }

  /* ── reads ─────────────────────────────────────────────────────────── */
  getCellValue(ref: CellRef): CellValue {
    const c = this.cell(ref);
    if (!c) return null;
    return c.value ?? null;
  }
  getCellFormula(ref: CellRef): string | undefined {
    return this.cell(ref)?.formula;
  }
  getDisplayValue(ref: CellRef): string {
    const c = this.cell(ref);
    if (!c) return '';
    return this.formatValue(c.value ?? null, c);
  }

  private formatValue(v: CellValue, cell: CellModel): string {
    if (isError(v)) return v.code;
    if (isBlank(v)) return '';
    const fmt = cell.format?.numberFormat;
    if (typeof v === 'number') {
      if (fmt) return formatNumberPattern(v, fmt);
      if (cell.format?.type === 'date' || cell.format?.type === 'time') {
        return formatDateDefault(serialToDate(v));
      }
      return numberToText(v);
    }
    if (v instanceof Date) return formatDateDefault(v);
    if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
    return toText(v);
  }

  /* ── evaluate (stateless) ──────────────────────────────────────────── */
  evaluate(formula: string | Ast, ctx: EvalContext): CellValue {
    const ast = typeof formula === 'string' ? this.parse(formula) : formula;
    return this.evaluator.evalToValue(ast, ctx);
  }

  /* ── function registry ─────────────────────────────────────────────── */
  defineFunction(name: string, fn: SpreadsheetFunction): void {
    this.functions.set(name.toUpperCase(), fn);
  }
  registerFunctions(map: Record<string, SpreadsheetFunction>): void {
    for (const [name, fn] of Object.entries(map)) this.functions.set(name.toUpperCase(), fn);
  }
  hasFunction(name: string): boolean {
    return this.functions.has(name.toUpperCase());
  }

  /* ── dependency graph construction ─────────────────────────────────── */
  private node(ref: CellRef): CellNode {
    const key = refKey(ref);
    let n = this.nodes.get(key);
    if (!n) {
      n = { ref, precedents: new Set(), dependents: new Set() };
      this.nodes.set(key, n);
    }
    return n;
  }

  /** Collect the precedent refs of a parsed formula (expanding ranges). */
  private collectPrecedents(ast: Ast, origin: CellRef): Set<string> {
    const set = new Set<string>();
    const collector: RefCollector = {
      addRef: (ref) => set.add(refKey(ref)),
      addRange: (from, to) => {
        const box = normalizeBox(from, to);
        for (let r = box.top; r <= box.bottom; r++) {
          for (let c = box.left; c <= box.right; c++) {
            set.add(refKey({ sheet: box.sheet, row: r, col: c }));
          }
        }
      },
    };
    // Use a no-op context just for ref collection (values not needed).
    const ctx = this.makeContext(origin);
    try {
      this.evaluator.evalToArrayOrValue(ast, ctx, collector);
    } catch {
      /* ignore — collection is best-effort; eval happens later */
    }
    return set;
  }

  /** Wire up graph edges for one cell from its (re-)parsed AST. */
  private setEdges(ref: CellRef, precedents: Set<string>): void {
    const n = this.node(ref);
    const key = refKey(ref);
    // Remove old reverse edges.
    for (const p of n.precedents) {
      this.dependentsIndex.get(p)?.delete(key);
    }
    n.precedents = precedents;
    // Add new reverse edges.
    for (const p of precedents) {
      let set = this.dependentsIndex.get(p);
      if (!set) {
        set = new Set();
        this.dependentsIndex.set(p, set);
      }
      set.add(key);
    }
  }

  private rebuildGraph(): void {
    this.nodes.clear();
    this.dependentsIndex.clear();
    for (const sheet of this.workbook.sheets) {
      for (const [k, cell] of Object.entries(sheet.cells)) {
        if (cell.formula !== undefined && cell.formula !== '') {
          const addr = parseCellKey(k);
          const ref: CellRef = { sheet: sheet.id, row: addr.row, col: addr.col };
          const ast = this.parse(cell.formula);
          this.node(ref).ast = ast;
          this.setEdges(ref, this.collectPrecedents(ast, ref));
        }
      }
    }
  }

  /* ── dependency introspection ──────────────────────────────────────── */
  dependentsOf(ref: CellRef): CellRef[] {
    const set = this.dependentsIndex.get(refKey(ref));
    if (!set) return [];
    return [...set].map((k) => this.nodes.get(k)!.ref);
  }
  precedentsOf(ref: CellRef): CellRef[] {
    const n = this.nodes.get(refKey(ref));
    if (!n) return [];
    return [...n.precedents].map((k) => keyToRef(k));
  }

  /* ── cell mutation ─────────────────────────────────────────────────── */
  setCellFormula(ref: CellRef, formula: string): CellRef[] {
    const cell = this.ensureCell(ref);
    const src = formula.startsWith('=') ? formula.slice(1) : formula;
    if (src.trim() === '') {
      // Clearing the formula.
      delete cell.formula;
      cell.value = null;
      const cleared = this.clearSpillFromAnchor(ref);
      delete this.node(ref).ast;
      this.setEdges(ref, new Set());
      return this.markDirty(ref, cleared);
    }
    cell.formula = src;
    const ast = this.parse(src);
    this.node(ref).ast = ast;
    this.setEdges(ref, this.collectPrecedents(ast, ref));
    return this.markDirty(ref);
  }

  setCellValue(ref: CellRef, value: CellValue): CellRef[] {
    const cell = this.ensureCell(ref);
    delete cell.formula;
    // Overwriting a spill anchor with a literal removes its members; readers of
    // those members must be re-dirtied so they recompute against the now-blank
    // member cells (the anchor itself stops being a formula, so the recalc
    // loop's spill-member fixpoint never runs for it).
    const cleared = this.clearSpillFromAnchor(ref);
    cell.value = value;
    delete this.node(ref).ast;
    this.setEdges(ref, new Set());
    return this.markDirty(ref, cleared);
  }

  /**
   * The set of refs that became dirty (this cell + transitive dependents).
   *
   * `seedKeys` lets callers inject additional starting refKeys whose dependents
   * must also be invalidated — used when clearing a dynamic-array spill, where
   * the removed member cells are not in the graph as the changed cell but their
   * readers still need to recompute.
   */
  private markDirty(ref: CellRef, seedKeys: string[] = []): CellRef[] {
    const dirty: CellRef[] = [];
    const seen = new Set<string>();
    const stack = [refKey(ref), ...seedKeys];
    while (stack.length) {
      const key = stack.pop()!;
      if (seen.has(key)) continue;
      seen.add(key);
      dirty.push(keyToRef(key));
      const deps = this.dependentsIndex.get(key);
      if (deps) for (const d of deps) stack.push(d);
    }
    return dirty;
  }

  /* ── recalculation (topological) ───────────────────────────────────── */
  recalc(changedRefs?: CellRef[]): CellRef[] {
    let targetKeys = changedRefs
      ? this.transitiveFormulaTargets(changedRefs)
      : new Set([...this.nodes.values()].filter((n) => n.ast).map((n) => refKey(n.ref)));

    const changed: CellRef[] = [];
    const changedKeys = new Set<string>();
    const evaluated = new Set<string>();

    // Dynamic-array spill writes value into neighbour cells that are NOT formula
    // cells; dependents of those members must still recompute. We therefore run
    // the topo recalc, collect any spill-member refs produced, union their
    // dependents into the target set, and iterate to a fixpoint. A bound guards
    // against pathological churn.
    for (let pass = 0; pass < MAX_RECALC_PASSES; pass++) {
      const order = this.topoSort(targetKeys);
      const onCycle = order.cycle;
      const newTargets = new Set<string>();

      for (const key of order.sorted) {
        if (evaluated.has(key)) continue;
        const node = this.nodes.get(key);
        if (!node || !node.ast) continue;
        evaluated.add(key);
        const ref = node.ref;
        const cell = this.cell(ref);
        if (!cell) continue;
        const prev = cell.value ?? null;

        if (onCycle.has(key)) {
          this.assignValue(ref, ERR.CYCLE);
        } else {
          const members = this.evalFormulaCell(ref, node.ast);
          // Feed dependents of every spilled member back into the target set so
          // formulas that read a spill-range member recompute in a later pass.
          for (const mKey of members) {
            const deps = this.dependentsIndex.get(mKey);
            if (!deps) continue;
            for (const d of deps) {
              if (this.nodes.get(d)?.ast && !evaluated.has(d)) newTargets.add(d);
            }
          }
        }
        const now = this.cell(ref)?.value ?? null;
        if (!valuesEqual(prev, now) && !changedKeys.has(key)) {
          changedKeys.add(key);
          changed.push(ref);
        }
      }

      if (newTargets.size === 0) break;
      // Next pass targets the freshly dirtied dependents plus their own
      // transitive formula dependents.
      targetKeys = this.transitiveFormulaTargets([...newTargets].map(keyToRef));
    }
    return changed;
  }

  /** Formula cells reachable (transitively) from the changed refs. */
  private transitiveFormulaTargets(changedRefs: CellRef[]): Set<string> {
    const targets = new Set<string>();
    const seen = new Set<string>();
    const stack = changedRefs.map(refKey);
    while (stack.length) {
      const key = stack.pop()!;
      const deps = this.dependentsIndex.get(key);
      if (!deps) continue;
      for (const d of deps) {
        if (seen.has(d)) continue;
        seen.add(d);
        const node = this.nodes.get(d);
        if (node?.ast) targets.add(d);
        stack.push(d);
      }
    }
    // Also include directly-changed cells that are themselves formulas.
    for (const ref of changedRefs) {
      const k = refKey(ref);
      if (this.nodes.get(k)?.ast) targets.add(k);
    }
    return targets;
  }

  /**
   * Topologically sort the target formula cells by their precedent edges.
   * Returns the order plus the set of keys participating in a cycle.
   */
  private topoSort(targets: Set<string>): { sorted: string[]; cycle: Set<string> } {
    const sorted: string[] = [];
    const cycle = new Set<string>();
    const state = new Map<string, 0 | 1 | 2>(); // 0=unvisited,1=visiting,2=done

    const visit = (key: string, path: Set<string>): void => {
      if (!targets.has(key)) return;
      const st = state.get(key);
      if (st === 2) return;
      if (st === 1) {
        // Back-edge → cycle. Mark every node on the current path that is a target.
        cycle.add(key);
        for (const p of path) if (targets.has(p)) cycle.add(p);
        return;
      }
      state.set(key, 1);
      path.add(key);
      const node = this.nodes.get(key);
      if (node) {
        for (const p of node.precedents) {
          if (targets.has(p)) visit(p, path);
        }
      }
      path.delete(key);
      state.set(key, 2);
      sorted.push(key);
    };

    for (const key of targets) visit(key, new Set());
    return { sorted, cycle };
  }

  /**
   * Evaluate one formula cell, assigning its value + handling spill.
   * Returns the refKeys of any spill-member cells written (the anchor itself is
   * already covered by the normal dependency graph, so it is not included).
   */
  private evalFormulaCell(ref: CellRef, ast: Ast): string[] {
    // Clear any previous spill this cell anchored. Members that disappear must
    // also re-dirty their dependents, so collect them too.
    const cleared = this.clearSpillFromAnchor(ref);
    const ctx = this.makeContext(ref);
    const result: FnArg = this.evaluator.evalToArrayOrValue(ast, ctx);

    if (isMatrix(result)) {
      const written = this.spill(ref, result);
      // Union written + cleared so dependents of a shrunk/removed member recompute.
      return cleared.length ? [...new Set([...written, ...cleared])] : written;
    }
    this.assignValue(ref, result);
    return cleared;
  }

  private assignValue(ref: CellRef, value: CellValue): void {
    const cell = this.ensureCell(ref);
    cell.value = value;
  }

  /* ── dynamic-array spill ───────────────────────────────────────────── */
  /** Write a matrix result as a spill; returns refKeys of the member cells written. */
  private spill(anchor: CellRef, matrix: CellValue[][]): string[] {
    const rows = matrix.length;
    const cols = matrix[0]?.length ?? 0;
    const at = (r: number, c: number): CellValue => matrix[r]?.[c] ?? null;
    if (rows === 1 && cols === 1) {
      this.assignValue(anchor, at(0, 0));
      const c = this.ensureCell(anchor);
      delete c.spill;
      return [];
    }
    const sheet = this.sheetById(anchor.sheet);
    if (!sheet) {
      this.assignValue(anchor, ERR.REF);
      return [];
    }

    // Check the spill range is clear (no non-empty, non-self cells).
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (r === 0 && c === 0) continue;
        const tRef: CellRef = { sheet: anchor.sheet, row: anchor.row + r, col: anchor.col + c };
        const existing = this.cell(tRef);
        if (existing && existing.spillParent === undefined && !isBlank(existing.value ?? null)) {
          // Blocked → #SPILL! on the anchor.
          this.assignValue(anchor, ERR.SPILL);
          const ac = this.ensureCell(anchor);
          delete ac.spill;
          return [];
        }
        if (existing && existing.formula) {
          this.assignValue(anchor, ERR.SPILL);
          const ac = this.ensureCell(anchor);
          delete ac.spill;
          return [];
        }
      }
    }

    // Write the spill.
    const written: string[] = [];
    const anchorCell = this.ensureCell(anchor);
    anchorCell.value = at(0, 0);
    anchorCell.spill = { rows, cols };
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (r === 0 && c === 0) continue;
        const tRef: CellRef = { sheet: anchor.sheet, row: anchor.row + r, col: anchor.col + c };
        const tc = this.ensureCell(tRef);
        tc.value = at(r, c);
        tc.spillParent = { row: anchor.row, col: anchor.col };
        written.push(refKey(tRef));
      }
    }
    return written;
  }

  /**
   * Remove any spill members previously written by this anchor.
   * Returns the refKeys of the removed member cells so their dependents can be
   * re-dirtied (a shrinking/removed spill must invalidate readers of members).
   */
  private clearSpillFromAnchor(anchor: CellRef): string[] {
    const sheet = this.sheetById(anchor.sheet);
    if (!sheet) return [];
    const anchorCell = sheet.cells[cellKey(anchor.row, anchor.col)];
    if (!anchorCell?.spill) return [];
    const { rows, cols } = anchorCell.spill;
    const removed: string[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (r === 0 && c === 0) continue;
        const key = cellKey(anchor.row + r, anchor.col + c);
        const member = sheet.cells[key];
        if (
          member &&
          member.spillParent &&
          member.spillParent.row === anchor.row &&
          member.spillParent.col === anchor.col
        ) {
          delete sheet.cells[key];
          removed.push(refKey({ sheet: anchor.sheet, row: anchor.row + r, col: anchor.col + c }));
        }
      }
    }
    delete anchorCell.spill;
    return removed;
  }
}

/* ── helpers ─────────────────────────────────────────────────────────── */

/** Upper bound on spill-driven recalc fixpoint iterations (guards churn). */
const MAX_RECALC_PASSES = 64;

function keyToRef(key: string): CellRef {
  const bang = key.indexOf('!');
  const sheet = key.slice(0, bang);
  const rest = key.slice(bang + 1);
  const comma = rest.indexOf(',');
  return { sheet, row: parseInt(rest.slice(0, comma), 10), col: parseInt(rest.slice(comma + 1), 10) };
}

function valuesEqual(a: CellValue, b: CellValue): boolean {
  if (a === b) return true;
  if (isError(a) && isError(b)) return a.code === b.code;
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (isBlank(a) && isBlank(b)) return true;
  return false;
}
