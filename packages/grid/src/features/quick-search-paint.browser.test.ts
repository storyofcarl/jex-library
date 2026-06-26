/**
 * Real-Chromium a11y + visual test for QuickFind highlight wiring.
 *
 * Mounts a real Grid, installs `QuickSearchFeature`, runs a search, and verifies
 * the DomRenderer paints inline `<mark>` highlights into the default text cells
 * (the gap this feature closes) — then asserts the grid stays axe-clean with the
 * highlight markup present, and that clearing the search removes every mark.
 */
import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import '@jects/theme/style.css';
import '../styles.css';
import '../engine/grid.css';
import './features.css';
import { Grid } from '../engine/grid.js';
import type { ColumnDef } from '../contract.js';
import { QuickSearchFeature } from './quick-search.js';
import { FilterFeature } from './filter.js';
import { SEARCH_MATCH_CELL_CLASS } from './quick-search-paint.js';
import { expectNoA11yViolations } from '../test-utils/a11y.js';

interface Row {
  id: number;
  name: string;
  city: string;
}

const cols: ColumnDef<Row>[] = [
  { field: 'name', header: 'Name', width: 160 },
  { field: 'city', header: 'City', width: 160 },
];

const data: Row[] = [
  { id: 1, name: 'Alice', city: 'Paris' },
  { id: 2, name: 'Bob', city: 'Berlin' },
  { id: 3, name: 'Carol', city: 'Barcelona' },
  { id: 4, name: 'Dave', city: 'Madrid' },
];

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

let host: HTMLElement;
beforeEach(() => {
  host = document.createElement('div');
  host.style.width = '380px';
  host.style.height = '260px';
  host.style.position = 'absolute';
  host.style.top = '0';
  host.style.left = '0';
  document.body.appendChild(host);
});
afterEach(() => host.remove());

describe('QuickFind highlight (Chromium)', () => {
  it('paints inline marks into default cells and stays axe-clean', async () => {
    const g = new Grid<Row>(host, { data, columns: cols, rowHeight: 30 });
    const search = g.use(new QuickSearchFeature<Row>({ filterRows: false }));
    (search as QuickSearchFeature<Row>).search('bar'); // matches "Barcelona"
    g.refresh();
    await nextFrame();

    const marks = host.querySelectorAll('mark.jects-grid-search__hl');
    expect(marks.length).toBeGreaterThanOrEqual(1);
    const matched = Array.from(marks).map((m) => m.textContent?.toLowerCase());
    expect(matched.every((t) => t === 'bar')).toBe(true);

    // The matched cell is tagged for whole-cell styling.
    const matchCell = host.querySelector(`.${SEARCH_MATCH_CELL_CLASS}`);
    expect(matchCell).toBeTruthy();
    expect(matchCell!.textContent).toBe('Barcelona');

    // The highlight mark must be visibly tinted (token-driven background), not
    // transparent — proves the CSS landed and renders.
    const markBg = getComputedStyle(marks[0] as HTMLElement).backgroundColor;
    expect(markBg).not.toBe('rgba(0, 0, 0, 0)');
    expect(markBg).not.toBe('transparent');

    await expectNoA11yViolations(host);
    g.destroy();
  });

  it('highlights only the matched substring, leaving surrounding text plain', async () => {
    const g = new Grid<Row>(host, { data, columns: cols, rowHeight: 30 });
    const search = g.use(new QuickSearchFeature<Row>({ filterRows: false }));
    (search as QuickSearchFeature<Row>).search('lic'); // inside "Alice"
    g.refresh();
    await nextFrame();

    const mark = host.querySelector('mark.jects-grid-search__hl');
    expect(mark).toBeTruthy();
    expect(mark!.textContent).toBe('lic');
    const cell = mark!.closest('.jects-grid__cell') as HTMLElement;
    expect(cell.textContent).toBe('Alice');
    g.destroy();
  });

  it('removes every highlight when the search is cleared', async () => {
    const g = new Grid<Row>(host, { data, columns: cols, rowHeight: 30 });
    const search = g.use(new QuickSearchFeature<Row>({ filterRows: false }));
    (search as QuickSearchFeature<Row>).search('ar');
    g.refresh();
    await nextFrame();
    expect(host.querySelector('mark.jects-grid-search__hl')).toBeTruthy();

    (search as QuickSearchFeature<Row>).clear();
    g.refresh();
    await nextFrame();
    expect(host.querySelector('mark.jects-grid-search__hl')).toBeNull();
    expect(host.querySelector(`.${SEARCH_MATCH_CELL_CLASS}`)).toBeNull();

    await expectNoA11yViolations(host);
    g.destroy();
  });
});

describe('QuickSearch + Filter composition (Chromium)', () => {
  it('search composes with a column filter instead of clobbering it', async () => {
    const g = new Grid<Row>(host, { data, columns: cols, rowHeight: 30 });
    const filter = g.use(new FilterFeature<Row>()) as FilterFeature<Row>;
    const search = g.use(new QuickSearchFeature<Row>()) as QuickSearchFeature<Row>;

    // Column filter: city contains "ar" → Paris (1), Barcelona (3).
    filter.setColumnFilter('city', 'contains', 'ar');
    g.refresh();
    await nextFrame();
    expect(g.getRowCount()).toBe(2);

    // Honest event payload (no synthetic empty filterChange).
    let lastQs: { query: string; active: boolean; matches: number } | null = null;
    let filterChanges = 0;
    g.on('quickSearchChange', (e) => {
      lastQs = e;
    });
    g.on('filterChange', () => {
      filterChanges++;
    });

    // Search "bar" → only Barcelona (3); the city filter must survive.
    search.search('bar');
    g.refresh();
    await nextFrame();
    expect(g.getRowCount()).toBe(1);
    expect(g.getRow(0)!.id).toBe(3);
    expect(lastQs).toEqual({ query: 'bar', active: true, matches: 1 });
    // The dishonest synthetic filterChange is gone — the search emits its own event.
    expect(filterChanges).toBe(0);

    // Clearing the search restores the column-filtered view (not the full set).
    search.search('');
    g.refresh();
    await nextFrame();
    expect(g.getRowCount()).toBe(2);
    expect(filter.isActive('city')).toBe(true);

    await expectNoA11yViolations(host);
    g.destroy();
  });
});
