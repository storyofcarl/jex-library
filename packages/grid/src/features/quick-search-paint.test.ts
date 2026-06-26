/**
 * jsdom unit tests for the QuickSearch render hook (quick-search-paint.ts).
 *
 * Covers the pure helper surface (`isQuickSearchHighlighter`,
 * `getActiveQuickSearch`, `applyQuickSearchHighlight`) and an end-to-end path
 * through the real `DomRenderer.paintCell`, proving that with a `QuickSearch`
 * feature installed and active, default-rendered text cells receive inline
 * `<mark>` highlighting and the match class — and that the highlight is cleared
 * (recycling-safe) when the search is cleared or the cell stops matching.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Store, type Model } from '@jects/core';
import {
  applyQuickSearchHighlight,
  getActiveQuickSearch,
  isQuickSearchHighlighter,
  SEARCH_MATCH_CELL_CLASS,
  type QuickSearchHighlighter,
} from './quick-search-paint.js';
import { QuickSearchFeature } from './quick-search.js';
import { GridEngine } from '../engine/engine.js';
import { DomRenderer } from '../engine/dom-renderer.js';
import { DefaultSelectionModel } from '../engine/selection.js';
import type { ColumnDef, GridApi, GridFeature } from '../contract.js';

/* ── pure helper surface ──────────────────────────────────────────────── */

describe('quick-search-paint: helpers', () => {
  it('isQuickSearchHighlighter accepts a structurally-compatible object', () => {
    const ok: QuickSearchHighlighter = {
      isActive: () => true,
      matchesCell: () => true,
      highlight: (t) => t,
    };
    expect(isQuickSearchHighlighter(ok)).toBe(true);
    expect(isQuickSearchHighlighter(null)).toBe(false);
    expect(isQuickSearchHighlighter({})).toBe(false);
    expect(isQuickSearchHighlighter({ isActive: () => true })).toBe(false);
  });

  it('getActiveQuickSearch returns null when no features map present', () => {
    expect(getActiveQuickSearch({})).toBeNull();
    expect(getActiveQuickSearch({ features: undefined })).toBeNull();
  });

  it('getActiveQuickSearch returns null when the feature is inactive', () => {
    const feature: QuickSearchHighlighter = {
      isActive: () => false,
      matchesCell: () => false,
      highlight: (t) => t,
    };
    const features = new Map<string, GridFeature>([
      ['quickSearch', feature as unknown as GridFeature],
    ]);
    expect(getActiveQuickSearch({ features })).toBeNull();
  });

  it('getActiveQuickSearch returns the feature when active', () => {
    const feature: QuickSearchHighlighter = {
      isActive: () => true,
      matchesCell: () => true,
      highlight: (t) => t,
    };
    const features = new Map<string, GridFeature>([
      ['quickSearch', feature as unknown as GridFeature],
    ]);
    expect(getActiveQuickSearch({ features })).toBe(feature);
  });
});

describe('quick-search-paint: applyQuickSearchHighlight', () => {
  let cell: HTMLElement;
  beforeEach(() => {
    cell = document.createElement('div');
  });

  const activeOn = (needle: string): QuickSearchHighlighter => ({
    isActive: () => true,
    matchesCell: (v) => String(v).toLowerCase().includes(needle.toLowerCase()),
    highlight: (text) => {
      const at = text.toLowerCase().indexOf(needle.toLowerCase());
      if (at < 0) return text;
      return (
        text.slice(0, at) +
        `<mark class="jects-grid-search__hl">${text.slice(at, at + needle.length)}</mark>` +
        text.slice(at + needle.length)
      );
    },
  });

  it('is a no-op (returns false) when search is null', () => {
    cell.textContent = 'Barcelona';
    expect(applyQuickSearchHighlight(cell, 'Barcelona', null)).toBe(false);
    expect(cell.querySelector('mark')).toBeNull();
    expect(cell.classList.contains(SEARCH_MATCH_CELL_CLASS)).toBe(false);
  });

  it('wraps the match in a <mark> and tags the cell when matching', () => {
    cell.textContent = 'Barcelona';
    const applied = applyQuickSearchHighlight(cell, 'Barcelona', activeOn('ar'));
    expect(applied).toBe(true);
    const mark = cell.querySelector('mark.jects-grid-search__hl');
    expect(mark).toBeTruthy();
    expect(mark!.textContent).toBe('ar');
    expect(cell.classList.contains(SEARCH_MATCH_CELL_CLASS)).toBe(true);
    expect(cell.dataset['searchMatch']).toBe('');
  });

  it('does not highlight a non-matching cell', () => {
    cell.textContent = 'Berlin';
    expect(applyQuickSearchHighlight(cell, 'Berlin', activeOn('xyz'))).toBe(false);
    expect(cell.querySelector('mark')).toBeNull();
  });

  it('clears a stale highlight when the cell stops matching (recycling-safe)', () => {
    cell.textContent = 'Barcelona';
    applyQuickSearchHighlight(cell, 'Barcelona', activeOn('ar'));
    expect(cell.classList.contains(SEARCH_MATCH_CELL_CLASS)).toBe(true);

    // Recycled to a new value that no longer matches.
    applyQuickSearchHighlight(cell, 'Berlin', activeOn('ar'));
    expect(cell.classList.contains(SEARCH_MATCH_CELL_CLASS)).toBe(false);
    expect(cell.querySelector('mark')).toBeNull();
    expect(cell.textContent).toBe('Berlin');
    expect(cell.dataset['searchMatch']).toBeUndefined();
  });

  it('clears the highlight when search becomes inactive (null)', () => {
    cell.textContent = 'Barcelona';
    applyQuickSearchHighlight(cell, 'Barcelona', activeOn('ar'));
    applyQuickSearchHighlight(cell, 'Barcelona', null);
    expect(cell.classList.contains(SEARCH_MATCH_CELL_CLASS)).toBe(false);
    expect(cell.textContent).toBe('Barcelona');
  });

  it('escapes HTML so the highlight markup is XSS-safe', () => {
    // A highlighter that escapes non-match spans (mirrors QuickSearchFeature).
    const safe: QuickSearchHighlighter = {
      isActive: () => true,
      matchesCell: (v) => String(v).includes('b'),
      highlight: (text) =>
        text.replace(/</g, '&lt;').replace('b', '<mark class="jects-grid-search__hl">b</mark>'),
    };
    applyQuickSearchHighlight(cell, 'a<b>', safe);
    // The injected `<b>` must NOT have become a real element.
    expect(cell.querySelector('b')).toBeNull();
    expect(cell.querySelector('mark')).toBeTruthy();
  });
});

