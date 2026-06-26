/**
 * jsdom unit tests — additional typed cell renderers (rating / widget / rownumber)
 * + their registration into `CellRendererRegistry`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  Store,
  register,
  clearRegistry,
  createEl,
  type Model,
  type RecordId,
} from '@jects/core';
import {
  ratingRenderer,
  widgetCellRenderer,
  rownumberRenderer,
  destroyCellWidget,
  coerceRating,
  registerExtraRenderers,
  EXTRA_RENDERERS,
  type RatingMeta,
  type WidgetCellMeta,
} from './extra-renderers.js';
import { CellRendererRegistry } from './renderers.js';
import type { CellRenderContext, ColumnDef, GridApi } from '../contract.js';

interface Row extends Model {
  id: number;
  name: string;
  score: number;
}

function ctx<R extends Model>(
  partial: Partial<CellRenderContext<R>> & { column: ColumnDef<R>; value: unknown },
): CellRenderContext<R> {
  return {
    row: {} as R,
    rowIndex: 0,
    colIndex: 0,
    el: document.createElement('div'),
    api: {} as GridApi<R>,
    ...partial,
  } as CellRenderContext<R>;
}

/** A tiny GridApi stub exposing just `store` (enough for rating write-back). */
function apiWithStore<R extends Model>(rows: R[]): { api: GridApi<R>; store: Store<R> } {
  const store = new Store<R>({ data: rows, idField: 'id' });
  const api = { store } as unknown as GridApi<R>;
  return { api, store };
}

/* ── rating ──────────────────────────────────────────────────────────────── */
describe('coerceRating', () => {
  it('clamps + rounds into [0, max]', () => {
    expect(coerceRating(3, 5)).toBe(3);
    expect(coerceRating(3.6, 5)).toBe(4);
    expect(coerceRating(-2, 5)).toBe(0);
    expect(coerceRating(99, 5)).toBe(5);
    expect(coerceRating('2', 5)).toBe(2);
    expect(coerceRating('x', 5)).toBe(0);
    expect(coerceRating(null, 5)).toBe(0);
  });
});

