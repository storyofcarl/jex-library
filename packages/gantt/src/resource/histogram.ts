/**
 * `@jects/gantt` — **Resource Histogram** view (Bryntum/DHTMLX
 * "ResourceHistogram" parity feature).
 *
 * A resource histogram is a per-resource, time-bucketed **allocation chart** that
 * shares the Gantt's time axis. For each resource it draws one bar per time
 * bucket whose height encodes how much of that resource is committed during the
 * bucket. The committed amount is the **sum of the concurrent assigned units**
 * across every task the resource works on whose span overlaps the bucket. When
 * that concurrent sum exceeds the resource's capacity (`capacity * 100`
 * percentage-points) the surplus is drawn as a distinct **over-allocation band**
 * stacked on top of the in-capacity portion — the canonical "this person is
 * double-booked" signal.
 *
 * The allocation is **working-time aware**: a resource that is only available
 * part of a bucket (weekends/holidays via its calendar) contributes its units
 * weighted by the working overlap inside that bucket, so a Mon–Fri resource shows
 * no load in a Sat/Sun bucket even if a task technically spans it.
 *
 * Architecture (mirrors the other resource features — fully additive, contract-pure):
 *   - {@link computeHistogram} is a PURE function (no DOM, no time-axis): it takes
 *     resources + resolved assignments + task spans + a bucket plan (+ optional
 *     per-resource working-time calculators) and returns the per-resource,
 *     per-bucket allocation series with over-allocation flags. Fully unit-testable.
 *   - {@link ResourceHistogramView} is a framework-free `Widget` that renders those
 *     series as rows of bars positioned against a shared {@link TimeAxis}. It is
 *     presentation-only: it reads a {@link ResourceApi} + axis and repaints.
 *   - {@link GanttResourceHistogramFeature} is a `GanttFeature` that locates the
 *     installed `ResourceManager` (the {@link ResourceApi}), reuses the Gantt's
 *     `timeline.axis`, and mounts the view in an owned panel — ZERO edits to the
 *     `Gantt` class. It repaints on schedule/assignment changes.
 *
 * All times are epoch milliseconds (UTC); durations are milliseconds — consistent
 * with the rest of the Gantt contract.
 */

import './histogram.css';
import { Widget, createEl, register, type Model, type RecordId } from '@jects/core';
import type { WidgetConfig, WidgetEvents } from '@jects/core';
import type {
  TimeMs,
  DurationMs,
  TimeSpan,
  TimeAxis,
} from '@jects/timeline-core';

/**
 * Minimal working-time calculator contract used to weight allocations by a
 * resource's calendar. Any object exposing `workingDurationBetween` (e.g. one
 * derived from a `WorkingTimeCalendar`) satisfies it. Declared locally because
 * `@jects/timeline-core` does not export a calculator type.
 */
export interface WorkingTimeCalculator {
  /** Working duration (ms) between two epoch-ms instants `[start, end)`. */
  workingDurationBetween(start: TimeMs, end: TimeMs): DurationMs;
}
import type {
  GanttApi,
  GanttFeature,
  TaskModel,
} from '../contract.js';
import type {
  ResourceModel,
  ResourceApi,
} from './resource-contract.js';

/* ═══════════════════════════════════════════════════════════════════════════
   1. PUBLIC CONFIG / EVENT / RESULT TYPES
   ═══════════════════════════════════════════════════════════════════════════ */

/** The time granularity each histogram bucket spans. */
export type HistogramBucketUnit = 'hour' | 'day' | 'week' | 'month';

/** Full units of a single FTE (100% = one full-time unit). */
export const FULL_UNITS = 100;

/** Default bucket granularity. */
export const DEFAULT_BUCKET_UNIT: HistogramBucketUnit = 'day';

/**
 * A single time bucket: a half-open `[start, end)` span plus the amount of
 * **working time** the project calendar provides inside it (used to weight
 * partial-availability spans). `workingMs` defaults to the whole span when no
 * calendar is supplied.
 */
export interface HistogramBucket {
  /** Bucket span `[start, end)`, epoch ms. */
  span: TimeSpan;
}

