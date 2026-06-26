/**
 * InfiniteLoadFeature — lazy / infinite (load-on-demand) row loading.
 *
 * Brings the grid to Bryntum `AjaxStore` + buffered-rendering / DHTMLX
 * "dynamic loading" parity: instead of materializing the full data set up front,
 * the grid renders a virtual list of `totalCount` rows where only the ranges the
 * user has scrolled near are actually fetched. Unfetched rows are rendered as
 * skeleton **placeholder / loading rows**; as the virtual viewport window
 * approaches an un-loaded region the feature **prefetches** the next page through
 * a typed range-request callback.
 *
 * How it works (concurrency-safe — additive, talks to the grid ONLY through
 * `GridApi`, owns its own CSS, never edits the engine/main class):
 *
 *   1. On `init` (or `setTotalCount`) the feature *sizes* the backing store to
 *      `totalCount` records. Indices that aren't loaded yet are filled with
 *      lightweight **placeholder** records flagged `__jectsLoading: true` and a
 *      stable synthetic id (`__jects-ph-<index>`). The grid's virtualization
 *      then scrolls over the full `totalCount` height immediately, exactly like a
 *      server-backed buffered store.
 *
 *   2. The feature watches `viewportChange` / `scroll`. Whenever the painted
 *      window's end (plus `prefetchThreshold` rows of lookahead) reaches into a
 *      page whose rows aren't loaded, it requests that page (and any other
 *      not-loaded pages the *current* window overlaps) via the `loadRange`
 *      callback — a single page is never requested twice concurrently.
 *
 *   3. When a range resolves, the placeholder records for those indices are
 *      replaced in place with the real row data (re-keyed to the real id via
 *      `Store.changeId`), the loading flag cleared, and the grid repainted. If
 *      the response carries an updated `totalCount` the virtual list is resized.
 *
 *   4. After every repaint the feature re-decorates the painted rows: rows still
 *      backed by a placeholder get `.jects-grid__row--loading` + `aria-busy` so
 *      the skeleton CSS shows and assistive tech announces the busy state.
 *
 * Everything the feature creates (store listeners, the repaint decorator hook,
 * in-flight promises) is released on `destroy()`.
 */

import type { Model, RecordId } from '@jects/core';
import type { GridApi, GridFeature } from '../contract.js';
import { Disposers } from './shared.js';
import './infinite-load.css';

/** Prefix for the synthetic, stable id of a not-yet-loaded placeholder row. */
const PLACEHOLDER_ID_PREFIX = '__jects-ph-';

/** Flag set on placeholder records the feature owns (cleared once real data lands). */
export const LOADING_FLAG = '__jectsLoading';

/** A contiguous block of rows the grid is asking the data provider to fetch. */
export interface RangeRequest {
  /** First row index to fetch (inclusive). */
  start: number;
  /** One past the last row index to fetch (exclusive). */
  end: number;
  /** Convenience: number of rows requested (`end - start`). */
  count: number;
  /** Zero-based page index (`start / pageSize`) for page-oriented backends. */
  page: number;
  /** Page size in effect for this request. */
  pageSize: number;
}

/** What a `loadRange` callback must resolve to. */
export interface RangeResponse<Row extends Model = Model> {
  /** The fetched rows, in order, aligned to `request.start`. */
  rows: Row[];
  /**
   * Authoritative total row count, if the backend reports it. When present and
   * different from the current total the virtual list is resized to match.
   */
  totalCount?: number;
}

/** The range-request callback the integrator supplies (the data provider). */
export type LoadRange<Row extends Model = Model> = (
  request: RangeRequest,
) => Promise<RangeResponse<Row>> | RangeResponse<Row>;

export interface InfiniteLoadFeatureOptions<Row extends Model = Model> {
  /**
   * Range-request callback — fetch and return the rows for `request`. Required.
   * Aligned: `response.rows[k]` is the row for index `request.start + k`.
   */
  loadRange: LoadRange<Row>;
  /**
   * Initial total number of rows the virtual list spans. May be `0` (then call
   * `setTotalCount` once known, e.g. from the first response's `totalCount`).
   */
  totalCount?: number;
  /**
   * Rows per fetched page. Loads are aligned to page boundaries so a backend can
   * serve `?page=N&size=pageSize`. Default `50`.
   */
  pageSize?: number;
  /**
   * Lookahead in rows: prefetch begins when the painted window's end comes within
   * this many rows of an un-loaded region. Default `20`.
   */
  prefetchThreshold?: number;
  /** Field carrying the unique id on a fetched row. Defaults to the store's id field. */
  idField?: string;
  /**
   * Kick off a first load for the top of the list on `init` (so the initial
   * screen isn't all skeletons). Default `true`.
   */
  autoLoad?: boolean;
}

