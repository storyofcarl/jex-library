/**
 * `ResourceHistogram` — the Gantt **Resource Histogram** view (Bryntum/DHTMLX
 * "ResourceHistogram" parity feature).
 *
 * A time-phased histogram pane that, for every resource, draws its **allocated
 * units / effort per time bucket** as a column chart, overlaid with the
 * resource's **capacity line**, and highlights the buckets where the resource is
 * **over-allocated** (allocation exceeds capacity). It shares the Gantt's time
 * axis, so each histogram column lines up horizontally with the task bars that
 * drive it — pan/zoom the Gantt and the histogram re-projects in lockstep.
 *
 * Bryntum/DHTMLX behaviour mirrored here:
 *   - One lane per resource (people / equipment), in resource order, optionally
 *     filtered/sorted by the consumer.
 *   - Each lane is a stack of vertical bars, one per time bucket (day / week /
 *     month — driven by `bucketMs`), whose height encodes the summed assigned
 *     **units** active in that bucket (a percentage; 100 = one full-time unit).
 *   - A horizontal **capacity line** marks `capacity * 100` units; any bucket
 *     whose allocation rises above it is shaded with the over-allocation accent
 *     and the lane is flagged as over-allocated.
 *   - A bucket's allocation is the **overlap-weighted** sum of each assignment's
 *     units: an assignment whose task only covers half the bucket contributes
 *     half its units, so a histogram column reflects average load across the
 *     bucket exactly like the reference products.
 *
 * Architecture (concurrency-safe, contract-pure — mirrors `ResourceAssignmentView`
 * and the `ProgressLine` feature):
 *   - A standalone framework-free `Widget` (its own root + CSS). It does NOT edit
 *     the `Gantt` class, the timeline view, or the contract. It reads two public
 *     surfaces only: a `ResourceApi` (resources + resolved assignments + the
 *     over-allocation predicate) and a `@jects/timeline-core` `TimeAxis` (the
 *     shared time⇄pixel projection). The integrator hands it the Gantt's own axis
 *     (`gantt.timeline.axis`) so the panes share one axis.
 *   - The time-phasing itself is a PURE function (`computeHistogram`) over plain
 *     typed input, so the allocation math is fully unit-testable without a DOM or
 *     a live Gantt.
 *   - `refresh()` re-reads the model + axis and repaints; call it from the
 *     integrator on `scheduleChange` / `assign` / axis `setView`. All listeners
 *     and DOM are released on `destroy()`.
 *
 * All times are epoch milliseconds (UTC); durations are milliseconds — same as
 * the rest of the Gantt contract.
 */

import './resource-histogram.css';
import { Widget, createEl, register, type Model, type RecordId } from '@jects/core';
import type { WidgetConfig, WidgetEvents } from '@jects/core';
import type { TimeMs, DurationMs, TimeAxis, TimeSpan } from '@jects/timeline-core';
import type { ResourceApi, ResourceModel } from '../resource/resource-contract.js';

const BLOCK = 'jects-resource-histogram';
const FULL_UNITS = 100;
const DAY_MS = 86_400_000;

/* ═══════════════════════════════════════════════════════════════════════════
   1. PURE TIME-PHASING MODEL (unit-testable, no DOM, no axis)
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * A single resource's allocation for the histogram math: its capacity (in
 * FTE-equivalents, so `capacity * 100` is its unit ceiling) plus the time-bounded
 * allocation segments that load it. A segment is one assignment projected onto a
 * task span: `units` percent active across `[start, end)`.
 */
export interface HistogramResourceInput {
  /** Resource id. */
  id: RecordId;
  /** Display name (falls back to the id). */
  name?: string;
  /** Capacity in FTE units (`1` = one full-time unit). Used for the ceiling. */
  capacity: number;
  /** Whether this resource has no time component (cost resource — excluded). */
  isCost?: boolean;
  /** The time-bounded allocation segments loading this resource. */
  segments: ReadonlyArray<AllocationSegment>;
}

