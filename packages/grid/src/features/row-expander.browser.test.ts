/**
 * Real-Chromium a11y + interaction test for RowExpanderFeature.
 *
 * Mounts a real Grid, installs the feature, and verifies (with true layout):
 *   - the per-row expander toggle is injected with correct ARIA, and the mounted
 *     grid has no serious/critical axe violations with the feature present;
 *   - clicking the toggle injects a full-width detail row beneath the master,
 *     painted by the consumer renderer, and grows the total scroll height
 *     (virtualization accounts for the tall detail row);
 *   - the detail row is removed on collapse and the geometry shrinks back;
 *   - keyboard Enter on a focused toggle expands the row.
 */
import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import '@jects/theme/style.css';
import '../styles.css';
import { Grid } from '../engine/grid.js';
import type { ColumnDef } from '../contract.js';
import { RowExpanderFeature } from './row-expander.js';
import { expectNoA11yViolations } from '../test-utils/a11y.js';

interface Row {
  id: number;
  name: string;
  age: number;
}

const cols: ColumnDef<Row>[] = [
  { field: 'name', header: 'Name', width: 220 },
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

function root(): HTMLElement {
  return host.querySelector('.jects-grid') as HTMLElement;
}

function toggleFor(masterId: number): HTMLElement {
  const btn = root().querySelector<HTMLElement>(
    `[data-expander-toggle="${masterId}"]`,
  );
  if (!btn) throw new Error(`no expander toggle for ${masterId}`);
  return btn;
}

function detailFor(masterId: number): HTMLElement | null {
  return root().querySelector<HTMLElement>(
    `.jects-grid-detail-row[data-detail-for="${masterId}"]:not([hidden])`,
  );
}

function spacerHeight(): number {
  const sp = root().querySelector('.jects-grid__spacer') as HTMLElement;
  return parseFloat(sp.style.height) || 0;
}

describe('RowExpanderFeature (Chromium)', () => {
  it('injects an accessible toggle and stays axe-clean', async () => {
    const g = new Grid<Row>(host, { data: rows(30), columns: cols, rowHeight: 32 });
    g.use(new RowExpanderFeature<Row>({ renderer: (ctx) => `Detail for ${ctx.row.name}` }));
    g.refresh();
    await nextFrame();

    const btn = toggleFor(0);
    expect(btn.tagName).toBe('BUTTON');
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(btn.getAttribute('aria-label')).toMatch(/expand/i);

    await expectNoA11yViolations(host);
    g.destroy();
  });

  it('expands a row: paints a detail region and grows total height', async () => {
    const g = new Grid<Row>(host, { data: rows(30), columns: cols, rowHeight: 32 });
    g.use(
      new RowExpanderFeature<Row>({
        detailHeight: 180,
        renderer: (ctx) => {
          const div = document.createElement('div');
          div.className = 'demo-detail';
          div.textContent = `Profile of ${ctx.row.name}, age ${ctx.row.age}`;
          return div;
        },
      }),
    );
    g.refresh();
    await nextFrame();

    const before = spacerHeight();
    expect(detailFor(0)).toBeNull();

    toggleFor(0).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await nextFrame();

    const detail = detailFor(0);
    expect(detail).toBeTruthy();
    // Consumer content was painted into the detail body.
    expect(detail!.querySelector('.demo-detail')?.textContent).toContain('Profile of Person 0');
    // The detail row is the configured height.
    expect(Math.round(detail!.getBoundingClientRect().height)).toBe(180);
    // Total scrollable height grew by ~the detail height (virtualization math).
    expect(spacerHeight()).toBeGreaterThan(before + 150);
    // The toggle reflects expanded state.
    expect(toggleFor(0).getAttribute('aria-expanded')).toBe('true');

    // Still axe-clean with an expanded detail present.
    await expectNoA11yViolations(host);

    // Collapse: detail removed, geometry shrinks back.
    toggleFor(0).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await nextFrame();
    expect(detailFor(0)).toBeNull();
    expect(spacerHeight()).toBe(before);

    g.destroy();
  });

  it('keyboard Enter on a focused toggle expands the row', async () => {
    const g = new Grid<Row>(host, { data: rows(20), columns: cols, rowHeight: 32 });
    g.use(new RowExpanderFeature<Row>({ renderer: () => 'detail' }));
    g.refresh();
    await nextFrame();

    const btn = toggleFor(1);
    btn.focus();
    btn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await nextFrame();

    expect(detailFor(1)).toBeTruthy();
    expect(toggleFor(1).getAttribute('aria-expanded')).toBe('true');
    g.destroy();
  });

  it('the detail row stays beneath its master after a scroll/repaint', async () => {
    const g = new Grid<Row>(host, { data: rows(40), columns: cols, rowHeight: 32 });
    g.use(new RowExpanderFeature<Row>({ detailHeight: 120, renderer: () => 'd' }));
    g.refresh();
    await nextFrame();

    toggleFor(2).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await nextFrame();

    const master = root().querySelector<HTMLElement>('.jects-grid__row[data-row-id="2"]')!;
    const detail = detailFor(2)!;
    const mBottom = master.getBoundingClientRect().bottom;
    const dTop = detail.getBoundingClientRect().top;
    // The detail row sits directly under its master row.
    expect(Math.abs(dTop - mBottom)).toBeLessThan(2);

    g.destroy();
  });
});
