/** jsdom unit test for the top-level Spreadsheet widget. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Spreadsheet } from './spreadsheet.js';
import { isRegistered, create } from '@jects/core';
import type { CellRef } from '../contract.js';

let host: HTMLElement;
let ss: Spreadsheet;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  ss = new Spreadsheet(host, {});
});
afterEach(() => {
  if (!ss.isDestroyed) ss.destroy();
  host.remove();
});

const ref = (row: number, col: number): CellRef => ({
  sheet: ss.getApi().getActiveSheet().id,
  row,
  col,
});

describe('Spreadsheet — composition & registration', () => {
  it('registers with the factory', () => {
    expect(isRegistered('spreadsheet')).toBe(true);
  });

  it('can be created through the factory', () => {
    const host2 = document.createElement('div');
    document.body.appendChild(host2);
    const w = create({ type: 'spreadsheet' }, host2) as Spreadsheet;
    expect(w).toBeInstanceOf(Spreadsheet);
    w.destroy();
    host2.remove();
  });

  it('renders toolbar, formula bar, grid and tabs', () => {
    expect(host.querySelector('.jects-ss__toolbar')).toBeTruthy();
    expect(host.querySelector('.jects-fbar')).toBeTruthy();
    expect(host.querySelector('[role="grid"]')).toBeTruthy();
    expect(host.querySelector('[role="tablist"]')).toBeTruthy();
  });

  it('honors chrome toggles', () => {
    const h = document.createElement('div');
    document.body.appendChild(h);
    const bare = new Spreadsheet(h, { toolbar: false, formulaBar: false, sheetTabs: false });
    expect(h.querySelector('.jects-ss__toolbar')).toBeNull();
    expect(h.querySelector('.jects-fbar')).toBeNull();
    expect(h.querySelector('[role="tablist"]')).toBeNull();
    bare.destroy();
    h.remove();
  });
});

describe('Spreadsheet — editing & formula bar', () => {
  it('reflects the active cell in the formula bar', () => {
    ss.getApi().setCellInput(ref(0, 0), '=1+2');
    ss.getGrid().update({});
    ss.getGrid().setActive({ row: 0, col: 0 });
    const input = host.querySelector('.jects-fbar__input') as HTMLInputElement;
    expect(input.value).toBe('=1+2');
  });

  it('commits an edit from the formula bar', () => {
    ss.getGrid().setActive({ row: 1, col: 1 });
    const input = host.querySelector('.jects-fbar__input') as HTMLInputElement;
    input.value = '=10*2';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(ss.getApi().getValue(ref(1, 1))).toBe(20);
  });

  it('emits cellCommit through the widget', () => {
    const spy = vi.fn();
    ss.on('cellCommit', spy);
    ss.getGrid().setActive({ row: 0, col: 0 });
    ss.getGrid().startEdit('99');
    ss.getGrid().commitEdit();
    expect(spy).toHaveBeenCalled();
  });
});

describe('Spreadsheet — undo / redo', () => {
  it('undoes and redoes a cell edit', () => {
    ss.getGrid().setActive({ row: 0, col: 0 });
    ss.getGrid().startEdit('first');
    ss.getGrid().commitEdit();
    expect(ss.getApi().getValue(ref(0, 0))).toBe('first');
    expect(ss.canUndo()).toBe(true);
    ss.undo();
    expect(ss.getApi().getValue(ref(0, 0))).toBe(null);
    ss.redo();
    expect(ss.getApi().getValue(ref(0, 0))).toBe('first');
  });

  it('undoes a style change', () => {
    ss.getGrid().setActive({ row: 0, col: 0 });
    ss.toggleStyle('bold');
    expect(ss.getApi().getCell(ref(0, 0))?.style?.bold).toBe(true);
    ss.undo();
    expect(ss.getApi().getCell(ref(0, 0))?.style?.bold).toBeFalsy();
  });
});

describe('Spreadsheet — formats & styles', () => {
  it('applies a currency format to the selection', () => {
    ss.getApi().setCellInput(ref(0, 0), '1234.5');
    ss.getGrid().setActive({ row: 0, col: 0 });
    ss.applyFormat({ type: 'currency', numberFormat: '#,##0.00' });
    expect(ss.getApi().getDisplayValue(ref(0, 0))).toBe('$1,234.50');
  });

  it('applies alignment via applyStyle', () => {
    ss.getGrid().setActive({ row: 0, col: 0 });
    ss.applyStyle({ align: 'end' });
    expect(ss.getApi().getCell(ref(0, 0))?.style?.align).toBe('end');
  });
});

describe('Spreadsheet — clipboard & fill', () => {
  it('copies and pastes a block', () => {
    ss.getApi().setCellInput(ref(0, 0), 'a');
    ss.getApi().setCellInput(ref(0, 1), 'b');
    ss.getGrid().setActive({ row: 0, col: 0 });
    ss.getGrid().setActive({ row: 0, col: 1 }, true); // extend range A1:B1
    const tsv = ss.copy();
    expect(tsv).toBe('a\tb');
    ss.getGrid().setActive({ row: 2, col: 0 });
    ss.pasteBlock([['a', 'b']]);
    expect(ss.getApi().getValue(ref(2, 0))).toBe('a');
    expect(ss.getApi().getValue(ref(2, 1))).toBe('b');
  });

  it('fills a numeric series downward', () => {
    ss.getApi().setValue(ref(0, 0), 1);
    ss.getGrid().setActive({ row: 0, col: 0 });
    ss.getGrid().setActive({ row: 3, col: 0 }, true); // A1:A4
    ss.fillDown();
    expect(ss.getApi().getValue(ref(1, 0))).toBe(2);
    expect(ss.getApi().getValue(ref(3, 0))).toBe(4);
  });
});

describe('Spreadsheet — structure & sheets', () => {
  it('merges and splits cells via the toolbar API', () => {
    ss.getGrid().setActive({ row: 0, col: 0 });
    ss.getGrid().setActive({ row: 1, col: 1 }, true);
    ss.merge();
    expect(ss.getApi().getActiveSheet().merges?.length).toBe(1);
    ss.getGrid().setActive({ row: 0, col: 0 });
    ss.split();
    expect(ss.getApi().getActiveSheet().merges?.length).toBe(0);
  });

  it('freezes panes at the active cell', () => {
    ss.getGrid().setActive({ row: 2, col: 1 });
    ss.setFrozen({ rows: 2, cols: 1 });
    expect(ss.getApi().getActiveSheet().frozen).toEqual({ rows: 2, cols: 1 });
  });

  it('adds, switches, and reflects sheets in the tab strip', () => {
    const before = host.querySelectorAll('[role="tab"]').length;
    const id = ss.addSheet('Extra');
    expect(host.querySelectorAll('[role="tab"]').length).toBe(before + 1);
    expect(ss.getApi().getActiveSheet().id).toBe(id);
  });
});

describe('Spreadsheet — data validation', () => {
  it('stores a dropdown validation rule for the active cell', () => {
    ss.getGrid().setActive({ row: 0, col: 0 });
    ss.setValidation({ kind: 'list', values: ['Yes', 'No'] });
    expect(ss.getValidation({ row: 0, col: 0 })?.kind).toBe('list');
  });
});

describe('Spreadsheet — import / export', () => {
  it('exports CSV / JSON / XLSX of the current workbook', () => {
    ss.getApi().setCellInput(ref(0, 0), 'Name');
    ss.getApi().setCellInput(ref(0, 1), 'Age');
    expect(ss.exportTo('csv').split('\r\n')[0]).toBe('Name,Age');
    expect(ss.exportTo('json')).toContain('"sheets"');
    expect(ss.exportTo('xlsx')).toContain('<Workbook');
  });

  it('imports a CSV, replacing the workbook', () => {
    const spy = vi.fn();
    ss.on('import', spy);
    ss.importFrom('x,y\r\n1,2', 'csv');
    expect(ss.getApi().getValue(ref(0, 0))).toBe('x');
    expect(ss.getApi().getValue(ref(1, 0))).toBe(1);
    expect(spy).toHaveBeenCalledWith({ format: 'csv' });
  });
});

describe('Spreadsheet — lifecycle', () => {
  it('destroys cleanly and is idempotent', () => {
    expect(() => {
      ss.destroy();
      ss.destroy();
    }).not.toThrow();
    expect(ss.isDestroyed).toBe(true);
    expect(host.querySelector('.jects-ss')).toBeNull();
  });
});
