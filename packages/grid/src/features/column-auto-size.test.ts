/**
 * jsdom unit tests for ColumnAutoSizeFeature — header double-click auto-fit.
 *
 * Exercises: handle injection/decoration + re-decoration on layout events,
 * double-click + keyboard (Enter/Space) auto-fit, the `columnAutoSize` event
 * payload, delegation to the `columns` feature's `autoSize`, the standalone
 * `updateColumn` fallback, per-column `resizable === false` opt-out, a custom
 * measure hook, programmatic `autoSizeColumn`, and leak-free `destroy()`.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { ColumnDef } from '../contract.js';
import {
  ColumnAutoSizeFeature,
  columnAutoSizeFeature,
  type ColumnAutoSizeEvent,
} from './column-auto-size.js';
import { ColumnFeature } from '../columns/column-feature.js';
import { makeHarness, makeStore, type FeatureHarness } from './test-harness.js';

interface Row {
  id: number;
  name: string;
  city: string;
}

const ROWS: Row[] = [
  { id: 1, name: 'Alice', city: 'Wellington' },
  { id: 2, name: 'Bob', city: 'Auckland' },
  { id: 3, name: 'Caroline', city: 'Christchurch' },
];

const COLUMNS: ColumnDef<Row>[] = [
  { field: 'name', header: 'Name', minWidth: 50, maxWidth: 400 },
  { field: 'city', header: 'City' },
];

let h: FeatureHarness<Row>;
beforeEach(() => {
  h = makeHarness<Row>({ store: makeStore(ROWS), columns: COLUMNS });
});
afterEach(() => h.destroy());

/** Paint a fake header cell into the grid root (mimics the DomRenderer header). */
function paintHeaderCell(el: HTMLElement, colId: string, header: string): HTMLElement {
  const cell = document.createElement('div');
  cell.className = 'jects-grid__header-cell';
  cell.dataset['colId'] = colId;
  cell.dataset['colIndex'] = '0';
  cell.textContent = header;
  el.appendChild(cell);
  return cell;
}

/** Paint the standard two-column header. */
function paintHeader(el: HTMLElement): void {
  paintHeaderCell(el, 'name', 'Name');
  paintHeaderCell(el, 'city', 'City');
}

function fire(target: EventTarget, type: 'dblclick'): void {
  target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
}

function fireKey(target: EventTarget, key: string): void {
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
}

