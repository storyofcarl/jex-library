/**
 * QuickSearchFeature — global text search with match highlighting.
 *
 * Filters the grid to rows whose searchable columns contain the query (across
 * all columns by default), and exposes a `highlight(text)` helper renderers
 * call to wrap matched substrings in `<mark class="jects-grid-search__hl">`.
 * Match navigation (`next`/`prev`) walks the matching rows and scrolls them into
 * view via the viewport. Emits `filterChange` so other UIs (e.g. a summary)
 * recompute.
 *
 * Confined to `GridApi`; the store filter it installs is removed on `destroy()`.
 */

import type { Model } from '@jects/core';
import type { ColumnDef, GridApi, GridFeature } from '../contract.js';
import { Disposers, escapeHtml, getValue } from './shared.js';
import type { FilterFeature } from './filter.js';

/** Owner key under which QuickSearch registers its predicate on the FilterFeature. */
const FILTER_OWNER = 'quickSearch';

/**
 * Payload for the `quickSearchChange` event — emitted whenever the active search
 * query changes. Carries the real query + match count so listeners (search box,
 * result counter) can react WITHOUT being lied to about the column filter state
 * (which is why this is a dedicated event, not a synthetic `filterChange`).
 */
export interface QuickSearchChangeEvent {
  /** The current query string (empty when cleared). */
  query: string;
  /** Whether a search is active. */
  active: boolean;
  /** Number of matching rows. */
  matches: number;
}

export interface QuickSearchFeatureOptions {
  /** Column ids to search. Default: every column with a `field`. */
  columns?: string[];
  /** Case-sensitive matching. Default `false`. */
  caseSensitive?: boolean;
  /** Filter the grid to matching rows (vs. highlight-only). Default `true`. */
  filterRows?: boolean;
  /** Initial query. */
  query?: string;
}

export class QuickSearchFeature<Row extends Model = Model> implements GridFeature<Row> {
  readonly name = 'quickSearch';

  private api!: GridApi<Row>;
  private readonly disposers = new Disposers();
  private query = '';
  private needle = '';
  private readonly caseSensitive: boolean;
  private readonly filterRows: boolean;
  private readonly columnIds: string[] | null;
  private matchIndices: number[] = [];
  private cursor = -1;
  /** True when this feature installed the store filter directly (no FilterFeature). */
  private ownsStoreFilter = false;

  constructor(options: QuickSearchFeatureOptions = {}) {
    this.caseSensitive = options.caseSensitive ?? false;
    this.filterRows = options.filterRows ?? true;
    this.columnIds = options.columns ?? null;
    if (options.query) this.query = options.query;
  }

  init(grid: GridApi<Row>): void {
    this.api = grid;
    grid.track(() => this.disposers.dispose());
    if (this.query) this.search(this.query);
  }

  /** Current query string. */
  getQuery(): string {
    return this.query;
  }

  /** Whether a search is active. */
  isActive(): boolean {
    return this.query.trim() !== '';
  }

  /** Indices (into the post-search view) of matching rows. */
  getMatches(): number[] {
    return [...this.matchIndices];
  }

  /** Number of matching rows. */
  matchCount(): number {
    return this.matchIndices.length;
  }

  /** Run a search. Empty/whitespace clears it. */
  search(query: string): void {
    this.query = query;
    this.needle = this.caseSensitive ? query : query.toLowerCase();
    const active = query.trim() !== '';

    const searchCols = this.searchColumns();
    const matches = (row: Row): boolean => {
      for (const col of searchCols) {
        const cell = getValue(row, col);
        if (cell == null) continue;
        const hay = this.caseSensitive ? String(cell) : String(cell).toLowerCase();
        if (hay.includes(this.needle)) return true;
      }
      return false;
    };

    if (!active) {
      if (this.filterRows) this.removeRowFilter();
      this.matchIndices = [];
      this.cursor = -1;
    } else if (this.filterRows) {
      this.installRowFilter((row: Row) => matches(row));
      // After filtering, every visible row is a match.
      this.matchIndices = Array.from({ length: this.countView() }, (_, i) => i);
      this.cursor = this.matchIndices.length ? 0 : -1;
    } else {
      // Highlight-only: compute matching view indices without filtering.
      this.matchIndices = [];
      const n = this.api.getRowCount();
      for (let i = 0; i < n; i++) {
        const row = this.api.getRow(i);
        if (row && matches(row)) this.matchIndices.push(i);
      }
      this.cursor = this.matchIndices.length ? 0 : -1;
    }

    this.api.refresh();
    // Emit a dedicated, HONEST event reflecting the real query/match state. We do
    // NOT emit a synthetic `filterChange` (which would lie about the column filter
    // state and confuse the FilterFeature's undo-redo capture / filter-bar UI).
    this.api.emit('quickSearchChange', {
      query: this.query,
      active,
      matches: this.matchCount(),
    });
    if (this.cursor >= 0) this.scrollToCursor();
  }

