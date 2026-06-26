/**
 * jsdom unit tests — merged-cell (col/row span) rendering via SpanDomRenderer.
 *
 * Asserts the span post-pass on the real recycled DOM: origin cells are enlarged
 * across colSpan widths / rowSpan heights with aria-colspan/rowspan, covered
 * cells are hidden, and cross-window clipping (origin scrolled out of view) still
 * hides the covered cells it owns. jsdom reports no layout, but the renderer sets
 * explicit inline geometry + data/aria attributes, so these are deterministic.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GridEngine } from './engine.js';
import { SpanDomRenderer, createSpanRenderer } from './span-renderer.js';
import { DefaultSelectionModel } from './selection.js';
import { computeWindowSpanMap, engineSpanHost, hasSpanProviders } from './span-host.js';
import type { ColumnDef, GridApi } from '../contract.js';
import type { Model } from '@jects/core';
import type { SpanProvider } from '../columns/spans.js';

interface Row extends Model {
  id: number;
  a: string;
  b: string;
  c: string;
}

function data(n: number): Row[] {
  return Array.from({ length: n }, (_, i) => ({
    id: i,
    a: `a${i}`,
    b: `b${i}`,
    c: `c${i}`,
  }));
}

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

/** colSpan=2 on the first column at row 0 only. */
const colSpan2AtRow0: SpanProvider<Row> = (ctx) =>
  ctx.rowIndex === 0 ? { colSpan: 2, rowSpan: 1 } : 1;
/** rowSpan=2 on the first column at row 0 only. */
const rowSpan2AtRow0: SpanProvider<Row> = (ctx) =>
  ctx.rowIndex === 0 ? { colSpan: 1, rowSpan: 2 } : 1;

let host: HTMLElement;
beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => host.remove());

function mount(columns: ColumnDef<Row>[], rows = data(5), rowHeight = 20) {
  const engine = new GridEngine<Row>({ data: rows, columns, rowHeight });
  engine.setViewportSize(400, 200);
  const r = createSpanRenderer(engine);
  r.mount(host, stubApi(engine));
  return { engine, r };
}

function cell(rowIndex: number, colIndex: number): HTMLElement | null {
  return host.querySelector<HTMLElement>(
    `.jects-grid__row[data-row-index="${rowIndex}"] .jects-grid__cell[data-col-index="${colIndex}"]`,
  );
}

describe('span-host', () => {
  it('engineSpanHost reads counts, rows, columns and values', () => {
    const columns: ColumnDef<Row>[] = [{ field: 'a' }, { field: 'b' }];
    const engine = new GridEngine<Row>({ data: data(3), columns, rowHeight: 20 });
    const h = engineSpanHost(engine);
    expect(h.rowCount()).toBe(3);
    expect(h.colCount()).toBe(2);
    expect(h.rowAt(1)).toMatchObject({ id: 1 });
    expect(h.columnAt(0)?.field).toBe('a');
    expect(h.valueAt({ rowIndex: 2, colIndex: 1 })).toBe('b2');
  });

  it('hasSpanProviders detects column.meta.span', () => {
    const plain = new GridEngine<Row>({ data: data(2), columns: [{ field: 'a' }], rowHeight: 20 });
    expect(hasSpanProviders(plain)).toBe(false);
    const spanned = new GridEngine<Row>({
      data: data(2),
      columns: [{ field: 'a', meta: { span: colSpan2AtRow0 } }, { field: 'b' }],
      rowHeight: 20,
    });
    expect(hasSpanProviders(spanned)).toBe(true);
  });

  it('computeWindowSpanMap translates the inclusive window to a span region', () => {
    const engine = new GridEngine<Row>({
      data: data(5),
      columns: [{ field: 'a', meta: { span: colSpan2AtRow0 } }, { field: 'b' }, { field: 'c' }],
      rowHeight: 20,
    });
    engine.setViewportSize(400, 200);
    const map = computeWindowSpanMap(engine, engine.computeViewportWindow());
    expect(map.hasSpans).toBe(true);
    expect(map.origins.get('0:0')).toMatchObject({ colSpan: 2 });
    expect(map.covered.has('0:1')).toBe(true);
  });
});

describe('SpanDomRenderer: colSpan', () => {
  it('enlarges the origin across the summed column widths and hides covered cells', () => {
    const columns: ColumnDef<Row>[] = [
      { id: 'a', field: 'a', width: 100, meta: { span: colSpan2AtRow0 } },
      { id: 'b', field: 'b', width: 80 },
      { id: 'c', field: 'c', width: 60 },
    ];
    const { r } = mount(columns);
    r.renderViewport(r['spanEngine'].computeViewportWindow());

    const origin = cell(0, 0)!;
    expect(origin.classList.contains('jects-grid__cell--span-origin')).toBe(true);
    expect(origin.getAttribute('aria-colspan')).toBe('2');
    // width = 100 + 80 = 180.
    expect(origin.style.width).toBe('180px');

    const covered = cell(0, 1)!;
    expect(covered.style.display).toBe('none');
    expect(covered.getAttribute('aria-hidden')).toBe('true');
    expect(covered.classList.contains('jects-grid__cell--span-covered')).toBe(true);

    // Non-origin cells on other rows are untouched.
    expect(cell(1, 0)!.classList.contains('jects-grid__cell--span-origin')).toBe(false);
    expect(cell(1, 1)!.style.display).not.toBe('none');
    r.destroy();
  });
});

