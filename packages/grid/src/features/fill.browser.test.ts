/**
 * Real-Chromium a11y + interaction test for FillFeature (range fill / fill handle).
 *
 * Mounts a real Grid in `range` selection mode, installs the feature, and verifies:
 *   - the fill handle is injected with a button role + accessible name and the
 *     mounted grid has no serious/critical axe violations with the feature present;
 *   - a real pointer drag from the handle's corner down the column extends the
 *     source value across the swept cells (and continues a numeric series),
 *     committing through `store.update` and firing `fill`;
 *   - keyboard ArrowDown + Enter on the focused handle fills down one cell.
 */
import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import '@jects/theme/style.css';
import '../styles.css';
import './fill.css';
import { Grid } from '../engine/grid.js';
import type { CellAddress, ColumnDef } from '../contract.js';
import { FillFeature, type FillEvent } from './fill.js';
import { expectNoA11yViolations } from '../test-utils/a11y.js';

interface Row {
  id: number;
  n: number;
  label: string;
}

const cols: ColumnDef<Row>[] = [
  { field: 'n', header: 'N', type: 'number', width: 120 },
  { field: 'label', header: 'Label', width: 200 },
];

function rows(n: number): Row[] {
  return Array.from({ length: n }, (_, i) => ({ id: i + 1, n: 0, label: '' }));
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

let host: HTMLElement;
beforeEach(() => {
  host = document.createElement('div');
  host.style.width = '420px';
  host.style.height = '320px';
  host.style.position = 'absolute';
  host.style.top = '0';
  host.style.left = '0';
  document.body.appendChild(host);
});
afterEach(() => host.remove());

/** Drive the engine selection to a cell rectangle (range mode). */
function selectRange(g: Grid<Row>, from: CellAddress, to: CellAddress): void {
  (g.selection as unknown as { selectRange(a: CellAddress, b: CellAddress): void }).selectRange(
    from,
    to,
  );
}

describe('FillFeature (Chromium)', () => {
  it('injects an accessible fill handle and stays axe-clean', async () => {
    const g = new Grid<Row>(host, { data: rows(20), columns: cols, selection: 'range', rowHeight: 28 });
    g.use(new FillFeature<Row>());
    selectRange(g, { rowIndex: 0, colIndex: 0 }, { rowIndex: 0, colIndex: 0 });
    g.refresh();
    await nextFrame();

    const handle = document.querySelector('[data-fill-handle]') as HTMLElement;
    expect(handle).toBeTruthy();
    expect(handle.getAttribute('role')).toBe('button');
    expect(handle.getAttribute('aria-label')).toBeTruthy();
    expect(handle.tabIndex).toBe(0);

    // The orphaned-handle a11y fix: the handle is aria-tied to the active cell so
    // AT announces it with positional context (not as a stray body child).
    const describedBy = handle.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    const ownerCell = document.getElementById(describedBy!);
    expect(ownerCell?.classList.contains('jects-grid__cell')).toBe(true);
    expect(ownerCell?.getAttribute('aria-owns')).toBe(handle.id);

    await expectNoA11yViolations(host);
    g.destroy();
  });

  it('pointer drag from the handle series-fills the numeric column down', async () => {
    const g = new Grid<Row>(host, { data: rows(20), columns: cols, selection: 'range', rowHeight: 28 });
    g.use(new FillFeature<Row>());
    // Seed a 2-cell numeric source: 2, 4 → series step 2.
    g.store.update(1, { n: 2 });
    g.store.update(2, { n: 4 });
    selectRange(g, { rowIndex: 0, colIndex: 0 }, { rowIndex: 1, colIndex: 0 });
    g.refresh();
    await nextFrame();

    const events: FillEvent[] = [];
    g.on('fill', (e) => events.push(e));

    const handle = document.querySelector('[data-fill-handle]') as HTMLElement;
    const hRect = handle.getBoundingClientRect();
    const startX = hRect.left + hRect.width / 2;
    const startY = hRect.top + hRect.height / 2;

    // Resolve the drop point: row index 4, column 0 cell center.
    const dropCell = host.querySelector(
      '.jects-grid__row[data-row-index="4"] .jects-grid__cell[data-col-index="0"]',
    ) as HTMLElement;
    const dRect = dropCell.getBoundingClientRect();
    const dropX = dRect.left + dRect.width / 2;
    const dropY = dRect.top + dRect.height / 2;

    const opts = (x: number, y: number): PointerEventInit => ({
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
      pointerId: 1,
      pointerType: 'mouse',
    });
    handle.dispatchEvent(new PointerEvent('pointerdown', opts(startX, startY)));
    window.dispatchEvent(new PointerEvent('pointermove', opts(dropX, dropY)));
    window.dispatchEvent(new PointerEvent('pointerup', opts(dropX, dropY)));

    // Rows 3..5 (1-based ids 3,4,5) continue the +2 series: 6, 8, 10.
    expect(g.store.getById(3)!.n).toBe(6);
    expect(g.store.getById(4)!.n).toBe(8);
    expect(g.store.getById(5)!.n).toBe(10);
    expect(events).toHaveLength(1);
    expect(events[0]!.kind).toBe('series');

    g.destroy();
  });

  it('keyboard ArrowDown + Enter on the focused handle fills down', async () => {
    const g = new Grid<Row>(host, { data: rows(20), columns: cols, selection: 'range', rowHeight: 28 });
    g.use(new FillFeature<Row>());
    g.store.update(1, { label: 'Z' });
    selectRange(g, { rowIndex: 0, colIndex: 1 }, { rowIndex: 0, colIndex: 1 });
    g.refresh();
    await nextFrame();

    const handle = document.querySelector('[data-fill-handle]') as HTMLElement;
    handle.focus();
    handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(g.store.getById(2)!.label).toBe('Z');
    expect(g.store.getById(3)!.label).toBe('Z');
    g.destroy();
  });
});
