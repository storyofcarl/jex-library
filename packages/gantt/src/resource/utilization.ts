/**
 * `@jects/gantt` — **Resource Utilization** view (the Bryntum/DHTMLX
 * `ResourceUtilization` grid). A tabular **resources(rows) × time-buckets(cols)**
 * matrix: every cell shows how much of a resource's available capacity is
 * allocated in that bucket, flagging **over-allocation** (allocation exceeds
 * availability) and **idle** (zero allocation while available). Each resource row
 * expands to a set of **per-task breakdown rows** — one per task the resource
 * works on — so a planner can see *which* assignment drives a hot cell.
 *
 * This is DISTINCT from the histogram (a per-resource bar chart over time): the
 * utilization view is a dense spreadsheet-style grid optimised for scanning many
 * resources × many buckets at once, with drill-down.
 *
 * Architecture (contract-first, additive, concurrency-safe):
 *
 *   1. {@link UtilizationMatrix} — a PURE, DOM-free computation over the
 *      {@link ResourceApi} + a {@link UtilizationTimeAxis}. It distributes each
 *      assignment's effort across the buckets its task overlaps (proportional to
 *      the working overlap of the task span with each bucket), measures each
 *      resource's bucket availability from its capacity, and reports allocated /
 *      available / over per cell. Fully unit-testable in jsdom.
 *
 *   2. {@link ResourceUtilizationView} — a framework-free `@jects/core` `Widget`
 *      that renders the matrix as an ARIA `grid` (the @jects/grid contract:
 *      role=grid/row/columnheader/rowheader/gridcell), with expand/collapse of
 *      per-task breakdown rows, keyboard navigation, and token-pure cells whose
 *      intensity encodes the allocation ratio. Reads the matrix; never mutates
 *      the model.
 *
 * It touches the `Gantt` class through nothing — it is constructed from a
 * `ResourceApi` (e.g. a `ResourceManager`) and is wired by the integrator (see
 * the returned wireNotes). All times are epoch milliseconds (UTC); durations are
 * milliseconds — same as the scheduling contract.
 */

import './utilization.css';
import { Widget, createEl, register, type Model, type RecordId } from '@jects/core';
import type { WidgetConfig, WidgetEvents } from '@jects/core';
import type { ResolvedAssignment, ResourceApi, ResourceModel } from './resource-contract.js';

const MS_PER_HOUR = 3_600_000;
const BLOCK = 'jects-resource-util';

/* ═══════════════════════════════════════════════════════════════════════════
   1. TIME AXIS (bucketing)
   ═══════════════════════════════════════════════════════════════════════════ */

/** A single time bucket (column) in the utilization grid: a `[start, end)` span. */
export interface UtilizationBucket {
  /** Stable bucket index (0-based). */
  index: number;
  /** Bucket start (epoch ms, inclusive). */
  start: number;
  /** Bucket end (epoch ms, exclusive). */
  end: number;
  /** Pre-formatted column header label (e.g. "Wk 03", "Mar"). */
  label: string;
}

/** Granularity of the time axis buckets. */
export type UtilizationGranularity = 'day' | 'week' | 'month';

/**
 * The time axis the matrix buckets allocation into. Either supply explicit
 * `buckets`, or a `{ start, end, granularity }` range the axis discretises.
 */
export interface UtilizationTimeAxis {
  /** Explicit buckets (takes precedence over a range). */
  buckets?: UtilizationBucket[];
  /** Range start (epoch ms) — used with `granularity` when `buckets` is absent. */
  start?: number;
  /** Range end (epoch ms, exclusive). */
  end?: number;
  /** Bucket size when discretising a range. Default `'week'`. */
  granularity?: UtilizationGranularity;
  /** Optional custom header formatter (overrides the built-in per-granularity one). */
  formatHeader?: (bucket: { start: number; end: number; index: number }) => string;
}

const DAY_MS = 86_400_000;

/** UTC-midnight floor of a timestamp. */
function floorDayUTC(t: number): number {
  return Math.floor(t / DAY_MS) * DAY_MS;
}

/** Monday-start week floor (ISO) in UTC. */
function floorWeekUTC(t: number): number {
  const day = floorDayUTC(t);
  const dow = new Date(day).getUTCDay(); // 0=Sun..6=Sat
  const isoOffset = (dow + 6) % 7; // days since Monday
  return day - isoOffset * DAY_MS;
}

