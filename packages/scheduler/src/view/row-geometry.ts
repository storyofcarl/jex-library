/**
 * Variable row height — per-lane intrinsic vertical geometry for the Scheduler.
 *
 * The Scheduler historically placed every resource lane at a fixed `rowHeight`
 * (`rowTop = i * rowHeight`, `totalSize = count * rowHeight`). That throws away
 * the `contentHeight` that `layoutLane` already computes for each lane: a dense
 * lane that stacks N overlapping events needs `margin*2 + N*laneHeight + gaps`
 * pixels, not one nominal row. With fixed math those stacked sub-lanes either
 * overflow the row (bleeding into the next resource) or get clipped.
 *
 * This module is the Bryntum/DHTMLX "variable row height" behavior: each lane is
 * measured to its intrinsic height (the max of its explicit `resource.rowHeight`,
 * the configured default, and the height its events demand), those heights are
 * pushed into a core {@link OffsetIndex} (Fenwick tree — O(log n) offset/total/
 * hit-test), and the scheduler reads row tops + the scrollable total + the
 * virtualization window from the index instead of multiplying by a constant.
 *
 * It is intentionally a *standalone, framework-free* module (no DOM, no Widget):
 * the scheduler composes it. That keeps it independently unit-testable in jsdom
 * and lets the main component stay an additive consumer (see wireNotes).
 *
 * Design mirrors `@jects/grid`'s variable row-height seam: a measured-size map
 * feeding an `OffsetIndex`, recomputed when data/zoom/strategy change.
 */

import { OffsetIndex } from '@jects/core';
import type { RecordId, Model } from '@jects/core';
import type { TimeAxis, TimeSpan, TimelineEvent } from '@jects/timeline-core';
import type { EventOverlapStrategy } from '@jects/timeline-core';
import { layoutLane } from '../model/event-layout.js';
import type { ResourceModel, EventModel } from '../contract.js';

/** A row's visible window, expressed in resource indices + pixel geometry. */
export interface RowWindow {
  /** First resource index to render (inclusive). */
  startIndex: number;
  /** One-past-the-last resource index to render (exclusive). */
  endIndex: number;
  /** Total scrollable content height (px) across all lanes. */
  totalSize: number;
  /** Pixel top offset of `startIndex` (translateY of the first rendered row). */
  offset: number;
}

/** Inputs the geometry needs to measure a single lane's intrinsic height. */
export interface RowGeometryConfig {
  /** Default lane height (px) — the floor every lane is at least this tall. */
  rowHeight: number;
  /** Overlap strategy that drives sub-lane stacking (and thus height). */
  strategy: EventOverlapStrategy;
  /** Extra rows rendered beyond the viewport on each edge. Default 5. */
  overscan?: number;
  /**
   * Whether variable row height is active. When `false` the geometry degrades to
   * uniform `rowHeight` rows (identical to the legacy fixed math) so the feature
   * can be toggled without a code path fork in the host.
   */
  variableRowHeight?: boolean;
  /** Hard ceiling on a single lane's height (px), if any. */
  maxRowHeight?: number;
}

/** Resolves a resource's events to laid-out timeline events for measuring. */
export type LaneEventsResolver = (
  resource: ResourceModel,
  index: number,
) => ReadonlyArray<TimelineEvent<EventModel>>;

/**
 * Variable-height row geometry over an {@link OffsetIndex}.
 *
 * Lifecycle: `new RowGeometry(cfg)` → `measure(resources, axis, resolver)`
 * (rebuilds the index) → repeated `rowTop(i)` / `heightOf(i)` / `total()` /
 * `indexAt(px)` / `rowWindow(...)` reads. Re-`measure()` whenever resources,
 * events, zoom/axis, or the overlap strategy change (the same triggers that
 * already invalidate the scheduler's virtualizer).
 */
export class RowGeometry {
  private index: OffsetIndex;
  private cfg: Required<Omit<RowGeometryConfig, 'maxRowHeight'>> & { maxRowHeight: number };
  /** Lane intrinsic heights by resource id (for id-keyed lookups). */
  private heightsById = new Map<RecordId, number>();
  /** Lane top offsets by resource id (for the dependency router + bar paint). */
  private topsById = new Map<RecordId, number>();
  /** Ordered resource ids, parallel to index positions. */
  private ids: RecordId[] = [];

  constructor(config: RowGeometryConfig) {
    this.cfg = {
      rowHeight: config.rowHeight,
      strategy: config.strategy,
      overscan: config.overscan ?? 5,
      variableRowHeight: config.variableRowHeight ?? true,
      maxRowHeight: config.maxRowHeight ?? Number.POSITIVE_INFINITY,
    };
    this.index = new OffsetIndex(0);
  }

  /** Update tunables without re-measuring (caller should re-`measure` after). */
  configure(patch: Partial<RowGeometryConfig>): void {
    if (patch.rowHeight !== undefined) this.cfg.rowHeight = patch.rowHeight;
    if (patch.strategy !== undefined) this.cfg.strategy = patch.strategy;
    if (patch.overscan !== undefined) this.cfg.overscan = patch.overscan;
    if (patch.variableRowHeight !== undefined) this.cfg.variableRowHeight = patch.variableRowHeight;
    if (patch.maxRowHeight !== undefined) this.cfg.maxRowHeight = patch.maxRowHeight;
  }

  /** Number of lanes currently measured. */
  get count(): number {
    return this.index.count;
  }

