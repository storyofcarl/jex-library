import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GridEngine } from './engine.js';
import { DomRenderer } from './dom-renderer.js';
import { DefaultSelectionModel } from './selection.js';
import type { ColumnDef, GridApi } from '../contract.js';

interface Row {
  id: number;
  name: string;
}

const cols: ColumnDef<Row>[] = [{ field: 'name', width: 100 }];

function rows(n: number): Row[] {
  return Array.from({ length: n }, (_, i) => ({ id: i, name: `r${i}` }));
}

/** Minimal GridApi stub sufficient for the renderer's reads. */
function stubApi(engine: GridEngine<Row>): GridApi<Row> {
  const selection = new DefaultSelectionModel<Row>('multi', {
    getRowById: (id) => engine.getRowById(id),
    onChange: () => {},
  });
  return {
    selection,
    columns: engine.columns.map((c) => c.def),
  } as unknown as GridApi<Row>;
}

let host: HTMLElement;
beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => host.remove());

describe('DomRenderer: recycling', () => {
  it('mounts header + body chrome', () => {
    const engine = new GridEngine<Row>({ data: rows(100), columns: cols, rowHeight: 20 });
    engine.setViewportSize(200, 100);
    const r = new DomRenderer<Row>(engine);
    r.mount(host, stubApi(engine));
    expect(host.querySelector('.jects-grid__header')).toBeTruthy();
    expect(host.querySelector('.jects-grid__body')).toBeTruthy();
    expect(host.querySelector('.jects-grid__spacer')).toBeTruthy();
    r.destroy();
  });

  it('keeps the DOM row pool bounded for a 50k dataset', () => {
    const engine = new GridEngine<Row>({ data: rows(50_000), columns: cols, rowHeight: 20 });
    engine.setViewportSize(200, 200);
    const r = new DomRenderer<Row>(engine);
    r.mount(host, stubApi(engine));

    engine.setScroll(0, 0);
    r.renderViewport(engine.computeViewportWindow());
    const initialPool = r.poolSize;
    expect(initialPool).toBeLessThan(40);

    // Scroll far down — the pool must not grow unboundedly (rows are recycled).
    engine.setScroll(500_000, 0);
    r.renderViewport(engine.computeViewportWindow());
    expect(r.poolSize).toBeLessThan(60);
    expect(r.poolSize).toBeLessThan(initialPool + 40);

    // Total DOM row nodes stays tiny vs 50k.
    expect(host.querySelectorAll('.jects-grid__row').length).toBeLessThan(60);
    r.destroy();
  });

  it('positions rows with translateY at their offset', () => {
    const engine = new GridEngine<Row>({ data: rows(1000), columns: cols, rowHeight: 25 });
    engine.setViewportSize(200, 100);
    const r = new DomRenderer<Row>(engine);
    r.mount(host, stubApi(engine));
    engine.setScroll(0, 0);
    r.renderViewport(engine.computeViewportWindow());
    const rowEl = host.querySelector('.jects-grid__row[data-row-index="0"]') as HTMLElement;
    expect(rowEl.style.transform).toBe('translateY(0px)');
    const rowEl2 = host.querySelector('.jects-grid__row[data-row-index="2"]') as HTMLElement;
    expect(rowEl2.style.transform).toBe('translateY(50px)');
    r.destroy();
  });

  it('spacer height drives the scrollbar to totalSize', () => {
    const engine = new GridEngine<Row>({ data: rows(1000), columns: cols, rowHeight: 30 });
    engine.setViewportSize(200, 100);
    const r = new DomRenderer<Row>(engine);
    r.mount(host, stubApi(engine));
    r.renderViewport(engine.computeViewportWindow());
    const spacer = host.querySelector('.jects-grid__spacer') as HTMLElement;
    expect(spacer.style.height).toBe(`${1000 * 30}px`);
    r.destroy();
  });

  it('renders cell text from the row field', () => {
    const engine = new GridEngine<Row>({ data: rows(10), columns: cols, rowHeight: 20 });
    engine.setViewportSize(200, 100);
    const r = new DomRenderer<Row>(engine);
    r.mount(host, stubApi(engine));
    r.renderViewport(engine.computeViewportWindow());
    const cell = host.querySelector(
      '.jects-grid__row[data-row-index="0"] .jects-grid__cell',
    ) as HTMLElement;
    expect(cell.textContent).toBe('r0');
    r.destroy();
  });

  it('positions right-frozen columns from the right edge in display order', () => {
    interface FRow {
      id: number;
      a: string;
      b: string;
      c: string;
    }
    const fcols: ColumnDef<FRow>[] = [
      { id: 'a', field: 'a', width: 100 },
      { id: 'b', field: 'b', width: 80, frozen: 'right' },
      { id: 'c', field: 'c', width: 60, frozen: 'right' },
    ];
    const data: FRow[] = [{ id: 0, a: 'a0', b: 'b0', c: 'c0' }];
    const engine = new GridEngine<FRow>({ data, columns: fcols, rowHeight: 20 });
    engine.setViewportSize(400, 100);
    const sel = new DefaultSelectionModel<FRow>('multi', {
      getRowById: (id) => engine.getRowById(id),
      onChange: () => {},
    });
    const api = {
      selection: sel,
      columns: engine.columns.map((c) => c.def),
    } as unknown as GridApi<FRow>;
    const r = new DomRenderer<FRow>(engine);
    r.mount(host, api);
    r.renderViewport(engine.computeViewportWindow());

    // rightWidth = 80 + 60 = 140.
    // First right col 'b' (band-left 0)  → right inset 140 - 0 - 80 = 60.
    // Second right col 'c' (band-left 80) → right inset 140 - 80 - 60 = 0.
    const hb = host.querySelector<HTMLElement>('.jects-grid__header-cell[data-col-id="b"]')!;
    const hc = host.querySelector<HTMLElement>('.jects-grid__header-cell[data-col-id="c"]')!;
    expect(hb.style.right).toBe('60px');
    expect(hc.style.right).toBe('0px');
    expect(hb.style.left).toBe('auto');

    const cb = host.querySelector<HTMLElement>(
      '.jects-grid__row[data-row-index="0"] .jects-grid__cell[data-col-id="b"]',
    )!;
    expect(cb.style.right).toBe('60px');
    r.destroy();
  });
});