/**
 * `LoadState` of one page: not requested, in flight, loaded, or errored.
 */
export type PageState = 'idle' | 'loading' | 'loaded' | 'error';

/** Lazy / infinite load-on-demand feature. */
export class InfiniteLoadFeature<Row extends Model = Model> implements GridFeature<Row> {
  readonly name = 'infiniteLoad';

  private api!: GridApi<Row>;
  private readonly disposers = new Disposers();

  private readonly loadRange: LoadRange<Row>;
  private readonly pageSize: number;
  private readonly prefetchThreshold: number;
  private readonly autoLoad: boolean;
  private idFieldOpt?: string;

  private _totalCount: number;
  /** Per-page load state, keyed by page index. */
  private readonly pageState = new Map<number, PageState>();
  /** In-flight page promises (so we never double-request). */
  private readonly inFlight = new Map<number, Promise<void>>();
  /** Index → real id of every loaded row, so we know which store ids are real. */
  private readonly loadedIds = new Set<RecordId>();

  private decorating = false;
  private destroyed = false;

  constructor(options: InfiniteLoadFeatureOptions<Row>) {
    if (typeof options.loadRange !== 'function') {
      throw new TypeError('InfiniteLoadFeature: `loadRange` callback is required.');
    }
    this.loadRange = options.loadRange;
    this.pageSize = Math.max(1, Math.floor(options.pageSize ?? 50));
    this.prefetchThreshold = Math.max(0, Math.floor(options.prefetchThreshold ?? 20));
    this.autoLoad = options.autoLoad ?? true;
    this._totalCount = Math.max(0, Math.floor(options.totalCount ?? 0));
    if (options.idField) this.idFieldOpt = options.idField;
  }

  /* ── lifecycle ──────────────────────────────────────────────────────── */

  init(grid: GridApi<Row>): void {
    this.api = grid;
    grid.track(() => this.disposers.dispose());

    // Size the virtual list to totalCount with placeholder rows.
    this.resizeStore();

    // React to viewport movement (scroll + window recompute) to prefetch.
    this.disposers.add(grid.on('viewportChange', () => this.onViewport()));
    this.disposers.add(grid.on('scroll', () => this.onViewport()));
    // Re-skeletonize painted rows after each repaint (rows recycle on scroll).
    this.disposers.add(grid.on('viewportChange', () => this.decorate()));

    if (this.autoLoad && this._totalCount > 0) {
      // Fetch the first page so the initial screen has real data.
      void this.ensurePage(0);
    }
    this.decorate();
  }

  destroy(): void {
    this.destroyed = true;
    this.disposers.dispose();
    this.pageState.clear();
    this.inFlight.clear();
    this.loadedIds.clear();
  }

  /* ── public API ─────────────────────────────────────────────────────── */

  /** Current authoritative total row count of the virtual list. */
  get totalCount(): number {
    return this._totalCount;
  }

  /**
   * Resize the virtual list. Grows by appending placeholder rows / shrinks by
   * trimming the tail. Loaded rows are preserved. Triggers a prefetch + repaint.
   */
  setTotalCount(total: number): void {
    const next = Math.max(0, Math.floor(total));
    if (next === this._totalCount) return;
    this._totalCount = next;
    this.resizeStore();
    this.api.refresh();
    this.onViewport();
    this.decorate();
  }

  /** Whether the row at a view index is a not-yet-loaded placeholder. */
  isPlaceholder(rowIndex: number): boolean {
    const row = this.api.getRow(rowIndex);
    return isLoadingRecord(row);
  }

  /** Whether the page containing `rowIndex` has finished loading. */
  isLoaded(rowIndex: number): boolean {
    return this.pageState.get(this.pageOf(rowIndex)) === 'loaded';
  }

  /** Load state of a given page index. */
  pageStateOf(page: number): PageState {
    return this.pageState.get(page) ?? 'idle';
  }

  /** Number of pages that have finished loading. */
  loadedPageCount(): number {
    let n = 0;
    for (const s of this.pageState.values()) if (s === 'loaded') n++;
    return n;
  }