/** Allocation for one resource within one bucket. */
export interface HistogramCell {
  /** The bucket this cell belongs to (index into the bucket plan). */
  bucketIndex: number;
  /** Bucket span (mirrored for convenience). */
  span: TimeSpan;
  /**
   * Concurrent assigned units active in this bucket (percentage-points; 100 =
   * one full FTE for the whole bucket). Weighted by the working overlap of each
   * task span inside the bucket, so a task covering half the bucket's working
   * time at 100% contributes 50.
   */
  units: number;
  /** Capacity ceiling for the resource (percentage-points = `capacity * 100`). */
  capacityUnits: number;
  /** Units within capacity (`min(units, capacityUnits)`). */
  allocated: number;
  /** Units beyond capacity (`max(0, units - capacityUnits)`); 0 when not over. */
  overAllocated: number;
  /** Whether this bucket is over-allocated (`units > capacityUnits`). */
  isOver: boolean;
}

/** The full allocation series for one resource across all buckets. */
export interface HistogramSeries<R extends Model = Model> {
  /** The resource this series is for. */
  resource: ResourceModel<R>;
  /** Capacity ceiling (percentage-points). */
  capacityUnits: number;
  /** Per-bucket cells, aligned to the bucket plan order. */
  cells: HistogramCell[];
  /** Peak concurrent units across all buckets (the y-axis high-water mark). */
  peak: number;
  /** Whether ANY bucket is over-allocated. */
  hasOver: boolean;
}

/** The computed histogram for the whole resource set. */
export interface HistogramResult<R extends Model = Model> {
  /** The bucket plan the series are aligned to. */
  buckets: HistogramBucket[];
  /** One series per resource (in resource order). */
  series: HistogramSeries<R>[];
  /** Peak concurrent units across every resource/bucket (global y-scale). */
  globalPeak: number;
}

/**
 * A task's effective scheduling span for the histogram. The feature builds these
 * from the live engine; the pure core only needs the span + the assignment.
 */
export interface HistogramTaskSpan {
  taskId: RecordId;
  span: TimeSpan;
}

/** A resolved (resource, task, units) edge the pure core consumes. */
export interface HistogramAssignment {
  resourceId: RecordId;
  taskId: RecordId;
  /** Allocation percentage (100 = full time). */
  units: number;
}

/* ═══════════════════════════════════════════════════════════════════════════
   2. BUCKET PLANNING (pure)
   ═══════════════════════════════════════════════════════════════════════════ */

const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;
const MS_PER_WEEK = 7 * MS_PER_DAY;

/** Floor an epoch instant to the start of its bucket of `unit` (UTC). */
export function floorToBucket(time: TimeMs, unit: HistogramBucketUnit): TimeMs {
  switch (unit) {
    case 'hour':
      return Math.floor(time / MS_PER_HOUR) * MS_PER_HOUR;
    case 'day':
      return Math.floor(time / MS_PER_DAY) * MS_PER_DAY;
    case 'week': {
      // Weeks anchored to Monday. Epoch 0 (1970-01-01) is a Thursday, i.e. 3
      // days after the Monday that opens its week → shift by 3 days to align.
      const shifted = time + 3 * MS_PER_DAY;
      return Math.floor(shifted / MS_PER_WEEK) * MS_PER_WEEK - 3 * MS_PER_DAY;
    }
    case 'month': {
      const d = new Date(time);
      return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
    }
  }
}

/** Advance an epoch instant by one bucket of `unit` (UTC, month-aware). */
export function nextBucket(time: TimeMs, unit: HistogramBucketUnit): TimeMs {
  switch (unit) {
    case 'hour':
      return time + MS_PER_HOUR;
    case 'day':
      return time + MS_PER_DAY;
    case 'week':
      return time + MS_PER_WEEK;
    case 'month': {
      const d = new Date(time);
      return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
    }
  }
}

/**
 * Build the bucket plan covering `[range.start, range.end)` at `unit`
 * granularity. Buckets are aligned to natural boundaries (UTC midnight / Monday /
 * month-start) and clamped to the range at the edges so the first/last buckets
 * never extend past the requested range. Returns an empty plan for a non-positive
 * range. Capped at {@link MAX_BUCKETS} to stay bounded for pathological zooms.
 */
