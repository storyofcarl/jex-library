/**
 * The contract-conformant `SpreadsheetApi` that drives the production
 * `FormulaEngine`.
 *
 * The UI codes against `contract.ts`, so the Spreadsheet Widget accepts any
 * `SpreadsheetApi`. This module composes the headless calculation core from
 * `@jects/spreadsheet`'s engine area (`FormulaEngineImpl` — full dependency
 * graph, topological incremental recalc, cross-sheet refs, dynamic-array spill,
 * and the complete built-in function library) with the UI-facing service
 * surface (events, sheet/structure mutation, workbook lifecycle). The UI never
 * recalculates itself: every write goes through the engine, which owns recalc.
 */

import { EventEmitter } from '@jects/core';
import type {
  CellError,
  CellErrorCode,
  CellFormat,
  CellModel,
  CellRef,
  CellStyle,
  CellValue,
  FormulaEngine,
  FrozenPanes,
  SheetModel,
  SpreadsheetApi,
  SpreadsheetEvents,
  WorkbookModel,
} from '../contract.js';
import { FormulaEngineImpl } from '../engine/index.js';
import { formatValue, isCellError } from './format.js';
import { applyStructuralRefTransforms } from './ref-transform.js';

function err(code: CellErrorCode, message?: string): CellError {
  return message === undefined ? { kind: 'error', code } : { kind: 'error', code, message };
}

const cellKey = (row: number, col: number): string => `${row},${col}`;

/** Decode a `"row,col"` cell key into a numeric tuple. */
function parseKey(key: string): [number, number] {
  const i = key.indexOf(',');
  return [Number(key.slice(0, i)), Number(key.slice(i + 1))];
}

/* ── the engine + api ───────────────────────────────────────────────────── */

/**
 * Build a `SpreadsheetApi` backed by the production `FormulaEngine`
 * (`FormulaEngineImpl`). The api owns event emission, sheet/structure mutation,
 * and workbook lifecycle, and delegates ALL parsing/evaluation/recalc to the
 * engine.
 */