describe('SpanDomRenderer: rowSpan', () => {
  it('enlarges the origin across summed row heights and hides the row below', () => {
    const columns: ColumnDef<Row>[] = [
      { id: 'a', field: 'a', width: 100, meta: { span: rowSpan2AtRow0 } },
      { id: 'b', field: 'b', width: 80 },
    ];
    const { r } = mount(columns, data(5), 20);
    r.renderViewport(r['spanEngine'].computeViewportWindow());

    const origin = cell(0, 0)!;
    expect(origin.getAttribute('aria-rowspan')).toBe('2');
    // height = 20 + 20 = 40.
    expect(origin.style.height).toBe('40px');

    const covered = cell(1, 0)!;
    expect(covered.style.display).toBe('none');
    expect(covered.classList.contains('jects-grid__cell--span-covered')).toBe(true);

    // Row 2, col 0 is NOT covered (rowSpan only reaches row 1).
    expect(cell(2, 0)!.style.display).not.toBe('none');
    r.destroy();
  });
});

describe('SpanDomRenderer: no spans / clearing', () => {
  it('does nothing when no column declares a span provider', () => {
    const columns: ColumnDef<Row>[] = [
      { id: 'a', field: 'a', width: 100 },
      { id: 'b', field: 'b', width: 80 },
    ];
    const { r } = mount(columns);
    r.renderViewport(r['spanEngine'].computeViewportWindow());
    expect(host.querySelector('.jects-grid__cell--span-origin')).toBeNull();
    expect(host.querySelector('.jects-grid__cell--span-covered')).toBeNull();
    r.destroy();
  });

  it('restores a cell that stops being an origin/covered on re-render', () => {
    let spanOn = true;
    const dynamic: SpanProvider<Row> = (ctx) =>
      spanOn && ctx.rowIndex === 0 ? { colSpan: 2, rowSpan: 1 } : 1;
    const columns: ColumnDef<Row>[] = [
      { id: 'a', field: 'a', width: 100, meta: { span: dynamic } },
      { id: 'b', field: 'b', width: 80 },
    ];
    const { engine, r } = mount(columns);
    r.renderViewport(engine.computeViewportWindow());
    expect(cell(0, 1)!.style.display).toBe('none');

    // Turn spans off and repaint → covered cell must be restored.
    spanOn = false;
    r.renderViewport(engine.computeViewportWindow());
    const restored = cell(0, 1)!;
    expect(restored.style.display).not.toBe('none');
    expect(restored.classList.contains('jects-grid__cell--span-covered')).toBe(false);
    expect(restored.style.width).toBe('80px');
    r.destroy();
  });
});

describe('SpanDomRenderer: cross-window clipping', () => {
  it('hides cells covered by a rowSpan origin scrolled above the window', () => {
    // A tall rowSpan at row 0 reaching down 4 rows; scroll so row 0 is out of the
    // painted window but the cells it covers remain visible.
    const tall: SpanProvider<Row> = (ctx) =>
      ctx.rowIndex === 0 ? { colSpan: 1, rowSpan: 4 } : 1;
    const columns: ColumnDef<Row>[] = [
      { id: 'a', field: 'a', width: 100, meta: { span: tall } },
      { id: 'b', field: 'b', width: 80 },
    ];
    // Many rows, small viewport, no overscan so row 0 truly leaves the window.
    const engine = new GridEngine<Row>({
      data: data(50),
      columns,
      rowHeight: 20,
      virtualization: { overscan: 0 },
    });
    engine.setViewportSize(400, 40); // ~2 rows tall
    const r = createSpanRenderer(engine);
    r.mount(host, stubApi(engine));

    engine.setScroll(40, 0); // scroll past rows 0,1 → window starts ~row 2
    r.renderViewport(engine.computeViewportWindow());

    const window = engine.computeViewportWindow();
    // Row 0 (the origin) is above the window and not painted…
    expect(cell(0, 0)).toBeNull();
    // …but a covered cell still inside the window (e.g. row 2 or 3, col 0) is hidden.
    for (let rr = window.startIndex; rr <= Math.min(3, window.endIndex); rr++) {
      const c = cell(rr, 0);
      if (c) expect(c.style.display).toBe('none');
    }
    r.destroy();
  });
});

describe('SpanDomRenderer: subclass identity', () => {
  it('is a DomRenderer and keeps the bounded pool', () => {
    const columns: ColumnDef<Row>[] = [{ id: 'a', field: 'a', width: 100, meta: { span: colSpan2AtRow0 } }, { id: 'b', field: 'b', width: 80 }];
    const engine = new GridEngine<Row>({ data: data(10_000), columns, rowHeight: 20 });
    engine.setViewportSize(400, 200);
    const r = new SpanDomRenderer<Row>(engine);
    r.mount(host, stubApi(engine));
    r.renderViewport(engine.computeViewportWindow());
    expect(r.poolSize).toBeLessThan(60);
    r.destroy();
  });
});
