/**
 * jsdom unit tests for the three table interactions added to the spreadsheet's
 * custom CellGrid: column resize, row resize, and row multi-select. Each covers
 * the programmatic API, the DOM affordance + pointer/keyboard drag, event
 * emission, model persistence, and interplay with formulas / merges / freeze.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CellGrid } from './cell-grid.js';
import { Spreadsheet } from './spreadsheet.js';
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
  if (!grid.isDestroyed) grid.destroy();
  host.remove();
});

/**
 * Build a pointer-like event. jsdom lacks the `PointerEvent` constructor, so we
 * synthesize a `MouseEvent` (which carries clientX/clientY) of the right type
 * and graft `pointerId` on — exactly the fields the resize drag handler reads.
 */
function pointerEvent(type: string, x: number, y: number): Event {
  const ev = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y });
  Object.defineProperty(ev, 'pointerId', { value: 1, configurable: true });
  return ev;
}

/** Dispatch a pointer event sequence (down → move → up) on `target`. */
function pointerDrag(
  target: Element,
  axis: 'x' | 'y',
  from: number,
  to: number,
): void {
  const xy = (v: number): [number, number] => (axis === 'x' ? [v, 0] : [0, v]);
  target.dispatchEvent(pointerEvent('pointerdown', ...xy(from)));
  window.dispatchEvent(pointerEvent('pointermove', ...xy(to)));
  window.dispatchEvent(pointerEvent('pointerup', ...xy(to)));
}

describe('CellGrid — column resize', () => {
  it('renders a resizer handle on each column header', () => {
    const handles = host.querySelectorAll('.jects-sheet__col-resizer');
    expect(handles.length).toBe(5);
    expect(handles[0]?.getAttribute('role')).toBe('separator');
  });

  it('resizes a column programmatically, persisting + emitting', () => {
    let payload: { col: number; width: number; oldWidth: number } | null = null;
    grid.on('columnResize', (p) => (payload = p));
    const w = grid.resizeColumn(2, 180);
    expect(w).toBe(180);
    expect(api.getActiveSheet().cols?.[2]?.size).toBe(180);
    expect(payload).not.toBeNull();
    expect(payload!.col).toBe(2);
    expect(payload!.width).toBe(180);
    // Header reflects the new width.
    const th = host.querySelector('.jects-sheet__colhead[data-col="2"]') as HTMLElement;
    expect(th.style.width).toBe('180px');
  });

  it('resizes a column via a pointer drag on its handle', () => {
    let payload: { col: number; width: number } | null = null;
    grid.on('columnResize', (p) => (payload = p));
    const handle = host.querySelector(
      '.jects-sheet__col-resizer[data-col-resizer="1"]',
    ) as HTMLElement;
    // Default width 96; drag +60px to the right.
    pointerDrag(handle, 'x', 100, 160);
    expect(payload).not.toBeNull();
    expect(payload!.col).toBe(1);
    expect(payload!.width).toBe(96 + 60);
    expect(api.getActiveSheet().cols?.[1]?.size).toBe(156);
  });

  it('clamps column width to the minimum on an over-drag inward', () => {
    const handle = host.querySelector(
      '.jects-sheet__col-resizer[data-col-resizer="0"]',
    ) as HTMLElement;
    pointerDrag(handle, 'x', 100, -500);
    expect(api.getActiveSheet().cols?.[0]?.size).toBe(24); // MIN_COL_WIDTH
  });

  it('nudges column width with ArrowRight/ArrowLeft (keyboard)', () => {
    const handle = host.querySelector(
      '.jects-sheet__col-resizer[data-col-resizer="0"]',
    ) as HTMLElement;
    handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(api.getActiveSheet().cols?.[0]?.size).toBe(96 + 8);
    const handle2 = host.querySelector(
      '.jects-sheet__col-resizer[data-col-resizer="0"]',
    ) as HTMLElement;
    handle2.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowLeft', shiftKey: true, bubbles: true }),
    );
    expect(api.getActiveSheet().cols?.[0]?.size).toBe(104 - 32);
  });
});

describe('CellGrid — row resize', () => {
  it('renders a resizer handle on each row header', () => {
    const handles = host.querySelectorAll('.jects-sheet__row-resizer');
    expect(handles.length).toBe(8);
    expect(handles[0]?.getAttribute('aria-orientation')).toBe('horizontal');
  });

  it('resizes a row programmatically, persisting + emitting', () => {
    let payload: { row: number; height: number; oldHeight: number } | null = null;
    grid.on('rowResize', (p) => (payload = p));
    const h = grid.resizeRow(3, 60);
    expect(h).toBe(60);
    expect(api.getActiveSheet().rows?.[3]?.size).toBe(60);
    expect(payload!.row).toBe(3);
    expect(payload!.height).toBe(60);
    const rowEl = host.querySelectorAll('.jects-sheet__row')[3] as HTMLElement;
    expect(rowEl.style.height).toBe('60px');
  });

  it('resizes a row via a pointer drag on its handle', () => {
    let payload: { row: number; height: number } | null = null;
    grid.on('rowResize', (p) => (payload = p));
    const handle = host.querySelector(
      '.jects-sheet__row-resizer[data-row-resizer="2"]',
    ) as HTMLElement;
    // Default height 24; drag +40px down.
    pointerDrag(handle, 'y', 50, 90);
    expect(payload!.row).toBe(2);
    expect(payload!.height).toBe(24 + 40);
    expect(api.getActiveSheet().rows?.[2]?.size).toBe(64);
  });

  it('nudges row height with ArrowUp/ArrowDown (keyboard)', () => {
    const handle = host.querySelector(
      '.jects-sheet__row-resizer[data-row-resizer="0"]',
    ) as HTMLElement;
    handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(api.getActiveSheet().rows?.[0]?.size).toBe(24 + 4);
  });
});

