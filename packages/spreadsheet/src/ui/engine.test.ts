/** jsdom unit test for the in-UI engine (contract-conformant SpreadsheetApi). */
import { describe, it, expect, beforeEach } from 'vitest';
import { createSpreadsheetApi, defaultWorkbook } from './engine.js';
import type { CellRef, SpreadsheetApi } from '../contract.js';
import { isCellError } from './format.js';

let api: SpreadsheetApi;
const ref = (row: number, col: number): CellRef => ({ sheet: api.getActiveSheet().id, row, col });

beforeEach(() => {
  api = createSpreadsheetApi(defaultWorkbook());
});

describe('engine — literals & display', () => {
  it('writes a literal and reads its display value', () => {
    api.setCellInput(ref(0, 0), '42');
    expect(api.getValue(ref(0, 0))).toBe(42);
    expect(api.getDisplayValue(ref(0, 0))).toBe('42');
  });

  it('routes leading = to a formula', () => {
    api.setCellInput(ref(0, 0), '=1+2*3');
    expect(api.getValue(ref(0, 0))).toBe(7);
    expect(api.getFormula(ref(0, 0))).toBe('1+2*3');
  });
});

describe('engine — formulas & recalc', () => {
  it('resolves cell references and recalcs dependents', () => {
    api.setCellInput(ref(0, 0), '10'); // A1
    api.setCellInput(ref(1, 0), '20'); // A2
    api.setCellInput(ref(2, 0), '=A1+A2'); // A3
    expect(api.getValue(ref(2, 0))).toBe(30);
    api.setCellInput(ref(0, 0), '100');
    expect(api.getValue(ref(2, 0))).toBe(120);
  });

  it('evaluates SUM over a range', () => {
    api.setCellInput(ref(0, 0), '1');
    api.setCellInput(ref(1, 0), '2');
    api.setCellInput(ref(2, 0), '3');
    api.setCellInput(ref(3, 0), '=SUM(A1:A3)');
    expect(api.getValue(ref(3, 0))).toBe(6);
  });

  it('supports AVERAGE, MIN, MAX, IF, concat', () => {
    api.setCellInput(ref(0, 0), '2');
    api.setCellInput(ref(1, 0), '8');
    api.setCellInput(ref(0, 1), '=AVERAGE(A1:A2)');
    api.setCellInput(ref(1, 1), '=MAX(A1:A2)');
    api.setCellInput(ref(2, 1), '=IF(A2>A1,"big","small")');
    api.setCellInput(ref(3, 1), '="x"&A1');
    expect(api.getValue(ref(0, 1))).toBe(5);
    expect(api.getValue(ref(1, 1))).toBe(8);
    expect(api.getValue(ref(2, 1))).toBe('big');
    expect(api.getValue(ref(3, 1))).toBe('x2');
  });

  it('propagates #DIV/0! errors', () => {
    api.setCellInput(ref(0, 0), '=1/0');
    const v = api.getValue(ref(0, 0));
    expect(isCellError(v)).toBe(true);
    expect(api.getDisplayValue(ref(0, 0))).toBe('#DIV/0!');
  });

  it('emits cellChange and recalc events', () => {
    const changes: number[] = [];
    api.events.on('cellChange', () => changes.push(1));
    let recalced = false;
    api.events.on('recalc', () => (recalced = true));
    api.setCellInput(ref(0, 0), '5');
    expect(changes.length).toBeGreaterThan(0);
    expect(recalced).toBe(true);
  });
});

describe('engine — structure & sheets', () => {
  it('inserts rows, shifting cells down', () => {
    api.setCellInput(ref(1, 0), 'hi'); // A2
    api.insertRows(api.getActiveSheet().id, 0, 1);
    expect(api.getValue(ref(2, 0))).toBe('hi'); // moved to A3
  });

  it('deletes columns, shifting cells left', () => {
    api.setCellInput(ref(0, 2), 'z'); // C1
    api.deleteColumns(api.getActiveSheet().id, 0, 1);
    expect(api.getValue(ref(0, 1))).toBe('z'); // moved to B1
  });

  it('rewrites formula references when inserting a row', () => {
    api.setCellInput(ref(4, 0), '10'); // A5
    api.setCellInput(ref(0, 1), '=A5'); // B1 → A5
    expect(api.getValue(ref(0, 1))).toBe(10);
    api.insertRows(api.getActiveSheet().id, 0, 1); // everything shifts down
    // B1 moved to B2 and now references A6 (the relocated A5).
    expect(api.getFormula(ref(1, 1))).toBe('A6');
    expect(api.getValue(ref(1, 1))).toBe(10);
  });

  it('produces #REF! when a referenced row is deleted', () => {
    api.setCellInput(ref(2, 0), '5'); // A3
    api.setCellInput(ref(0, 1), '=A3'); // B1 → A3
    api.deleteRows(api.getActiveSheet().id, 2, 1); // delete row 3
    expect(api.getFormula(ref(0, 1))).toBe('#REF!');
    expect(isCellError(api.getValue(ref(0, 1)))).toBe(true);
  });

  it('shifts merge regions on structural edits', () => {
    const sheetId = api.getActiveSheet().id;
    api.mergeCells({ sheet: sheetId, row: 4, col: 0, rowSpan: 2, colSpan: 2 });
    api.insertRows(sheetId, 0, 1);
    expect(api.getActiveSheet().merges?.[0]).toMatchObject({ row: 5, rowSpan: 2 });
  });

  it('adds, renames, switches and removes sheets', () => {
    const id = api.addSheet('Data');
    expect(api.getWorkbook().sheets.length).toBe(2);
    api.setActiveSheet(id);
    expect(api.getActiveSheet().id).toBe(id);
    api.renameSheet(id, 'Renamed');
    expect(api.getActiveSheet().name).toBe('Renamed');
    api.removeSheet(id);
    expect(api.getWorkbook().sheets.length).toBe(1);
  });

  it('merges and unmerges cells', () => {
    const sheetId = api.getActiveSheet().id;
    api.setCellInput(ref(0, 0), 'anchor');
    api.mergeCells({ sheet: sheetId, row: 0, col: 0, rowSpan: 2, colSpan: 2 });
    expect(api.getActiveSheet().merges?.length).toBe(1);
    api.unmergeCells(sheetId, { row: 0, col: 0 });
    expect(api.getActiveSheet().merges?.length).toBe(0);
  });

  it('sets frozen panes', () => {
    api.setFrozen(api.getActiveSheet().id, { rows: 1, cols: 1 });
    expect(api.getActiveSheet().frozen).toEqual({ rows: 1, cols: 1 });
  });
});

describe('engine — function library & serialize', () => {
  it('registers a custom function', () => {
    api.engine.defineFunction('DOUBLE', (args) => Number(args[0]) * 2);
    expect(api.engine.hasFunction('double')).toBe(true);
    api.setCellInput(ref(0, 0), '=DOUBLE(21)');
    expect(api.getValue(ref(0, 0))).toBe(42);
  });

  it('serializes to a plain workbook', () => {
    api.setCellInput(ref(0, 0), 'x');
    const snap = api.serialize();
    expect(snap.sheets[0]?.cells['0,0']?.value).toBe('x');
  });
});