/** One assignment projected onto a task span: `units`% active over `[start,end)`. */
export interface AllocationSegment {
  /** The task driving this segment (for tooltips / drill-down). */
  taskId: RecordId;
  /** Segment start (epoch ms, inclusive). */
  start: TimeMs;
  /** Segment end (epoch ms, exclusive). */
  end: TimeMs;
  /** Allocation percentage active across the segment (100 = full time). */
  units: number;
}

/** The bucketing scheme: a uniform grid of `size` ms tiling the covered range. */
export interface HistogramBucketing {
  /** The time range the histogram covers (typically the shared axis range). */
  range: TimeSpan;
  /** Bucket width in ms (e.g. one day). Clamped to a sane minimum. */
  size: DurationMs;
  /**
   * Optional grid origin (epoch ms). When set, the bucket boundaries are
   * phase-aligned to this instant *and* the grid starts at it — so the first
   * column begins exactly at `anchor` rather than at the (typically week-padded)
   * `range.start`. Pass the project/data origin so the first rendered column
   * lines up with the timeline x of that instant and no empty leading-padding
   * columns are emitted. When omitted, the grid is anchored at `range.start`.
   */
  anchor?: TimeMs;
}

/** A computed bucket for one resource: its allocation vs capacity. */
export interface HistogramBucket {
  /** Bucket start (epoch ms, inclusive). */
  start: TimeMs;
  /** Bucket end (epoch ms, exclusive). */
  end: TimeMs;
  /**
   * Overlap-weighted allocated units active across this bucket: the average load
   * the resource carries over the bucket (a percentage). `0` = idle.
   */
  units: number;
  /** The capacity ceiling for this bucket (`capacity * 100`). */
  capacityUnits: number;
  /** Whether allocation exceeds capacity in this bucket (over-allocated). */
  over: boolean;
}

/** A computed lane for one resource: its buckets + summary flags. */
export interface HistogramLane {
  /** Resource id. */
  resourceId: RecordId;
  /** Resource display name. */
  name: string;
  /** Capacity ceiling in units (`capacity * 100`). */
  capacityUnits: number;
  /** Per-bucket allocation. */
  buckets: ReadonlyArray<HistogramBucket>;
  /** Peak allocation across all buckets (drives the lane's vertical scale). */
  peakUnits: number;
  /** Whether ANY bucket is over-allocated. */
  over: boolean;
}

/** The full computed histogram model. */
export interface HistogramModel {
  /** Bucket boundaries shared by every lane (uniform grid). */
  bucketStarts: ReadonlyArray<TimeMs>;
  /** Bucket width in ms. */
  bucketSize: DurationMs;
  /** Per-resource lanes (in input order). */
  lanes: ReadonlyArray<HistogramLane>;
  /** The maximum units any lane reaches (for a shared vertical scale). */
  globalPeakUnits: number;
}

/** Clamp a bucket size to a positive, finite number (default one day). */
function normalizeBucketSize(size: number | undefined): number {
  if (typeof size !== 'number' || !Number.isFinite(size) || size <= 0) return DAY_MS;
  // A bucket must be at least one minute to avoid pathological grids.
  return Math.max(60_000, size);
}

/**
 * Build the uniform bucket grid tiling `range` with `size`-ms buckets. By default
 * the grid is anchored at `range.start`. When `anchor` is supplied, the bucket
 * boundaries are phase-aligned to it and the grid begins at the first boundary
 * `>= anchor` that is also `>= range.start` — i.e. the grid starts at the data
 * origin, dropping empty leading-padding columns so the first column lines up
 * with the timeline x of `anchor`. The last bucket never spills past `range.end`.
 * Returns the inclusive bucket starts.
 */
