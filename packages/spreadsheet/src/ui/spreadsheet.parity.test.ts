/**
 * jsdom integration tests for the enterprise-parity features wired into the
 * top-level Spreadsheet widget: validation enforcement + dropdown, conditional
 * formatting, named ranges, comments, drag fill, and cell protection.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Spreadsheet } from './spreadsheet.js';
import type { CellAddress } from '../contract.js';

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

const ref = (row: number, col: number) => ({ sheet: ss.getApi().getActiveSheet().id, row, col });

/** Drive an inline edit through the grid (start → set editor value → commit). */
function typeInto(addr: CellAddress, text: string, advance: 'down' | 'none' = 'none'): void {
  ss.getGrid().setActive(addr);
  ss.getGrid().startEdit();
  const editor = host.querySelector('.jects-sheet__editor') as HTMLInputElement | HTMLSelectElement;
  editor.value = text;
  ss.getGrid().commitEdit(advance);
}

describe('Gap 1 — data validation enforcement + dropdown', () => {
  it('vetoes an invalid number on commit and emits editRejected', () => {
    const spy = vi.fn();
    ss.on('editRejected', spy);
    ss.getGrid().setActive({ row: 0, col: 0 });
    ss.setValidation({ kind: 'number', min: 0, max: 10 });
    typeInto({ row: 0, col: 0 }, '99');
    expect(ss.getApi().getValue(ref(0, 0))).toBe(null); // write was vetoed
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'validation' }),
    );
  });

  it('accepts a valid number', () => {
    ss.getGrid().setActive({ row: 0, col: 0 });
    ss.setValidation({ kind: 'number', min: 0, max: 10 });
    typeInto({ row: 0, col: 0 }, '5');
    expect(ss.getApi().getValue(ref(0, 0))).toBe(5);
  });

  it('renders a <select> editor for a list rule', () => {
    ss.getGrid().setActive({ row: 1, col: 1 });
    ss.setValidation({ kind: 'list', values: ['Yes', 'No'] });
    ss.getGrid().setActive({ row: 1, col: 1 });
    ss.getGrid().startEdit();
    const select = host.querySelector('select.jects-sheet__editor--select') as HTMLSelectElement;
    expect(select).toBeTruthy();
    // Options: blank + the two list values.
    expect([...select.options].map((o) => o.value)).toEqual(['', 'Yes', 'No']);
    select.value = 'No';
    ss.getGrid().commitEdit();
    expect(ss.getApi().getValue(ref(1, 1))).toBe('No');
  });
});

describe('Gap 2 — conditional formatting', () => {
  it('applies a cellValue rule live and clears it', () => {
    ss.getApi().setValue(ref(0, 0), 150);
    ss.getGrid().setActive({ row: 0, col: 0 });
    ss.addConditionalFormat(
      { kind: 'cellValue', op: '>', value: 100, style: { backgroundToken: '--jects-destructive' } },
      { top: 0, left: 0, bottom: 0, right: 0 },
    );
    expect(ss.getConditionalFormats().length).toBe(1);
    const cell = host.querySelector('.jects-sheet__cell[data-row="0"][data-col="0"]') as HTMLElement;
    expect(cell.style.backgroundColor).toContain('--jects-destructive');
    ss.clearConditionalFormats();
    expect(ss.getConditionalFormats().length).toBe(0);
  });

  it('applies an expression rule evaluated through the engine', () => {
    ss.getApi().setValue(ref(0, 0), 8);
    ss.addConditionalFormat(
      { kind: 'expression', formula: '=A1>5', style: { bold: true } },
      { top: 0, left: 0, bottom: 0, right: 0 },
    );
    ss.getGrid().update({});
    const cell = host.querySelector('.jects-sheet__cell[data-row="0"][data-col="0"]') as HTMLElement;
    expect(cell.classList.contains('jects-sheet__cell--bold')).toBe(true);
  });

  it('renders a dataBar element for a dataBar rule', () => {
    ss.getApi().setValue(ref(0, 0), 0);
    ss.getApi().setValue(ref(1, 0), 10);
    ss.addConditionalFormat({ kind: 'dataBar', colorToken: '--jects-primary' }, {
      top: 0,
      left: 0,
      bottom: 1,
      right: 0,
    });
    ss.getGrid().update({});
    const bars = host.querySelectorAll('.jects-sheet__cell-databar');
    expect(bars.length).toBeGreaterThan(0);
  });
});