describe('ColumnAutoSizeFeature (jsdom)', () => {
  it('registers under "columnAutoSize" and marks the grid sizable', () => {
    const f = h.api.use(new ColumnAutoSizeFeature<Row>()) as ColumnAutoSizeFeature<Row>;
    expect(f.name).toBe('columnAutoSize');
    expect(h.api.features.get('columnAutoSize')).toBe(f);
    expect(h.el.classList.contains('jects-grid--col-auto-sizable')).toBe(true);
  });

  it('injects an accessible auto-size handle into each header cell', () => {
    h.api.use(new ColumnAutoSizeFeature<Row>());
    paintHeader(h.el);
    // Decoration runs on viewportChange.
    h.api.emit('viewportChange', { window: h.api.viewport.window });

    const handles = h.el.querySelectorAll<HTMLElement>('.jects-grid__col-auto-sizer');
    expect(handles.length).toBe(2);
    handles.forEach((handle) => {
      expect(handle.getAttribute('role')).toBe('separator');
      expect(handle.getAttribute('aria-orientation')).toBe('vertical');
      expect(handle.tabIndex).toBe(0);
      expect(handle.getAttribute('aria-label')).toMatch(/auto-size column/i);
    });
  });

  it('does not double-inject handles when re-decorated', () => {
    h.api.use(new ColumnAutoSizeFeature<Row>());
    paintHeader(h.el);
    h.api.emit('viewportChange', { window: h.api.viewport.window });
    h.api.emit('viewportChange', { window: h.api.viewport.window });
    h.api.emit('columnResize', { columnId: 'name', width: 120 });
    expect(h.el.querySelectorAll('.jects-grid__col-auto-sizer').length).toBe(2);
  });

  it('auto-fits a column on handle double-click and emits columnAutoSize', () => {
    const f = h.api.use(
      new ColumnAutoSizeFeature<Row>({ measure: () => 137 }),
    ) as ColumnAutoSizeFeature<Row>;
    paintHeader(h.el);
    h.api.emit('viewportChange', { window: h.api.viewport.window });

    const events: ColumnAutoSizeEvent<Row>[] = [];
    h.api.on('columnAutoSize', (e) => events.push(e));

    const handle = h.el.querySelector<HTMLElement>(
      '.jects-grid__header-cell[data-col-id="name"] .jects-grid__col-auto-sizer',
    )!;
    fire(handle, 'dblclick');

    expect(events).toHaveLength(1);
    expect(events[0]!.columnId).toBe('name');
    expect(events[0]!.contentWidth).toBe(137);
    // Fallback path (no `columns` feature): content 137 + padding 24, clamped to band.
    expect(events[0]!.width).toBe(137 + 24);
    expect(f.name).toBe('columnAutoSize');
  });

  it('clamps the fitted width to the column min/max band (fallback path)', () => {
    h.api.use(new ColumnAutoSizeFeature<Row>({ measure: () => 1000 }));
    paintHeader(h.el);
    h.api.emit('viewportChange', { window: h.api.viewport.window });

    const events: ColumnAutoSizeEvent<Row>[] = [];
    h.api.on('columnAutoSize', (e) => events.push(e));

    const handle = h.el.querySelector<HTMLElement>(
      '.jects-grid__header-cell[data-col-id="name"] .jects-grid__col-auto-sizer',
    )!;
    fire(handle, 'dblclick');
    // maxWidth on the "name" column is 400.
    expect(events[0]!.width).toBe(400);
    expect(h.api.getColumn('name')!.width).toBe(400);
  });

  it('delegates to the installed columns feature autoSize when present', () => {
    // Install the real ColumnFeature so the auto-size goes through it (honoring
    // its own padding + emitting the contract `columnResize` event).
    h.api.use(new ColumnFeature<Row>({ autoSizePadding: 10 }));
    h.api.use(new ColumnAutoSizeFeature<Row>({ measure: () => 100 }));
    paintHeader(h.el);
    h.api.emit('viewportChange', { window: h.api.viewport.window });

    const resizes: Array<{ columnId: string; width: number }> = [];
    h.api.on('columnResize', (e) => resizes.push(e));

    const handle = h.el.querySelector<HTMLElement>(
      '.jects-grid__header-cell[data-col-id="city"] .jects-grid__col-auto-sizer',
    )!;
    fire(handle, 'dblclick');

    // Column feature owns padding (10): 100 + 10 = 110.
    expect(resizes.at(-1)).toEqual({ columnId: 'city', width: 110 });
  });

  it('auto-fits on Enter and Space (keyboard a11y)', () => {
    h.api.use(new ColumnAutoSizeFeature<Row>({ measure: () => 80 }));
    paintHeader(h.el);
    h.api.emit('viewportChange', { window: h.api.viewport.window });

    const events: ColumnAutoSizeEvent<Row>[] = [];
    h.api.on('columnAutoSize', (e) => events.push(e));

    const handle = h.el.querySelector<HTMLElement>(
      '.jects-grid__header-cell[data-col-id="name"] .jects-grid__col-auto-sizer',
    )!;
    fireKey(handle, 'Enter');
    fireKey(handle, ' ');
    expect(events).toHaveLength(2);
    expect(events[0]!.columnId).toBe('name');
  });

  it('ignores non-resizable columns (no event, hides handle)', () => {
    const cols: ColumnDef<Row>[] = [
      { field: 'name', header: 'Name', resizable: false },
      { field: 'city', header: 'City' },
    ];
    const h2 = makeHarness<Row>({ store: makeStore(ROWS), columns: cols });
    try {
      h2.api.use(new ColumnAutoSizeFeature<Row>({ measure: () => 200 }));
      paintHeaderCell(h2.el, 'name', 'Name');
      h2.api.emit('viewportChange', { window: h2.api.viewport.window });

      const handle = h2.el.querySelector<HTMLElement>(
        '.jects-grid__header-cell[data-col-id="name"] .jects-grid__col-auto-sizer',
      )!;
      expect(handle.hidden).toBe(true);

      const events: ColumnAutoSizeEvent<Row>[] = [];
      h2.api.on('columnAutoSize', (e) => events.push(e));
      fire(handle, 'dblclick');
      expect(events).toHaveLength(0);
    } finally {
      h2.destroy();
    }
  });

  it('exposes a programmatic autoSizeColumn that returns the committed width', () => {
    const f = h.api.use(
      new ColumnAutoSizeFeature<Row>({ measure: () => 60 }),
    ) as ColumnAutoSizeFeature<Row>;
    paintHeader(h.el);
    h.api.emit('viewportChange', { window: h.api.viewport.window });

    const width = f.autoSizeColumn('city');
    expect(width).toBe(60 + 24);
    expect(f.autoSizeColumn('does-not-exist')).toBeUndefined();
  });

  it('measure hook receives the column, fonts and a measure fn', () => {
    let seen: { header: string | undefined; headerFont: string; cellFont: string } | null = null;
    h.api.use(
      new ColumnAutoSizeFeature<Row>({
        measure: ({ column, headerFont, cellFont, measure }) => {
          seen = { header: column.header, headerFont, cellFont };
          // exercise the supplied measure fn (canvas may return 0 in jsdom)
          measure('x', cellFont);
          return 42;
        },
      }),
    );
    paintHeader(h.el);
    h.api.emit('viewportChange', { window: h.api.viewport.window });
    const handle = h.el.querySelector<HTMLElement>(
      '.jects-grid__header-cell[data-col-id="name"] .jects-grid__col-auto-sizer',
    )!;
    fire(handle, 'dblclick');
    expect(seen).not.toBeNull();
    expect(seen!.header).toBe('Name');
    expect(typeof seen!.headerFont).toBe('string');
    expect(typeof seen!.cellFont).toBe('string');
  });

  it('built-in measurer samples header + cell values without throwing', () => {
    // No measure hook → exercises the real measureText path (returns 0 widths in
    // jsdom canvas, but must not throw and must still commit a clamped width).
    h.api.use(new ColumnAutoSizeFeature<Row>());
    paintHeader(h.el);
    h.api.emit('viewportChange', { window: h.api.viewport.window });
    const events: ColumnAutoSizeEvent<Row>[] = [];
    h.api.on('columnAutoSize', (e) => events.push(e));
    const handle = h.el.querySelector<HTMLElement>(
      '.jects-grid__header-cell[data-col-id="city"] .jects-grid__col-auto-sizer',
    )!;
    fire(handle, 'dblclick');
    expect(events).toHaveLength(1);
    // City has no min/max → padding only (24) over a 0 measured width in jsdom.
    expect(events[0]!.width).toBeGreaterThanOrEqual(24);
  });

  it('factory helper builds the feature', () => {
    const f = columnAutoSizeFeature<Row>({ handleSize: 12 });
    expect(f).toBeInstanceOf(ColumnAutoSizeFeature);
    h.api.use(f);
    expect(h.api.features.get('columnAutoSize')).toBe(f);
  });

  it('destroy() removes injected handles, the class flag, and is leak-free', () => {
    const f = h.api.use(new ColumnAutoSizeFeature<Row>()) as ColumnAutoSizeFeature<Row>;
    paintHeader(h.el);
    h.api.emit('viewportChange', { window: h.api.viewport.window });
    expect(h.el.querySelectorAll('.jects-grid__col-auto-sizer').length).toBe(2);

    f.destroy();
    expect(h.el.querySelectorAll('.jects-grid__col-auto-sizer').length).toBe(0);
    expect(h.el.classList.contains('jects-grid--col-auto-sizable')).toBe(false);

    // After destroy, a double-click must no longer auto-size (listeners removed).
    const events: ColumnAutoSizeEvent<Row>[] = [];
    h.api.on('columnAutoSize', (e) => events.push(e));
    // Re-decorate is a no-op (feature gone); fire on a header cell directly.
    const cell = h.el.querySelector<HTMLElement>('.jects-grid__header-cell[data-col-id="name"]')!;
    fire(cell, 'dblclick');
    expect(events).toHaveLength(0);
  });
});
