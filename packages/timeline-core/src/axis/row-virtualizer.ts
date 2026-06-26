/**
 * {@link RowVirtualizer} default implementation — the vertical-virtualization
 * seam. Reuses the core `computeWindow` (fixed heights, O(1)) and `OffsetIndex`
 * (variable heights, Fenwick tree, O(log n)) so Scheduler (resource rows) and
 * Gantt (task-tree rows) can supply different row providers without changing the
 * paint loop.
 *
 * The virtualizer is *data-source agnostic*: it is fed a `RowProvider` (count +
 * per-index row resolution) and the resolved heights, and answers offset/index/
 * window queries against them. The engine wires the provider to its row model.
 */

import { computeWindow, OffsetIndex, type Model, type RecordId } from '@jects/core';
import type { RowVirtualizer, RowWindow, TimelineRow } from '../contract.js';

/**
 * Supplies row models and the row count to the virtualizer. Resolves a row at an
 * absolute view index (after filter/sort/tree-expansion). The engine implements
 * this over its row model; features never construct it.
 */
export interface RowProvider<R extends Model = Model> {
  /** Total rows in the current (filtered/expanded) view. */
  count(): number;
  /** The row model at an absolute index, or `undefined` if out of range. */
  rowAt(index: number): TimelineRow<R> | undefined;
  /** Absolute index of a row id, or -1. */
  indexOf(id: RecordId): number;
}

export interface RowVirtualizerConfig<R extends Model = Model> {
  provider: RowProvider<R>;
  /** Default/fixed row height in px. */
  rowHeight: number;
  /** Allow per-row variable heights (backed by `OffsetIndex`). Default false. */
  variableRowHeight?: boolean;
  /** Default overscan rows above/below the viewport. Default 3. */
  overscan?: number;
}

export class DefaultRowVirtualizer<R extends Model = Model> implements RowVirtualizer<R> {
  private readonly provider: RowProvider<R>;
  private readonly defaultHeight: number;
  private readonly variable: boolean;
  private readonly defaultOverscan: number;

  /** Lazily built when variable heights are active; null in fixed-height mode. */
  private offsets: OffsetIndex | null = null;
  /** The row count the current `offsets` was built for (rebuild on mismatch). */
  private offsetsCount = -1;

  constructor(config: RowVirtualizerConfig<R>) {
    this.provider = config.provider;
    this.defaultHeight = config.rowHeight;
    this.variable = config.variableRowHeight ?? false;
    this.defaultOverscan = config.overscan ?? 3;
  }

  get count(): number {
    return this.provider.count();
  }

  /**
   * Mark cached geometry stale. Call after the row set changes (add/remove/
   * filter/expand) or a row's resolved height changes. Cheap; rebuild is lazy.
   */
  invalidate(): void {
    this.offsets = null;
    this.offsetsCount = -1;
  }

  offsetOf(rowIndex: number): number {
    if (!this.variable) return clampIndex(rowIndex, this.count) * this.defaultHeight;
    return this.index().offsetOf(clampIndex(rowIndex, this.count));
  }

  heightOf(rowIndex: number): number {
    const row = this.provider.rowAt(clampIndex(rowIndex, this.count));
    if (row && row.height > 0) return row.height;
    return this.defaultHeight;
  }

  indexAt(y: number): number {
    const n = this.count;
    if (n === 0) return 0;
    if (y <= 0) return 0;
    if (!this.variable) {
      return Math.min(n - 1, Math.floor(y / this.defaultHeight));
    }
    return this.index().indexAt(y);
  }

  rowAt(rowIndex: number): TimelineRow<R> | undefined {
    if (rowIndex < 0 || rowIndex >= this.count) return undefined;
    return this.provider.rowAt(rowIndex);
  }

  computeWindow(input: {
    scrollTop: number;
    viewportHeight: number;
    overscan?: number;
  }): RowWindow<R> {
    const n = this.count;
    const overscan = input.overscan ?? this.defaultOverscan;
    if (n === 0) {
      return { startIndex: 0, endIndex: 0, offset: 0, totalSize: 0, rows: [] };
    }

    let startIndex: number;
    let endIndexExclusive: number;
    let offset: number;
    let totalSize: number;

    if (!this.variable) {
      // Fixed-height fast path via core computeWindow (returns inclusive end).
      const w = computeWindow({
        scrollTop: input.scrollTop,
        viewportHeight: input.viewportHeight,
        itemSize: this.defaultHeight,
        count: n,
        overscan,
      });
      startIndex = w.startIndex;
      // Contract uses a half-open [startIndex, endIndex); core returns inclusive.
      endIndexExclusive = Math.min(n, w.endIndex + 1);
      offset = w.offset;
      totalSize = w.totalSize;
    } else {
      // Variable-height path via OffsetIndex.
      const idx = this.index();
      totalSize = idx.total();
      const top = Math.max(0, Math.min(input.scrollTop, Math.max(0, totalSize - input.viewportHeight)));
      const firstVisible = idx.indexAt(top);
      const lastVisible = idx.indexAt(top + input.viewportHeight);
      startIndex = Math.max(0, firstVisible - overscan);
      endIndexExclusive = Math.min(n, lastVisible + overscan + 1);
      offset = idx.offsetOf(startIndex);
    }

    const rows: TimelineRow<R>[] = [];
    for (let i = startIndex; i < endIndexExclusive; i++) {
      const row = this.provider.rowAt(i);
      if (row) rows.push(row);
    }
    return { startIndex, endIndex: endIndexExclusive, offset, totalSize, rows };
  }

  /** Build (or reuse) the `OffsetIndex` for the current row set. */
  private index(): OffsetIndex {
    const n = this.count;
    if (this.offsets && this.offsetsCount === n) return this.offsets;
    const idx = new OffsetIndex(n);
    for (let i = 0; i < n; i++) {
      const row = this.provider.rowAt(i);
      idx.setSize(i, row && row.height > 0 ? row.height : this.defaultHeight);
    }
    this.offsets = idx;
    this.offsetsCount = n;
    return idx;
  }
}

function clampIndex(i: number, count: number): number {
  if (count <= 0) return 0;
  return i < 0 ? 0 : i >= count ? count - 1 : i;
}