describe('Gap 4 — named ranges', () => {
  it('defines a name, uses it in a formula, and recalcs', () => {
    ss.getApi().setValue(ref(0, 0), 2);
    ss.getApi().setValue(ref(1, 0), 3);
    ss.getApi().setValue(ref(2, 0), 4);
    const sheetName = ss.getApi().getActiveSheet().name;
    ss.defineName('Nums', `${sheetName}!A1:A3`);
    ss.getApi().setCellInput(ref(0, 2), '=SUM(Nums)'); // C1
    expect(ss.getApi().getValue(ref(0, 2))).toBe(9);
    expect(ss.listNames()['Nums']).toBe(`${sheetName}!A1:A3`);

    // Editing a member recalculates through the name.
    ss.getApi().setCellInput(ref(0, 0), '10');
    expect(ss.getApi().getValue(ref(0, 2))).toBe(17);

    ss.deleteName('Nums');
    expect(ss.listNames()['Nums']).toBeUndefined();
  });
});

describe('Gap 6 — comments / notes', () => {
  it('sets, reads, serializes and round-trips a comment', () => {
    ss.setComment({ row: 0, col: 0 }, 'Review this');
    expect(ss.getComment({ row: 0, col: 0 })).toBe('Review this');
    const cell = host.querySelector('.jects-sheet__cell[data-row="0"][data-col="0"]') as HTMLElement;
    expect(cell.classList.contains('jects-sheet__cell--comment')).toBe(true);
    expect(cell.querySelector('.jects-sheet__cell-comment')).toBeTruthy();

    // Serializes with the workbook (round-trips through JSON).
    const json = ss.exportTo('json');
    expect(json).toContain('Review this');

    // Undo removes it.
    ss.undo();
    expect(ss.getComment({ row: 0, col: 0 })).toBeUndefined();
  });
});

describe('Gap 8 — drag fill-handle', () => {
  it('fills a linear numeric series down via fillTo', () => {
    ss.getApi().setValue(ref(0, 0), 1);
    ss.getApi().setValue(ref(1, 0), 2);
    // Source A1:A2, drag to A5 → extend the 1,2 series.
    ss.fillTo({ top: 0, left: 0, bottom: 1, right: 0 }, { row: 4, col: 0 });
    expect(ss.getApi().getValue(ref(2, 0))).toBe(3);
    expect(ss.getApi().getValue(ref(3, 0))).toBe(4);
    expect(ss.getApi().getValue(ref(4, 0))).toBe(5);
  });

  it('copies a non-numeric source rightward', () => {
    ss.getApi().setValue(ref(0, 0), 'X');
    ss.fillTo({ top: 0, left: 0, bottom: 0, right: 0 }, { row: 0, col: 2 });
    expect(ss.getApi().getValue(ref(0, 1))).toBe('X');
    expect(ss.getApi().getValue(ref(0, 2))).toBe('X');
  });
});

describe('Gap 9 — cell protection', () => {
  it('vetoes editing a locked cell on a protected sheet', () => {
    ss.getApi().setValue(ref(0, 0), 'orig');
    const spy = vi.fn();
    ss.on('editRejected', spy);
    ss.setSheetProtected(true);
    expect(ss.isSheetProtected()).toBe(true);
    // startEdit itself refuses to open an editor on a locked, protected cell.
    ss.getGrid().setActive({ row: 0, col: 0 });
    ss.getGrid().startEdit();
    expect(ss.getGrid().isEditing()).toBe(false);
    expect(host.querySelector('.jects-sheet__editor')).toBeNull();
    expect(ss.getApi().getValue(ref(0, 0))).toBe('orig');
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ reason: 'protected' }));
  });

  it('allows editing an explicitly unlocked cell on a protected sheet', () => {
    ss.setCellsLocked(false, { top: 0, left: 0, bottom: 0, right: 0 });
    ss.setSheetProtected(true);
    typeInto({ row: 0, col: 0 }, 'ok');
    expect(ss.getApi().getValue(ref(0, 0))).toBe('ok');
  });
});
