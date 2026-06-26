/**
 * RTL support — real-Chromium geometry + a11y test (Bryntum/DHTMLX "RTL" parity).
 *
 * jsdom can't lay out, so the *visual* RTL mirroring (frozen bands flipping to the
 * opposite physical edge, centre columns flowing from the right) is verified here
 * in real Chromium against actual `offsetLeft` geometry. The companion jsdom suite
 * (`engine/rtl.test.ts`) covers the pure helpers + the inline-style contract.
 *
 * Asserts, for a grid with a frozen-left + centre + frozen-right column set:
 *   - LTR: frozen-left pinned to the visual left, frozen-right to the visual right;
 *   - RTL (`dir="rtl"` on the grid host): the bands MIRROR — the frozen-"left"
 *     (reading-start) band pins to the visual RIGHT, the frozen-"right" band to the
 *     visual LEFT, and header cells stay pixel-aligned with their body cells;
 *   - header/body alignment holds in RTL (the regression the header-align test
 *     guards, now under RTL);
 *   - axe-core finds zero serious/critical violations in the RTL grid (Q2 bar).
 */
import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import '@jects/theme/style.css';
import './styles.css';
import { Grid } from './engine/grid.js';
import type { ColumnDef } from './contract.js';
import { expectNoA11yViolations } from './test-utils/a11y.js';

interface Row {
  id: number;
  a: string;
  b: string;
  c: string;
  d: string;
}

// 100 (frozen-left) + 160 + 160 (centre) + 90 (frozen-right) = 510px of columns
// in a 400px viewport, so the centre band genuinely scrolls and the frozen bands
// are meaningfully pinned.
const columns: ColumnDef<Row>[] = [
  { id: 'a', field: 'a', header: 'A', width: 100, frozen: 'left' },
  { id: 'b', field: 'b', header: 'B', width: 160 },
  { id: 'c', field: 'c', header: 'C', width: 160 },
  { id: 'd', field: 'd', header: 'D', width: 90, frozen: 'right' },
];

function rows(n: number): Row[] {
  return Array.from({ length: n }, (_, i) => ({
    id: i,
    a: `a${i}`,
    b: `b${i}`,
    c: `c${i}`,
    d: `d${i}`,
  }));
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

async function settle(): Promise<void> {
  await nextFrame();
  await nextFrame();
  await nextFrame();
}

/** offsetLeft/offsetWidth of the first painted body cell for a given column id. */
function bodyCellRect(root: HTMLElement, colId: string): { left: number; width: number } {
  const firstRow = Array.from(root.querySelectorAll<HTMLElement>('.jects-grid__row')).find(
    (el) => !el.hidden,
  )!;
  const cell = firstRow.querySelector<HTMLElement>(`.jects-grid__cell[data-col-id="${colId}"]`)!;
  return { left: cell.offsetLeft, width: cell.offsetWidth };
}

function headerCellRect(root: HTMLElement, colId: string): { left: number; width: number } {
  const cell = root.querySelector<HTMLElement>(`.jects-grid__header-cell[data-col-id="${colId}"]`)!;
  return { left: cell.offsetLeft, width: cell.offsetWidth };
}

let host: HTMLElement;
let grid: Grid<Row>;

beforeEach(() => {
  host = document.createElement('div');
  host.style.width = '400px';
  host.style.height = '300px';
  host.style.position = 'absolute';
  host.style.top = '0';
  host.style.left = '0';
  document.body.appendChild(host);
});

afterEach(() => {
  grid?.destroy();
  host.remove();
});

describe('Grid RTL support', () => {
  it('LTR: frozen-left pins to the visual left, frozen-right to the visual right', async () => {
    grid = new Grid<Row>(host, { data: rows(30), columns, rowHeight: 28 });
    await settle();
    const root = host.querySelector('.jects-grid') as HTMLElement;

    const a = bodyCellRect(root, 'a'); // frozen-left
    const d = bodyCellRect(root, 'd'); // frozen-right
    // Frozen-left sits at the very left of the row.
    expect(a.left).toBe(0);
    // Frozen-right sits at the right: its left = totalWidth - its width = 510 - 90.
    expect(d.left).toBe(510 - d.width);
    // 'a' is to the left of 'd'.
    expect(a.left).toBeLessThan(d.left);
  });

  it('RTL: frozen bands mirror — reading-start band pins to the visual RIGHT', async () => {
    host.setAttribute('dir', 'rtl');
    grid = new Grid<Row>(host, { data: rows(30), columns, rowHeight: 28 });
    await settle();
    const root = host.querySelector('.jects-grid') as HTMLElement;

    const a = bodyCellRect(root, 'a'); // frozen reading-start
    const d = bodyCellRect(root, 'd'); // frozen reading-end

    // Under RTL the reading-start ('a') band must mirror to the RIGHT edge, and the
    // reading-end ('d') band to the LEFT edge — i.e. 'a' is now to the RIGHT of 'd'.
    expect(a.left).toBeGreaterThan(d.left);
    // Reading-start frozen column pins flush to the row's right edge.
    expect(a.left).toBe(510 - a.width);
    // Reading-end frozen column pins flush to the row's left edge.
    expect(d.left).toBe(0);
  });

  it('RTL: header cells stay pixel-aligned with their body cells', async () => {
    host.setAttribute('dir', 'rtl');
    grid = new Grid<Row>(host, { data: rows(30), columns, rowHeight: 28 });
    await settle();
    const root = host.querySelector('.jects-grid') as HTMLElement;

    for (const id of ['a', 'b', 'c', 'd']) {
      const h = headerCellRect(root, id);
      const b = bodyCellRect(root, id);
      expect(Math.abs(h.left - b.left), `column ${id} left drift`).toBeLessThanOrEqual(1);
      expect(Math.abs(h.width - b.width), `column ${id} width drift`).toBeLessThanOrEqual(1);
    }
  });

  it('flipping dir at runtime re-mirrors the layout on the next paint', async () => {
    grid = new Grid<Row>(host, { data: rows(30), columns, rowHeight: 28 });
    await settle();
    const root = host.querySelector('.jects-grid') as HTMLElement;

    // LTR: 'a' left of 'd'.
    expect(bodyCellRect(root, 'a').left).toBeLessThan(bodyCellRect(root, 'd').left);

    // Flip to RTL and force a repaint through the public refresh path.
    host.setAttribute('dir', 'rtl');
    grid.refresh();
    grid.invalidateLayout();
    await settle();

    // RTL: 'a' now to the right of 'd'.
    expect(bodyCellRect(root, 'a').left).toBeGreaterThan(bodyCellRect(root, 'd').left);
  });

  it('has zero serious/critical axe violations in RTL', async () => {
    host.setAttribute('dir', 'rtl');
    grid = new Grid<Row>(host, {
      data: rows(30),
      columns,
      rowHeight: 28,
      selection: 'row',
    } as never);
    await settle();
    const root = host.querySelector('.jects-grid') as HTMLElement;
    await expectNoA11yViolations(root);
  });
});
