/**
 * Real-Chromium a11y + interaction test for ColumnAutoSizeFeature.
 *
 * Mounts a real Grid, installs the feature, and verifies:
 *   - the per-header auto-size handle is injected with the correct ARIA
 *     separator role/label, and the mounted grid has no serious/critical axe
 *     violations with the feature present;
 *   - a real double-click on a header's trailing handle auto-fits the column to
 *     its content (measured with the real canvas `measureText`) and fires
 *     `columnAutoSize` — an over-wide column shrinks toward its content;
 *   - keyboard Enter on a focused handle triggers the same auto-fit.
 */
import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import '@jects/theme/style.css';
import '../styles.css';
import './column-auto-size.css';
import { Grid } from '../engine/grid.js';
import type { ColumnDef } from '../contract.js';
import { ColumnAutoSizeFeature, type ColumnAutoSizeEvent } from './column-auto-size.js';
import { expectNoA11yViolations } from '../test-utils/a11y.js';

interface Row {
  id: number;
  name: string;
  city: string;
}

const cols: ColumnDef<Row>[] = [
  // Start far wider than the content so an auto-fit visibly shrinks it.
  { field: 'name', header: 'Name', width: 360, minWidth: 40 },
  { field: 'city', header: 'City', width: 200 },
];

function rows(n: number): Row[] {
  const cities = ['NY', 'LA', 'SF'];
  return Array.from({ length: n }, (_, i) => ({
    id: i,
    name: `P${i}`,
    city: cities[i % cities.length]!,
  }));
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

let host: HTMLElement;
beforeEach(() => {
  host = document.createElement('div');
  host.style.width = '700px';
  host.style.height = '320px';
  host.style.position = 'absolute';
  host.style.top = '0';
  host.style.left = '0';
  document.body.appendChild(host);
});
afterEach(() => host.remove());

function headerHandle(root: HTMLElement, colId: string): HTMLElement {
  const cell = root.querySelector<HTMLElement>(
    `.jects-grid__header-cell[data-col-id="${colId}"]`,
  );
  const handle = cell?.querySelector<HTMLElement>('.jects-grid__col-auto-sizer');
  if (!handle) throw new Error(`no auto-size handle for column ${colId}`);
  return handle;
}

describe('ColumnAutoSizeFeature (Chromium)', () => {
  it('injects an accessible handle and stays axe-clean', async () => {
    const g = new Grid<Row>(host, { data: rows(20), columns: cols });
    g.use(new ColumnAutoSizeFeature<Row>());
    g.refresh();
    await nextFrame();

    const root = host.querySelector('.jects-grid') as HTMLElement;
    const handle = headerHandle(root, 'name');
    expect(handle.getAttribute('role')).toBe('separator');
    expect(handle.getAttribute('aria-orientation')).toBe('vertical');
    expect(handle.getAttribute('aria-label')).toMatch(/auto-size column/i);
    expect(handle.tabIndex).toBe(0);

    await expectNoA11yViolations(root);
    g.destroy();
  });

  it('auto-fits an over-wide column to its content on double-click', async () => {
    const g = new Grid<Row>(host, { data: rows(20), columns: cols });
    g.use(new ColumnAutoSizeFeature<Row>());
    g.refresh();
    await nextFrame();

    const root = host.querySelector('.jects-grid') as HTMLElement;
    const events: ColumnAutoSizeEvent<Row>[] = [];
    g.on('columnAutoSize', (e) => events.push(e));

    const before = g.getColumn('name')!.width ?? 0;
    expect(before).toBe(360);

    const handle = headerHandle(root, 'name');
    handle.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    await nextFrame();

    expect(events).toHaveLength(1);
    expect(events[0]!.columnId).toBe('name');
    // Real measureText produced a positive content width.
    expect(events[0]!.contentWidth).toBeGreaterThan(0);
    // The over-wide 360px column shrank toward its short content ("P0".."P19").
    expect(events[0]!.width).toBeLessThan(before);
    expect(g.getColumn('name')!.width).toBe(events[0]!.width);
    g.destroy();
  });

  it('auto-fits on keyboard Enter from a focused handle', async () => {
    const g = new Grid<Row>(host, { data: rows(20), columns: cols });
    g.use(new ColumnAutoSizeFeature<Row>());
    g.refresh();
    await nextFrame();

    const root = host.querySelector('.jects-grid') as HTMLElement;
    const events: ColumnAutoSizeEvent<Row>[] = [];
    g.on('columnAutoSize', (e) => events.push(e));

    const handle = headerHandle(root, 'name');
    handle.focus();
    handle.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
    await nextFrame();

    expect(events).toHaveLength(1);
    expect(events[0]!.columnId).toBe('name');
    g.destroy();
  });
});
