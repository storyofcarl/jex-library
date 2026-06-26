/**
 * jsdom unit tests for RowResizeFeature — per-row height drag.
 *
 * Exercises: handle injection/decoration, pointer-drag commit + clamping,
 * keyboard nudge/reset, `rowResize` event payloads, programmatic API,
 * state serialize/restore, and leak-free `destroy()`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ColumnDef } from '../contract.js';
import { RowResizeFeature, rowResizeFeature } from './row-resize.js';
import type { RowResizeEvent } from './row-resize.js';
import { makeHarness, makeStore, type FeatureHarness } from './test-harness.js';

interface Row {
  id: number;
  name: string;
}

const ROWS: Row[] = [
  { id: 1, name: 'Alice' },
  { id: 2, name: 'Bob' },
  { id: 3, name: 'Carol' },
];

const COLUMNS: ColumnDef<Row>[] = [{ field: 'name', header: 'Name' }];

let h: FeatureHarness<Row>;
beforeEach(() => {
  h = makeHarness<Row>({ store: makeStore(ROWS), columns: COLUMNS });
});
afterEach(() => h.destroy());

/** Paint a fake recycled row element into the grid root (mimics the renderer). */
function paintRow(el: HTMLElement, rowIndex: number, id: number, height = 36): HTMLElement {
  const rowEl = document.createElement('div');
  rowEl.className = 'jects-grid__row';
  rowEl.dataset['rowIndex'] = String(rowIndex);
  rowEl.dataset['rowId'] = String(id);
  rowEl.style.height = `${height}px`;
  el.appendChild(rowEl);
  return rowEl;
}

function firePointer(
  target: EventTarget,
  type: string,
  init: { clientY: number; pointerId?: number },
): void {
  const ev = new MouseEvent(type, { bubbles: true, cancelable: true, clientY: init.clientY });
  // jsdom has no PointerEvent ctor by default; decorate the MouseEvent.
  Object.defineProperty(ev, 'pointerId', { value: init.pointerId ?? 1 });
  target.dispatchEvent(ev);
}

