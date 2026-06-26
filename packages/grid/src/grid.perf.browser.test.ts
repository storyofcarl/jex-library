/**
 * Performance smoke test (real Chromium). NOT a benchmark — a deterministic
 * guard that virtualization actually virtualizes:
 *
 *   - mount a Grid with 50,000 rows × ~10 columns and assert it renders at all,
 *   - assert only a small windowed subset of `.jects-grid__row` nodes exists in
 *     the DOM (well under 100, not 50k), proving the DOM recycler is engaged,
 *   - assert a programmatic scroll moves the rendered window (different row
 *     indices are painted; the original top rows are no longer in the DOM).
 *
 * Determinism: fixed viewport size, fixed `rowHeight`, virtualization overscan
 * pinned, and every assertion runs after a flushed `requestAnimationFrame`
 * (the Grid repaints on rAF) — no timers, no layout races.
 */
import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import '@jects/theme/style.css';
import './styles.css';
import { Grid } from './engine/grid.js';
import type { ColumnDef } from './contract.js';

interface Row {
  id: number;
  c0: string;
  c1: number;
  c2: string;
  c3: number;
  c4: string;
  c5: number;
  c6: string;
  c7: number;
  c8: string;
}

const ROW_COUNT = 50_000;
const ROW_HEIGHT = 32;
const VIEWPORT_HEIGHT = 480; // ~15 rows visible
const OVERSCAN = 4;

// 10 columns: 1 id + c0..c8.
const columns: ColumnDef<Row>[] = [
  { field: 'id', header: 'ID', type: 'number', width: 80 },
  ...Array.from({ length: 9 }, (_, i) => ({
    field: `c${i}` as keyof Row & string,
    header: `Col ${i}`,
    width: 120,
  })),
];

function rows(n: number): Row[] {
  const out: Row[] = new Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = {
      id: i,
      c0: `r${i}-0`,
      c1: i,
      c2: `r${i}-2`,
      c3: i * 2,
      c4: `r${i}-4`,
      c5: i * 3,
      c6: `r${i}-6`,
      c7: i * 4,
      c8: `r${i}-8`,
    };
  }
  return out;
}

/** Resolve after the next animation frame so the Grid's rAF repaint has run. */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/** Absolute row indices currently painted in the DOM (visible rows only). */
function paintedRowIndices(root: HTMLElement): number[] {
  return Array.from(root.querySelectorAll<HTMLElement>('.jects-grid__row'))
    .filter((el) => !el.hidden)
    .map((el) => Number(el.dataset['rowIndex']))
    .filter((n) => !Number.isNaN(n))
    .sort((a, b) => a - b);
}

let host: HTMLElement;
beforeEach(() => {
  host = document.createElement('div');
  host.style.width = '640px';
  host.style.height = `${VIEWPORT_HEIGHT}px`;
  // The Grid measures the scroller; give the page a stable, real layout box.
  host.style.position = 'absolute';
  host.style.top = '0';
  host.style.left = '0';
  document.body.appendChild(host);
});
afterEach(() => host.remove());

describe('Grid performance smoke (50k rows × 10 cols)', () => {
  it('mounts 50,000 rows without error and reports the full row count', async () => {
    const g = new Grid<Row>(host, {
      data: rows(ROW_COUNT),
      columns,
      rowHeight: ROW_HEIGHT,
      virtualization: { enabled: true, overscan: OVERSCAN },
    });
    await nextFrame();

    const root = host.querySelector('.jects-grid') as HTMLElement;
    expect(root).toBeTruthy();
    // The engine knows about all 50k rows even though only a window is painted.
    expect(g.getRowCount()).toBe(ROW_COUNT);
    // The spacer is sized to the full scroll height (drives the native
    // scrollbar). NB: large px values serialize in exponential form
    // (e.g. "1.6e+06px"), so parse with parseFloat, not parseInt.
    const spacer = root.querySelector<HTMLElement>('.jects-grid__spacer')!;
    expect(parseFloat(spacer.style.height)).toBe(ROW_COUNT * ROW_HEIGHT);

    g.destroy();
  });

  it('only a small windowed subset of row nodes exists in the DOM', async () => {
    const g = new Grid<Row>(host, {
      data: rows(ROW_COUNT),
      columns,
      rowHeight: ROW_HEIGHT,
      virtualization: { enabled: true, overscan: OVERSCAN },
    });
    await nextFrame();

    const root = host.querySelector('.jects-grid') as HTMLElement;
    const painted = paintedRowIndices(root);

    // Virtualization working: far fewer than 50k rows, and indeed < 100.
    expect(painted.length).toBeGreaterThan(0);
    expect(painted.length).toBeLessThan(100);

    // The initial window starts at the top of the dataset.
    expect(painted[0]).toBe(0);

    // Total row nodes that were ever created (pool size) is also bounded — the
    // recycler never grows to anywhere near the dataset size.
    const allRowNodes = root.querySelectorAll('.jects-grid__row').length;
    expect(allRowNodes).toBeLessThan(100);

    g.destroy();
  });

  it('programmatic scroll moves the rendered window', async () => {
    const g = new Grid<Row>(host, {
      data: rows(ROW_COUNT),
      columns,
      rowHeight: ROW_HEIGHT,
      virtualization: { enabled: true, overscan: OVERSCAN },
    });
    await nextFrame();

    const root = host.querySelector('.jects-grid') as HTMLElement;
    const before = paintedRowIndices(root);
    expect(before[0]).toBe(0);

    // Scroll far down: row 40,000 lives at 40000 * 32 = 1,280,000px.
    const targetRow = 40_000;
    g.viewport.scrollTo({ top: targetRow * ROW_HEIGHT });
    await nextFrame();

    const after = paintedRowIndices(root);

    // Still windowed after the jump (recycler did not balloon).
    expect(after.length).toBeGreaterThan(0);
    expect(after.length).toBeLessThan(100);

    // The window actually moved: the new first painted index is near the target
    // and the original top rows are no longer in the DOM.
    expect(after[0]).toBeGreaterThan(before[before.length - 1]!);
    expect(after).toContain(targetRow);
    expect(after).not.toContain(0);

    // The viewport reflects the new scroll position.
    expect(g.viewport.scrollTop).toBe(targetRow * ROW_HEIGHT);

    g.destroy();
  });

  it('scrolling back to the top restores the initial window', async () => {
    const g = new Grid<Row>(host, {
      data: rows(ROW_COUNT),
      columns,
      rowHeight: ROW_HEIGHT,
      virtualization: { enabled: true, overscan: OVERSCAN },
    });
    await nextFrame();

    const root = host.querySelector('.jects-grid') as HTMLElement;

    g.viewport.scrollTo({ top: 25_000 * ROW_HEIGHT });
    await nextFrame();
    expect(paintedRowIndices(root)).not.toContain(0);

    g.viewport.scrollTo({ top: 0 });
    await nextFrame();
    const back = paintedRowIndices(root);
    expect(back[0]).toBe(0);
    expect(back.length).toBeLessThan(100);

    g.destroy();
  });
});
