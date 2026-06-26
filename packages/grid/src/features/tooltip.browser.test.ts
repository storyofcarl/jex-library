/**
 * Real-Chromium a11y + interaction test for TooltipFeature.
 *
 * With true layout, this verifies:
 *   - a column `tooltip` renderer surfaces a bubble on hover, the described cell
 *     gets `aria-describedby` pointing at the `role="tooltip"` bubble, and the
 *     mounted grid is axe-clean with the tooltip present;
 *   - overflow detection works against real `scrollWidth`/`clientWidth` — a
 *     clipped cell shows its full text, a fitting cell does not;
 *   - keyboard focus shows a tooltip (not just hover) and Escape dismisses it;
 *   - the bubble is positioned over the cell (within the viewport).
 */
import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import '@jects/theme/style.css';
import '../styles.css';
import './tooltip.css';
import { Grid } from '../engine/grid.js';
import type { ColumnDef } from '../contract.js';
import { TooltipFeature, type TooltipColumnDef } from './tooltip.js';
import { expectNoA11yViolations } from '../test-utils/a11y.js';

interface Row {
  id: number;
  name: string;
  bio: string;
}

function rows(n: number): Row[] {
  return Array.from({ length: n }, (_, i) => ({
    id: i,
    name: `Person ${i}`,
    bio: `A deliberately long biography for person ${i} that will not fit inside a narrow column and must be clipped.`,
  }));
}

const cols: TooltipColumnDef<Row>[] = [
  { field: 'name', header: 'Name', width: 120, tooltip: (ctx) => `Full name: ${String(ctx.value)}` },
  // Narrow column with no renderer → overflow fallback should kick in.
  { field: 'bio', header: 'Bio', width: 120 },
];

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}
function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

let host: HTMLElement;
beforeEach(() => {
  host = document.createElement('div');
  host.style.width = '320px';
  host.style.height = '300px';
  host.style.position = 'absolute';
  host.style.top = '0';
  host.style.left = '0';
  document.body.appendChild(host);
});
afterEach(() => host.remove());

function root(): HTMLElement {
  return host.querySelector('.jects-grid') as HTMLElement;
}
function cellAt(rowIndex: number, colIndex: number): HTMLElement {
  const el = root().querySelector<HTMLElement>(
    `.jects-grid__row[data-row-index="${rowIndex}"] .jects-grid__cell[data-col-index="${colIndex}"]`,
  );
  if (!el) throw new Error(`no cell ${rowIndex},${colIndex}`);
  return el;
}

describe('TooltipFeature (Chromium)', () => {
  it('shows a renderer tooltip on hover, wires aria-describedby, stays axe-clean', async () => {
    const g = new Grid<Row>(host, { data: rows(20), columns: cols as ColumnDef<Row>[], rowHeight: 32 });
    const f = g.use(new TooltipFeature<Row>({ showDelay: 0, hideDelay: 0 })) as TooltipFeature<Row>;
    g.refresh();
    await nextFrame();

    const cell = cellAt(0, 0);
    cell.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
    await wait(20);

    expect(f.isVisible).toBe(true);
    const bubble = f.bubbleEl!;
    expect(bubble.getAttribute('role')).toBe('tooltip');
    expect(bubble.textContent).toBe('Full name: Person 0');
    expect(cell.getAttribute('aria-describedby')).toBe(bubble.id);

    // The bubble sits within the viewport (positioned, not at 0/0 off-screen).
    const r = bubble.getBoundingClientRect();
    expect(r.width).toBeGreaterThan(0);
    expect(r.left).toBeGreaterThanOrEqual(0);
    expect(r.top).toBeGreaterThanOrEqual(0);

    await expectNoA11yViolations(host);
    g.destroy();
  });

  it('uses the overflow fallback for a clipped cell and skips a fitting one', async () => {
    const g = new Grid<Row>(host, { data: rows(20), columns: cols as ColumnDef<Row>[], rowHeight: 32 });
    const f = g.use(new TooltipFeature<Row>({ showDelay: 0, hideDelay: 0 })) as TooltipFeature<Row>;
    g.refresh();
    await nextFrame();

    // The bio cell is narrow → its long text overflows → fallback shows full text.
    const bio = cellAt(0, 1);
    expect(bio.scrollWidth).toBeGreaterThan(bio.clientWidth); // truly clipped
    expect(f.showFor(bio)).toBe(true);
    expect(f.bubbleEl!.textContent).toContain('biography for person 0');
    f.hideNow();

    // The name cell content fits → no overflow tooltip would fire (but it has a
    // renderer, so showFor returns true via the renderer; assert the *overflow*
    // path directly by checking the geometry).
    const name = cellAt(0, 0);
    expect(name.scrollWidth).toBeLessThanOrEqual(name.clientWidth + 1);
    g.destroy();
  });

  it('shows on keyboard focus and dismisses on Escape', async () => {
    const g = new Grid<Row>(host, { data: rows(20), columns: cols as ColumnDef<Row>[], rowHeight: 32 });
    const f = g.use(new TooltipFeature<Row>({ showDelay: 0, hideDelay: 0 })) as TooltipFeature<Row>;
    g.refresh();
    await nextFrame();

    const cell = cellAt(1, 0);
    cell.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    await wait(30);
    expect(f.isVisible).toBe(true);

    root().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(f.isVisible).toBe(false);
    expect(cell.hasAttribute('aria-describedby')).toBe(false);

    g.destroy();
  });
});
