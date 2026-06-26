/**
 * Header/body alignment regression test (real Chromium) — GALLERY-FEEDBACK #2.
 *
 * The bug: on a container resize the grid's ResizeObserver re-measured the
 * viewport and repainted ONLY the body (`renderViewport`). Flex columns derive
 * their pixel widths from the available width, so after a width change the body
 * cells re-flowed to new widths while the header kept its mount-time widths —
 * the two drifted out of horizontal alignment.
 *
 * The fix: the ResizeObserver callback now re-renders the header too whenever
 * the measured size actually changed the layout, so header and body columns stay
 * pixel-aligned.
 *
 * This test mounts a grid with FLEX columns in a fixed-width host, then changes
 * the host width to force a resize, and asserts each header cell's
 * offsetLeft/offsetWidth matches the corresponding body cell's after the resize.
 */
import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import '@jects/theme/style.css';
import './styles.css';
import { Grid } from './engine/grid.js';
import type { ColumnDef } from './contract.js';

interface Row {
  id: number;
  name: string;
  email: string;
  role: string;
}

// All flex columns: their resolved widths depend on the container width, so a
// resize necessarily re-flows them. (A fixed-width column would be unaffected by
// a resize and would not exercise the bug.)
const columns: ColumnDef<Row>[] = [
  { field: 'name', header: 'Name', flex: 1 },
  { field: 'email', header: 'Email', flex: 2 },
  { field: 'role', header: 'Role', flex: 1 },
];

function rows(n: number): Row[] {
  return Array.from({ length: n }, (_, i) => ({
    id: i,
    name: `Name ${i}`,
    email: `user${i}@example.com`,
    role: i % 2 === 0 ? 'admin' : 'user',
  }));
}

/** Resolve after the next animation frame so the Grid's rAF repaint has run. */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/**
 * Wait for the ResizeObserver to fire AND the resulting rAF paint to flush.
 * ResizeObserver delivers its callback before paint, which schedules a rAF; we
 * settle a few frames to be safe and deterministic.
 */
async function settle(): Promise<void> {
  // ResizeObserver notification + the rerenderHeader()/scheduleRefresh() rAF.
  await nextFrame();
  await nextFrame();
  await nextFrame();
}

/** offsetLeft/offsetWidth for each header cell, keyed by colIndex. */
function headerGeom(root: HTMLElement): Map<number, { left: number; width: number }> {
  const out = new Map<number, { left: number; width: number }>();
  root.querySelectorAll<HTMLElement>('.jects-grid__header-cell').forEach((cell) => {
    const idx = Number(cell.dataset['colIndex']);
    if (Number.isNaN(idx)) return;
    out.set(idx, { left: cell.offsetLeft, width: cell.offsetWidth });
  });
  return out;
}

/** offsetLeft/offsetWidth for each cell of the first painted body row. */
function bodyGeom(root: HTMLElement): Map<number, { left: number; width: number }> {
  const out = new Map<number, { left: number; width: number }>();
  const firstRow = Array.from(root.querySelectorAll<HTMLElement>('.jects-grid__row')).find(
    (el) => !el.hidden,
  );
  if (!firstRow) return out;
  firstRow.querySelectorAll<HTMLElement>('.jects-grid__cell').forEach((cell) => {
    if (cell.hidden) return;
    const idx = Number(cell.dataset['colIndex']);
    if (Number.isNaN(idx)) return;
    out.set(idx, { left: cell.offsetLeft, width: cell.offsetWidth });
  });
  return out;
}

/** Assert every header cell aligns with the matching body cell (within 1px). */
function expectAligned(root: HTMLElement): void {
  const header = headerGeom(root);
  const body = bodyGeom(root);
  expect(header.size).toBeGreaterThan(0);
  expect(body.size).toBe(header.size);
  for (const [idx, h] of header) {
    const b = body.get(idx);
    expect(b, `body cell for column ${idx} should exist`).toBeTruthy();
    // offsetLeft/offsetWidth are integers; allow a 1px rounding tolerance.
    expect(Math.abs(h.left - b!.left), `column ${idx} left drift`).toBeLessThanOrEqual(1);
    expect(Math.abs(h.width - b!.width), `column ${idx} width drift`).toBeLessThanOrEqual(1);
  }
}

let host: HTMLElement;
beforeEach(() => {
  host = document.createElement('div');
  host.style.width = '800px';
  host.style.height = '320px';
  host.style.position = 'absolute';
  host.style.top = '0';
  host.style.left = '0';
  document.body.appendChild(host);
});
afterEach(() => host.remove());

describe('Grid header/body alignment on container resize', () => {
  it('header columns stay aligned with body columns after the host widens', async () => {
    const g = new Grid<Row>(host, {
      data: rows(20),
      columns,
      rowHeight: 32,
    });
    await nextFrame();

    const root = host.querySelector('.jects-grid') as HTMLElement;
    expect(root).toBeTruthy();
    // Aligned at mount.
    expectAligned(root);

    // Force a resize: widen the host so flex columns must re-flow.
    host.style.width = '1200px';
    await settle();

    // Alignment must hold after the resize (the header was re-rendered).
    expectAligned(root);

    g.destroy();
  });

  it('header columns stay aligned with body columns after the host narrows', async () => {
    const g = new Grid<Row>(host, {
      data: rows(20),
      columns,
      rowHeight: 32,
    });
    await nextFrame();

    const root = host.querySelector('.jects-grid') as HTMLElement;
    expectAligned(root);

    // Narrow the host (flex columns shrink toward their minimum widths).
    host.style.width = '500px';
    await settle();

    expectAligned(root);

    g.destroy();
  });

  it('header column widths actually change on resize (proving the bug surface)', async () => {
    const g = new Grid<Row>(host, {
      data: rows(20),
      columns,
      rowHeight: 32,
    });
    await nextFrame();

    const root = host.querySelector('.jects-grid') as HTMLElement;
    const before = headerGeom(root);

    host.style.width = '1200px';
    await settle();

    const after = headerGeom(root);
    // At least one flex column must have widened — otherwise the resize did not
    // exercise the re-flow this test is guarding.
    let widened = false;
    for (const [idx, b] of before) {
      const a = after.get(idx);
      if (a && a.width > b.width + 1) widened = true;
    }
    expect(widened, 'a flex column should widen when the host widens').toBe(true);

    // And it remains aligned with the body after that change.
    expectAligned(root);

    g.destroy();
  });
});