export function createSpreadsheetApi(initial?: WorkbookModel): SpreadsheetApi {
  let workbook: WorkbookModel = initial ?? defaultWorkbook();
  const events = new EventEmitter<SpreadsheetEvents>();
  const engine: FormulaEngine = new FormulaEngineImpl(workbook);

  const sheetById = (id: string): SheetModel | undefined => workbook.sheets.find((s) => s.id === id);

  function getCellModel(ref: CellRef): CellModel | undefined {
    return sheetById(ref.sheet)?.cells[cellKey(ref.row, ref.col)];
  }

  function ensureSheet(id: string): SheetModel {
    const s = sheetById(id);
    if (!s) throw new Error(`Unknown sheet ${id}`);
    return s;
  }

  function getCellValue(ref: CellRef): CellValue {
    return engine.getCellValue(ref);
  }

  /**
   * Recompute the workbook (incrementally from `dirty` when supplied), emit a
   * `recalc` for the moved cells plus a `cellError` for any that resolved to an
   * error, and return the changed refs.
   */
  function runRecalc(dirty?: CellRef[]): CellRef[] {
    const changed = engine.recalc(dirty);
    for (const ref of changed) {
      const v = engine.getCellValue(ref);
      if (isCellError(v)) events.emit('cellError', { ref, error: v });
    }
    return changed;
  }

  function autoRecalcAndEmit(dirty: CellRef[]): void {
    if (workbook.calcMode === 'manual') return;
    const changed = runRecalc(dirty);
    if (changed.length || dirty.length) events.emit('recalc', { changed });
  }

  let sheetSeq = workbook.sheets.length;

  const api: SpreadsheetApi = {
    engine,
    events,
    getWorkbook: () => workbook,
    loadWorkbook(wb) {
      workbook = wb;
      sheetSeq = wb.sheets.length;
      engine.setWorkbook(wb);
      runRecalc();
      events.emit('workbookLoad', { workbook });
    },
    getActiveSheet() {
      const activeId = workbook.activeSheet ?? workbook.sheets[0]?.id;
      const found = (activeId ? sheetById(activeId) : undefined) ?? workbook.sheets[0];
      if (!found) throw new Error('Workbook has no sheets');
      return found;
    },
    setActiveSheet(sheetId) {
      const previous = workbook.activeSheet;
      if (!sheetById(sheetId)) return;
      workbook.activeSheet = sheetId;
      events.emit('activeSheetChange', previous === undefined ? { sheetId } : { sheetId, previous });
    },
    addSheet(name, atIndex) {
      const id = `sheet-${++sheetSeq}`;
      const sheet: SheetModel = {
        id,
        name: name ?? `Sheet${sheetSeq}`,
        cells: {},
        rowCount: 100,
        colCount: 26,
      };
      const index = atIndex ?? workbook.sheets.length;
      workbook.sheets.splice(index, 0, sheet);
      events.emit('sheetAdd', { sheetId: id, index });
      return id;
    },
    removeSheet(sheetId) {
      const idx = workbook.sheets.findIndex((s) => s.id === sheetId);
      if (idx < 0 || workbook.sheets.length <= 1) return;
      workbook.sheets.splice(idx, 1);
      if (workbook.activeSheet === sheetId) {
        const nextActive = workbook.sheets[Math.max(0, idx - 1)]?.id;
        if (nextActive) {
          workbook.activeSheet = nextActive;
          events.emit('activeSheetChange', { sheetId: nextActive, previous: sheetId });
        } else {
          delete workbook.activeSheet;
        }
      }
      events.emit('sheetRemove', { sheetId });
    },
    renameSheet(sheetId, name) {
      const s = sheetById(sheetId);
      if (!s) return;
      const previous = s.name;
      s.name = name;
      events.emit('sheetRename', { sheetId, name, previous });
    },
    getCell(ref) {
      return getCellModel(ref);
    },
    getValue: getCellValue,
    getDisplayValue: (ref) => {
      // Compute through the engine, but format via the UI formatter so the
      // contract's `CellFormat.type` (currency/percent/date/…) is honored,
      // including the currency symbol prefix the engine's pattern formatter omits.
      const cell = getCellModel(ref);
      return formatValue(engine.getCellValue(ref), cell?.format);
    },
    getFormula: (ref) => engine.getCellFormula(ref),
    setCellInput(ref, input) {
      const oldValue = getCellValue(ref);
      if (events.emit('beforeCellChange', { ref, oldValue, input }) === false) return;
      let dirty: CellRef[];
      if (input.startsWith('=')) {
        dirty = engine.setCellFormula(ref, input.slice(1));
      } else {
        const sheet = ensureSheet(ref.sheet);
        const cell = sheet.cells[cellKey(ref.row, ref.col)];
        const fmt = cell?.format;
        const value = parseTyped(input, fmt);
        dirty = engine.setCellValue(ref, value);
      }
      autoRecalcAndEmit(dirty);
      const newValue = getCellValue(ref);
      events.emit('cellChange', { ref, oldValue, value: newValue });
    },
    setValue(ref, value) {
      const oldValue = getCellValue(ref);
      const dirty = engine.setCellValue(ref, value);
      autoRecalcAndEmit(dirty);
      events.emit('cellChange', { ref, oldValue, value: getCellValue(ref) });
    },
    setFormula(ref, formula) {
      const oldValue = getCellValue(ref);
      const dirty = engine.setCellFormula(ref, formula);
      autoRecalcAndEmit(dirty);
      events.emit('cellChange', { ref, oldValue, value: getCellValue(ref) });
    },
    clearCell(ref, opts) {
      const sheet = sheetById(ref.sheet);
      if (!sheet) return;
      const key = cellKey(ref.row, ref.col);
      const cell = sheet.cells[key];
      if (!cell) return;
      const oldValue = cell.value ?? null;
      const format = cell.format;
      const style = cell.style;
      // Clear value + formula through the engine so dependency edges and
      // dependents are updated, then restore preserved format/style if asked.
      const dirty = engine.setCellValue(ref, null);
      if (opts?.keepFormat) {
        const restored = sheet.cells[key];
        if (restored) {
          delete restored.value;
          if (format) restored.format = format;
          if (style) restored.style = style;
        }
      } else {
        delete sheet.cells[key];
      }
      autoRecalcAndEmit(dirty);
      events.emit('cellChange', { ref, oldValue, value: null });
    },
    setFormat(ref, format) {
      const sheet = ensureSheet(ref.sheet);
      const cell = (sheet.cells[cellKey(ref.row, ref.col)] ??= {});
      cell.format = { ...cell.format, ...format } as CellFormat;
      events.emit('cellChange', { ref, oldValue: cell.value ?? null, value: cell.value ?? null });
    },
    setStyle(ref, style) {
      const sheet = ensureSheet(ref.sheet);
      const cell = (sheet.cells[cellKey(ref.row, ref.col)] ??= {});
      cell.style = { ...cell.style, ...style } as CellStyle;
      events.emit('cellChange', { ref, oldValue: cell.value ?? null, value: cell.value ?? null });
    },
    insertRows(sheetId, rowIndex, count) {
      const sheet = ensureSheet(sheetId);
      // Rewrite formula refs / merges / frozen BEFORE relocating cell positions
      // (the transform reads stored refs, the shift relocates the cells map).
      applyStructuralRefTransforms(workbook.sheets, sheet, { axis: 'row', at: rowIndex, delta: count });
      shiftRows(sheet, rowIndex, count);
      engine.setWorkbook(workbook);
      events.emit('structureChange', { sheetId, op: 'insertRows', index: rowIndex, count });
      autoRecalcAndEmit([]);
    },
    deleteRows(sheetId, rowIndex, count) {
      const sheet = ensureSheet(sheetId);
      applyStructuralRefTransforms(workbook.sheets, sheet, { axis: 'row', at: rowIndex, delta: -count });
      shiftRows(sheet, rowIndex, -count);
      engine.setWorkbook(workbook);
      events.emit('structureChange', { sheetId, op: 'deleteRows', index: rowIndex, count });
      autoRecalcAndEmit([]);
    },
    insertColumns(sheetId, colIndex, count) {
      const sheet = ensureSheet(sheetId);
      applyStructuralRefTransforms(workbook.sheets, sheet, { axis: 'col', at: colIndex, delta: count });
      shiftCols(sheet, colIndex, count);
      engine.setWorkbook(workbook);
      events.emit('structureChange', { sheetId, op: 'insertColumns', index: colIndex, count });
      autoRecalcAndEmit([]);
    },
    deleteColumns(sheetId, colIndex, count) {
      const sheet = ensureSheet(sheetId);
      applyStructuralRefTransforms(workbook.sheets, sheet, { axis: 'col', at: colIndex, delta: -count });
      shiftCols(sheet, colIndex, -count);
      engine.setWorkbook(workbook);
      events.emit('structureChange', { sheetId, op: 'deleteColumns', index: colIndex, count });
      autoRecalcAndEmit([]);
    },
    mergeCells(region) {
      const sheet = ensureSheet(region.sheet);
      (sheet.merges ??= []).push({
        row: region.row,
        col: region.col,
        rowSpan: region.rowSpan,
        colSpan: region.colSpan,
      });
      // clear covered (non-anchor) cells
      for (let r = region.row; r < region.row + region.rowSpan; r++)
        for (let c = region.col; c < region.col + region.colSpan; c++) {
          if (r === region.row && c === region.col) continue;
          delete sheet.cells[cellKey(r, c)];
        }
      engine.setWorkbook(workbook);
      autoRecalcAndEmit([]);
    },
    unmergeCells(sheet, address) {
      const s = sheetById(sheet);
      if (!s?.merges) return;
      s.merges = s.merges.filter((m) => !(m.row === address.row && m.col === address.col));
    },
    setFrozen(sheetId, frozen) {
      ensureSheet(sheetId).frozen = { ...frozen } as FrozenPanes;
    },
    recalculate(changedRefs) {
      const changed = runRecalc(changedRefs);
      events.emit('recalc', { changed });
    },
    setCalcMode(mode) {
      workbook.calcMode = mode;
    },
    serialize() {
      return JSON.parse(JSON.stringify(workbook)) as WorkbookModel;
    },
  };

  function shiftRows(sheet: SheetModel, at: number, delta: number): void {
    const next: Record<string, CellModel> = {};
    for (const [key, cell] of Object.entries(sheet.cells)) {
      const [row, col] = parseKey(key);
      if (delta > 0) {
        const nr = row >= at ? row + delta : row;
        next[cellKey(nr, col)] = cell;
      } else {
        const removeStart = at;
        const removeEnd = at - delta - 1;
        if (row >= removeStart && row <= removeEnd) continue;
        const nr = row > removeEnd ? row + delta : row;
        next[cellKey(nr, col)] = cell;
      }
    }
    sheet.cells = next;
    sheet.rowCount = Math.max(1, sheet.rowCount + delta);
  }

  function shiftCols(sheet: SheetModel, at: number, delta: number): void {
    const next: Record<string, CellModel> = {};
    for (const [key, cell] of Object.entries(sheet.cells)) {
      const [row, col] = parseKey(key);
      if (delta > 0) {
        const nc = col >= at ? col + delta : col;
        next[cellKey(row, nc)] = cell;
      } else {
        const removeStart = at;
        const removeEnd = at - delta - 1;
        if (col >= removeStart && col <= removeEnd) continue;
        const nc = col > removeEnd ? col + delta : col;
        next[cellKey(row, nc)] = cell;
      }
    }
    sheet.cells = next;
    sheet.colCount = Math.max(1, sheet.colCount + delta);
  }

  function parseTyped(input: string, format?: CellFormat): CellValue {
    if (format?.type === 'text') return input;
    const t = input.trim();
    if (t === '') return null;
    if (/^(true|false)$/i.test(t)) return /^true$/i.test(t);
    if (/^-?\d+(\.\d+)?%$/.test(t)) return parseFloat(t) / 100;
    const numeric = t.replace(/^[$£€¥]/, '').replace(/,/g, '');
    if (/^-?\d+(\.\d+)?$/.test(numeric)) return parseFloat(numeric);
    return input;
  }

  // Compute initial values for any formula cells in the provided workbook.
  runRecalc();
  return api;
}

/* ── helpers ────────────────────────────────────────────────────────────── */

/** A blank single-sheet workbook. */
export function defaultWorkbook(): WorkbookModel {
  return {
    sheets: [{ id: 'sheet-1', name: 'Sheet1', cells: {}, rowCount: 100, colCount: 26 }],
    activeSheet: 'sheet-1',
    calcMode: 'auto',
  };
}

/** Re-export the error helper for the IO layer / consumers. */
export { err as makeError };
