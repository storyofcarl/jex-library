/** jsdom unit tests for QuickSearchFeature (search + highlight + navigation). */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ColumnDef } from '../contract.js';
import { QuickSearchFeature } from './quick-search.js';
import { FilterFeature } from './filter.js';
import { makeHarness, makeStore, type FeatureHarness } from './test-harness.js';

interface Row {
  id: number;
  name: string;
  city: string;
}

const ROWS: Row[] = [
  { id: 1, name: 'Alice', city: 'Paris' },
  { id: 2, name: 'Bob', city: 'Berlin' },
  { id: 3, name: 'Carol', city: 'Madrid' },
  { id: 4, name: 'Dave', city: 'Barcelona' },
];

const COLUMNS: ColumnDef<Row>[] = [
  { field: 'name', header: 'Name' },
  { field: 'city', header: 'City' },
];

let h: FeatureHarness<Row>;
beforeEach(() => {
  h = makeHarness<Row>({ store: makeStore(ROWS), columns: COLUMNS });
});
afterEach(() => h.destroy());

describe('QuickSearchFeature (jsdom)', () => {
  it('filters to rows matching across all columns', () => {
    const f = h.api.use(new QuickSearchFeature<Row>()) as QuickSearchFeature<Row>;
    f.search('bar'); // matches "Barcelona"
    expect(h.api.getRowCount()).toBe(1);
    expect(h.api.getRow(0)!.id).toBe(4);
  });

  it('is case-insensitive by default', () => {
    const f = h.api.use(new QuickSearchFeature<Row>()) as QuickSearchFeature<Row>;
    f.search('ALICE');
    expect(h.api.getRowCount()).toBe(1);
  });

  it('clears when query is empty', () => {
    const f = h.api.use(new QuickSearchFeature<Row>()) as QuickSearchFeature<Row>;
    f.search('a');
    expect(h.api.getRowCount()).toBeLessThan(4);
    f.search('');
    expect(h.api.getRowCount()).toBe(4);
    expect(f.isActive()).toBe(false);
  });

  it('limits search to configured columns', () => {
    const f = h.api.use(
      new QuickSearchFeature<Row>({ columns: ['name'] }),
    ) as QuickSearchFeature<Row>;
    f.search('Paris'); // only in city, which is excluded
    expect(h.api.getRowCount()).toBe(0);
  });

  it('highlight wraps matches in a mark, escaping the rest', () => {
    const f = h.api.use(new QuickSearchFeature<Row>()) as QuickSearchFeature<Row>;
    f.search('ar');
    const html = f.highlight('Barcelona');
    expect(html).toBe('B<mark class="jects-grid-search__hl">ar</mark>celona');
  });

  it('highlight escapes HTML in non-matched text', () => {
    const f = h.api.use(new QuickSearchFeature<Row>()) as QuickSearchFeature<Row>;
    f.search('x');
    expect(f.highlight('a<b>')).toBe('a&lt;b&gt;');
  });

  it('next / prev cycle through matches and scroll into view', () => {
    const f = h.api.use(
      new QuickSearchFeature<Row>({ filterRows: false }),
    ) as QuickSearchFeature<Row>;
    f.search('a'); // Alice, Carol, Dave, Barcelona-row(Dave already), Paris(Alice)
    expect(f.matchCount()).toBeGreaterThan(1);
    const first = f.currentMatch();
    const second = f.next();
    expect(second).not.toBe(first);
    expect(h.scrolledRows().length).toBeGreaterThan(0);
    const back = f.prev();
    expect(back).toBe(first);
  });

  it('matchesCell reports per-value matches', () => {
    const f = h.api.use(new QuickSearchFeature<Row>()) as QuickSearchFeature<Row>;
    f.search('par');
    expect(f.matchesCell('Paris')).toBe(true);
    expect(f.matchesCell('Berlin')).toBe(false);
  });

  it('emits an honest quickSearchChange on search (NOT a fake empty filterChange)', () => {
    const f = h.api.use(new QuickSearchFeature<Row>()) as QuickSearchFeature<Row>;
    const qsSpy = vi.fn();
    const filterSpy = vi.fn();
    h.api.on('quickSearchChange', qsSpy);
    h.api.on('filterChange', filterSpy);
    f.search('bob');
    // The dedicated event fires with the REAL query + match count …
    expect(qsSpy).toHaveBeenCalledWith({ query: 'bob', active: true, matches: 1 });
    // … and the dishonest synthetic filterChange (with an empty filter) is gone.
    expect(filterSpy).not.toHaveBeenCalled();
  });

  it('does not clobber a FilterFeature column filter (filters AND-compose)', () => {
    const filter = h.api.use(new FilterFeature<Row>()) as FilterFeature<Row>;
    // Column filter: city contains "ar" → Paris (id 1), Barcelona (id 4).
    filter.setColumnFilter('city', 'contains', 'ar');
    expect(h.api.getRowCount()).toBe(2);

    const qs = h.api.use(new QuickSearchFeature<Row>()) as QuickSearchFeature<Row>;
    // Search "bar" → only Barcelona row (id 4); the city filter must survive.
    qs.search('bar');
    expect(h.api.getRowCount()).toBe(1);
    expect(h.api.getRow(0)!.id).toBe(4);

    // Clearing the search restores the column-filtered view (not the full set).
    qs.search('');
    expect(h.api.getRowCount()).toBe(2);
    expect(filter.isActive('city')).toBe(true);
  });

  it('removes only its own predicate on destroy, leaving column filters intact', () => {
    const filter = h.api.use(new FilterFeature<Row>()) as FilterFeature<Row>;
    filter.setColumnFilter('city', 'contains', 'ar'); // → ids 1, 4
    const qs = h.api.use(new QuickSearchFeature<Row>()) as QuickSearchFeature<Row>;
    qs.search('bar'); // → id 4 only
    expect(h.api.getRowCount()).toBe(1);
    h.api.removeFeature('quickSearch');
    expect(h.api.getRowCount()).toBe(2); // city filter survives
  });
});