export function buildBuckets(bucketing: HistogramBucketing): {
  starts: number[];
  size: number;
} {
  const size = normalizeBucketSize(bucketing.size);
  const { start, end } = bucketing.range;
  const starts: number[] = [];
  if (!(end > start)) return { starts, size };
  // Resolve the grid origin. With an anchor, snap to the first on-phase boundary
  // at/after both the anchor and the range start (so leading padding is dropped);
  // otherwise anchor at the range start.
  let gridStart = start;
  if (bucketing.anchor != null && Number.isFinite(bucketing.anchor)) {
    const anchor = bucketing.anchor;
    if (anchor >= start) {
      gridStart = anchor;
    } else {
      // Phase-align: first boundary at/after `start` on the anchor's grid.
      const steps = Math.ceil((start - anchor) / size);
      gridStart = anchor + steps * size;
    }
  }
  for (let t = gridStart; t < end; t += size) starts.push(t);
  return { starts, size };
}

/**
 * The overlap (ms) of `[aStart, aEnd)` with `[bStart, bEnd)`. Never negative.
 */
function overlapMs(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}

/**
 * Time-phase a set of resources into a bucketed histogram model. Pure — given
 * the resource inputs and the bucketing it returns the per-resource per-bucket
 * allocation with over-allocation flags, doing NO DOM or axis work.
 *
 * For each bucket and resource, the allocation is the **overlap-weighted** sum of
 * every segment's units:
 *
 *   bucketUnits = Σ_segments  units · overlap(segment, bucket) / bucketWidth
 *
 * so a segment covering the whole bucket contributes its full units, and one
 * covering half the bucket contributes half — i.e. the column is the resource's
 * average load over the bucket. Over-allocation is `bucketUnits > capacity*100`
 * (with a small epsilon so exactly-full does not flag). Cost resources are
 * skipped (no time component).
 */
export function computeHistogram(
  resources: ReadonlyArray<HistogramResourceInput>,
  bucketing: HistogramBucketing,
): HistogramModel {
  const { starts, size } = buildBuckets(bucketing);
  const lanes: HistogramLane[] = [];
  let globalPeak = 0;

  for (const resource of resources) {
    if (resource.isCost) continue;
    const capacityUnits = Math.max(0, (resource.capacity || 0) * FULL_UNITS);
    const buckets: HistogramBucket[] = [];
    let peak = 0;
    let laneOver = false;

    for (const bStart of starts) {
      const bEnd = bStart + size;
      let units = 0;
      for (const seg of resource.segments) {
        if (seg.end <= bStart || seg.start >= bEnd) continue;
        const ov = overlapMs(seg.start, seg.end, bStart, bEnd);
        if (ov <= 0) continue;
        // Weight the units by the fraction of the bucket the segment covers, so
        // the column is the average load across the bucket.
        units += normUnits(seg.units) * (ov / size);
      }
      units = round2(units);
      // Epsilon guards floating-point dust around the capacity ceiling.
      const over = units > capacityUnits + 1e-6;
      if (over) laneOver = true;
      if (units > peak) peak = units;
      buckets.push({ start: bStart, end: bEnd, units, capacityUnits, over });
    }

    const lanePeak = Math.max(peak, capacityUnits);
    if (lanePeak > globalPeak) globalPeak = lanePeak;
    lanes.push({
      resourceId: resource.id,
      name: resource.name ?? String(resource.id),
      capacityUnits,
      buckets,
      peakUnits: peak,
      over: laneOver,
    });
  }

  return {
    bucketStarts: starts,
    bucketSize: size,
    lanes,
    globalPeakUnits: Math.max(globalPeak, FULL_UNITS),
  };
}

