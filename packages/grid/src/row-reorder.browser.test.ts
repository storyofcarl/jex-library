/**
 * Row reorder — real-Chromium interaction + a11y test.
 *
 * jsdom can't do layout, so the *visual* pipeline (pointer drag → floating
 * proxy → drop indicator between rows → commit) is verified here against the
 * real DOM-recycling Grid. Covers:
 *   - a same-grid pointer drag that moves a row via `store.move`,
 *   - a cross-grid pointer drag that transfers a row between two grids,
 *   - the floating proxy + drop indicator appearing during the drag,
 *   - axe-core: zero serious/critical violations while the feature is installed.
 *
 * Determinism: fixed host sizes + rowHeight; every assertion runs after a
 * flushed rAF (the Grid repaints on rAF). Pointer events are synthesized with
 * real client coordinates derived from `getBoundingClientRect`.
 */
import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import '@jects/theme/style.css';
import './styles.css';
import './features/features.css';
import { Grid } from './engine/grid.js';
import type { ColumnDef } from './contract.js';
import { RowReorderFeature, rowReorderFeature } from './features/row-reorder.js';
import { expectNoA11yViolations } from './test-utils/a11y.js';

interface Row {
  id: number;
  name: string;
}

const columns: ColumnDef<Row>[] = [{ field: 'name', header: 'Name', width: 130 }];

function rows(prefix: string, n: number, base = 0): Row[] {
  return Array.from({ length: n }, (_, i) => ({ id: base + i, name: `${prefix} ${i}` }));
}

const raf = (): Promise<void> =>
  new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

function rowEls(host: HTMLElement): HTMLElement[] {
  return Array.from(host.querySelectorAll<HTMLElement>('.jects-grid__row[data-row-index]')).filter(
    (el) => !el.hidden,
  );
}

function rowByIndex(host: HTMLElement, index: number): HTMLElement {
  return rowEls(host).find((el) => Number(el.dataset['rowIndex']) === index)!;
}

function center(el: HTMLElement): { x: number; y: number } {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

function pointer(type: string, x: number, y: number, target: EventTarget): void {
  target.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
      button: 0,
      pointerId: 1,
      isPrimary: true,
    }),
  );
}

let host1: HTMLElement;
let host2: HTMLElement;
beforeEach(() => {
  // Keep both grids comfortably inside a typical test-iframe viewport so the
  // pointer client coordinates we synthesize stay hit-testable
  // (`elementsFromPoint` returns nothing for points outside the viewport).
  host1 = document.createElement('div');
  host1.style.cssText = 'position:fixed;left:4px;top:4px;width:150px;height:240px;';
  host2 = document.createElement('div');
  host2.style.cssText = 'position:fixed;left:170px;top:4px;width:150px;height:240px;';
  document.body.append(host1, host2);
});
afterEach(() => {
  host1.remove();
  host2.remove();
});

describe('RowReorder (real Chromium)', () => {
  it('drags a row down within one grid and commits via store.move', async () => {
    const g = new Grid<Row>(host1, {
      data: rows('Row', 6),
      columns,
      rowHeight: 36,
      plugins: [rowReorderFeature<Row>()],
    });
    g.refresh();
    await raf();

    const src = rowByIndex(host1, 0); // Row 0
    const dst = rowByIndex(host1, 3); // Row 3
    const from = center(src);
    const to = center(dst);

    pointer('pointerdown', from.x, from.y, src);
    // First move crosses the drag threshold.
    pointer('pointermove', from.x, from.y + 8, document);
    await raf();
    // A floating proxy should now exist.
    expect(document.querySelector('.jects-grid-rowdrag-proxy')).toBeTruthy();

    // Move over the lower half of Row 3 → drop "after" it.
    pointer('pointermove', to.x, to.y + 8, document);
    await raf();
    // A drop indicator should be visible in the grid.
    const indicator = host1.querySelector<HTMLElement>('.jects-grid-rowdrag-indicator');
    expect(indicator).toBeTruthy();
    expect(indicator!.hidden).toBe(false);

    pointer('pointerup', to.x, to.y + 8, document);
    await raf();

    // Row 0 ("Row 0") should now sit after the old Row 3.
    const order = g.store.toArray().map((r) => r.name);
    expect(order.indexOf('Row 0')).toBeGreaterThan(order.indexOf('Row 3'));
    // Drag chrome cleaned up.
    expect(document.querySelector('.jects-grid-rowdrag-proxy')).toBeNull();

    g.destroy();
  });

  it('transfers a row from one grid to another (cross-grid)', async () => {
    const g1 = new Grid<Row>(host1, {
      data: rows('A', 4, 0),
      columns,
      rowHeight: 36,
      plugins: [rowReorderFeature<Row>({ group: 'shared' })],
    });
    const g2 = new Grid<Row>(host2, {
      data: rows('B', 4, 100),
      columns,
      rowHeight: 36,
      plugins: [rowReorderFeature<Row>({ group: 'shared' })],
    });
    g1.refresh();
    g2.refresh();
    await raf();

    const src = rowByIndex(host1, 1); // "A 1"
    const tgt = rowByIndex(host2, 0); // first row of grid 2
    const from = center(src);
    const to = center(tgt);

    pointer('pointerdown', from.x, from.y, src);
    pointer('pointermove', from.x + 6, from.y, document);
    await raf();
    // Move over grid 2 → its indicator should show.
    pointer('pointermove', to.x, to.y - 4, document);
    await raf();
    expect(host2.querySelector('.jects-grid-rowdrag-indicator')?.hasAttribute('hidden')).not.toBe(
      true,
    );

    pointer('pointerup', to.x, to.y - 4, document);
    await raf();

    const g1names = g1.store.toArray().map((r) => r.name);
    const g2names = g2.store.toArray().map((r) => r.name);
    expect(g1names).not.toContain('A 1'); // left the source
    expect(g2names).toContain('A 1'); // landed in the target

    g1.destroy();
    g2.destroy();
  });

  it('has no serious/critical a11y violations with the feature installed', async () => {
    const g = new Grid<Row>(host1, {
      data: rows('Row', 8),
      columns,
      rowHeight: 32,
      plugins: [new RowReorderFeature<Row>()],
    });
    g.refresh();
    await raf();
    await expectNoA11yViolations(host1);
    g.destroy();
  });
});