  /**
   * Force a (re)load of the page containing `rowIndex`, even if already loaded.
   * Resolves when the page's data has been applied.
   */
  async loadAround(rowIndex: number): Promise<void> {
    const page = this.pageOf(rowIndex);
    this.pageState.delete(page);
    this.inFlight.delete(page);
    await this.ensurePage(page);
  }

  /** Discard all loaded data + state and re-skeletonize (e.g. after a sort). */
  reset(total = this._totalCount): void {
    this.pageState.clear();
    this.inFlight.clear();
    this.loadedIds.clear();
    this._totalCount = Math.max(0, Math.floor(total));
    this.resizeStore(true);
    this.api.refresh();
    if (this.autoLoad && this._totalCount > 0) void this.ensurePage(0);
    this.decorate();
  }

  /* ── prefetch driving ───────────────────────────────────────────────── */

  private onViewport(): void {
    if (this._totalCount === 0) return;
    const win = this.api.viewport.window;
    // The painted window plus lookahead.
    const start = Math.max(0, win.startIndex);
    const end = Math.min(this._totalCount - 1, win.endIndex + this.prefetchThreshold);
    if (end < start) return;

    const firstPage = this.pageOf(start);
    const lastPage = this.pageOf(end);
    for (let p = firstPage; p <= lastPage; p++) {
      void this.ensurePage(p);
    }
  }

  /* ── page loading ───────────────────────────────────────────────────── */

  /** Ensure a page is loaded; coalesces concurrent requests for the same page. */
  private ensurePage(page: number): Promise<void> {
    if (page < 0) return Promise.resolve();
    const state = this.pageState.get(page);
    if (state === 'loaded') return Promise.resolve();
    const existing = this.inFlight.get(page);
    if (existing) return existing;

    const start = page * this.pageSize;
    if (start >= this._totalCount) return Promise.resolve();
    const end = Math.min(this._totalCount, start + this.pageSize);
    const request: RangeRequest = {
      start,
      end,
      count: end - start,
      page,
      pageSize: this.pageSize,
    };

    this.pageState.set(page, 'loading');
    this.decorate();

    const run = Promise.resolve()
      .then(() => this.loadRange(request))
      .then((res) => {
        // The feature may have been torn down while awaiting.
        if (this.destroyed) return;
        this.applyRange(request, res);
        this.pageState.set(page, 'loaded');
      })
      .catch((err: unknown) => {
        if (!this.destroyed) {
          this.pageState.set(page, 'error');
          this.decorate();
        }
        throw err;
      })
      .finally(() => {
        this.inFlight.delete(page);
      });

    this.inFlight.set(page, run);
    // Swallow rejection on the stored promise so unhandled-rejection isn't raised
    // for callers that don't await; `loadAround` still sees the error if awaited.
    run.catch(() => {});
    return run;
  }

  /** Merge a resolved range into the store's placeholder records, then repaint. */
  private applyRange(request: RangeRequest, res: RangeResponse<Row>): void {
    const store = this.api.store;
    const idField = this.idField();
    const rows = res.rows ?? [];

    for (let k = 0; k < rows.length; k++) {
      const index = request.start + k;
      if (index >= this._totalCount) break;
      const placeholderId = placeholderIdFor(index);
      const record = store.getById(placeholderId) ?? store.getAt(index);
      if (!record) continue;

      const real = rows[k]!;
      const realId = (real as Model)[idField] as RecordId | undefined;
      const keyId = (record as Model)[idField] as RecordId;

      // Strip any placeholder-only keys the real row won't overwrite, then merge
      // the real fields and clear the loading flag. Going through `store.update`
      // (rather than mutating silently) fires the store `change` event, which is
      // what tells the engine to invalidate its row model so the freshly-loaded
      // ids/values are reflected on the next paint.
      stripExtraKeys(record as Model, real as Model, idField);
      store.update(keyId, { ...(real as Model), [LOADING_FLAG]: false } as never);

      // Re-key the store entry to the real id (falls back to keeping the
      // synthetic id when the row carries none — selection/scroll still work).
      if (realId != null && realId !== keyId) {
        store.changeId(keyId, realId);
        this.loadedIds.add(realId);
      } else {
        this.loadedIds.add(keyId);
      }
    }

    if (res.totalCount != null && res.totalCount !== this._totalCount) {
      this._totalCount = Math.max(0, Math.floor(res.totalCount));
      this.resizeStore();
    }

    this.api.refresh();
    this.decorate();
  }