/** Start of month (UTC) for a timestamp. */
function floorMonthUTC(t: number): number {
  const d = new Date(t);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

/** First day of the next month (UTC). */
function nextMonthUTC(t: number): number {
  const d = new Date(t);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
}

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_LABELS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/** ISO week number (1..53) for a UTC timestamp. */
function isoWeekNumber(t: number): number {
  const d = new Date(floorDayUTC(t));
  // Shift to the Thursday of this ISO week, then count weeks from Jan 1.
  const dow = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dow + 3);
  const firstThursday = Date.UTC(d.getUTCFullYear(), 0, 4);
  const ft = new Date(firstThursday);
  const ftDow = (ft.getUTCDay() + 6) % 7;
  const week1Monday = firstThursday - ftDow * DAY_MS + 3 * DAY_MS; // Thursday of week 1
  return 1 + Math.round((d.getTime() - week1Monday) / (7 * DAY_MS));
}

function defaultHeader(granularity: UtilizationGranularity, start: number): string {
  switch (granularity) {
    case 'day': {
      const d = new Date(start);
      return `${WEEKDAY_LABELS[d.getUTCDay()]} ${d.getUTCDate()}`;
    }
    case 'month': {
      const d = new Date(start);
      return `${MONTH_LABELS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
    }
    case 'week':
    default:
      return `Wk ${String(isoWeekNumber(start)).padStart(2, '0')}`;
  }
}

/**
 * Resolve a {@link UtilizationTimeAxis} config into a concrete bucket list.
 * Pure; exported for testing.
 */
export function resolveBuckets(axis: UtilizationTimeAxis): UtilizationBucket[] {
  if (axis.buckets && axis.buckets.length > 0) {
    // Re-index to guarantee contiguous 0-based indices.
    return axis.buckets.map((b, index) => ({ ...b, index }));
  }
  const granularity = axis.granularity ?? 'week';
  if (typeof axis.start !== 'number' || typeof axis.end !== 'number' || axis.end <= axis.start) {
    return [];
  }
  const out: UtilizationBucket[] = [];
  let cursor =
    granularity === 'day'
      ? floorDayUTC(axis.start)
      : granularity === 'week'
        ? floorWeekUTC(axis.start)
        : floorMonthUTC(axis.start);
  let index = 0;
  // Hard cap to avoid pathological ranges blowing up the grid.
  const MAX_BUCKETS = 1024;
  while (cursor < axis.end && index < MAX_BUCKETS) {
    const next =
      granularity === 'day'
        ? cursor + DAY_MS
        : granularity === 'week'
          ? cursor + 7 * DAY_MS
          : nextMonthUTC(cursor);
    const label = axis.formatHeader
      ? axis.formatHeader({ start: cursor, end: next, index })
      : defaultHeader(granularity, cursor);
    out.push({ index, start: cursor, end: next, label });
    cursor = next;
    index++;
  }
  return out;
}

/* ═══════════════════════════════════════════════════════════════════════════
   2. MATRIX MODEL (computed)
   ═══════════════════════════════════════════════════════════════════════════ */

/** A single resource×bucket cell of allocation figures. */
export interface UtilizationCell {
  /** Bucket index this cell belongs to. */
  bucket: number;
  /**
   * Allocated effort in this bucket, expressed in **hours** (a resource-agnostic
   * unit so cells across resources are comparable).
   */
  allocated: number;
  /**
   * Available capacity in this bucket, in hours — `capacity × bucketWorkingHours`.
   * `0` for `cost` resources (no time component).
   */
  available: number;
  /**
   * Allocation ratio `allocated / available` (0..∞). `0` when nothing available.
   * `> 1` ⇒ over-allocated.
   */
  ratio: number;
  /** Whether `allocated > available` (over-allocated). */
  over: boolean;
}

/** A per-task breakdown row under a resource row (drill-down). */
export interface UtilizationTaskRow {
  /** The task id. */
  taskId: RecordId;
  /** Display name (task name, else its id). */
  name: string;
  /** This task's contribution to each bucket (allocated hours), indexed by bucket. */
  cells: UtilizationCell[];
  /** Total allocated hours across all buckets (for the row total column). */
  total: number;
}

/** A resource row of the matrix, with its aggregate cells and drill-down rows. */
export interface UtilizationRow<R extends Model = Model> {
  /** The resource. */
  resource: ResourceModel<R>;
  /** Aggregate cell per bucket (sum of all this resource's task contributions). */
  cells: UtilizationCell[];
  /** Per-task drill-down rows (sorted by total allocation, descending). */
  tasks: UtilizationTaskRow[];
  /** Total allocated hours across all buckets. */
  totalAllocated: number;
  /** Total available hours across all buckets. */
  totalAvailable: number;
  /** Whether ANY bucket is over-allocated. */
  anyOver: boolean;
}

/** Options governing how the matrix distributes effort + measures availability. */
export interface UtilizationMatrixOptions {
  /**
   * Working hours per day used to convert a resource's capacity into available
   * hours per bucket. Default `8` (one FTE-day). A resource with `capacity = 2`
   * therefore supplies `16` hours/working-day.
   */
  hoursPerDay?: number;
  /**
   * Number of working days per calendar week, used to scale week/month bucket
   * availability. Default `5` (Mon–Fri).
   */
  workingDaysPerWeek?: number;
}

const DEFAULT_HOURS_PER_DAY = 8;
const DEFAULT_WORKING_DAYS_PER_WEEK = 5;

/** Resolve a task's effort (working ms): explicit `effort`, else span. */
function taskSpan(task: { start?: number; end?: number } | undefined): {
  start: number;
  end: number;
} | null {
  if (!task) return null;
  if (typeof task.start === 'number' && typeof task.end === 'number' && task.end > task.start) {
    return { start: task.start, end: task.end };
  }
  return null;
}

/** Overlap (ms) of `[aStart,aEnd)` with `[bStart,bEnd)`. */
function overlapMs(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}

/**
 * Fraction of a bucket's wall-clock span that is "working" — used to scale a
 * resource's nominal capacity down to working hours. We approximate working time
 * as `workingDaysPerWeek / 7` of the wall span; the histogram/calendar features
 * can supply a precise figure, but the utilization grid only needs a comparable
 * relative measure.
 */
function workingFractionForBucket(workingDaysPerWeek: number): number {
  return Math.min(1, Math.max(0, workingDaysPerWeek / 7));
}

/**
 * `UtilizationMatrix` — the pure, DOM-free computation engine. Construct it from
 * a {@link ResourceApi} and a {@link UtilizationTimeAxis}; read {@link rows}.
 * Rebuild via {@link compute} when the data changes.
 */
export class UtilizationMatrix<T extends Model = Model, R extends Model = Model> {
  readonly buckets: UtilizationBucket[];
  readonly hoursPerDay: number;
  readonly workingDaysPerWeek: number;

  private readonly api: ResourceApi<T, R>;
  private _rows: UtilizationRow<R>[] = [];

  constructor(
    api: ResourceApi<T, R>,
    axis: UtilizationTimeAxis,
    options: UtilizationMatrixOptions = {},
  ) {
    this.api = api;
    this.buckets = resolveBuckets(axis);
    this.hoursPerDay = positiveOr(options.hoursPerDay, DEFAULT_HOURS_PER_DAY);
    this.workingDaysPerWeek = positiveOr(
      options.workingDaysPerWeek,
      DEFAULT_WORKING_DAYS_PER_WEEK,
    );
    this.compute();
  }

  /** The computed resource rows (snapshot). */
  get rows(): ReadonlyArray<UtilizationRow<R>> {
    return this._rows;
  }

  /** Grand total allocated hours across every resource and bucket. */
  get grandTotalAllocated(): number {
    return this._rows.reduce((s, r) => s + r.totalAllocated, 0);
  }

  /** Whether any resource is over-allocated in any bucket. */
  get hasOverAllocation(): boolean {
    return this._rows.some((r) => r.anyOver);
  }

  /** Recompute every cell from the current {@link ResourceApi} state. */
  compute(): void {
    const resources = this.api.getResources();
    this._rows = resources.map((resource) => this.computeRow(resource));
  }

  /** Available hours for a resource in a single bucket (capacity × working hours). */
  availabilityFor(resource: ResourceModel<R>, bucket: UtilizationBucket): number {
    if (resource.type === 'cost' || resource.type === 'material') return 0;
    const capacity = typeof resource.capacity === 'number' ? resource.capacity : 1;
    const bucketDays = (bucket.end - bucket.start) / DAY_MS;
    const workingFraction = workingFractionForBucket(this.workingDaysPerWeek);
    return capacity * this.hoursPerDay * bucketDays * workingFraction;
  }

  private computeRow(resource: ResourceModel<R>): UtilizationRow<R> {
    const assignments = this.api.getAssignmentsOf(resource.id);
    // The task objects this resource works on (carry name + start/end span).
    const tasks = new Map<RecordId, { id: RecordId; name?: string; start?: number; end?: number }>();
    for (const t of this.api.getResourceTasks(resource.id)) {
      tasks.set(t.id, t as { id: RecordId; name?: string; start?: number; end?: number });
    }
    // Per-task accumulation: taskId → bucket allocated hours array.
    const taskBuckets = new Map<RecordId, { name: string; hours: number[] }>();

    for (const resolved of assignments) {
      this.accumulateAssignment(resolved, tasks, taskBuckets);
    }

    // Aggregate resource cells.
    const cells = this.buckets.map<UtilizationCell>((bucket) => {
      const available = this.availabilityFor(resource, bucket);
      let allocated = 0;
      for (const tb of taskBuckets.values()) allocated += tb.hours[bucket.index] ?? 0;
      return makeCell(bucket.index, allocated, available);
    });

    // Build per-task drill rows.
    const taskRows: UtilizationTaskRow[] = [];
    for (const [taskId, tb] of taskBuckets) {
      const taskCells = this.buckets.map<UtilizationCell>((bucket) => {
        const available = this.availabilityFor(resource, bucket);
        return makeCell(bucket.index, tb.hours[bucket.index] ?? 0, available);
      });
      const total = tb.hours.reduce((s, h) => s + (h ?? 0), 0);
      taskRows.push({ taskId, name: tb.name, cells: taskCells, total });
    }
    taskRows.sort((a, b) => b.total - a.total || String(a.taskId).localeCompare(String(b.taskId)));

    const totalAllocated = cells.reduce((s, c) => s + c.allocated, 0);
    const totalAvailable = cells.reduce((s, c) => s + c.available, 0);
    const anyOver = cells.some((c) => c.over);

    return { resource, cells, tasks: taskRows, totalAllocated, totalAvailable, anyOver };
  }

  /**
   * Distribute ONE resource's assignment effort for a task across the buckets the
   * task overlaps, proportional to the working overlap of the task span with each
   * bucket.
   *
   * Effort share is computed HERE (not taken from the resolved assignment) so it
   * is correct when multiple resources co-work a task: this resource's share is
   * `thisUnits / Σ(units of every resource on the task)`, multiplied by the task's
   * total effort. (The manager's `getAssignmentsOf` resolves each assignment in
   * isolation, so its `effort` would not account for co-assignees.)
   */
  private accumulateAssignment(
    resolved: ResolvedAssignment<R>,
    tasks: Map<RecordId, { id: RecordId; name?: string; start?: number; end?: number }>,
    taskBuckets: Map<RecordId, { name: string; hours: number[] }>,
  ): void {
    const taskId = resolved.assignment.taskId;
    const task = tasks.get(taskId);
    const span = taskSpan(task);

    // Total effort (hours) for the task, and this assignment's units share of it.
    const taskEffortHours = this.taskEffortHours(taskId, task);
    const thisUnits = normalizeNonNeg(resolved.assignment.units, 100);
    const totalUnits = this.totalUnitsOnTask(taskId);
    const share = totalUnits > 0 ? thisUnits / totalUnits : 0;
    const effortHours = taskEffortHours * share;
    if (effortHours <= 0) return;

    const name = (task?.name as string | undefined) ?? String(taskId);
    const entry =
      taskBuckets.get(taskId) ??
      taskBuckets.set(taskId, { name, hours: new Array(this.buckets.length).fill(0) }).get(taskId)!;

    if (!span) {
      // No span ⇒ pin all effort into the first bucket.
      if (entry.hours.length > 0) entry.hours[0]! += effortHours;
      return;
    }

    // Total overlap of the span with all buckets — the normaliser so the
    // distributed hours sum to the full effort even when the span pokes outside
    // the visible axis range.
    let totalOverlap = 0;
    for (const b of this.buckets) totalOverlap += overlapMs(span.start, span.end, b.start, b.end);
    if (totalOverlap <= 0) return; // span entirely outside the axis

    for (const b of this.buckets) {
      const ov = overlapMs(span.start, span.end, b.start, b.end);
      if (ov <= 0) continue;
      entry.hours[b.index]! += effortHours * (ov / totalOverlap);
    }
  }

  /** A task's total effort in hours (explicit effort, else span duration). */
  private taskEffortHours(
    taskId: RecordId,
    task: { start?: number; end?: number } | undefined,
  ): number {
    // The resolved assignments for the task carry the same `effort` per the
    // manager; sum them to recover the task's full effort without depending on
    // the wider GanttApi. (Σ of per-assignment effort = task effort.)
    const resolved = this.api.getAssignmentsFor(taskId);
    if (resolved.length > 0) {
      const sum = resolved.reduce((s, r) => s + r.effort, 0);
      if (sum > 0) return sum / MS_PER_HOUR;
    }
    const span = taskSpan(task);
    return span ? (span.end - span.start) / MS_PER_HOUR : 0;
  }

  /** Sum of units of every resource assigned to a task. */
  private totalUnitsOnTask(taskId: RecordId): number {
    return this.api
      .getAssignmentsFor(taskId)
      .reduce((s, r) => s + normalizeNonNeg(r.assignment.units, 100), 0);
  }
}

function normalizeNonNeg(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return fallback;
  return value;
}

function makeCell(bucket: number, allocated: number, available: number): UtilizationCell {
  const ratio = available > 0 ? allocated / available : allocated > 0 ? Infinity : 0;
  const over = allocated > available + 1e-9 && allocated > 0;
  return { bucket, allocated, available, ratio, over };
}

function positiveOr(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

/* ═══════════════════════════════════════════════════════════════════════════
   3. VIEW (Widget) — ARIA grid render of the matrix
   ═══════════════════════════════════════════════════════════════════════════ */

/** Formatting + interaction options for the view. */
export interface ResourceUtilizationViewConfig<
  T extends Model = Model,
  R extends Model = Model,
> extends WidgetConfig {
  /** The resource surface to read assignments + capacity from. */
  api: ResourceApi<T, R>;
  /** The time axis (buckets) the matrix distributes allocation across. */
  axis: UtilizationTimeAxis;
  /** Matrix distribution options (hours/day, working days/week). */
  matrix?: UtilizationMatrixOptions;
  /** Accessible label for the grid. Default `'Resource utilization'`. */
  label?: string;
  /** Header label for the leading (resource name) column. Default `'Resource'`. */
  resourceHeader?: string;
  /** Header label for the trailing total column. Default `'Total'`. */
  totalHeader?: string;
  /** Whether all resource rows start expanded. Default `false`. */
  expandedByDefault?: boolean;
  /**
   * Cell value formatter. Default renders allocated hours rounded to one decimal,
   * appending `h`. Return `''` to leave a cell blank.
   */
  formatCell?: (cell: UtilizationCell) => string;
}

export interface ResourceUtilizationViewEvents extends WidgetEvents {
  /** A resource row was expanded or collapsed. */
  toggleRow: { resourceId: RecordId; expanded: boolean };
  /** A grid cell was activated (click / Enter / Space). */
  cellActivate: {
    resourceId: RecordId;
    /** The task id when the cell is in a per-task drill row; `undefined` on a
     *  resource-aggregate cell. */
    taskId: RecordId | undefined;
    bucket: number;
    cell: UtilizationCell;
    native: Event;
  };
}

const DEFAULT_FORMAT = (cell: UtilizationCell): string =>
  cell.allocated > 0 ? `${roundTo(cell.allocated, 1)}h` : '';

function roundTo(n: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

/** Mutable per-view state kept off-instance (see the note in the class). */
interface ViewState<T extends Model, R extends Model> {
  matrix?: UtilizationMatrix<T, R>;
  expanded: Set<RecordId>;
  /** Active cell coordinate for roving-tabindex keyboard nav: [rowIdx, colIdx]. */
  active: [number, number];
}

/** WeakMap holding each view's mutable state, so it survives field-init ordering. */
const viewStates = new WeakMap<object, ViewState<Model, Model>>();

/**
 * `ResourceUtilizationView` — renders a {@link UtilizationMatrix} as an
 * accessible grid with expand/collapse drill-down and keyboard navigation.
 */
export class ResourceUtilizationView<
  T extends Model = Model,
  R extends Model = Model,
> extends Widget<ResourceUtilizationViewConfig<T, R>, ResourceUtilizationViewEvents> {
  // The Widget base calls `render()` from its CONSTRUCTOR, before any subclass
  // field initializer runs. With `useDefineForClassFields`, every declared class
  // field is (re)assigned to its initializer (or `undefined`) AFTER `super()`
  // returns — which would clobber anything the first `render()` stored. So we keep
  // all mutable view state in a module-level WeakMap keyed by the instance (no
  // class field ⇒ nothing to clobber), accessed via the getters below.
  private get state(): ViewState<T, R> {
    let s = viewStates.get(this) as ViewState<T, R> | undefined;
    if (!s) {
      s = { expanded: new Set<RecordId>(), active: [0, 0] };
      viewStates.set(this, s);
    }
    return s;
  }

  private get expanded(): Set<RecordId> {
    return this.state.expanded;
  }

  private get active(): [number, number] {
    return this.state.active;
  }

  private set active(v: [number, number]) {
    this.state.active = v;
  }

  private get matrix(): UtilizationMatrix<T, R> {
    return this.state.matrix!;
  }

  private set matrix(m: UtilizationMatrix<T, R>) {
    this.state.matrix = m;
  }

  protected override defaults(): Partial<ResourceUtilizationViewConfig<T, R>> {
    return {
      label: 'Resource utilization',
      resourceHeader: 'Resource',
      totalHeader: 'Total',
      expandedByDefault: false,
    } as Partial<ResourceUtilizationViewConfig<T, R>>;
  }

  protected buildEl(): HTMLElement {
    const el = createEl('div', { className: BLOCK });
    // `treegrid` (not `grid`): resource rows are expandable into per-task drill
    // rows, and `aria-expanded` on a row is only valid for treegrid semantics.
    el.setAttribute('role', 'treegrid');
    return el;
  }

  protected override render(): void {
    const { api, axis, matrix, label, expandedByDefault } = this.config;
    this.matrix = new UtilizationMatrix<T, R>(api, axis, matrix ?? {});
    if (expandedByDefault && this.expanded.size === 0) {
      for (const row of this.matrix.rows) this.expanded.add(row.resource.id);
    }
    this.el.setAttribute('aria-label', label ?? 'Resource utilization');
    this.el.setAttribute('aria-colcount', String(this.matrix.buckets.length + 2));
    this.paint();
  }

  /** Recompute the matrix from the current data and repaint (call on data change). */
  refresh(): void {
    this.matrix.compute();
    this.paint();
  }

  /** Programmatically expand/collapse a resource's drill-down rows. */
  setExpanded(resourceId: RecordId, expanded: boolean): void {
    if (expanded) this.expanded.add(resourceId);
    else this.expanded.delete(resourceId);
    this.paint();
    this.emit('toggleRow', { resourceId, expanded });
  }

  /** Whether a resource row is currently expanded. */
  isExpanded(resourceId: RecordId): boolean {
    return this.expanded.has(resourceId);
  }

  private paint(): void {
    this.el.replaceChildren();
    const { buckets } = this.matrix;
    const totalRows = 1 + this.visibleRowCount();
    this.el.setAttribute('aria-rowcount', String(totalRows));

    // ── header row ──────────────────────────────────────────────────────────
    const header = createEl('div', { className: `${BLOCK}__row ${BLOCK}__row--header` });
    header.setAttribute('role', 'row');
    header.setAttribute('aria-rowindex', '1');
    header.append(this.headerCell(this.config.resourceHeader ?? 'Resource', 1, `${BLOCK}__corner`));
    buckets.forEach((b, i) => {
      const cell = this.headerCell(b.label, i + 2);
      cell.dataset.bucket = String(b.index);
      header.append(cell);
    });
    header.append(this.headerCell(this.config.totalHeader ?? 'Total', buckets.length + 2));
    this.el.append(header);

    // ── body rows ───────────────────────────────────────────────────────────
    let rowIndex = 2; // aria-rowindex is 1-based; header is row 1
    this.matrix.rows.forEach((row) => {
      this.el.append(this.resourceRow(row, rowIndex));
      rowIndex++;
      if (this.expanded.has(row.resource.id)) {
        row.tasks.forEach((task) => {
          this.el.append(this.taskRow(row, task, rowIndex));
          rowIndex++;
        });
      }
    });

    this.applyRovingTabindex();
  }

  private visibleRowCount(): number {
    let n = 0;
    for (const row of this.matrix.rows) {
      n += 1;
      if (this.expanded.has(row.resource.id)) n += row.tasks.length;
    }
    return n;
  }

  private headerCell(text: string, colIndex: number, extra = ''): HTMLElement {
    const cell = createEl('div', {
      className: `${BLOCK}__cell ${BLOCK}__cell--header${extra ? ` ${extra}` : ''}`,
      text,
    });
    cell.setAttribute('role', 'columnheader');
    cell.setAttribute('aria-colindex', String(colIndex));
    return cell;
  }

  private resourceRow(row: UtilizationRow<R>, ariaRow: number): HTMLElement {
    const { resource } = row;
    const isExpanded = this.expanded.has(resource.id);
    const hasTasks = row.tasks.length > 0;
    const rowEl = createEl('div', {
      className: `${BLOCK}__row ${BLOCK}__row--resource${row.anyOver ? ` ${BLOCK}__row--over` : ''}`,
    });
    rowEl.setAttribute('role', 'row');
    rowEl.setAttribute('aria-rowindex', String(ariaRow));
    rowEl.setAttribute('aria-level', '1');
    rowEl.dataset.resourceId = String(resource.id);
    if (hasTasks) rowEl.setAttribute('aria-expanded', String(isExpanded));

    // row header (resource name + expander)
    const name = (resource.name as string | undefined) ?? String(resource.id);
    const head = createEl('div', { className: `${BLOCK}__cell ${BLOCK}__rowhead` });
    head.setAttribute('role', 'rowheader');
    head.setAttribute('aria-colindex', '1');

    if (hasTasks) {
      const twisty = createEl('button', {
        className: `${BLOCK}__twisty`,
        attrs: { type: 'button', 'aria-label': `${isExpanded ? 'Collapse' : 'Expand'} ${name}` },
        text: isExpanded ? '▾' : '▸',
      });
      twisty.addEventListener('click', (e) => {
        e.stopPropagation();
        this.setExpanded(resource.id, !this.expanded.has(resource.id));
      });
      head.append(twisty);
    } else {
      head.append(createEl('span', { className: `${BLOCK}__twisty ${BLOCK}__twisty--leaf` }));
    }
    head.append(createEl('span', { className: `${BLOCK}__name`, text: name }));
    if (row.anyOver) {
      const flag = createEl('span', {
        className: `${BLOCK}__over-flag`,
        text: '!',
        attrs: { 'aria-label': 'over-allocated' },
      });
      head.append(flag);
    }
    rowEl.append(head);

    // bucket cells
    row.cells.forEach((cell) => {
      rowEl.append(this.gridCell(resource.id, undefined, cell, 'resource'));
    });

    // total cell
    rowEl.append(this.totalCell(row.totalAllocated, row.totalAvailable, row.cells.length + 2));
    return rowEl;
  }

  private taskRow(
    row: UtilizationRow<R>,
    task: UtilizationTaskRow,
    ariaRow: number,
  ): HTMLElement {
    const rowEl = createEl('div', { className: `${BLOCK}__row ${BLOCK}__row--task` });
    rowEl.setAttribute('role', 'row');
    rowEl.setAttribute('aria-rowindex', String(ariaRow));
    rowEl.setAttribute('aria-level', '2');
    rowEl.dataset.resourceId = String(row.resource.id);
    rowEl.dataset.taskId = String(task.taskId);

    const head = createEl('div', { className: `${BLOCK}__cell ${BLOCK}__rowhead ${BLOCK}__rowhead--task` });
    head.setAttribute('role', 'rowheader');
    head.setAttribute('aria-colindex', '1');
    head.append(createEl('span', { className: `${BLOCK}__twisty ${BLOCK}__twisty--leaf` }));
    head.append(createEl('span', { className: `${BLOCK}__name`, text: task.name }));
    rowEl.append(head);

    task.cells.forEach((cell) => {
      rowEl.append(this.gridCell(row.resource.id, task.taskId, cell, 'task'));
    });
    rowEl.append(this.totalCell(task.total, 0, task.cells.length + 2));
    return rowEl;
  }

  private gridCell(
    resourceId: RecordId,
    taskId: RecordId | undefined,
    cell: UtilizationCell,
    kind: 'resource' | 'task',
  ): HTMLElement {
    const format = this.config.formatCell ?? DEFAULT_FORMAT;
    const text = format(cell);
    const el = createEl('div', {
      className: classForCell(cell, kind),
      text,
    });
    el.setAttribute('role', 'gridcell');
    el.setAttribute('aria-colindex', String(cell.bucket + 2));
    el.dataset.bucket = String(cell.bucket);
    el.dataset.resourceId = String(resourceId);
    if (taskId !== undefined) el.dataset.taskId = String(taskId);

    // Encode the allocation ratio as a token-scaled background intensity. We
    // clamp to [0,1] for the variable; over-allocation gets its own class.
    const intensity = Number.isFinite(cell.ratio) ? Math.min(1, Math.max(0, cell.ratio)) : 1;
    el.style.setProperty('--jects-util-ratio', intensity.toFixed(3));

    const pct =
      cell.available > 0
        ? `${Math.round(cell.ratio * 100)}% of capacity`
        : cell.allocated > 0
          ? `${roundTo(cell.allocated, 1)}h (no capacity)`
          : 'idle';
    const overLabel = cell.over ? ', over-allocated' : '';
    el.setAttribute(
      'aria-label',
      `${roundTo(cell.allocated, 1)} hours, ${pct}${overLabel}`,
    );

    const activate = (native: Event): void => {
      this.emit('cellActivate', { resourceId, taskId, bucket: cell.bucket, cell, native });
    };
    el.addEventListener('click', activate);
    return el;
  }

  private totalCell(allocated: number, available: number, colIndex: number): HTMLElement {
    const el = createEl('div', {
      className: `${BLOCK}__cell ${BLOCK}__cell--total`,
      text: allocated > 0 ? `${roundTo(allocated, 1)}h` : '',
    });
    el.setAttribute('role', 'gridcell');
    el.setAttribute('aria-colindex', String(colIndex));
    const suffix = available > 0 ? ` of ${roundTo(available, 1)} available` : '';
    el.setAttribute('aria-label', `${roundTo(allocated, 1)} hours total${suffix}`);
    return el;
  }

  /* ── roving tabindex + keyboard navigation (ARIA grid) ──────────────────── */

  private rowEls(): HTMLElement[] {
    return [...this.el.querySelectorAll<HTMLElement>(`.${BLOCK}__row`)];
  }

  private applyRovingTabindex(): void {
    const rows = this.rowEls();
    // Clamp the active coordinate into range after a structural change.
    this.active[0] = Math.min(this.active[0], rows.length - 1);
    rows.forEach((rowEl, r) => {
      const cells = [...rowEl.children] as HTMLElement[];
      this.active[1] = Math.min(this.active[1], cells.length - 1);
      cells.forEach((cell, c) => {
        const isActive = r === this.active[0] && c === this.active[1];
        cell.tabIndex = isActive ? 0 : -1;
      });
    });
    // Wire one keydown handler on the grid root (delegated).
    if (!this.el.dataset.keysBound) {
      this.el.addEventListener('keydown', (e) => this.onKeydown(e));
      this.el.dataset.keysBound = '1';
    }
  }

  private onKeydown(e: KeyboardEvent): void {
    const rows = this.rowEls();
    if (rows.length === 0) return;
    let [r, c] = this.active;
    const cellCount = (idx: number): number => rows[idx]?.children.length ?? 0;
    switch (e.key) {
      case 'ArrowRight':
        c = Math.min(c + 1, cellCount(r) - 1);
        break;
      case 'ArrowLeft':
        c = Math.max(c - 1, 0);
        break;
      case 'ArrowDown':
        r = Math.min(r + 1, rows.length - 1);
        c = Math.min(c, cellCount(r) - 1);
        break;
      case 'ArrowUp':
        r = Math.max(r - 1, 0);
        c = Math.min(c, cellCount(r) - 1);
        break;
      case 'Home':
        c = 0;
        break;
      case 'End':
        c = cellCount(r) - 1;
        break;
      case 'Enter':
      case ' ': {
        const cell = rows[r]?.children[c] as HTMLElement | undefined;
        if (cell) {
          e.preventDefault();
          // A twisty inside a rowheader toggles; a gridcell activates.
          const twisty = cell.querySelector<HTMLButtonElement>(`.${BLOCK}__twisty`);
          if (twisty && twisty.tagName === 'BUTTON') twisty.click();
          else cell.click();
        }
        return;
      }
      default:
        return;
    }
    e.preventDefault();
    this.active = [r, c];
    this.focusActive();
  }

  private focusActive(): void {
    const rows = this.rowEls();
    rows.forEach((rowEl, r) => {
      [...rowEl.children].forEach((cell, ci) => {
        const el = cell as HTMLElement;
        const isActive = r === this.active[0] && ci === this.active[1];
        el.tabIndex = isActive ? 0 : -1;
        if (isActive) el.focus();
      });
    });
  }
}

function classForCell(cell: UtilizationCell, kind: 'resource' | 'task'): string {
  const parts = [`${BLOCK}__cell`, `${BLOCK}__cell--${kind}`];
  if (cell.over) parts.push(`${BLOCK}__cell--over`);
  else if (cell.allocated <= 0 && cell.available > 0) parts.push(`${BLOCK}__cell--idle`);
  else if (cell.allocated > 0) parts.push(`${BLOCK}__cell--alloc`);
  return parts.join(' ');
}

/** Factory mirroring the other view/feature creators. */
export function createResourceUtilizationView<T extends Model = Model, R extends Model = Model>(
  host: HTMLElement | string,
  config: ResourceUtilizationViewConfig<T, R>,
): ResourceUtilizationView<T, R> {
  return new ResourceUtilizationView<T, R>(host, config);
}

register(
  'resourceUtilizationView',
  ResourceUtilizationView as unknown as new (
    host: HTMLElement | string,
    config?: Record<string, unknown>,
  ) => ResourceUtilizationView,
);