describe('CellGrid — row multi-select', () => {
  it('renders a checkbox per row + a select-all in the corner', () => {
    expect(host.querySelectorAll('.jects-sheet__rowselect').length).toBe(8);
    expect(host.querySelector('.jects-sheet__selectall')).toBeTruthy();
  });

  it('selects a single row on a plain checkbox click', () => {
    let payload: { rows: number[] } | null = null;
    grid.on('rowSelectionChange', (p) => (payload = p));
    const cb = host.querySelector('[data-row-select="2"]') as HTMLInputElement;
    cb.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(grid.getSelectedRows()).toEqual([2]);
    expect(payload!.rows).toEqual([2]);
  });

  it('selects a contiguous range with shift-click (3 rows)', () => {
    (host.querySelector('[data-row-select="1"]') as HTMLInputElement).dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    );
    (host.querySelector('[data-row-select="3"]') as HTMLInputElement).dispatchEvent(
      new MouseEvent('click', { bubbles: true, shiftKey: true }),
    );
    expect(grid.getSelectedRows()).toEqual([1, 2, 3]);
  });

  it('toggles individual rows with ctrl-click', () => {
    (host.querySelector('[data-row-select="0"]') as HTMLInputElement).dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    );
    (host.querySelector('[data-row-select="4"]') as HTMLInputElement).dispatchEvent(
      new MouseEvent('click', { bubbles: true, ctrlKey: true }),
    );
    expect(grid.getSelectedRows()).toEqual([0, 4]);
    // Ctrl-click an already-selected row removes it.
    (host.querySelector('[data-row-select="0"]') as HTMLInputElement).dispatchEvent(
      new MouseEvent('click', { bubbles: true, ctrlKey: true }),
    );
    expect(grid.getSelectedRows()).toEqual([4]);
  });

  it('selects all rows via the corner select-all', () => {
    const all = host.querySelector('.jects-sheet__selectall') as HTMLInputElement;
    all.checked = true;
    all.dispatchEvent(new Event('change', { bubbles: true }));
    expect(grid.getSelectedRows()).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(grid.isAllRowsSelected()).toBe(true);
  });

  it('marks selected row headers with the selected modifier class', () => {
    grid.setSelectedRows([2, 5]);
    const rh = (r: number) =>
      host.querySelector(`.jects-sheet__rowhead[data-row="${r}"]`) as HTMLElement;
    expect(rh(2).classList.contains('jects-sheet__rowhead--selected')).toBe(true);
    expect(rh(5).classList.contains('jects-sheet__rowhead--selected')).toBe(true);
    expect(rh(0).classList.contains('jects-sheet__rowhead--selected')).toBe(false);
  });
});

describe('CellGrid — interactions preserve existing behavior', () => {
  it('keeps formula display values after a column resize', () => {
    api.setCellInput({ sheet: api.getActiveSheet().id, row: 0, col: 0 }, '=2+3');
    grid.update({});
    grid.resizeColumn(0, 140);
    expect(host.querySelector('[data-row="0"][data-col="0"]')?.textContent).toBe('5');
  });

  it('keeps merged cells working after a row resize', () => {
    const sheetId = api.getActiveSheet().id;
    api.mergeCells({ sheet: sheetId, row: 0, col: 0, rowSpan: 2, colSpan: 2 });
    grid.update({});
    grid.resizeRow(0, 40);
    const merged = host.querySelector('.jects-sheet__cell--merged');
    expect(merged).toBeTruthy();
  });

  it('still moves the active cell with arrow keys (selection model intact)', () => {
    grid.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(grid.getActive()).toEqual({ row: 1, col: 0 });
  });
});

describe('Spreadsheet — resize/select wired to the top-level widget', () => {
  let ssHost: HTMLElement;
  let ss: Spreadsheet;
  beforeEach(() => {
    ssHost = document.createElement('div');
    document.body.appendChild(ssHost);
    ss = new Spreadsheet(ssHost, { maxRows: 6, maxCols: 4 });
  });
  afterEach(() => {
    if (!ss.isDestroyed) ss.destroy();
    ssHost.remove();
  });

  it('re-emits columnResize / rowResize from the grid', () => {
    let col: { col: number; width: number } | null = null;
    let row: { row: number; height: number } | null = null;
    ss.on('columnResize', (e) => (col = e));
    ss.on('rowResize', (e) => (row = e));
    ss.resizeColumn(1, 150);
    ss.resizeRow(2, 50);
    expect(col!.col).toBe(1);
    expect(col!.width).toBe(150);
    expect(row!.row).toBe(2);
    expect(row!.height).toBe(50);
  });

  it('exposes row multi-selection through the widget', () => {
    let payload: { rows: number[] } | null = null;
    ss.on('rowSelectionChange', (e) => (payload = e));
    ss.setSelectedRows([0, 2, 4]);
    expect(ss.getSelectedRows()).toEqual([0, 2, 4]);
    expect(payload!.rows).toEqual([0, 2, 4]);
    ss.selectAllRows(true);
    expect(ss.getSelectedRows()).toEqual([0, 1, 2, 3, 4, 5]);
  });
});