export function planBuckets(
  range: TimeSpan,
  unit: HistogramBucketUnit = DEFAULT_BUCKET_UNIT,
): HistogramBucket[] {
  const buckets: HistogramBucket[] = [];
  if (!(range.end > range.start)) return buckets;
  let cursor = floorToBucket(range.start, unit);
  let guard = 0;
  while (cursor < range.end && guard < MAX_BUCKETS) {
    const rawEnd = nextBucket(cursor, unit);
    const start = Math.max(cursor, range.start);
    const end = Math.min(rawEnd, range.end);
    if (end > start) buckets.push({ span: { start, end } });
    cursor = rawEnd;
    guard++;
  }
  return buckets;
}

/** Safety cap so a zoomed-out hour view can't allocate millions of buckets. */
export const MAX_BUCKETS = 2000;

/* ═══════════════════════════════════════════════════════════════════════════
   3. WORKING-OVERLAP (pure, calendar-aware)
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Working-time overlap (ms) between a task span and a bucket span, honoring a
 * resource's calendar. With no calculator, this is the plain wall-clock overlap.
 * With a calculator it is the working ms inside the intersection — so non-working
 * weekends/holidays inside the bucket don't inflate the resource's load.
 */
export function workingOverlap(
  taskSpan: TimeSpan,
  bucketSpan: TimeSpan,
  calc?: WorkingTimeCalculator,
): DurationMs {
  const start = Math.max(taskSpan.start, bucketSpan.start);
  const end = Math.min(taskSpan.end, bucketSpan.end);
  if (!(end > start)) return 0;
  if (!calc) return end - start;
  return Math.max(0, calc.workingDurationBetween(start, end));
}

/**
 * The working ms the resource is *available* inside a bucket — i.e. the working
 * duration of the whole bucket span. Used as the denominator when weighting a
 * task's contribution, so a 100%-units task that covers all the working time of a
 * bucket contributes a full 100 units, regardless of weekend padding.
 */
export function bucketWorkingMs(
  bucketSpan: TimeSpan,
  calc?: WorkingTimeCalculator,
): DurationMs {
  if (!calc) return Math.max(0, bucketSpan.end - bucketSpan.start);
  return Math.max(0, calc.workingDurationBetween(bucketSpan.start, bucketSpan.end));
}

/* ═══════════════════════════════════════════════════════════════════════════
   4. THE PURE HISTOGRAM COMPUTATION
   ═══════════════════════════════════════════════════════════════════════════ */

/** Input bundle for {@link computeHistogram}. */
export interface ComputeHistogramInput<R extends Model = Model> {
  /** Resources to compute series for (the histogram rows, in order). */
  resources: ReadonlyArray<ResourceModel<R>>;
  /** Resolved (resource,task,units) edges. */
  assignments: ReadonlyArray<HistogramAssignment>;
  /** Task scheduling spans, keyed by task id. */
  taskSpans: ReadonlyMap<RecordId, TimeSpan>;
  /** The bucket plan (from {@link planBuckets}). */
  buckets: ReadonlyArray<HistogramBucket>;
  /**
   * Optional resolver for a resource's working-time calculator (drives
   * calendar-aware weighting). Returning `undefined` treats the resource as
   * always-available (wall-clock weighting).
   */
  calculatorFor?:
    | ((resource: ResourceModel<R>) => WorkingTimeCalculator | undefined)
    | undefined;
}

/**
 * Compute the per-resource, time-bucketed allocation histogram.
 *
 * For each resource and each bucket it sums, over every assignment the resource
 * holds, that assignment's `units` weighted by the fraction of the bucket's
 * **working time** its task span occupies:
 *
 *   cell.units = Σ_assignments  units_a · (workingOverlap(taskSpan_a, bucket) / bucketWorkingMs)
 *
 * Two fully-overlapping 100%-units tasks therefore yield 200 in a bucket — the
 * concurrent over-allocation the band visualises. A task that only covers half a
 * bucket's working time at 100% contributes 50. The capacity ceiling is
 * `resource.capacity * 100`; the surplus above it is the over-allocation.
 *
 * Pure: no DOM, no axis, no global state. Deterministic given its inputs.
 */
