/**
 * Real-Chromium a11y + interaction test for InfiniteLoadFeature.
 *
 * Mounts a real virtualized Grid over an empty Store, installs the feature with
 * a delayed range-loader, and verifies the full load-on-demand loop against a
 * browser engine (jsdom lies about layout/scroll, so this MUST run in Chromium):
 *
 *   - the virtual list is sized to `totalCount`: the scrollable body height
 *     reflects all rows even though almost none are fetched;
 *   - not-yet-loaded rows paint as skeleton placeholders carrying
 *     `.jects-grid__row--loading` + `aria-busy`, and the grid is axe-clean in
 *     that loading state (the busy rows must not introduce a11y violations);
 *   - after the first page resolves those rows lose the loading state and show
 *     real data;
 *   - scrolling deep into the list triggers a prefetch of the approached page,
 *     whose rows then become real data — and the grid is axe-clean afterwards.
 */
import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import '@jects/theme/style.css';
import '../styles.css';
import { Store } from '@jects/core';
import { Grid } from '../engine/grid.js';
import type { ColumnDef } from '../contract.js';
import { InfiniteLoadFeature, type RangeRequest } from './infinite-load.js';
import { expectNoA11yViolations } from '../test-utils/a11y.js';

interface Row {
  id: number;
  name: string;
  city: string;
}

const cols: ColumnDef<Row>[] = [
  { field: 'id', header: 'ID', width: 80 },
  { field: 'name', header: 'Name', width: 220 },
  { field: 'city', header: 'City', width: 180 },
];

const CITIES = ['Paris', 'Berlin', 'Madrid', 'Rome', 'Lisbon'];

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A range-loader that answers after a short delay, like a real server. */
function makeLoader(latency = 10) {
  const seen: RangeRequest[] = [];
  const load = async (req: RangeRequest) => {
    seen.push(req);
    await delay(latency);
    const rows: Row[] = [];
    for (let i = req.start; i < req.end; i++) {
      rows.push({ id: i, name: `Person ${i}`, city: CITIES[i % CITIES.length]! });
    }
    return { rows };
  };
  return { load, seen };
}

function paintedRows(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('.jects-grid__row')).filter((r) => !r.hidden);
}

let host: HTMLElement;
beforeEach(() => {
  host = document.createElement('div');
  host.style.width = '520px';
  host.style.height = '320px';
  host.style.position = 'absolute';
  host.style.top = '0';
  host.style.left = '0';
  document.body.appendChild(host);
});
afterEach(() => host.remove());

describe('InfiniteLoadFeature (Chromium)', () => {
  it('sizes the virtual list and paints axe-clean skeleton placeholders', async () => {
    const store = new Store<Row>({ data: [], idField: 'id' });
    const { load } = makeLoader(40);
    const g = new Grid<Row>(host, { data: store, columns: cols, rowHeight: 32 });
    g.use(
      new InfiniteLoadFeature<Row>({
        totalCount: 5000,
        pageSize: 100,
        autoLoad: false, // keep everything a placeholder for this assertion
        loadRange: load,
      }),
    );
    g.refresh();
    await nextFrame();
    await nextFrame();

    // Virtual list spans all 5000 rows: the scroll spacer height ≈ 5000 * 32.
    const spacer = host.querySelector('.jects-grid__spacer') as HTMLElement;
    expect(spacer.getBoundingClientRect().height).toBeGreaterThan(5000 * 32 * 0.9);

    // Painted rows are skeleton placeholders.
    const root = host.querySelector('.jects-grid') as HTMLElement;
    const painted = paintedRows(root);
    expect(painted.length).toBeGreaterThan(0);
    const loadingRows = painted.filter((r) => r.classList.contains('jects-grid__row--loading'));
    expect(loadingRows.length).toBeGreaterThan(0);
    expect(loadingRows[0]!.getAttribute('aria-busy')).toBe('true');

    // Busy/loading rows must not introduce a11y violations.
    await expectNoA11yViolations(host);
    g.destroy();
  });

  it('auto-loads the first page and replaces placeholders with real data', async () => {
    const store = new Store<Row>({ data: [], idField: 'id' });
    const { load, seen } = makeLoader(10);
    const g = new Grid<Row>(host, { data: store, columns: cols, rowHeight: 32 });
    const f = g.use(
      new InfiniteLoadFeature<Row>({ totalCount: 5000, pageSize: 100, loadRange: load }),
    ) as InfiniteLoadFeature<Row>;
    g.refresh();
    await nextFrame();

    // Wait for the first page to resolve + repaint.
    await delay(40);
    await nextFrame();
    await nextFrame();

    expect(seen.some((r) => r.page === 0)).toBe(true);
    expect(f.isLoaded(0)).toBe(true);

    const root = host.querySelector('.jects-grid') as HTMLElement;
    const top = paintedRows(root).find((r) => r.dataset['rowIndex'] === '0')!;
    expect(top.classList.contains('jects-grid__row--loading')).toBe(false);
    expect(top.textContent).toContain('Person 0');

    await expectNoA11yViolations(host);
    g.destroy();
  });

  it('prefetches and fills the page a deep scroll approaches', async () => {
    const store = new Store<Row>({ data: [], idField: 'id' });
    const { load, seen } = makeLoader(10);
    const g = new Grid<Row>(host, { data: store, columns: cols, rowHeight: 32 });
    const f = g.use(
      new InfiniteLoadFeature<Row>({
        totalCount: 5000,
        pageSize: 100,
        prefetchThreshold: 30,
        loadRange: load,
      }),
    ) as InfiniteLoadFeature<Row>;
    g.refresh();
    await nextFrame();
    await delay(30);

    // Scroll deep: row ~1500 (index = 1500). Page 15 (rows 1500..1599).
    const scroller = host.querySelector('.jects-grid__scroller') as HTMLElement;
    scroller.scrollTop = 1500 * 32;
    scroller.dispatchEvent(new Event('scroll'));
    await nextFrame();
    await delay(40);
    await nextFrame();
    await nextFrame();

    expect(seen.some((r) => r.page === 15)).toBe(true);
    expect(f.isLoaded(1500)).toBe(true);

    const root = host.querySelector('.jects-grid') as HTMLElement;
    const painted = paintedRows(root).filter(
      (r) => !r.classList.contains('jects-grid__row--loading'),
    );
    expect(painted.length).toBeGreaterThan(0);
    expect(painted.some((r) => /Person 1\d\d\d/.test(r.textContent ?? ''))).toBe(true);

    await expectNoA11yViolations(host);
    g.destroy();
  });
});