/* ── end-to-end through the real DomRenderer ──────────────────────────── */

interface Row extends Model {
  id: number;
  name: string;
}

const COLS: ColumnDef<Row>[] = [{ field: 'name', width: 120 }];
const ROWS: Row[] = [
  { id: 1, name: 'Alice' },
  { id: 2, name: 'Bob' },
  { id: 3, name: 'Carol' },
];

/**
 * Build an api the renderer can read that wires a real QuickSearchFeature
 * against the same store the engine renders, plus the bits the feature itself
 * needs from the api (store / columns / row access / refresh / viewport).
 */
function makeRenderApi(engine: GridEngine<Row>, store: Store<Row>) {
  const features = new Map<string, GridFeature<Row>>();
  const selection = new DefaultSelectionModel<Row>('multi', {
    getRowById: (id) => engine.getRowById(id),
    onChange: () => {},
  });
  const scrolled: number[] = [];
  const api = {
    store,
    selection,
    features,
    columns: engine.columns.map((c) => c.def),
    getColumn: (id: string) =>
      engine.columns.map((c) => c.def).find((c) => (c.id ?? c.field) === id || c.field === id),
    getRow: (i: number) => store.getAt(i),
    getRowCount: () => store.count,
    refresh: () => {},
    emit: () => true,
    track: () => {},
    viewport: { scrollToRow: (i: number) => scrolled.push(i) },
  } as unknown as GridApi<Row>;
  return { api, features, scrolled };
}

let host: HTMLElement;
beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => host.remove());

describe('DomRenderer × QuickSearchFeature (jsdom integration)', () => {
  function mountWithSearch(query: string | null) {
    const store = new Store<Row>({ data: ROWS.map((r) => ({ ...r })), idField: 'id' });
    const engine = new GridEngine<Row>({ data: store.toArray(), columns: COLS, rowHeight: 20 });
    engine.setViewportSize(300, 200);
    const { api, features } = makeRenderApi(engine, store);

    const feature = new QuickSearchFeature<Row>({ filterRows: false });
    features.set(feature.name, feature);
    feature.init(api);

    const r = new DomRenderer<Row>(engine);
    r.mount(host, api);
    if (query != null) feature.search(query);
    r.renderViewport(engine.computeViewportWindow());
    return { r, feature, engine };
  }

  it('does not mark any cell when no search is active', () => {
    const { r } = mountWithSearch(null);
    expect(host.querySelector('mark.jects-grid-search__hl')).toBeNull();
    expect(host.querySelector(`.${SEARCH_MATCH_CELL_CLASS}`)).toBeNull();
    r.destroy();
  });

  it('marks matched substrings in painted cells when a search is active', () => {
    const { r } = mountWithSearch('al'); // matches "Alice", "Carol"
    const marks = host.querySelectorAll('mark.jects-grid-search__hl');
    expect(marks.length).toBeGreaterThanOrEqual(1);
    // The matched cell carries the cell-match class.
    const matchCells = host.querySelectorAll(`.${SEARCH_MATCH_CELL_CLASS}`);
    expect(matchCells.length).toBeGreaterThanOrEqual(1);
    // "Bob" has no match → no mark inside it.
    const bobCell = Array.from(host.querySelectorAll<HTMLElement>('.jects-grid__cell')).find(
      (c) => c.textContent === 'Bob',
    );
    expect(bobCell).toBeTruthy();
    expect(bobCell!.querySelector('mark')).toBeNull();
    r.destroy();
  });

  it('clears highlights when the search is cleared and rows repaint', () => {
    const { r, feature, engine } = mountWithSearch('al');
    expect(host.querySelector('mark.jects-grid-search__hl')).toBeTruthy();

    feature.clear();
    r.renderViewport(engine.computeViewportWindow());
    expect(host.querySelector('mark.jects-grid-search__hl')).toBeNull();
    expect(host.querySelector(`.${SEARCH_MATCH_CELL_CLASS}`)).toBeNull();
    r.destroy();
  });

  it('highlights the exact matched substring, leaving the rest as text', () => {
    const { r } = mountWithSearch('lic'); // inside "Alice"
    const mark = host.querySelector('mark.jects-grid-search__hl');
    expect(mark).toBeTruthy();
    expect(mark!.textContent).toBe('lic');
    const cell = mark!.closest('.jects-grid__cell') as HTMLElement;
    expect(cell.textContent).toBe('Alice');
    r.destroy();
  });
});