export function computeHistogram<R extends Model = Model>(
  input: ComputeHistogramInput<R>,
): HistogramResult<R> {
  const { resources, assignments, taskSpans, buckets } = input;
  const bucketArr = buckets as HistogramBucket[];

  // Index assignments by resource for O(assignments) total work.
  const byResource = new Map<RecordId, HistogramAssignment[]>();
  for (const a of assignments) {
    const list = byResource.get(a.resourceId);
    if (list) list.push(a);
    else byResource.set(a.resourceId, [a]);
  }

  let globalPeak = 0;
  const series: HistogramSeries<R>[] = [];

  for (const resource of resources) {
    const calc = input.calculatorFor?.(resource);
    const capacity =
      typeof resource.capacity === 'number' && Number.isFinite(resource.capacity)
        ? resource.capacity
        : 1;
    // `cost` resources have no time dimension → no capacity ceiling concept.
    const capacityUnits =
      resource.type === 'cost' ? Number.POSITIVE_INFINITY : Math.max(0, capacity) * FULL_UNITS;

    const resAssignments = byResource.get(resource.id) ?? [];
    // Precompute each bucket's working denominator once per resource.
    const cells: HistogramCell[] = [];
    let peak = 0;
    let hasOver = false;

    for (let b = 0; b < bucketArr.length; b++) {
      const bucket = bucketArr[b]!;
      const denom = bucketWorkingMs(bucket.span, calc);
      let units = 0;
      if (denom > 0) {
        for (const a of resAssignments) {
          const taskSpan = taskSpans.get(a.taskId);
          if (!taskSpan) continue;
          const overlap = workingOverlap(taskSpan, bucket.span, calc);
          if (overlap <= 0) continue;
          units += a.units * (overlap / denom);
        }
      }
      units = roundUnits(units);
      const allocated = Math.min(units, capacityUnits);
      const over = Math.max(0, units - capacityUnits);
      const isOver = over > OVER_EPSILON;
      if (isOver) hasOver = true;
      if (units > peak) peak = units;
      cells.push({
        bucketIndex: b,
        span: bucket.span,
        units,
        capacityUnits,
        allocated: roundUnits(allocated),
        overAllocated: roundUnits(over),
        isOver,
      });
    }

    if (peak > globalPeak) globalPeak = peak;
    series.push({ resource, capacityUnits, cells, peak, hasOver });
  }

  return { buckets: bucketArr, series, globalPeak };
}

/** Tolerance (percentage-points) below which over-allocation is treated as zero. */
const OVER_EPSILON = 0.01;