  /**
   * Install the row predicate. When a FilterFeature is present, register it as an
   * EXTERNAL predicate there so the column filters survive (and stay AND-combined
   * with the search). Otherwise install it directly on the store (we own the
   * store filter in that standalone case).
   */
  private installRowFilter(predicate: (row: Row) => boolean): void {
    const filter = this.filterFeature();
    if (filter) {
      filter.setExternalFilter(FILTER_OWNER, predicate);
      this.ownsStoreFilter = false;
    } else {
      this.api.store.filter(predicate);
      this.ownsStoreFilter = true;
    }
  }

  /**
   * Remove ONLY quick-search's own predicate. Through the FilterFeature this drops
   * just our external predicate (other columns' filters are preserved). In the
   * standalone case we only clear the store filter if WE installed it, so we never
   * wipe a predicate some other code set on the store.
   */
  private removeRowFilter(): void {
    const filter = this.filterFeature();
    if (filter) {
      if (filter.hasExternalFilter(FILTER_OWNER)) filter.setExternalFilter(FILTER_OWNER, null);
    } else if (this.ownsStoreFilter) {
      this.api.store.clearFilters();
      this.ownsStoreFilter = false;
    }
  }

  /** The installed FilterFeature, if any (for filter composition). */
  private filterFeature(): FilterFeature<Row> | undefined {
    const f = this.api.features.get('filter');
    return f && typeof (f as FilterFeature<Row>).setExternalFilter === 'function'
      ? (f as FilterFeature<Row>)
      : undefined;
  }

  /** Clear the search. */
  clear(): void {
    this.search('');
  }

  /** Advance to the next match (wraps). Returns the row index, or -1. */
  next(): number {
    if (!this.matchIndices.length) return -1;
    this.cursor = (this.cursor + 1) % this.matchIndices.length;
    this.scrollToCursor();
    return this.matchIndices[this.cursor]!;
  }

  /** Go to the previous match (wraps). */
  prev(): number {
    if (!this.matchIndices.length) return -1;
    this.cursor = (this.cursor - 1 + this.matchIndices.length) % this.matchIndices.length;
    this.scrollToCursor();
    return this.matchIndices[this.cursor]!;
  }

  /** Row index of the active match, or -1. */
  currentMatch(): number {
    return this.cursor >= 0 ? this.matchIndices[this.cursor]! : -1;
  }

  /**
   * Wrap each occurrence of the query within `text` in a highlight `<mark>`.
   * Returns HTML-safe markup (the non-matched text is escaped).
   */
  highlight(text: string): string {
    if (!this.isActive() || !text) return escapeHtml(text ?? '');
    const hay = this.caseSensitive ? text : text.toLowerCase();
    const needle = this.needle;
    if (!needle || !hay.includes(needle)) return escapeHtml(text);

    let out = '';
    let i = 0;
    while (i < text.length) {
      const at = hay.indexOf(needle, i);
      if (at < 0) {
        out += escapeHtml(text.slice(i));
        break;
      }
      out += escapeHtml(text.slice(i, at));
      out += `<mark class="jects-grid-search__hl">${escapeHtml(text.slice(at, at + needle.length))}</mark>`;
      i = at + needle.length;
    }
    return out;
  }

  /** Does this cell value match the active query? */
  matchesCell(value: unknown): boolean {
    if (!this.isActive() || value == null) return false;
    const hay = this.caseSensitive ? String(value) : String(value).toLowerCase();
    return hay.includes(this.needle);
  }

  private searchColumns(): ColumnDef<Row>[] {
    if (this.columnIds) {
      return this.columnIds
        .map((id) => this.api.getColumn(id))
        .filter((c): c is ColumnDef<Row> => !!c && !!c.field);
    }
    return this.api.columns.filter((c) => !!c.field);
  }

  private countView(): number {
    return this.api.getRowCount();
  }

  private scrollToCursor(): void {
    const idx = this.currentMatch();
    if (idx >= 0) this.api.viewport.scrollToRow(idx);
  }

  destroy(): void {
    // Remove only quick-search's own row filter so the store/other columns are
    // left exactly as they were before the feature ran.
    if (this.filterRows && this.isActive()) this.removeRowFilter();
    this.disposers.dispose();
    this.matchIndices = [];
  }
}

/** Convenience factory. */
export function quickSearchFeature<Row extends Model = Model>(
  options?: QuickSearchFeatureOptions,
): QuickSearchFeature<Row> {
  return new QuickSearchFeature<Row>(options);
}

/* ═══════════════════════════════════════════════════════════════════════════
   Module augmentation — make `quickSearchChange` a first-class, typed grid
   event (purely additive to the frozen contract; mirrors the fill feature's
   augmentation pattern). QuickSearch emits THIS instead of a synthetic
   `filterChange` so listeners are never told an honest-but-wrong filter state.
   ═══════════════════════════════════════════════════════════════════════════ */
declare module '../contract.js' {
  // The `Row` type param is required to merge with the base `GridEvents<Row>`
  // declaration; the payload itself is row-agnostic.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface GridEvents<Row extends Model> {
    /** The quick-search query changed (honest query + match-count payload). */
    quickSearchChange: QuickSearchChangeEvent;
  }
}
