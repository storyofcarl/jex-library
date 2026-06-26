/**
 * Usage stories for FillFeature (range fill / fill handle — drag-fill, copy-fill,
 * and series fill).
 *
 * Framework-free imperative examples (the house "stories" format): each function
 * builds a real Grid in `range` selection mode, installs the feature, and returns
 * the instance so a docs shell / playground can mount and tear it down.
 *
 * Try it: select a cell (or a small block), then drag the little square at the
 * selection's bottom-right corner down/across — or focus it and press the arrow
 * keys then Enter. Numbers and dates continue as a series; everything else tiles.
 */
import { Grid } from '../engine/grid.js';
import type { ColumnDef } from '../contract.js';
import { FillFeature, fillFeature } from './fill.js';

interface Sale {
  id: number;
  week: number;
  region: string;
  amount: number;
  due: Date;
  /** Index signature so `Sale` satisfies the core `Model` constraint. */
  [key: string]: unknown;
}

const data: Sale[] = Array.from({ length: 40 }, (_, i) => ({
  id: i + 1,
  week: i < 2 ? i + 1 : 0, // seed weeks 1,2 — drag-fill the rest as a series
  region: i === 0 ? 'EMEA' : '',
  amount: i < 2 ? (i + 1) * 100 : 0,
  due: new Date(2026, 0, 1 + i * 7),
}));

const columns: ColumnDef<Sale>[] = [
  { field: 'week', header: 'Week', type: 'number', width: 90 },
  { field: 'region', header: 'Region', width: 140 },
  { field: 'amount', header: 'Amount', type: 'number', width: 120 },
  { field: 'due', header: 'Due', type: 'date', width: 140 },
];

/**
 * Basic: select `Week 1, Week 2` and drag the fill handle down — the numeric
 * series continues (3, 4, 5, …). Logs each `fill`.
 */
export function basicFill(host: HTMLElement): Grid<Sale> {
  const grid = new Grid<Sale>(host, {
    data,
    columns,
    selection: 'range',
    rowHeight: 30,
  });
  grid.use(new FillFeature<Sale>({ series: 'auto' }));
  grid.on('fill', (e) => {
    console.log(`fill ${e.kind} ${e.direction}: ${e.cells.length} cell(s)`);
  });
  // Pre-select the two seed cells so the handle is visible on mount.
  (grid.selection as unknown as { selectRange(a: unknown, b: unknown): void }).selectRange(
    { rowIndex: 0, colIndex: 0 },
    { rowIndex: 1, colIndex: 0 },
  );
  grid.refresh();
  return grid;
}

/**
 * Copy-only: `series: 'never'` always tiles the source block instead of
 * continuing a progression (good for categorical columns).
 */
export function copyFill(host: HTMLElement): Grid<Sale> {
  const grid = new Grid<Sale>(host, {
    data,
    columns,
    selection: 'range',
    rowHeight: 30,
  });
  grid.use(fillFeature<Sale>({ series: 'never' }));
  (grid.selection as unknown as { selectCell(a: unknown): void }).selectCell({
    rowIndex: 0,
    colIndex: 1,
  });
  grid.refresh();
  return grid;
}

/**
 * Vetoed fill: a `beforeFill` handler can cancel the write (e.g. guard a
 * read-only region). Here fills into rows past index 20 are blocked.
 */
export function vetoableFill(host: HTMLElement): Grid<Sale> {
  const grid = new Grid<Sale>(host, {
    data,
    columns,
    selection: 'range',
    rowHeight: 30,
  });
  grid.use(new FillFeature<Sale>());
  grid.on('beforeFill', (e) => {
    if (e.target.bottom > 20) return false; // veto fills into the locked tail
    return undefined;
  });
  return grid;
}
