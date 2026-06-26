/**
 * Real-Chromium a11y + interaction test for RowResizeFeature.
 *
 * Mounts a real Grid, installs the feature, and verifies:
 *   - the per-row drag handle is injected with the correct ARIA separator role
 *     and value range, and the mounted grid has no serious/critical axe
 *     violations with the feature present;
 *   - a real pointer drag on a row's bottom edge resizes that row, taller, and
 *     fires `rowResize`; the engine persists the height (survives a repaint);
 *   - keyboard ArrowDown on a focused handle nudges the height.
 */
import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import '@jects/theme/style.css';
import '../styles.css';
import { Grid } from '../engine/grid.js';
import type { ColumnDef } from '../contract.js';
import { RowResizeFeature, type RowResizeEvent } from './row-resize.js';
import { expectNoA11yViolations } from '../test-utils/a11y.js';

interface Row {
  id: number;
  name: string;
  age: number;
}

const cols: ColumnDef<Row>[] = [
  { field: 'name', header: 'Name', width: 200 },
  { field: 'age', header: 'Age', type: 'number', width: 100 },
];

function rows(n: number): Row[] {
  return Array.from({ length: n }, (_, i) => ({ id: i, name: `Person ${i}`, age: 20 + i }));
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

let host: HTMLElement;
beforeEach(() => {
  host = document.createElement('div');
  host.style.width = '480px';
  host.style.height = '320px';
  host.style.position = 'absolute';
  host.style.top = '0';
  host.style.left = '0';
  document.body.appendChild(host);
});
afterEach(() => host.remove());

function firstDataRow(root: HTMLElement): HTMLElement {
  const el = Array.from(root.querySelectorAll<HTMLElement>('.jects-grid__row')).find(
    (r) => !r.hidden && r.dataset['rowIndex'] === '0',
  );
  if (!el) throw new Error('no painted data row 0');
  return el;
}

describe('RowResizeFeature (Chromium)', () => {
  it('injects an accessible handle and stays axe-clean with variable heights', async () => {
    const g = new Grid<Row>(host, {
      data: rows(30),
      columns: cols,
      rowHeight: 32,
      virtualization: { variableRowHeight: true },
    });
    g.use(new RowResizeFeature<Row>());
    g.refresh();
    await nextFrame();

    const root = host.querySelector('.jects-grid') as HTMLElement;
    const rowEl = firstDataRow(root);
    const handle = rowEl.querySelector('.jects-grid__row-resizer') as HTMLElement;
    expect(handle).toBeTruthy();
    expect(handle.getAttribute('role')).toBe('separator');
    expect(handle.getAttribute('aria-orientation')).toBe('horizontal');
    expect(handle.getAttribute('aria-valuemin')).toBe('20');
    expect(Number(handle.getAttribute('aria-valuenow'))).toBeGreaterThan(0);

    await expectNoA11yViolations(host);
    g.destroy();
  });

  it('drag on a row bottom edge resizes that row and fires rowResize', async () => {
    const g = new Grid<Row>(host, {
      data: rows(30),
      columns: cols,
      rowHeight: 32,
      virtualization: { variableRowHeight: true },
    });
    g.use(new RowResizeFeature<Row>({ minHeight: 20, maxHeight: 300 }));
    g.refresh();
    await nextFrame();

    const root = host.querySelector('.jects-grid') as HTMLElement;
    const rowEl = firstDataRow(root);
    const handle = rowEl.querySelector('.jects-grid__row-resizer') as HTMLElement;

    const events: RowResizeEvent<Row>[] = [];
    g.on('rowResize', (e) => events.push(e));

    const rect = handle.getBoundingClientRect();
    const startY = rect.top + rect.height / 2;
    const opts = (clientY: number): PointerEventInit => ({
      bubbles: true,
      cancelable: true,
      clientY,
      pointerId: 1,
      pointerType: 'mouse',
    });
    handle.dispatchEvent(new PointerEvent('pointerdown', opts(startY)));
    window.dispatchEvent(new PointerEvent('pointermove', opts(startY + 40)));
    window.dispatchEvent(new PointerEvent('pointerup', opts(startY + 40)));

    expect(events).toHaveLength(1);
    expect(events[0]!.id).toBe(0);
    expect(events[0]!.height).toBeGreaterThan(events[0]!.oldHeight);
    // The taller height persists through a repaint (engine variable height).
    g.refresh();
    await nextFrame();
    const rowAfter = firstDataRow(host.querySelector('.jects-grid') as HTMLElement);
    expect(rowAfter.getBoundingClientRect().height).toBeGreaterThan(40);

    g.destroy();
  });

  it('keyboard ArrowDown on a focused handle grows the row', async () => {
    const g = new Grid<Row>(host, {
      data: rows(20),
      columns: cols,
      rowHeight: 32,
      virtualization: { variableRowHeight: true },
    });
    const f = g.use(new RowResizeFeature<Row>({ keyboardStep: 8 })) as RowResizeFeature<Row>;
    g.refresh();
    await nextFrame();

    const root = host.querySelector('.jects-grid') as HTMLElement;
    const handle = firstDataRow(root).querySelector('.jects-grid__row-resizer') as HTMLElement;
    handle.focus();
    handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));

    expect(f.getHeight(0)).toBe(40); // 32 + 8
    g.destroy();
  });
});