/** Round units to 2 decimals to avoid floating-point fuzz in the output. */
function roundUnits(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

/* ═══════════════════════════════════════════════════════════════════════════
   5. THE VIEW WIDGET
   ═══════════════════════════════════════════════════════════════════════════ */

// Distinct block name (`-chart`) so this additive, axis-sharing chart never
// collides with any other `jects-resource-histogram` markup mounted in parallel.
const BLOCK = 'jects-resource-histogram-chart';

/** Configuration for {@link ResourceHistogramView}. */
export interface ResourceHistogramViewConfig<
  T extends Model = Model,
  R extends Model = Model,
> extends WidgetConfig {
  /** Resource surface to read resources + assignments from. */
  api: ResourceApi<T, R>;
  /** Shared time axis (the Gantt's `timeline.axis`) used to position bars. */
  axis: TimeAxis;
  /** Resolve a task's scheduling span (defaults to reading the task model). */
  taskSpanFor?(taskId: RecordId): TimeSpan | undefined;
  /** Lookup a task by id (for the default span resolver). */
  getTask?(taskId: RecordId): TaskModel<T> | undefined;
  /** Bucket granularity. Default `'day'`. */
  bucketUnit?: HistogramBucketUnit;
  /** Pixel height of each resource row. Default 48. */
  rowHeight?: number;
  /** Resolve a resource's working-time calculator (calendar honoring). */
  calculatorFor?(resource: ResourceModel<R>): WorkingTimeCalculator | undefined;
  /** Only render resources of these types (default: all but `cost`). */
  resourceTypes?: ReadonlyArray<ResourceModel<R>['type']>;
  /** Accessible label for the chart region. Default `'Resource histogram'`. */
  label?: string;
}

/** Events emitted by {@link ResourceHistogramView}. */
export interface ResourceHistogramViewEvents extends WidgetEvents {
  /** A bucket bar was activated (click / Enter / Space). */
  bucketActivate: {
    resourceId: RecordId;
    bucketIndex: number;
    cell: HistogramCell;
    native: Event;
  };
  /** The histogram was (re)computed and painted. */
  histogramPaint: { result: HistogramResult };
}

/**
 * Renders a {@link HistogramResult} as a stack of resource rows, each row a band
 * of per-bucket bars positioned against the shared time axis. Over-allocated
 * surplus is drawn as a separate stacked segment with its own modifier class. The
 * widget is presentation-only and fully re-render-idempotent.
 */
export class ResourceHistogramView<
  T extends Model = Model,
  R extends Model = Model,
> extends Widget<ResourceHistogramViewConfig<T, R>, ResourceHistogramViewEvents> {
  /**
   * Last computed result (exposed for tests / external readouts). NOT declared
   * with a field initializer: the `Widget` base calls `render()` from its
   * constructor (before subclass field initializers would run), so an `= null`
   * initializer would clobber the value set during that first render. We assign
   * it in `render()` and read it through a lazy getter.
   */
  private lastResult?: HistogramResult<R> | null;

  protected override defaults(): Partial<ResourceHistogramViewConfig<T, R>> {
    return {
      bucketUnit: DEFAULT_BUCKET_UNIT,
      rowHeight: 48,
      label: 'Resource histogram',
    } as Partial<ResourceHistogramViewConfig<T, R>>;
  }

  protected buildEl(): HTMLElement {
    const el = createEl('div', { className: BLOCK });
    el.setAttribute('role', 'group');
    return el;
  }

  protected override render(): void {
    const el = this.el;
    el.setAttribute('aria-label', this.config.label ?? 'Resource histogram');
    const result = this.compute();
    this.lastResult = result;
    el.replaceChildren();

    const axis = this.config.axis;
    const rowHeight = this.config.rowHeight ?? 48;
    // Size the chart to the axis content so it lines up under the Gantt bars.
    el.style.width = `${Math.max(0, axis.contentWidth)}px`;

    if (result.series.length === 0) {
      const empty = createEl('div', {
        className: `${BLOCK}__empty`,
        text: 'No resources',
      });
      el.append(empty);
      return;
    }

    const scaleMax = Math.max(result.globalPeak, 1);

    for (const s of result.series) {
      el.append(this.buildRow(s, scaleMax, rowHeight));
    }

    this.emit('histogramPaint', {
      result: result as unknown as HistogramResult,
    });
  }

  /** Recompute the current histogram from the live API + axis range. */
  private compute(): HistogramResult<R> {
    const { api, axis } = this.config;
    const unit = this.config.bucketUnit ?? DEFAULT_BUCKET_UNIT;
    const range: TimeSpan = { start: axis.range.start, end: axis.range.end };
    const buckets = planBuckets(range, unit);

    const resources = this.visibleResources();
    const taskSpans = new Map<RecordId, TimeSpan>();
    const assignments: HistogramAssignment[] = [];

    for (const resource of resources) {
      for (const resolved of api.getAssignmentsOf(resource.id)) {
        const taskId = resolved.assignment.taskId;
        if (!taskSpans.has(taskId)) {
          const span = this.spanOf(taskId);
          if (span) taskSpans.set(taskId, span);
        }
        if (taskSpans.has(taskId)) {
          assignments.push({ resourceId: resource.id, taskId, units: resolved.units });
        }
      }
    }

    return computeHistogram<R>({
      resources,
      assignments,
      taskSpans,
      buckets,
      calculatorFor: this.config.calculatorFor,
    });
  }

  private visibleResources(): ReadonlyArray<ResourceModel<R>> {
    const all = this.config.api.getResources();
    const types = this.config.resourceTypes;
    if (types) return all.filter((r) => types.includes(r.type));
    // Default: skip pure cost lines (no time dimension to chart).
    return all.filter((r) => r.type !== 'cost');
  }

  private spanOf(taskId: RecordId): TimeSpan | undefined {
    const custom = this.config.taskSpanFor?.(taskId);
    if (custom && custom.end > custom.start) return custom;
    const task = this.config.getTask?.(taskId);
    if (!task) return undefined;
    const start = task.start;
    const end = task.end;
    if (typeof start === 'number' && typeof end === 'number' && end > start) {
      return { start, end };
    }
    return undefined;
  }

  /** Build one resource row (label gutter + bucket bars). */
  private buildRow(
    series: HistogramSeries<R>,
    scaleMax: number,
    rowHeight: number,
  ): HTMLElement {
    const { resource } = series;
    const name = (resource.name as string | undefined) ?? String(resource.id);

    const row = createEl('div', {
      className: `${BLOCK}__row${series.hasOver ? ` ${BLOCK}__row--over` : ''}`,
    });
    row.setAttribute('role', 'group');
    row.setAttribute(
      'aria-label',
      `${name}: peak ${formatUnits(series.peak)}% allocation` +
        (series.hasOver ? ', over-allocated' : ''),
    );
    row.dataset.resourceId = String(resource.id);
    row.style.height = `${rowHeight}px`;

    // Capacity guide line (where capacity*100 sits on the y-scale).
    if (Number.isFinite(series.capacityUnits)) {
      const capRatio = clamp01(series.capacityUnits / scaleMax);
      const guide = createEl('div', { className: `${BLOCK}__capacity` });
      guide.style.bottom = `${capRatio * 100}%`;
      guide.setAttribute('aria-hidden', 'true');
      row.append(guide);
    }

    const axis = this.config.axis;
    for (const cell of series.cells) {
      const x = axis.toX(cell.span.start);
      const w = Math.max(1, axis.toX(cell.span.end) - x);
      row.append(this.buildBar(resource.id, name, cell, x, w, scaleMax));
    }
    return row;
  }

  /** Build one bucket bar (allocated segment + optional over band). */
  private buildBar(
    resourceId: RecordId,
    resourceName: string,
    cell: HistogramCell,
    x: number,
    width: number,
    scaleMax: number,
  ): HTMLElement {
    const bar = createEl('div', {
      className: `${BLOCK}__bar${cell.isOver ? ` ${BLOCK}__bar--over` : ''}`,
    });
    bar.style.left = `${x}px`;
    bar.style.width = `${width}px`;
    bar.dataset.bucketIndex = String(cell.bucketIndex);
    bar.dataset.units = String(cell.units);
    bar.tabIndex = 0;
    bar.setAttribute('role', 'button');
    bar.setAttribute(
      'aria-label',
      `${resourceName}, ${formatBucket(cell.span)}: ${formatUnits(cell.units)}% allocated` +
        (cell.isOver ? `, ${formatUnits(cell.overAllocated)}% over capacity` : ''),
    );

    const allocRatio = clamp01(cell.allocated / scaleMax);
    const overRatio = clamp01(cell.overAllocated / scaleMax);

    if (allocRatio > 0) {
      const fill = createEl('div', { className: `${BLOCK}__fill` });
      fill.style.height = `${allocRatio * 100}%`;
      fill.setAttribute('aria-hidden', 'true');
      bar.append(fill);
    }
    if (overRatio > 0) {
      const over = createEl('div', { className: `${BLOCK}__over` });
      over.style.height = `${overRatio * 100}%`;
      over.style.bottom = `${allocRatio * 100}%`;
      over.setAttribute('aria-hidden', 'true');
      bar.append(over);
    }

    const activate = (native: Event): void => {
      this.emit('bucketActivate', {
        resourceId,
        bucketIndex: cell.bucketIndex,
        cell,
        native,
      });
    };
    bar.addEventListener('click', activate);
    bar.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        activate(e);
      }
    });
    return bar;
  }

  /** Force a repaint (e.g. after an external schedule/assignment change). */
  repaint(): void {
    this.render();
  }

  /**
   * The last computed result (for tests / external readouts). Recomputes lazily
   * if no paint has happened since construction (the base `Widget` constructor
   * renders before subclass field initializers run, so the first-render cache is
   * reset to `undefined` — see {@link lastResult}).
   */
  getResult(): HistogramResult<R> | null {
    if (this.lastResult == null) this.lastResult = this.compute();
    return this.lastResult;
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   6. HELPERS
   ═══════════════════════════════════════════════════════════════════════════ */

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/** Compact, locale-free units formatting (drops trailing `.00`). */
function formatUnits(n: number): string {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

/** Compact UTC date label for a bucket's start. */
function formatBucket(span: TimeSpan): string {
  const d = new Date(span.start);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/* ═══════════════════════════════════════════════════════════════════════════
   7. THE GANTT FEATURE
   ═══════════════════════════════════════════════════════════════════════════ */

const PANEL_CLASS = 'jects-gantt__histogram-panel';

/** Configuration for {@link GanttResourceHistogramFeature}. */
export interface GanttResourceHistogramConfig<
  T extends Model = Model,
  R extends Model = Model,
> {
  /**
   * The resource surface. When omitted, the feature locates the installed
   * `ResourceManager` from `api.features` (it is itself a `ResourceApi`).
   */
  resourceApi?: ResourceApi<T, R>;
  /** Bucket granularity. Default `'day'`. */
  bucketUnit?: HistogramBucketUnit;
  /** Pixel height of each resource row. Default 48. */
  rowHeight?: number;
  /** Resolve a resource's working-time calculator (calendar honoring). */
  calculatorFor?(resource: ResourceModel<R>): WorkingTimeCalculator | undefined;
  /** Restrict to specific resource types. */
  resourceTypes?: ReadonlyArray<ResourceModel<R>['type']>;
  /** Accessible label for the chart region. */
  label?: string;
  /**
   * Host element to mount the panel into. When omitted, an owned panel is
   * appended after the Gantt root element so it shares the horizontal scroll.
   */
  mountInto?: HTMLElement;
}

/**
 * The Resource Histogram `GanttFeature`. It is additive and contract-pure: it
 * reaches into the Gantt ONLY through the public `GanttApi` (timeline axis, task
 * reads, events, `track`) and through a located `ResourceApi`. It owns one panel
 * containing a {@link ResourceHistogramView}, and repaints it whenever the
 * schedule, a task, or an assignment changes — coalesced to one frame.
 */
export class GanttResourceHistogramFeature<
  T extends Model = Model,
  R extends Model = Model,
> implements GanttFeature<T> {
  readonly name = 'resourceHistogram';

  private readonly config: GanttResourceHistogramConfig<T, R>;
  private view: ResourceHistogramView<T, R> | null = null;
  private panel: HTMLElement | null = null;
  private ownsPanel = false;
  private disposers: Array<() => void> = [];
  private rafId = 0;
  private destroyed = false;

  constructor(config: GanttResourceHistogramConfig<T, R> = {}) {
    this.config = { ...config };
  }

  /** The mounted view (for tests / external control). */
  getView(): ResourceHistogramView<T, R> | null {
    return this.view;
  }

  /** The current computed histogram (or `null` before first paint). */
  getResult(): HistogramResult<R> | null {
    return this.view?.getResult() ?? null;
  }

  init(api: GanttApi<T>): void {
    this.destroyed = false;
    this.disposers = [];

    const resourceApi = this.resolveResourceApi(api);
    if (!resourceApi) {
      // No resource layer installed → the feature is a no-op (but still tracked
      // for clean teardown). It does not throw; resources may be added later.
      api.track(() => this.destroy());
      return;
    }

    // Mount panel.
    const panel = this.config.mountInto ?? this.createOwnedPanel(api.el);
    this.panel = panel;

    // Assemble the view config WITHOUT explicit-`undefined` optional props
    // (the repo runs `exactOptionalPropertyTypes`, which rejects them).
    const viewConfig: ResourceHistogramViewConfig<T, R> = {
      api: resourceApi,
      axis: api.timeline.axis,
      getTask: (id) => api.getTask(id),
      taskSpanFor: (id) => {
        const sched = api.getSchedule(id);
        if (sched && sched.end > sched.start) {
          return { start: sched.start, end: sched.end };
        }
        const task = api.getTask(id);
        if (task && typeof task.start === 'number' && typeof task.end === 'number') {
          return { start: task.start, end: task.end };
        }
        return undefined;
      },
    };
    if (this.config.bucketUnit !== undefined) viewConfig.bucketUnit = this.config.bucketUnit;
    if (this.config.rowHeight !== undefined) viewConfig.rowHeight = this.config.rowHeight;
    if (this.config.calculatorFor !== undefined) viewConfig.calculatorFor = this.config.calculatorFor;
    if (this.config.resourceTypes !== undefined) viewConfig.resourceTypes = this.config.resourceTypes;
    if (this.config.label !== undefined) viewConfig.label = this.config.label;

    const view = new ResourceHistogramView<T, R>(panel, viewConfig);
    this.view = view;

    // Repaint on schedule / task changes (spans move).
    this.disposers.push(api.on('scheduleChange', () => this.schedulePaint()));
    this.disposers.push(api.on('taskChange', () => this.schedulePaint()));
    // Repaint on assignment changes routed through the host Gantt emitter.
    this.disposers.push(
      (api as unknown as {
        on(e: string, fn: () => void): () => void;
      }).on('assign', () => this.schedulePaint()),
    );
    this.disposers.push(
      (api as unknown as {
        on(e: string, fn: () => void): () => void;
      }).on('unassign', () => this.schedulePaint()),
    );

    api.track(() => this.destroy());
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
    for (const off of this.disposers) {
      try {
        off();
      } catch {
        /* best-effort */
      }
    }
    this.disposers = [];
    this.view?.destroy();
    this.view = null;
    if (this.ownsPanel) this.panel?.remove();
    this.panel = null;
    this.ownsPanel = false;
  }

  /** Repaint immediately (synchronous). */
  repaint(): void {
    this.view?.repaint();
  }

  /* ── internals ─────────────────────────────────────────────────────────── */

  private resolveResourceApi(api: GanttApi<T>): ResourceApi<T, R> | undefined {
    if (this.config.resourceApi) return this.config.resourceApi;
    // The ResourceManager registers itself under 'resourceManager' and IS-A
    // ResourceApi.
    const feature = api.features.get('resourceManager');
    if (feature && isResourceApi<T, R>(feature)) return feature;
    // Fall back to scanning all features for one satisfying the surface.
    for (const f of api.features.values()) {
      if (isResourceApi<T, R>(f)) return f;
    }
    return undefined;
  }

  private createOwnedPanel(ganttEl: HTMLElement): HTMLElement {
    const panel = createEl('div', { className: PANEL_CLASS });
    panel.setAttribute('role', 'region');
    panel.setAttribute('aria-label', this.config.label ?? 'Resource histogram');
    // Append as a sibling AFTER the Gantt root so it appears below the chart.
    ganttEl.insertAdjacentElement('afterend', panel);
    this.ownsPanel = true;
    return panel;
  }

  private schedulePaint(): void {
    if (this.rafId || this.destroyed) return;
    const raf =
      typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame
        : (cb: FrameRequestCallback): number => {
            queueMicrotask(() => cb(0));
            return 1;
          };
    this.rafId = raf(() => {
      this.rafId = 0;
      this.view?.repaint();
    });
  }
}

/** Structural check: does a feature satisfy the {@link ResourceApi} surface? */
function isResourceApi<T extends Model, R extends Model>(
  x: unknown,
): x is ResourceApi<T, R> {
  const o = x as Partial<ResourceApi<T, R>> | null;
  return (
    !!o &&
    typeof o.getResources === 'function' &&
    typeof o.getAssignmentsOf === 'function' &&
    typeof o.isOverAllocated === 'function'
  );
}

/** Factory mirroring the other Gantt feature creators. */
export function createResourceHistogram<
  T extends Model = Model,
  R extends Model = Model,
>(config?: GanttResourceHistogramConfig<T, R>): GanttResourceHistogramFeature<T, R> {
  return new GanttResourceHistogramFeature<T, R>(config);
}

register(
  'resourceHistogramView',
  ResourceHistogramView as unknown as new (
    host: HTMLElement | string,
    config?: Record<string, unknown>,
  ) => ResourceHistogramView,
);
