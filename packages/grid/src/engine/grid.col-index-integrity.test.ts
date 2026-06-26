/**
 * Regression tests for `data-col-index` integrity in the live DOM under the
 * feature stack — defects found by RUNTIME-verifying the demo (unit tests + type
 * defs missed them):
 *
 *   - Bug 2: selection-column + row-expander installed together painted the
 *     trailing data column with a DOM cell order that left `data-col-index` out
 *     of document order (injected feature columns appended after data cells on a
 *     recycled row).
 *   - Bug 3: ResponsiveFeature priority-mode hiding a column left a stale hidden
 *     recycled cell carrying the hidden column's old `data-col-index`, colliding
 *     with the live cell that now owns that index.
 *
 * Both are renderer-recycling defects: a real `Grid` is constructed and the
 * rendered cells are asserted for unique, sequential, in-order `data-col-index`.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import '@jects/widgets';
import { Grid } from './grid.js';
import { selectionColumnFeature } from '../features/selection-column.js';
import { rowExpanderFeature } from '../features/row-expander.js';
import { responsiveFeature, type ResponsiveFeature } from '../features/responsive.js';
import type { ColumnDef } from '../contract.js';

interface Row {
  id: number;
  name: string;
  qty: number;
  city: string;
}

const data = (): Row[] => [
  { id: 1, name: 'Ada', qty: 1234.5, city: 'London' },
  { id: 2, name: 'Linus', qty: 42, city: 'Helsinki' },
];

let host: HTMLElement;
beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => host.remove());

/** Visible (non-hidden) data cells of the first rendered row, in DOM order. */
function visibleCells(h: HTMLElement): HTMLElement[] {
  const row0 = h.querySelector('.jects-grid__row[data-row-index="0"]')!;
  return [...row0.querySelectorAll<HTMLElement>('.jects-grid__cell')].filter((c) => !c.hidden);
}

describe('Bug 2: selection column + row expander together', () => {
  it('paints each data column exactly once with unique, in-order data-col-index', () => {
    const cols: ColumnDef<Row>[] = [
      { field: 'name', width: 100 },
      { field: 'qty', type: 'number', width: 100 },
      { field: 'city', width: 100 },
    ];
    const grid = new Grid<Row>(host, { data: data(), columns: cols, selection: 'multi' });
    grid.use(selectionColumnFeature<Row>());
    grid.use(rowExpanderFeature<Row>({ renderer: () => 'detail' }));
    grid.refresh();

    const cells = visibleCells(host);
    const indices = cells.map((c) => c.dataset['colIndex']);

    // 3 data columns + 2 injected feature columns = 5 cells.
    expect(cells.length).toBe(5);
    // No duplicate data-col-index.
    expect(new Set(indices).size).toBe(indices.length);
    // Sequential 0..4 in document order (DOM order matches column order).
    expect(indices).toEqual(['0', '1', '2', '3', '4']);
    // The two injected feature columns lead, then the three data columns.
    expect(cells.map((c) => c.dataset['colId'])).toEqual([
      '__expander',
      '__select',
      'name',
      'qty',
      'city',
    ]);
    // Each data value rendered exactly once.
    const texts = cells.map((c) => c.textContent);
    expect(texts.filter((t) => t === 'Ada')).toHaveLength(1);
    expect(texts.filter((t) => t === 'London')).toHaveLength(1);

    grid.destroy();
  });
});

describe('Bug 2b: auto expander column + an action-type column', () => {
  it('renders each column once with no phantom trailing cell (id-less action column)', () => {
    const cols: ColumnDef<Row>[] = [
      { field: 'name', width: 100 },
      { field: 'qty', type: 'number', width: 100 },
      // Action column WITHOUT id/field: its positional `col-N` fallback id shifts
      // when the expander column is auto-prepended, which used to orphan a cell.
      { type: 'action', width: 80, meta: { actions: [{ key: 'go', label: 'Go' }] } },
    ];
    const grid = new Grid<Row>(host, { data: data(), columns: cols });
    grid.use(rowExpanderFeature<Row>({ column: true, renderer: () => 'detail' }));
    grid.refresh();

    // 3 author columns + 1 auto expander column.
    expect(grid.getEngine().columns.length).toBe(4);

    const row0 = host.querySelector('.jects-grid__row[data-row-index="0"]')!;
    // No phantom: total cell nodes (visible + hidden) equals the column count.
    const allCellNodes = [...row0.querySelectorAll<HTMLElement>('.jects-grid__cell')];
    expect(allCellNodes.length).toBe(4);

    const cells = visibleCells(host);
    expect(cells.length).toBe(4);
    const indices = cells.map((c) => c.dataset['colIndex']);
    expect(new Set(indices).size).toBe(indices.length);
    expect(indices).toEqual(['0', '1', '2', '3']);
    // No cell carries a stale/undefined data-col-index.
    expect(indices.every((i) => i != null)).toBe(true);
    // Expander column leads; action column trails.
    expect(cells[0]!.dataset['colId']).toBe('__expander');

    // The action buttons render exactly once (in the trailing cell only).
    const actionButtons = [...row0.querySelectorAll('button[data-action="go"]')];
    expect(actionButtons).toHaveLength(1);
    expect(cells[3]!.querySelector('button[data-action="go"]')).toBeTruthy();

    grid.destroy();
  });
});

describe('Bug 3: ResponsiveFeature priority-mode hiding', () => {
  it('keeps data-col-index sequential and unique after a priority hide and re-show', () => {
    const cols: ColumnDef<Row>[] = [
      { field: 'name', width: 200 },
      { field: 'qty', width: 100, responsivePriority: 1 }, // dropped first
      { field: 'city', width: 100, responsivePriority: 2 },
    ];
    const grid = new Grid<Row>(host, { data: data(), columns: cols });
    const f = grid.use(responsiveFeature<Row>()) as ResponsiveFeature<Row>;

    // Narrow: shed the lowest-priority column (qty).
    f.evaluate(350);
    grid.refresh();

    let cells = visibleCells(host);
    let indices = cells.map((c) => c.dataset['colIndex']);
    expect(cells.map((c) => c.dataset['colId'])).toEqual(['name', 'city']);
    // No stale hidden cell collides on data-col-index.
    expect(new Set(indices).size).toBe(indices.length);
    expect(indices).toEqual(['0', '1']);
    // The whole row (including hidden recycled cells) has no duplicate index.
    const allIdx = [
      ...host.querySelectorAll<HTMLElement>(
        '.jects-grid__row[data-row-index="0"] .jects-grid__cell[data-col-index]',
      ),
    ].map((c) => c.dataset['colIndex']);
    expect(new Set(allIdx).size).toBe(allIdx.length);

    // Widen: every column returns, indices stay sequential.
    f.evaluate(800);
    grid.refresh();
    cells = visibleCells(host);
    indices = cells.map((c) => c.dataset['colIndex']);
    expect(cells.map((c) => c.dataset['colId'])).toEqual(['name', 'qty', 'city']);
    expect(indices).toEqual(['0', '1', '2']);

    grid.destroy();
  });
});