describe('ratingRenderer', () => {
  it('paints `max` stars with the right number filled + a radiogroup label', () => {
    const c = ctx<Row>({ column: { field: 'score', type: 'rating' }, value: 3 });
    ratingRenderer(c);
    const group = c.el.querySelector('.jects-grid-rating')!;
    expect(group.getAttribute('role')).toBe('radiogroup');
    expect(group.getAttribute('aria-label')).toBe('Rating: 3 of 5');
    const stars = c.el.querySelectorAll('.jects-grid-rating__star');
    expect(stars).toHaveLength(5);
    expect(c.el.querySelectorAll('.jects-grid-rating__star--on')).toHaveLength(3);
    // editable → stars are buttons with radio role.
    expect(stars[0]!.tagName).toBe('BUTTON');
    expect(stars[0]!.getAttribute('role')).toBe('radio');
  });

  it('honors custom max + non-editable (spans, no buttons)', () => {
    const meta: RatingMeta = { max: 3, editable: false };
    const c = ctx<Row>({ column: { field: 'score', type: 'rating', meta: { rating: meta } }, value: 2 });
    ratingRenderer(c);
    const stars = c.el.querySelectorAll('.jects-grid-rating__star');
    expect(stars).toHaveLength(3);
    expect(stars[0]!.tagName).toBe('SPAN');
    expect(c.el.querySelector('.jects-grid-rating--editable')).toBeNull();
  });

  it('clicking a star writes the new value back through the store', () => {
    const rows: Row[] = [{ id: 1, name: 'A', score: 2 }];
    const { api, store } = apiWithStore(rows);
    const c = ctx<Row>({
      column: { field: 'score', type: 'rating' },
      value: 2,
      row: rows[0]!,
      api,
    });
    ratingRenderer(c);
    const stars = c.el.querySelectorAll<HTMLButtonElement>('.jects-grid-rating__star');
    stars[3]!.click(); // 4th star → value 4
    expect(store.getById(1 as RecordId)!.score).toBe(4);
    // group label + filled count reflect the new value without a repaint.
    expect(c.el.querySelector('.jects-grid-rating')!.getAttribute('aria-label')).toBe('Rating: 4 of 5');
    expect(c.el.querySelectorAll('.jects-grid-rating__star--on')).toHaveLength(4);
  });

  it('fires onChange and respects a veto (no store write)', () => {
    const rows: Row[] = [{ id: 1, name: 'A', score: 1 }];
    const { api, store } = apiWithStore(rows);
    const onChange = vi.fn().mockReturnValue(false);
    const meta: RatingMeta = { onChange };
    const c = ctx<Row>({
      column: { field: 'score', type: 'rating', meta: { rating: meta } },
      value: 1,
      row: rows[0]!,
      api,
    });
    ratingRenderer(c);
    const stars = c.el.querySelectorAll<HTMLButtonElement>('.jects-grid-rating__star');
    stars[4]!.click(); // attempt value 5 — vetoed
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ value: 5 }));
    expect(store.getById(1 as RecordId)!.score).toBe(1); // unchanged
  });

  it('keyboard ArrowRight/ArrowLeft adjusts the rating', () => {
    const rows: Row[] = [{ id: 1, name: 'A', score: 2 }];
    const { api, store } = apiWithStore(rows);
    const c = ctx<Row>({ column: { field: 'score', type: 'rating' }, value: 2, row: rows[0]!, api });
    ratingRenderer(c);
    const stars = c.el.querySelectorAll<HTMLButtonElement>('.jects-grid-rating__star');
    stars[1]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(store.getById(1 as RecordId)!.score).toBe(3);
    stars[2]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(store.getById(1 as RecordId)!.score).toBe(2);
  });

  it('clicking the single filled star toggles to 0', () => {
    const rows: Row[] = [{ id: 1, name: 'A', score: 1 }];
    const { api, store } = apiWithStore(rows);
    const c = ctx<Row>({ column: { field: 'score', type: 'rating' }, value: 1, row: rows[0]!, api });
    ratingRenderer(c);
    const stars = c.el.querySelectorAll<HTMLButtonElement>('.jects-grid-rating__star');
    stars[0]!.click();
    expect(store.getById(1 as RecordId)!.score).toBe(0);
  });
});

/* ── widget column ─────────────────────────────────────────────────────────── */
// A trivial registered widget for the factory.
class FakeWidget {
  el: HTMLElement;
  destroyed = false;
  constructor(_host: HTMLElement | string, config?: Record<string, unknown>) {
    this.el = createEl('span', { className: 'fake-widget', text: String(config?.text ?? '') });
  }
  destroy(): void {
    this.destroyed = true;
    this.el.remove();
  }
}