  /* ── store sizing (placeholder management) ──────────────────────────── */

  /**
   * Make the store hold exactly `_totalCount` records: append placeholders to
   * grow, trim the tail to shrink. When `rebuild` is true every existing record
   * is replaced by a fresh placeholder (used by {@link reset}).
   */
  private resizeStore(rebuild = false): void {
    const store = this.api.store;
    const idField = this.idField();

    if (rebuild) {
      const all = store.toArray();
      if (all.length) {
        store.remove(all.map((r) => (r as Model)[idField] as RecordId));
      }
    }

    const have = store.count;
    const want = this._totalCount;

    if (want > have) {
      const additions: Row[] = [];
      for (let i = have; i < want; i++) {
        additions.push(makePlaceholder<Row>(i, idField));
      }
      if (additions.length) store.add(additions);
    } else if (want < have) {
      const toRemove: RecordId[] = [];
      for (let i = want; i < have; i++) {
        const rec = store.getAt(i);
        if (rec) toRemove.push((rec as Model)[idField] as RecordId);
      }
      if (toRemove.length) store.remove(toRemove);
    }
  }

  /* ── row skeleton decoration ────────────────────────────────────────── */

  /**
   * Toggle `.jects-grid__row--loading` + `aria-busy` on every painted row that is
   * still backed by a placeholder. Idempotent and re-entrancy guarded.
   */
  private decorate(): void {
    if (this.decorating) return;
    this.decorating = true;
    try {
      const rows = this.api.el.querySelectorAll<HTMLElement>('.jects-grid__row[data-row-id]');
      rows.forEach((rowEl) => {
        const idAttr = rowEl.dataset['rowId'];
        if (idAttr == null) return;
        const loading = this.isLoadingId(idAttr);
        rowEl.classList.toggle('jects-grid__row--loading', loading);
        if (loading) rowEl.setAttribute('aria-busy', 'true');
        else rowEl.removeAttribute('aria-busy');
      });
    } finally {
      this.decorating = false;
    }
  }

  /** Is the store record currently identified by `idAttr` a loading placeholder? */
  private isLoadingId(idAttr: string): boolean {
    // Fast path: synthetic placeholder ids are self-describing.
    if (idAttr.startsWith(PLACEHOLDER_ID_PREFIX)) {
      // It might have been re-keyed but the dataset is stale until repaint; trust
      // the record's flag if we can resolve it.
      const rec = this.api.store.getById(idAttr);
      return rec ? isLoadingRecord(rec) : true;
    }
    const recById = this.api.store.getById(idAttr) ?? this.api.store.getById(Number(idAttr));
    return isLoadingRecord(recById);
  }

  /* ── helpers ────────────────────────────────────────────────────────── */

  private pageOf(rowIndex: number): number {
    return Math.floor(rowIndex / this.pageSize);
  }

  private idField(): string {
    return this.idFieldOpt ?? this.api.store.idField ?? 'id';
  }
}

/* ── module-level helpers ─────────────────────────────────────────────── */

/** Stable synthetic id for the placeholder occupying virtual index `i`. */
export function placeholderIdFor(i: number): string {
  return `${PLACEHOLDER_ID_PREFIX}${i}`;
}

/** Build a placeholder record for virtual index `i`. */
function makePlaceholder<Row extends Model>(i: number, idField: string): Row {
  const rec: Model = {
    [idField]: placeholderIdFor(i),
    [LOADING_FLAG]: true,
  };
  return rec as Row;
}

/**
 * Delete keys present on the placeholder `rec` that the incoming `real` row does
 * not carry (except the id field, which `store.update` re-keys), so stale
 * placeholder-only fields never linger on a loaded row.
 */
function stripExtraKeys(rec: Model, real: Model, idField: string): void {
  for (const key of Object.keys(rec)) {
    if (key === idField) continue;
    if (key === LOADING_FLAG) continue;
    if (!(key in real)) delete rec[key];
  }
}

/** Is `row` a not-yet-loaded placeholder record? */
export function isLoadingRecord(row: unknown): boolean {
  return (
    row != null &&
    typeof row === 'object' &&
    (row as Model)[LOADING_FLAG] === true
  );
}

/** Convenience factory mirroring the other feature factories. */
export function infiniteLoadFeature<Row extends Model = Model>(
  options: InfiniteLoadFeatureOptions<Row>,
): InfiniteLoadFeature<Row> {
  return new InfiniteLoadFeature<Row>(options);
}