  /**
   * Compute the intrinsic height of one lane, given its resource record and the
   * timeline events on it. The height is the maximum of:
   *   - the configured default `rowHeight` (the floor — empty lanes match legacy),
   *   - the resource's explicit `rowHeight` (author override), and
   *   - the `contentHeight` `layoutLane` reports for the lane's events (stacked
   *     sub-lanes grow it).
   * then clamped to `maxRowHeight`. With `variableRowHeight: false` the events
   * are ignored and the floor is returned, reproducing fixed-height rows.
   */
  laneHeight(
    resource: ResourceModel,
    events: ReadonlyArray<TimelineEvent<EventModel>>,
    axis: TimeAxis,
  ): number {
    const floor = Math.max(
      this.cfg.rowHeight,
      typeof resource.rowHeight === 'number' && resource.rowHeight > 0
        ? resource.rowHeight
        : 0,
    );
    if (!this.cfg.variableRowHeight || events.length === 0) {
      return Math.min(floor, this.cfg.maxRowHeight);
    }
    const { contentHeight } = layoutLane<EventModel>({
      rowId: resource.id,
      events,
      axis,
      rowHeight: floor,
      strategy: this.cfg.strategy,
    });
    return Math.min(Math.max(floor, contentHeight), this.cfg.maxRowHeight);
  }

  /**
   * Rebuild the offset index by measuring every lane. `resolver` returns the
   * (already resolved, recurrence-expanded) timeline events for a lane; passing
   * an empty list per lane yields uniform rows. Returns `this` for chaining.
   */
  measure(
    resources: ReadonlyArray<ResourceModel>,
    axis: TimeAxis,
    resolver: LaneEventsResolver,
  ): this {
    const n = resources.length;
    this.index = new OffsetIndex(n);
    this.heightsById.clear();
    this.topsById.clear();
    this.ids = new Array<RecordId>(n);

    let running = 0;
    for (let i = 0; i < n; i++) {
      const resource = resources[i]!;
      const events = resolver(resource, i);
      const h = this.laneHeight(resource, events, axis);
      this.index.setSize(i, h);
      this.ids[i] = resource.id;
      this.heightsById.set(resource.id, h);
      this.topsById.set(resource.id, running);
      running += h;
    }
    return this;
  }

  /** Top (content y) of lane at index `i`. */
  rowTop(i: number): number {
    return this.index.offsetOf(i);
  }

  /** Intrinsic height of lane at index `i`. */
  heightOf(i: number): number {
    return this.index.sizeOf(i);
  }

  /** Top (content y) of a lane by resource id, or `undefined` if unmeasured. */
  topOfId(id: RecordId): number | undefined {
    return this.topsById.get(id);
  }

  /** Intrinsic height of a lane by resource id, or `undefined` if unmeasured. */
  heightOfId(id: RecordId): number | undefined {
    return this.heightsById.get(id);
  }

  /** Total scrollable content height across all lanes. */
  total(): number {
    return this.index.total();
  }

  /** Index of the lane spanning content-pixel `px` (clamped to range). */
  indexAt(px: number): number {
    return this.index.indexAt(px);
  }

  /**
   * Live read-only view of lane tops keyed by resource id. The same Map instance
   * is reused across `measure()` calls (cleared + repopulated), so a consumer
   * (e.g. the orthogonal dependency router, which holds `rowOffsets` by
   * reference) sees fresh offsets without re-wiring.
   */
  get tops(): ReadonlyMap<RecordId, number> {
    return this.topsById;
  }

  /**
   * Compute the visible window for a scroll position + viewport height using the
   * variable offsets. Mirrors core `computeWindow` semantics (overscan, clamped
   * top, `endIndex` exclusive) but hit-tests against the offset index so dense
   * lanes are accounted for. Falls back to covering all rows when the viewport is
   * unsized (jsdom / pre-layout), matching the host's existing behavior.
   */
  rowWindow(scrollTop: number, viewportHeight: number): RowWindow {
    const count = this.count;
    const totalSize = this.total();
    if (count === 0 || totalSize === 0) {
      return { startIndex: 0, endIndex: 0, totalSize: 0, offset: 0 };
    }
    const overscan = this.cfg.overscan;
    // Unsized viewport → render everything (jsdom has no layout).
    if (viewportHeight <= 0) {
      return { startIndex: 0, endIndex: count, totalSize, offset: 0 };
    }
    const clampedTop = Math.max(0, Math.min(scrollTop, Math.max(0, totalSize - viewportHeight)));
    const firstVisible = this.index.indexAt(clampedTop);
    const lastVisible = this.index.indexAt(clampedTop + viewportHeight);

    const startIndex = Math.max(0, firstVisible - overscan);
    // `lastVisible` is the index spanning the bottom edge; +1 makes it inclusive,
    // +overscan pads, then clamp to count (exclusive end).
    const endIndex = Math.min(count, lastVisible + 1 + overscan);
    const offset = this.index.offsetOf(startIndex);
    return { startIndex, endIndex, totalSize, offset };
  }
}

/**
 * Convenience: map scheduler resolved events into the `TimelineEvent` shape the
 * layout/measurement expects. Kept here (not in the host) so the measuring path
 * is self-contained and testable. `editableOf` lets the caller mark recurrence
 * occurrences read-only exactly as the host's `paintBars` does.
 */
export function toTimelineEvents(
  resourceId: RecordId,
  records: ReadonlyArray<{ id: RecordId; span: TimeSpan; record: EventModel }>,
  editableOf?: (r: { id: RecordId; record: EventModel }) => boolean,
): TimelineEvent<EventModel>[] {
  return records.map((e) => {
    const ev: TimelineEvent<EventModel> = {
      id: e.id,
      rowId: resourceId,
      span: e.span,
      record: e.record,
    };
    if (e.record.percentDone !== undefined) ev.progress = e.record.percentDone;
    if (editableOf) ev.editable = editableOf(e);
    if (e.record.eventColor !== undefined) ev.styleKey = e.record.eventColor;
    return ev;
  });
}

/** Marker re-export so consumers can satisfy the generic `Model` constraint. */
export type { Model };