describe('widgetCellRenderer', () => {
  beforeEach(() => {
    clearRegistry();
    register('fakewidget', FakeWidget as never);
  });
  afterEach(() => clearRegistry());

  it('mounts a control built from a static config', () => {
    const meta: WidgetCellMeta = { widget: { type: 'fakewidget', text: 'hi' } };
    const c = ctx<Row>({ column: { type: 'widget', meta: { widget: meta } }, value: undefined });
    widgetCellRenderer(c);
    const mounted = c.el.querySelector('.fake-widget');
    expect(mounted).toBeTruthy();
    expect(mounted!.textContent).toBe('hi');
    expect(c.el.classList.contains('jects-grid-cell--widget')).toBe(true);
  });

  it('derives config per row via a function', () => {
    const meta: WidgetCellMeta<Row> = {
      widget: (cc) => ({ type: 'fakewidget', text: cc.row.name }),
    };
    const row: Row = { id: 1, name: 'Ada', score: 0 };
    const c = ctx<Row>({ column: { type: 'widget', meta: { widget: meta } }, value: undefined, row });
    widgetCellRenderer(c);
    expect(c.el.querySelector('.fake-widget')!.textContent).toBe('Ada');
  });

  it('runs onMount and tracks returned disposers', () => {
    const off = vi.fn();
    const onMount = vi.fn().mockReturnValue(off);
    const meta: WidgetCellMeta = { widget: { type: 'fakewidget', text: 'x' }, onMount };
    const c = ctx<Row>({ column: { type: 'widget', meta: { widget: meta } }, value: undefined });
    widgetCellRenderer(c);
    expect(onMount).toHaveBeenCalledOnce();
    destroyCellWidget(c.el);
    expect(off).toHaveBeenCalledOnce();
  });

  it('destroys the prior widget when the same cell is repainted (recycling-safe)', () => {
    const meta: WidgetCellMeta = { widget: { type: 'fakewidget', text: 'a' } };
    const c = ctx<Row>({ column: { type: 'widget', meta: { widget: meta } }, value: undefined });
    widgetCellRenderer(c);
    const first = c.el.querySelector('.fake-widget');
    // Repaint same cell → first control torn down, exactly one remains.
    widgetCellRenderer(c);
    expect(c.el.querySelectorAll('.fake-widget')).toHaveLength(1);
    expect(c.el.contains(first)).toBe(false);
  });

  it('fails soft (empty cell) when no widget meta is provided', () => {
    const c = ctx<Row>({ column: { type: 'widget' }, value: undefined });
    widgetCellRenderer(c);
    expect(c.el.textContent).toBe('');
    expect(c.el.querySelector('.fake-widget')).toBeNull();
  });

  it('fails soft when the type is unregistered', () => {
    const meta: WidgetCellMeta = { widget: { type: 'nope-not-registered' } };
    const c = ctx<Row>({ column: { type: 'widget', meta: { widget: meta } }, value: undefined });
    expect(() => widgetCellRenderer(c)).not.toThrow();
    expect(c.el.querySelector('.fake-widget')).toBeNull();
  });
});

/* ── rownumber ─────────────────────────────────────────────────────────────── */
describe('rownumberRenderer', () => {
  it('emits the 1-based view index by default', () => {
    const c0 = ctx<Row>({ column: { type: 'rownumber' }, value: undefined, rowIndex: 0 });
    rownumberRenderer(c0);
    expect(c0.el.textContent).toBe('1');
    expect(c0.el.classList.contains('jects-grid-cell--rownumber')).toBe(true);

    const c4 = ctx<Row>({ column: { type: 'rownumber' }, value: undefined, rowIndex: 4 });
    rownumberRenderer(c4);
    expect(c4.el.textContent).toBe('5');
  });

  it('honors a custom start + format', () => {
    const c = ctx<Row>({
      column: { type: 'rownumber', meta: { rownumber: { start: 100, format: (i, s) => `#${s + i}` } } },
      value: undefined,
      rowIndex: 2,
    });
    rownumberRenderer(c);
    expect(c.el.textContent).toBe('#102');
  });
});

/* ── registration into the core registry ─────────────────────────────────────── */
describe('registry integration', () => {
  it('CellRendererRegistry resolves the new types out of the box', () => {
    const reg = new CellRendererRegistry<Row>();
    expect(reg.resolve({ type: 'rating' })).toBe(ratingRenderer);
    expect(reg.resolve({ type: 'widget' })).toBe(widgetCellRenderer);
    expect(reg.resolve({ type: 'rownumber' })).toBe(rownumberRenderer);
  });

  it('registerExtraRenderers wires a custom registry target', () => {
    const calls: string[] = [];
    registerExtraRenderers({
      register: (type) => {
        calls.push(type);
      },
    });
    expect(calls).toEqual(['rating', 'widget', 'rownumber', 'select']);
    expect(Object.keys(EXTRA_RENDERERS)).toEqual(['rating', 'widget', 'rownumber', 'select']);
  });
});