describe('RowResizeFeature (jsdom)', () => {
  it('registers under the name "rowResize" and marks the grid resizable', () => {
    const f = h.api.use(new RowResizeFeature<Row>()) as RowResizeFeature<Row>;
    expect(f.name).toBe('rowResize');
    expect(h.api.features.get('rowResize')).toBe(f);
    expect(h.el.classList.contains('jects-grid--row-resizable')).toBe(true);
  });

  it('injects an accessible resize handle into each painted row', () => {
    h.api.use(new RowResizeFeature<Row>());
    paintRow(h.el, 0, 1);
    paintRow(h.el, 1, 2);
    // Decoration runs on viewportChange.
    h.api.emit('viewportChange', { window: h.api.viewport.window });

    const handles = h.el.querySelectorAll('.jects-grid__row-resizer');
    expect(handles.length).toBe(2);
    const handle = handles[0] as HTMLElement;
    expect(handle.getAttribute('role')).toBe('separator');
    expect(handle.getAttribute('aria-orientation')).toBe('horizontal');
    expect(handle.getAttribute('aria-label')).toBeTruthy();
    expect(handle.tabIndex).toBe(0);
    expect(handle.getAttribute('aria-valuemin')).toBe('20');
    expect(handle.getAttribute('aria-valuemax')).toBe('400');
  });

  it('does not inject duplicate handles when re-decorating', () => {
    h.api.use(new RowResizeFeature<Row>());
    paintRow(h.el, 0, 1);
    h.api.emit('viewportChange', { window: h.api.viewport.window });
    h.api.emit('viewportChange', { window: h.api.viewport.window });
    expect(h.el.querySelectorAll('.jects-grid__row-resizer').length).toBe(1);
  });

  it('commits a pointer drag, clamps the height, and emits rowResize', () => {
    const f = h.api.use(new RowResizeFeature<Row>()) as RowResizeFeature<Row>;
    const rowEl = paintRow(h.el, 0, 1, 36);
    h.api.emit('viewportChange', { window: h.api.viewport.window });
    const handle = rowEl.querySelector('.jects-grid__row-resizer') as HTMLElement;

    const events: RowResizeEvent<Row>[] = [];
    h.api.on('rowResize', (e) => events.push(e));

    // Drag the bottom edge down by 30px → 36 + 30 = 66.
    firePointer(handle, 'pointerdown', { clientY: 100 });
    firePointer(window, 'pointermove', { clientY: 115 });
    firePointer(window, 'pointerup', { clientY: 130 });

    expect(events).toHaveLength(1);
    expect(events[0]!.id).toBe(1);
    expect(events[0]!.rowIndex).toBe(0);
    expect(events[0]!.height).toBe(66);
    expect(events[0]!.oldHeight).toBe(36);
    expect(events[0]!.row.name).toBe('Alice');
    expect(f.getHeight(1)).toBe(66);
    // Live DOM height reflects the commit.
    expect(rowEl.style.height).toBe('66px');
  });

  it('clamps below minHeight and above maxHeight', () => {
    const f = h.api.use(
      new RowResizeFeature<Row>({ minHeight: 24, maxHeight: 80 }),
    ) as RowResizeFeature<Row>;
    const rowEl = paintRow(h.el, 0, 1, 40);
    h.api.emit('viewportChange', { window: h.api.viewport.window });
    const handle = rowEl.querySelector('.jects-grid__row-resizer') as HTMLElement;

    // Drag far up → clamps to min.
    firePointer(handle, 'pointerdown', { clientY: 200 });
    firePointer(window, 'pointerup', { clientY: 0 });
    expect(f.getHeight(1)).toBe(24);

    // Drag far down → clamps to max.
    firePointer(handle, 'pointerdown', { clientY: 0 });
    firePointer(window, 'pointerup', { clientY: 1000 });
    expect(f.getHeight(1)).toBe(80);
  });

  it('updates aria-valuenow live during a drag preview', () => {
    h.api.use(new RowResizeFeature<Row>());
    const rowEl = paintRow(h.el, 0, 1, 36);
    h.api.emit('viewportChange', { window: h.api.viewport.window });
    const handle = rowEl.querySelector('.jects-grid__row-resizer') as HTMLElement;

    firePointer(handle, 'pointerdown', { clientY: 50 });
    firePointer(window, 'pointermove', { clientY: 70 }); // +20 → 56
    expect(handle.getAttribute('aria-valuenow')).toBe('56');
    expect(rowEl.style.height).toBe('56px');
    firePointer(window, 'pointerup', { clientY: 70 });
  });

  it('keyboard ArrowDown/ArrowUp nudge by keyboardStep, Shift = x4', () => {
    const f = h.api.use(
      new RowResizeFeature<Row>({ keyboardStep: 5, defaultHeight: 36 }),
    ) as RowResizeFeature<Row>;
    const rowEl = paintRow(h.el, 0, 1, 36);
    h.api.emit('viewportChange', { window: h.api.viewport.window });
    const handle = rowEl.querySelector('.jects-grid__row-resizer') as HTMLElement;

    handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(f.getHeight(1)).toBe(41);
    handle.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, shiftKey: true }),
    );
    expect(f.getHeight(1)).toBe(41 + 20);
    handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    expect(f.getHeight(1)).toBe(56);
  });

  it('keyboard Home resets to the default height', () => {
    const f = h.api.use(
      new RowResizeFeature<Row>({ defaultHeight: 36 }),
    ) as RowResizeFeature<Row>;
    const rowEl = paintRow(h.el, 0, 1, 36);
    h.api.emit('viewportChange', { window: h.api.viewport.window });
    const handle = rowEl.querySelector('.jects-grid__row-resizer') as HTMLElement;

    f.resizeRow(1, 120);
    expect(f.getHeight(1)).toBe(120);
    handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    expect(f.getHeight(1)).toBe(36);
  });

  it('resizeRow() programmatically resizes and emits', () => {
    const f = h.api.use(new RowResizeFeature<Row>()) as RowResizeFeature<Row>;
    const spy = vi.fn();
    h.api.on('rowResize', spy);
    const committed = f.resizeRow(2, 90);
    expect(committed).toBe(90);
    expect(f.getHeight(2)).toBe(90);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0].id).toBe(2);
  });

  it('resetRow() removes the override and emits', () => {
    const f = h.api.use(
      new RowResizeFeature<Row>({ defaultHeight: 36 }),
    ) as RowResizeFeature<Row>;
    f.resizeRow(2, 90);
    const spy = vi.fn();
    h.api.on('rowResize', spy);
    f.resetRow(2);
    expect(f.getHeight(2)).toBeUndefined();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0].height).toBe(36);
  });

  it('serializes and restores per-row heights via getState/setState', () => {
    const f = h.api.use(new RowResizeFeature<Row>()) as RowResizeFeature<Row>;
    f.resizeRow(1, 50);
    f.resizeRow(3, 70);
    const state = f.getState();
    expect(state).toEqual({ '1': 50, '3': 70 });

    const f2 = rowResizeFeature<Row>();
    const h2 = makeHarness<Row>({ store: makeStore(ROWS), columns: COLUMNS });
    h2.api.use(f2);
    f2.setState(state);
    expect(f2.getHeight(1)).toBe(50);
    expect(f2.getHeight(3)).toBe(70);
    h2.destroy();
  });

  it('honors a custom applySize hook instead of the default engine wiring', () => {
    const applySize = vi.fn();
    const f = h.api.use(
      new RowResizeFeature<Row>({ applySize }),
    ) as RowResizeFeature<Row>;
    f.resizeRow(1, 64);
    expect(applySize).toHaveBeenCalledTimes(1);
    expect(applySize.mock.calls[0]![0]).toMatchObject({ rowIndex: 0, id: 1, height: 64 });
  });

  it('a no-op resize (same height) does not emit', () => {
    h.api.use(new RowResizeFeature<Row>({ defaultHeight: 36 }));
    const rowEl = paintRow(h.el, 0, 1, 36);
    h.api.emit('viewportChange', { window: h.api.viewport.window });
    const handle = rowEl.querySelector('.jects-grid__row-resizer') as HTMLElement;
    const spy = vi.fn();
    h.api.on('rowResize', spy);
    // pointerdown then up with zero delta → height unchanged.
    firePointer(handle, 'pointerdown', { clientY: 100 });
    firePointer(window, 'pointerup', { clientY: 100 });
    expect(spy).not.toHaveBeenCalled();
  });

  it('destroy() removes handles, the class, listeners, and clears state', () => {
    const f = h.api.use(new RowResizeFeature<Row>()) as RowResizeFeature<Row>;
    paintRow(h.el, 0, 1);
    h.api.emit('viewportChange', { window: h.api.viewport.window });
    expect(h.el.querySelector('.jects-grid__row-resizer')).toBeTruthy();
    f.resizeRow(1, 80);

    f.destroy();
    expect(h.el.querySelector('.jects-grid__row-resizer')).toBeNull();
    expect(h.el.classList.contains('jects-grid--row-resizable')).toBe(false);
    expect(f.getHeight(1)).toBeUndefined();

    // After destroy, a viewportChange must not re-inject handles.
    h.api.emit('viewportChange', { window: h.api.viewport.window });
    expect(h.el.querySelector('.jects-grid__row-resizer')).toBeNull();
  });
});