describe('DomRenderer: typed columns render by type (no explicit renderer)', () => {
  interface TRow {
    id: number;
    qty: number;
    when: string;
    stars: number;
  }

  const tdata: TRow[] = [{ id: 0, qty: 1234.5, when: '2020-06-15T00:00:00Z', stars: 3 }];

  function stubTApi(engine: GridEngine<TRow>): GridApi<TRow> {
    const selection = new DefaultSelectionModel<TRow>('multi', {
      getRowById: (id) => engine.getRowById(id),
      onChange: () => {},
    });
    return {
      selection,
      columns: engine.columns.map((c) => c.def),
    } as unknown as GridApi<TRow>;
  }

  function paint(columns: ColumnDef<TRow>[]): HTMLElement[] {
    const engine = new GridEngine<TRow>({ data: tdata, columns, rowHeight: 20 });
    engine.setViewportSize(600, 100);
    const r = new DomRenderer<TRow>(engine);
    r.mount(host, stubTApi(engine));
    r.renderViewport(engine.computeViewportWindow());
    return [
      ...host.querySelectorAll<HTMLElement>('.jects-grid__row[data-row-index="0"] .jects-grid__cell'),
    ];
  }

  it('number column formats via the registered numberRenderer (grouping)', () => {
    const cells = paint([{ field: 'qty', type: 'number', width: 100 }]);
    // Grouped, not raw String(1234.5).
    expect(cells[0]!.textContent).toContain(',');
    expect(cells[0]!.classList.contains('jects-grid-cell--number')).toBe(true);
  });

  it('date column formats via the registered dateRenderer', () => {
    const cells = paint([{ field: 'when', type: 'date', width: 120 }]);
    // A formatted date is not the raw ISO string.
    expect(cells[0]!.textContent).not.toBe('2020-06-15T00:00:00Z');
    expect(cells[0]!.textContent).toMatch(/2020/);
  });

  it('rating column renders the star radiogroup via the registered ratingRenderer', () => {
    const cells = paint([{ field: 'stars', type: 'rating', width: 120 }]);
    expect(cells[0]!.querySelector('.jects-grid-rating')).toBeTruthy();
    expect(cells[0]!.querySelectorAll('.jects-grid-rating__star').length).toBe(5);
  });

  it('action column renders its buttons via the registered actionRenderer', () => {
    const cells = paint([
      { id: 'act', type: 'action', width: 80, meta: { actions: [{ key: 'go', label: 'Go' }] } },
    ]);
    const btn = cells[0]!.querySelector('button');
    expect(btn).toBeTruthy();
    expect(btn!.dataset['action']).toBe('go');
  });

  it('an explicit column.renderer still overrides the typed renderer', () => {
    const cells = paint([
      { field: 'qty', type: 'number', width: 100, renderer: () => 'CUSTOM' },
    ]);
    expect(cells[0]!.textContent).toBe('CUSTOM');
  });
});
