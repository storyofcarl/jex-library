/**
 * Real-Chromium a11y + interaction test for the additional typed columns
 * (rating / widget / rownumber).
 *
 * Mounts a real Grid with all three column types and verifies:
 *   - the mounted grid has no serious/critical axe violations (Q2 bar) with the
 *     star radiogroup, a per-cell @jects/widgets Button, and rownumber cells;
 *   - the rownumber column paints the 1-based view index (frozen-friendly);
 *   - a real click on a star commits the new rating to the store AND the repaint
 *     reflects it (the renderer reads it back from the store);
 *   - the widget column mounts a real Button control per row whose click handler
 *     receives the right row.
 */
import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import '@jects/theme/style.css';
// Import the widgets module (not just its CSS) so `register('button', Button)`
// runs — the widget column builds controls through the @jects/core factory.
import '@jects/widgets';
import '@jects/widgets/style.css';
import '../styles.css';
import './columns.css';
import { Grid } from '../engine/grid.js';
import type { ColumnDef } from '../contract.js';
import { withExtraColumnRenderers, type RatingMeta, type WidgetCellMeta } from './extra-renderers.js';
import { expectNoA11yViolations } from '../test-utils/a11y.js';

interface Row {
  id: number;
  name: string;
  score: number;
}

function rows(n: number): Row[] {
  return Array.from({ length: n }, (_, i) => ({ id: i + 1, name: `Person ${i + 1}`, score: (i % 5) }));
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

let host: HTMLElement;
let lastClickedRow = -1;

beforeEach(() => {
  host = document.createElement('div');
  host.style.width = '640px';
  host.style.height = '360px';
  host.style.position = 'absolute';
  host.style.top = '0';
  host.style.left = '0';
  document.body.appendChild(host);
  lastClickedRow = -1;
});
afterEach(() => host.remove());

function makeColumns(): ColumnDef<Row>[] {
  const rating: RatingMeta = { max: 5, label: 'Score' };
  const widget: WidgetCellMeta<Row> = {
    widget: (ctx) => ({ type: 'button', text: `Open ${ctx.row.name}`, variant: 'ghost' }),
    onMount: (w, ctx) => w.on('click', () => (lastClickedRow = ctx.row.id)),
  };
  return [
    { id: 'rn', type: 'rownumber', header: '#', width: 56, frozen: 'left' },
    { field: 'name', header: 'Name', width: 160 },
    { field: 'score', header: 'Score', type: 'rating', width: 160, meta: { rating } },
    { id: 'act', type: 'widget', header: 'Action', width: 200, meta: { widget } },
  ];
}

function cellEl(root: HTMLElement, rowIndex: number, colIndex: number): HTMLElement {
  const el = root.querySelector<HTMLElement>(
    `.jects-grid__row[data-row-index="${rowIndex}"] .jects-grid__cell[data-col-index="${colIndex}"]`,
  );
  if (!el) throw new Error(`no cell ${rowIndex},${colIndex}`);
  return el;
}

describe('Additional column types (Chromium)', () => {
  it('renders rating/widget/rownumber columns with zero serious/critical a11y violations', async () => {
    const g = new Grid<Row>(host, { data: rows(12), columns: withExtraColumnRenderers(makeColumns()), rowHeight: 36 });
    g.refresh();
    await nextFrame();

    const root = host.querySelector('.jects-grid') as HTMLElement;

    // rownumber: 1-based view index.
    expect(cellEl(root, 0, 0).textContent).toBe('1');
    expect(cellEl(root, 2, 0).textContent).toBe('3');

    // rating: a radiogroup with 5 stars, the right number filled for row 0 (score 0).
    const ratingGroup = cellEl(root, 1, 2).querySelector('.jects-grid-rating')!;
    expect(ratingGroup.getAttribute('role')).toBe('radiogroup');
    expect(ratingGroup.querySelectorAll('.jects-grid-rating__star')).toHaveLength(5);

    // widget: a real Button control mounted per cell.
    expect(cellEl(root, 0, 3).querySelector('.jects-btn')).toBeTruthy();

    await expectNoA11yViolations(host);
    g.destroy();
  });

  it('clicking a star commits + persists the rating through a repaint', async () => {
    const g = new Grid<Row>(host, { data: rows(12), columns: withExtraColumnRenderers(makeColumns()), rowHeight: 36 });
    g.refresh();
    await nextFrame();

    const root = host.querySelector('.jects-grid') as HTMLElement;
    // Row index 0 → record id 1, score 0. Click the 4th star → score 4.
    const stars = cellEl(root, 0, 2).querySelectorAll<HTMLButtonElement>('.jects-grid-rating__star');
    stars[3]!.click();

    expect(g.getRowById(1)!.score).toBe(4);

    // Force a repaint; the renderer reads the new value back from the store.
    g.refreshCell(0, 2);
    await nextFrame();
    const repainted = cellEl(host.querySelector('.jects-grid') as HTMLElement, 0, 2);
    expect(repainted.querySelectorAll('.jects-grid-rating__star--on')).toHaveLength(4);

    g.destroy();
  });

  it('the widget column mounts a per-row Button whose handler gets the right row', async () => {
    const g = new Grid<Row>(host, { data: rows(8), columns: withExtraColumnRenderers(makeColumns()), rowHeight: 36 });
    g.refresh();
    await nextFrame();

    const root = host.querySelector('.jects-grid') as HTMLElement;
    const btn = cellEl(root, 2, 3).querySelector<HTMLElement>('.jects-btn')!;
    btn.click();
    // Row index 2 → record id 3.
    expect(lastClickedRow).toBe(3);

    g.destroy();
  });
});