function normUnits(u: number): number {
  return typeof u === 'number' && Number.isFinite(u) && u > 0 ? u : 0;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/* ═══════════════════════════════════════════════════════════════════════════
   2. WIDGET CONFIG / EVENTS
   ═══════════════════════════════════════════════════════════════════════════ */

/** How a resource segment's span is resolved from the task it points at. */
export interface TaskSpanResolver {
  (taskId: RecordId): { start?: TimeMs; end?: TimeMs } | undefined;
}

/** Configuration for the {@link ResourceHistogram} widget. */
export interface ResourceHistogramConfig<
  T extends Model = Model,
  R extends Model = Model,
> extends WidgetConfig {
  /** The resource surface to read resources + assignments + over-allocation from. */
  api: ResourceApi<T, R>;
  /**
   * The SHARED time axis (typically `gantt.timeline.axis`) that projects time ⇄
   * pixels, so histogram columns line up with the Gantt bars. The histogram is
   * read-only against it — it never mutates the axis.
   */
  axis: TimeAxis;
  /**
   * Resolve a task's span. The integrator passes the Gantt's task lookup
   * (`(id) => gantt.getTask(id)`); the histogram intersects these spans with its
   * buckets. When omitted, segments cannot be time-phased and lanes render empty.
   */
  getTaskSpan?: TaskSpanResolver;
  /**
   * Bucket width in ms. Defaults to one day. Pick a coarser bucket (a week /
   * month in ms) to summarise long projects.
   */
  bucketMs?: DurationMs;
  /**
   * Restrict the lanes to these resource ids (in this order). When omitted, every
   * non-cost resource is shown in resource order.
   */
  resourceIds?: ReadonlyArray<RecordId>;
  /** Lane height in px (the drawable column area). Default `48`. */
  laneHeight?: number;
  /** Accessible label for the whole histogram region. Default `'Resource histogram'`. */
  label?: string;
  /** Show the per-bucket numeric allocation as a title tooltip. Default `true`. */
  showTooltips?: boolean;
}

/** Typed events the histogram emits. */
export interface ResourceHistogramEvents extends WidgetEvents {
  /** A histogram column was activated (click / Enter / Space on a bucket bar). */
  bucketActivate: {
    resourceId: RecordId;
    bucketStart: TimeMs;
    bucketEnd: TimeMs;
    units: number;
    over: boolean;
    native: Event;
  };
  /** The histogram was recomputed + repainted. */
  histogramRender: { model: HistogramModel };
}

/* ═══════════════════════════════════════════════════════════════════════════
   3. THE WIDGET
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * The Resource Histogram pane. Presentation-only: it reads its `ResourceApi` +
 * shared `TimeAxis`, time-phases the allocations via {@link computeHistogram},
 * and paints one labelled lane per resource. It never mutates the model; the
 * integrator calls {@link ResourceHistogram.refresh} when the schedule or
 * assignments change (or the axis is zoomed/panned).
 */
export class ResourceHistogram<
  T extends Model = Model,
  R extends Model = Model,
> extends Widget<ResourceHistogramConfig<T, R>, ResourceHistogramEvents> {
  /** Last computed model (for tests / external readouts). */
  private model: HistogramModel | null = null;

  protected override defaults(): Partial<ResourceHistogramConfig<T, R>> {
    return {
      bucketMs: DAY_MS,
      laneHeight: 48,
      label: 'Resource histogram',
      showTooltips: true,
    } as Partial<ResourceHistogramConfig<T, R>>;
  }

  protected buildEl(): HTMLElement {
    const el = createEl('div', { className: BLOCK });
    el.setAttribute('role', 'group');
    return el;
  }

  protected override render(): void {
    const { label } = this.config;
    this.el.setAttribute('aria-label', label ?? 'Resource histogram');
    this.paint();
  }

  /**
   * Re-read the model + axis and repaint. Idempotent; safe to call on every
   * `scheduleChange` / `assign` / axis change. Returns the freshly computed model.
   */
  refresh(): HistogramModel {
    return this.paint();
  }

  /** The last computed histogram model (or `null` before first paint). */
  getModel(): HistogramModel | null {
    return this.model;
  }

  /* ── input assembly (ResourceApi + task spans → pure-fn input) ──────────── */

  /**
   * Assemble the pure-function input from the `ResourceApi` + the task-span
   * resolver: for each in-scope resource, project every assignment onto its
   * task's span to produce an {@link AllocationSegment}. Exposed for tests.
   */
  buildInput(): HistogramResourceInput[] {
    const { api, getTaskSpan, resourceIds } = this.config;
    const resources = this.selectResources(api.getResources(), resourceIds);
    const out: HistogramResourceInput[] = [];
    for (const resource of resources) {
      const isCost = resource.type === 'cost';
      const segments: AllocationSegment[] = [];
      if (!isCost && getTaskSpan) {
        for (const resolved of api.getAssignmentsOf(resource.id)) {
          const span = getTaskSpan(resolved.assignment.taskId);
          const start = span?.start;
          const end = span?.end;
          if (start == null || end == null || !(end > start)) continue;
          segments.push({
            taskId: resolved.assignment.taskId,
            start,
            end,
            units: resolved.units,
          });
        }
      }
      out.push({
        id: resource.id,
        name: (resource.name as string | undefined) ?? String(resource.id),
        capacity: typeof resource.capacity === 'number' ? resource.capacity : 1,
        isCost,
        segments,
      });
    }
    return out;
  }

  /**
   * The earliest segment start across all in-scope resources, as an `{ anchor }`
   * partial to spread into the bucketing. Returns `{}` when there is no data, so
   * the grid falls back to anchoring at the axis range start.
   */
  private dataOriginOf(
    input: ReadonlyArray<HistogramResourceInput>,
  ): { anchor?: TimeMs } {
    let min = Infinity;
    for (const resource of input) {
      for (const seg of resource.segments) {
        if (seg.start < min) min = seg.start;
      }
    }
    return Number.isFinite(min) ? { anchor: min } : {};
  }

  private selectResources(
    all: ReadonlyArray<ResourceModel<R>>,
    ids: ReadonlyArray<RecordId> | undefined,
  ): ResourceModel<R>[] {
    if (!ids) return all.slice();
    const byId = new Map(all.map((r) => [r.id, r] as const));
    const out: ResourceModel<R>[] = [];
    for (const id of ids) {
      const r = byId.get(id);
      if (r) out.push(r);
    }
    return out;
  }

  /* ── painting ────────────────────────────────────────────────────────────── */

  /** (Re)compute + draw the histogram for the current model + axis. Idempotent. */
  paint(): HistogramModel {
    const { axis } = this.config;
    const input = this.buildInput();
    const model = computeHistogram(input, {
      range: axis.range,
      size: this.config.bucketMs ?? DAY_MS,
      // Anchor the grid to the data origin so the first column lines up with the
      // timeline x of the earliest assignment, dropping empty leading padding.
      ...this.dataOriginOf(input),
    });
    this.model = model;

    this.el.replaceChildren();

    if (model.lanes.length === 0) {
      const empty = createEl('div', {
        className: `${BLOCK}__empty`,
        text: 'No resources to display',
      });
      this.el.append(empty);
      this.emit('histogramRender', { model });
      return model;
    }

    for (const lane of model.lanes) {
      this.el.append(this.buildLane(lane));
    }
    this.emit('histogramRender', { model });
    return model;
  }

  private buildLane(lane: HistogramLane): HTMLElement {
    const { axis, laneHeight } = this.config;
    const height = laneHeight ?? 48;
    const peak = Math.max(this.model?.globalPeakUnits ?? FULL_UNITS, lane.capacityUnits, 1);

    const laneEl = createEl('div', {
      className: `${BLOCK}__lane${lane.over ? ` ${BLOCK}__lane--over` : ''}`,
    });
    laneEl.setAttribute('role', 'group');
    laneEl.dataset.resourceId = String(lane.resourceId);
    laneEl.setAttribute(
      'aria-label',
      `${lane.name}: peak ${Math.round(lane.peakUnits)}% of ${Math.round(lane.capacityUnits)}% capacity` +
        (lane.over ? ' (over-allocated)' : ''),
    );

    // Lane header: resource name + over-allocation flag.
    const header = createEl('div', { className: `${BLOCK}__lane-header` });
    const nameEl = createEl('span', { className: `${BLOCK}__lane-name`, text: lane.name });
    header.append(nameEl);
    if (lane.over) {
      const flag = createEl('span', {
        className: `${BLOCK}__overflag`,
        text: 'over',
      });
      flag.setAttribute('aria-hidden', 'true');
      header.append(flag);
    }
    laneEl.append(header);

    // Plot area: time-positioned bucket bars + capacity line.
    const plot = createEl('div', { className: `${BLOCK}__plot` });
    plot.style.height = `${height}px`;
    plot.style.setProperty('--_hist-width', `${Math.max(axis.contentWidth, 1)}px`);
    plot.style.width = `${Math.max(axis.contentWidth, 1)}px`;

    // Capacity line: a horizontal rule at `capacityUnits / peak` of the height.
    if (lane.capacityUnits > 0) {
      const capLine = createEl('div', { className: `${BLOCK}__capacity` });
      const capFrac = clamp01(lane.capacityUnits / peak);
      capLine.style.bottom = `${(capFrac * 100).toFixed(2)}%`;
      capLine.setAttribute('aria-hidden', 'true');
      plot.append(capLine);
    }

    for (const bucket of lane.buckets) {
      const bar = this.buildBar(lane, bucket, axis, peak, height);
      if (bar) plot.append(bar);
    }

    laneEl.append(plot);
    return laneEl;
  }

  private buildBar(
    lane: HistogramLane,
    bucket: HistogramBucket,
    axis: TimeAxis,
    peak: number,
    height: number,
  ): HTMLElement | null {
    const box = axis.spanToBox({ start: bucket.start, end: bucket.end });
    const width = Math.max(0, box.width);
    if (width <= 0) return null;

    const bar = createEl('button', {
      className:
        `${BLOCK}__bar` + (bucket.over ? ` ${BLOCK}__bar--over` : '') +
        (bucket.units <= 0 ? ` ${BLOCK}__bar--empty` : ''),
    });
    bar.type = 'button';
    bar.style.left = `${box.x}px`;
    bar.style.width = `${width}px`;
    // Height encodes allocation as a fraction of the shared vertical peak. Bars
    // are anchored to the lane floor (column chart).
    const frac = clamp01(bucket.units / peak);
    bar.style.height = `${(frac * height).toFixed(2)}px`;
    bar.dataset.bucketStart = String(bucket.start);
    bar.dataset.units = String(bucket.units);
    if (bucket.over) bar.dataset.over = 'true';

    const label =
      `${lane.name}, ${formatDate(bucket.start)}: ` +
      `${Math.round(bucket.units)}% allocated of ${Math.round(bucket.capacityUnits)}% capacity` +
      (bucket.over ? ' — over-allocated' : '');
    bar.setAttribute('aria-label', label);
    if (this.config.showTooltips !== false) bar.title = label;

    const activate = (native: Event): void => {
      this.emit('bucketActivate', {
        resourceId: lane.resourceId,
        bucketStart: bucket.start,
        bucketEnd: bucket.end,
        units: bucket.units,
        over: bucket.over,
        native,
      });
    };
    bar.addEventListener('click', activate);
    return bar;
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   4. HELPERS
   ═══════════════════════════════════════════════════════════════════════════ */

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/** Compact UTC date (YYYY-MM-DD) for accessible labels. */
function formatDate(ms: number): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Convenience factory mirroring the other Gantt view/feature creators. */
export function createResourceHistogram<
  T extends Model = Model,
  R extends Model = Model,
>(
  host: HTMLElement | string,
  config: ResourceHistogramConfig<T, R>,
): ResourceHistogram<T, R> {
  return new ResourceHistogram<T, R>(host, config);
}

register(
  'resourceHistogram',
  ResourceHistogram as unknown as new (
    host: HTMLElement | string,
    config?: Record<string, unknown>,
  ) => ResourceHistogram,
);
