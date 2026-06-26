/** jsdom unit test for the CellGrid surface. */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CellGrid } from './cell-grid.js';
import { createSpreadsheetApi, defaultWorkbook } from './engine.js';
import type { SpreadsheetApi } from '../contract.js';

let host: HTMLElement;
let api: SpreadsheetApi;
let grid: CellGrid;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  api = createSpreadsheetApi(defaultWorkbook());
  grid = new CellGrid(host, { api, maxRows: 8, maxCols: 5 });
});
afterEach(() => {
  grid.destroy();
  host.remove();
});

describe('CellGrid (jsdom)', () => {
  it('renders grid roles and column/row headers', () => {
    expect(host.querySelector('[role="grid"]')).toBeTruthy();
    const colHeads = host.querySelectorAll('.jects-sheet__colhead');
    expect(colHeads.length).toBe(5);
    expect(colHeads[0]?.textContent).toBe('A');
    const rowHeads = host.querySelectorAll('.jects-sheet__rowhead');
    expect(rowHeads.length).toBe(8);
    expect(rowHeads[0]?.textContent).toBe('1');
  });

  it('renders one gridcell per addressable cell', () => {
    expect(host.querySelectorAll('[role="gridcell"]').length).toBe(8 * 5);
  });

  it('reflects engine display values', () => {
    api.setCellInput({ sheet: api.getActiveSheet().id, row: 0, col: 0 }, '=2+2');
    grid.update({});
    const cell = host.querySelector('[data-row="0"][data-col="0"]');
    expect(cell?.textContent).toBe('4');
  });

  it('moves the active cell with arrow keys', () => {
    grid.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    grid.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(grid.getActive()).toEqual({ row: 1, col: 1 });
  });

  it('extends a range with shift+arrow', () => {
    grid.el.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', shiftKey: true, bubbles: true }),
    );
    grid.el.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true }),
    );
    expect(grid.getRange()).toEqual({ top: 0, left: 0, bottom: 1, right: 1 });
    expect(grid.isSingleSelection()).toBe(false);
  });

  it('emits selectionChange when the active cell changes', () => {
    let payload: { active: { row: number; col: number } } | null = null;
    grid.on('selectionChange', (p) => (payload = p));
    grid.setActive({ row: 2, col: 1 });
    expect(payload).not.toBeNull();
    expect(payload!.active).toEqual({ row: 2, col: 1 });
  });

  it('edits a cell and commits, writing through the engine', () => {
    grid.setActive({ row: 0, col: 0 });
    grid.startEdit('hello');
    expect(grid.isEditing()).toBe(true);
    grid.commitEdit();
    expect(api.getValue({ sheet: api.getActiveSheet().id, row: 0, col: 0 })).toBe('hello');
  });

  it('starts editing on a printable keystroke', () => {
    grid.setActive({ row: 0, col: 0 });
    grid.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true }));
    expect(grid.isEditing()).toBe(true);
  });

  it('deletes the selection contents on Delete', () => {
    const ref = { sheet: api.getActiveSheet().id, row: 0, col: 0 };
    api.setCellInput(ref, 'data');
    grid.update({});
    grid.setActive({ row: 0, col: 0 });
    grid.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    expect(api.getValue(ref)).toBe(null);
  });

  it('renders merged cells with a single anchor', () => {
    const sheetId = api.getActiveSheet().id;
    api.mergeCells({ sheet: sheetId, row: 0, col: 0, rowSpan: 1, colSpan: 2 });
    grid.update({});
    // covered cell (0,1) is not rendered
    expect(host.querySelector('[data-row="0"][data-col="1"]')).toBeNull();
    expect(host.querySelector('[data-row="0"][data-col="0"]')?.classList.contains('jects-sheet__cell--merged')).toBe(true);
  });

  it('points aria-activedescendant at the active cell id', () => {
    grid.setActive({ row: 2, col: 1 });
    const root = host.querySelector('[role="grid"]') as HTMLElement;
    const active = host.querySelector('[data-row="2"][data-col="1"]') as HTMLElement;
    expect(active.id).toBeTruthy();
    expect(root.getAttribute('aria-activedescendant')).toBe(active.id);
  });

  it('registers the window mouseup against an AbortSignal so destroy cleans it up', () => {
    const seen: Array<AddEventListenerOptions | boolean | undefined> = [];
    const origAdd = window.addEventListener.bind(window);
    window.addEventListener = ((type: string, fn: unknown, opts?: unknown) => {
      if (type === 'mouseup') seen.push(opts as AddEventListenerOptions);
      return origAdd(type as never, fn as never, opts as never);
    }) as typeof window.addEventListener;
    try {
      // Begin a drag (registers a window 'mouseup') but never release it.
      const cell = host.querySelector('[data-row="0"][data-col="0"]') as HTMLElement;
      cell.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      expect(seen.length).toBe(1);
      // The drag listener must carry an AbortSignal so destroy() removes it even
      // though the user never released the mouse over the window.
      const opts = seen[0] as AddEventListenerOptions;
      expect(opts && typeof opts === 'object' && opts.signal).toBeInstanceOf(AbortSignal);
      const signal = (opts as AddEventListenerOptions).signal as AbortSignal;
      expect(signal.aborted).toBe(false);
      grid.destroy();
      expect(signal.aborted).toBe(true); // AbortController fired on teardown
    } finally {
      window.addEventListener = origAdd as typeof window.addEventListener;
    }
  });

  it('destroy() is idempotent', () => {
    grid.destroy();
    expect(() => grid.destroy()).not.toThrow();
    expect(grid.isDestroyed).toBe(true);
  });
});
