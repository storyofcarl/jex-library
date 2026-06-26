/**
 * `@jects/gantt` — RESOURCE UTILIZATION VIEW (Bryntum / DHTMLX parity).
 *
 * The tabular, drill-down counterpart to the resource *histogram*. Where the
 * histogram draws bars per period, this view is a spreadsheet-style grid:
 *
 *   - ROWS are resources (people / equipment), each expandable to the tasks they
 *     are assigned to (a two-level `treegrid` drill-down).
 *   - COLUMNS are time periods bucketed from a shared time axis (day / week /
 *     month / quarter / year), plus a trailing TOTAL column.
 *   - CELLS show the percentage allocation that resource (or, on a task row, that
 *     resource↔task assignment) consumes in that period, against the resource's
 *     capacity. Over-allocated cells (> 100% of capacity) are flagged.
 *   - A trailing TOTAL row sums every resource per period.
 *
 * This module is fully ADDITIVE: a self-contained `Widget` + its own CSS. It does
 * NOT edit the `Gantt` class, the package barrel, or any config. It reads the
 * frozen {@link ResourceApi} (resources + resolved assignments) and the public
 * {@link GanttApi} (task spans), and projects allocation onto periods using the
 * shared timeline-core axis arithmetic (`floorToUnit` / `addUnits`) — the same
 * "shared axis" the timeline pane uses, so periods line up exactly.
 *
 * The period-bucketing math (`computeUtilization`) is a PURE function with no DOM,
 * so the heavy logic is unit-testable under jsdom; the Widget is the visual /
 * a11y surface exercised by the browser test.
 */

import './resource-utilization.css';
import {
  Widget,
  createEl,
  register,
  type Model,
  type RecordId,
  type WidgetConfig,
  type WidgetEvents,
} from '@jects/core';
import { addUnits, floorToUnit, type TimeUnit } from '@jects/timeline-core';
import type { TaskModel } from '../contract.js';
import type {
  ResourceApi,
  ResourceModel,
} from '../resource/resource-contract.js';

const BLOCK = 'jects-resource-utilization';
const MS_PER_HOUR = 3_600_000;
const FULL_UNITS = 100;

/* ═══════════════════════════════════════════════════════════════════════════
   1. PUBLIC TYPES — period model + computed utilization rows
   ═══════════════════════════════════════════════════════════════════════════ */

/** A single bucketed time column `[start, end)` on the utilization axis. */
export interface UtilizationPeriod {
  /** Inclusive start of the period (epoch ms, floored to the unit). */
  start: number;
  /** Exclusive end of the period (epoch ms). */
  end: number;
  /** Header label for the column (formatted from `start`/`unit`). */
  label: string;
}

/** One period's computed allocation for a resource or a resource↔task row. */
export interface UtilizationCell {
  /**
   * Working effort (ms) the row contributes inside this period. Effort is the
   * task's effort scaled by the assignment's `effortShare`, distributed evenly
   * across the working span of the task and intersected with the period.
   */
  effort: number;
  /**
   * Allocation **percent** of capacity in this period (0..N). 100 = the resource
   * is fully booked for the whole period at one capacity unit; > 100 means
   * over-allocated. On a task drill-down row this is that single assignment's
   * share of the resource's capacity.
   */
  percent: number;
  /** `true` when `percent` exceeds the resource's capacity (over-allocated). */
  over: boolean;
}

/** A drill-down row: one task a resource is assigned to. */
export interface UtilizationTaskRow {
  taskId: RecordId;
  /** Task display name (or the id as a string). */
  name: string;
  /** Per-period cells, parallel to {@link UtilizationData.periods}. */
  cells: UtilizationCell[];
  /** Sum of `effort` across all periods (ms). */
  totalEffort: number;
  /** Average allocation percent across periods that the task touches. */
  totalPercent: number;
}

/** A top-level row: one resource, with its drill-down task rows. */
export interface UtilizationResourceRow<R extends Model = Model> {
  resourceId: RecordId;
  resource: ResourceModel<R> | undefined;
  /** Display name (or the id as a string). */
  name: string;
  /** Capacity in FTE units (default 1). */
  capacity: number;
  /** Per-period aggregate cells for the resource (sum of its task rows). */
  cells: UtilizationCell[];
  /** Sum of `effort` across all periods (ms). */
  totalEffort: number;
  /** Peak allocation percent across periods (the over-allocation high-water mark). */
  peakPercent: number;
  /** `true` if the resource is over-allocated in ANY period. */
  over: boolean;
  /** Drill-down rows for the tasks this resource works on. */
  tasks: UtilizationTaskRow[];
}

/** The full computed dataset the view renders. */
export interface UtilizationData<R extends Model = Model> {
  /** The period columns (in chronological order). */
  periods: UtilizationPeriod[];
  /** One row per resource (filtered to those with assignments unless configured otherwise). */
  rows: UtilizationResourceRow<R>[];
  /** Column footer: total effort per period summed across resources (ms). */
  totalsByPeriod: number[];
  /** Grand total effort across everything (ms). */
  grandTotalEffort: number;
}

/** Minimal task-span lookup the math needs (a subset of `GanttApi`). */
export interface TaskSpanSource<T extends Model = Model> {
  getTask(id: RecordId): TaskModel<T> | undefined;
}

/** Inputs to the pure {@link computeUtilization} bucketing function. */
export interface ComputeUtilizationInput<T extends Model = Model, R extends Model = Model> {
  /** The resource surface to read resources + resolved assignments from. */
  api: ResourceApi<T, R>;
  /** Task-span lookup (the host `GanttApi`, or any `{ getTask }`). */
  tasks: TaskSpanSource<T>;
  /** Period bucket unit. Default `'week'`. */
  unit?: TimeUnit;
  /** Increment of `unit` per column (e.g. 2 ⇒ fortnights). Default 1. */
  increment?: number;
  /**
   * Explicit axis range `[start, end)`. When omitted, the range is derived from
   * the min start / max end of every assigned task (snapped to the unit).
   */
  range?: { start: number; end: number };
  /** Hours per working day used to convert effort↔capacity. Default 8. */
  hoursPerDay?: number;
  /** Working days per week (capacity denominator for week+ buckets). Default 5. */
  daysPerWeek?: number;
  /** Restrict to these resource ids (else all resources with assignments). */
  resourceIds?: RecordId[];
  /** Include resources that have no assignments (all-zero rows). Default false. */
  includeUnassigned?: boolean;
  /** Cap the number of generated period columns (safety). Default 366. */
  maxPeriods?: number;
}

/* ═══════════════════════════════════════════════════════════════════════════
   2. PURE BUCKETING MATH
   ═══════════════════════════════════════════════════════════════════════════ */

/** Approximate working-ms capacity of one FTE unit for a period of `spanMs`. */
function periodCapacityMs(
  spanMs: number,
  hoursPerDay: number,
  daysPerWeek: number,
): number {
  // Fraction of a week that is working time, applied to the period's wall span.
  const workWeekFraction = (daysPerWeek * hoursPerDay) / (7 * 24);
  return Math.max(0, spanMs * workWeekFraction);
}

/** Overlap (ms) of `[aStart,aEnd)` and `[bStart,bEnd)`; 0 when disjoint. */
function overlapMs(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}

/** Read a task's working span `[start,end)`; `undefined` if not schedulable. */
function taskSpan(task: TaskModel | undefined): { start: number; end: number } | undefined {
  if (!task) return undefined;
  const start = typeof task.start === 'number' ? task.start : undefined;
  let end = typeof task.end === 'number' ? task.end : undefined;
  if (start === undefined) return undefined;
  if (end === undefined) {
    const dur =
      typeof task.duration === 'number'
        ? task.duration
        : typeof task.effort === 'number'
          ? task.effort
          : 0;
    end = start + Math.max(0, dur);
  }
  if (end <= start) end = start + 1; // keep half-open intervals non-empty
  return { start, end };
}

/** Format a period start as a compact header label for the given unit. */
export function formatPeriodLabel(start: number, unit: TimeUnit): string {
  const d = new Date(start);
  switch (unit) {
    case 'year':
      return String(d.getUTCFullYear());
    case 'quarter':
      return `Q${Math.floor(d.getUTCMonth() / 3) + 1} ${d.getUTCFullYear()}`;
    case 'month':
      return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
    case 'week': {
      return `Wk ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}`;
    }
    case 'day':
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
    default:
      return d.toLocaleString('en-US', { timeZone: 'UTC' });
  }
}

/** Build the chronological period columns spanning `[start,end)`. */
export function buildPeriods(
  start: number,
  end: number,
  unit: TimeUnit,
  increment: number,
  maxPeriods: number,
): UtilizationPeriod[] {
  const periods: UtilizationPeriod[] = [];
  let cursor = floorToUnit(start, unit);
  let guard = 0;
  while (cursor < end && guard < maxPeriods) {
    const next = addUnits(cursor, unit, increment);
    periods.push({ start: cursor, end: next, label: formatPeriodLabel(cursor, unit) });
    cursor = next;
    guard += 1;
  }
  // Always emit at least one column so an empty/instant range still renders.
  if (periods.length === 0) {
    const next = addUnits(floorToUnit(start, unit), unit, increment);
    periods.push({
      start: floorToUnit(start, unit),
      end: next,
      label: formatPeriodLabel(floorToUnit(start, unit), unit),
    });
  }
  return periods;
}

/**
 * Compute the full per-resource, per-period utilization dataset. Pure: depends
 * only on its inputs and the resource/task lookups, with no DOM. Each
 * assignment's effort is spread EVENLY across its task's working span and then
 * intersected with each period; the period allocation percent is that period's
 * effort over the resource's capacity for the period.
 */
export function computeUtilization<T extends Model = Model, R extends Model = Model>(
  input: ComputeUtilizationInput<T, R>,
): UtilizationData<R> {
  const {
    api,
    tasks,
    unit = 'week',
    increment = 1,
    hoursPerDay = 8,
    daysPerWeek = 5,
    includeUnassigned = false,
    maxPeriods = 366,
  } = input;

  const allResources = api.getResources();
  const wanted = input.resourceIds ? new Set(input.resourceIds) : null;
  const resources = allResources.filter((r) => !wanted || wanted.has(r.id));

  // Derive the axis range from assigned task spans unless explicitly provided.
  let rangeStart = input.range?.start;
  let rangeEnd = input.range?.end;
  if (rangeStart === undefined || rangeEnd === undefined) {
    let min = Infinity;
    let max = -Infinity;
    for (const res of resources) {
      for (const ra of api.getAssignmentsOf(res.id)) {
        const span = taskSpan(tasks.getTask(ra.assignment.taskId));
        if (!span) continue;
        if (span.start < min) min = span.start;
        if (span.end > max) max = span.end;
      }
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      // No schedulable assignments: fall back to a single unit from "now".
      min = floorToUnit(Date.now(), unit);
      max = addUnits(min, unit, increment);
    }
    rangeStart ??= min;
    rangeEnd ??= max;
  }

  const periods = buildPeriods(rangeStart, rangeEnd, unit, increment, maxPeriods);
  const periodCapMs = periods.map((p) =>
    periodCapacityMs(p.end - p.start, hoursPerDay, daysPerWeek),
  );

  const rows: UtilizationResourceRow<R>[] = [];
  const totalsByPeriod = new Array(periods.length).fill(0);
  let grandTotalEffort = 0;

  for (const res of resources) {
    const capacity = res.type === 'cost' ? 1 : Math.max(0, res.capacity ?? 1) || 1;
    const resolved = api.getAssignmentsOf(res.id);
    if (resolved.length === 0 && !includeUnassigned) continue;

    // Bucket each assignment (task) into periods.
    const taskRows: UtilizationTaskRow[] = [];
    const resCells: UtilizationCell[] = periods.map(() => ({ effort: 0, percent: 0, over: false }));

    for (const ra of resolved) {
      const span = taskSpan(tasks.getTask(ra.assignment.taskId));
      if (!span) continue;
      const spanMs = span.end - span.start;
      // Effort this resource owes on this task (working ms). Prefer the resolved
      // effort (units-share of the task effort); fall back to the task span.
      const totalEffort =
        ra.effort && Number.isFinite(ra.effort) && ra.effort > 0 ? ra.effort : spanMs;
      const effortPerMs = spanMs > 0 ? totalEffort / spanMs : 0;

      const cells: UtilizationCell[] = periods.map((p, i) => {
        const ov = overlapMs(span.start, span.end, p.start, p.end);
        const effort = ov * effortPerMs;
        const cap = (periodCapMs[i] ?? 0) * capacity;
        const percent = cap > 0 ? (effort / cap) * FULL_UNITS : 0;
        const cell: UtilizationCell = { effort, percent, over: false };
        // Accumulate onto the resource aggregate row.
        resCells[i]!.effort += effort;
        return cell;
      });

      const taskTotalEffort = cells.reduce((s, c) => s + c.effort, 0);
      const touched = cells.filter((c) => c.effort > 0);
      const taskTotalPercent =
        touched.length > 0 ? touched.reduce((s, c) => s + c.percent, 0) / touched.length : 0;

      taskRows.push({
        taskId: ra.assignment.taskId,
        name: resolveTaskName(tasks.getTask(ra.assignment.taskId), ra.assignment.taskId),
        cells,
        totalEffort: taskTotalEffort,
        totalPercent: taskTotalPercent,
      });
    }

    // Finalize the resource aggregate row: percent + over flag per period.
    let peakPercent = 0;
    let resTotalEffort = 0;
    let over = false;
    resCells.forEach((cell, i) => {
      const cap = (periodCapMs[i] ?? 0) * capacity;
      cell.percent = cap > 0 ? (cell.effort / cap) * FULL_UNITS : 0;
      cell.over = res.type !== 'cost' && cell.percent > FULL_UNITS;
      if (cell.over) over = true;
      if (cell.percent > peakPercent) peakPercent = cell.percent;
      resTotalEffort += cell.effort;
      totalsByPeriod[i] += cell.effort;
    });
    grandTotalEffort += resTotalEffort;

    // Mark over-allocated task cells (share of capacity) for the drill-down.
    for (const tr of taskRows) {
      tr.cells.forEach((cell, i) => {
        const cap = (periodCapMs[i] ?? 0) * capacity;
        cell.percent = cap > 0 ? (cell.effort / cap) * FULL_UNITS : 0;
        cell.over = res.type !== 'cost' && (resCells[i]?.over ?? false) && cell.percent > 0;
      });
    }

    // Sort task drill-down rows by descending total effort (busiest first).
    taskRows.sort((a, b) => b.totalEffort - a.totalEffort);

    rows.push({
      resourceId: res.id,
      resource: res,
      name: (res.name as string | undefined) ?? String(res.id),
      capacity,
      cells: resCells,
      totalEffort: resTotalEffort,
      peakPercent,
      over,
      tasks: taskRows,
    });
  }

  return { periods, rows, totalsByPeriod, grandTotalEffort };
}

function resolveTaskName(task: TaskModel | undefined, id: RecordId): string {
  const name = task?.name as string | undefined;
  return name && name.length > 0 ? name : String(id);
}

/** Format effort ms as a compact hours string (e.g. `12h`, `1.5h`). */
export function formatEffortHours(ms: number): string {
  if (ms <= 0) return '';
  const hours = ms / MS_PER_HOUR;
  const rounded = Math.round(hours * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}h` : `${rounded.toFixed(1)}h`;
}

/** Format an allocation percent as a rounded integer string (e.g. `125%`). */
export function formatPercent(percent: number): string {
  if (percent <= 0) return '';
  return `${Math.round(percent)}%`;
}

/* ═══════════════════════════════════════════════════════════════════════════
   3. THE WIDGET — an ARIA treegrid utilization surface
   ═══════════════════════════════════════════════════════════════════════════ */

export interface ResourceUtilizationViewConfig<
  T extends Model = Model,
  R extends Model = Model,
> extends WidgetConfig {
  /** Resource surface (resources + resolved assignments). */
  api: ResourceApi<T, R>;
  /**
   * Task-span lookup. Pass the host `GanttApi`/`Gantt`, or any `{ getTask }`.
   * Defaults to `api` when it also exposes `getTask` (the Gantt does).
   */
  tasks?: TaskSpanSource<T>;
  /** Period bucket unit. Default `'week'`. */
  unit?: TimeUnit;
  /** Periods per column. Default 1. */
  increment?: number;
  /** Explicit axis range; otherwise derived from assigned task spans. */
  range?: { start: number; end: number };
  /** Hours per working day. Default 8. */
  hoursPerDay?: number;
  /** Working days per week. Default 5. */
  daysPerWeek?: number;
  /** Restrict to these resources. */
  resourceIds?: RecordId[];
  /** Include resources without assignments. Default false. */
  includeUnassigned?: boolean;
  /** Accessible label for the grid. Default `'Resource utilization'`. */
  label?: string;
  /**
   * What each cell shows: allocation `'percent'` (default) or working `'effort'`
   * hours. The opposite figure is exposed via the cell `title`/aria-label.
   */
  cellMode?: 'percent' | 'effort';
  /** Resource ids expanded on first render. Default: none (all collapsed). */
  expanded?: RecordId[];
}

export interface ResourceUtilizationViewEvents extends WidgetEvents {
  /** A resource row was expanded/collapsed. */
  toggle: { resourceId: RecordId; expanded: boolean };
  /** A cell was activated (click / Enter / Space). */
  cellActivate: {
    resourceId: RecordId;
    taskId?: RecordId;
    periodIndex: number;
    cell: UtilizationCell;
    native: Event;
  };
}

export class ResourceUtilizationView<
  T extends Model = Model,
  R extends Model = Model,
> extends Widget<ResourceUtilizationViewConfig<T, R>, ResourceUtilizationViewEvents> {
  // NB: `Widget` runs `render()` from its constructor BEFORE subclass field
  // initializers execute, so these are initialized lazily (see `expandedSet()`)
  // to survive that first render call.
  private _expanded?: Set<RecordId>;
  private data: UtilizationData<R> | null = null;
  /**
   * Roving-tabindex anchor: the `[role,colIndex]` of the single data gridcell
   * that currently holds `tabIndex 0`. Identified by aria-colindex + the row's
   * aria-rowindex so it survives re-renders (expand/collapse). `null` until the
   * first data cell is rendered/focused.
   */
  private activeCell: { rowIndex: number; colIndex: number } | null = null;

  private get expanded(): Set<RecordId> {
    return (this._expanded ??= new Set<RecordId>());
  }

  protected override defaults(): Partial<ResourceUtilizationViewConfig<T, R>> {
    return {
      unit: 'week',
      increment: 1,
      hoursPerDay: 8,
      daysPerWeek: 5,
      includeUnassigned: false,
      label: 'Resource utilization',
      cellMode: 'percent',
    } as Partial<ResourceUtilizationViewConfig<T, R>>;
  }

  protected buildEl(): HTMLElement {
    const el = createEl('div', { className: BLOCK });
    el.setAttribute('role', 'treegrid');
    el.setAttribute('aria-readonly', 'true');
    // Single roving-tabindex model: the grid root itself is NOT a tab stop; one
    // data cell carries tabIndex 0 (see syncRovingTabindex). Arrow keys move the
    // roving focus across the data gridcells.
    el.tabIndex = -1;
    el.addEventListener('keydown', (e) => this.onGridKeydown(e));
    // Track which data cell becomes the roving anchor when focused directly.
    el.addEventListener(
      'focusin',
      (e) => {
        const cell = (e.target as HTMLElement | null)?.closest<HTMLElement>(
          `.${BLOCK}__cell--data`,
        );
        if (cell && el.contains(cell)) this.rememberActiveCell(cell);
      },
      true,
    );
    return el;
  }

  /** Recompute the dataset from the current config (pure step). */
  private compute(): UtilizationData<R> {
    const cfg = this.config;
    const tasks = (cfg.tasks ??
      (cfg.api as unknown as TaskSpanSource<T>)) as TaskSpanSource<T>;
    // Build the input omitting `undefined` keys (exactOptionalPropertyTypes).
    const input: ComputeUtilizationInput<T, R> = { api: cfg.api, tasks };
    if (cfg.unit !== undefined) input.unit = cfg.unit;
    if (cfg.increment !== undefined) input.increment = cfg.increment;
    if (cfg.range !== undefined) input.range = cfg.range;
    if (cfg.hoursPerDay !== undefined) input.hoursPerDay = cfg.hoursPerDay;
    if (cfg.daysPerWeek !== undefined) input.daysPerWeek = cfg.daysPerWeek;
    if (cfg.resourceIds !== undefined) input.resourceIds = cfg.resourceIds;
    if (cfg.includeUnassigned !== undefined) input.includeUnassigned = cfg.includeUnassigned;
    return computeUtilization<T, R>(input);
  }

  protected override render(): void {
    const cfg = this.config;
    if (this.expanded.size === 0 && cfg.expanded) {
      for (const id of cfg.expanded) this.expanded.add(id);
    }
    this.el.setAttribute('aria-label', cfg.label ?? 'Resource utilization');
    const data = (this.data = this.compute());
    this.el.replaceChildren();

    const colCount = data.periods.length + 2; // name + periods + total
    this.el.style.setProperty('--_ru-periods', String(data.periods.length));

    // Publish the grid's logical dimensions so AT can resolve each row/cell's
    // position. aria-rowcount is the TOTAL logical rows (header + every resource
    // + every drill-down task across ALL resources, whether or not the row is
    // currently expanded in the DOM + the trailing totals row); aria-colcount is
    // the name column + every period + the trailing total column. Without these,
    // collapsed rows make the running aria-rowindex skip numbers with no known
    // total to anchor against.
    if (data.rows.length === 0) {
      // Header + the single empty-state row.
      this.el.setAttribute('aria-rowcount', '2');
    } else {
      let logicalRows = 1 + 1; // header + totals row
      for (const row of data.rows) logicalRows += 1 + row.tasks.length;
      this.el.setAttribute('aria-rowcount', String(logicalRows));
    }
    this.el.setAttribute('aria-colcount', String(colCount));

    this.el.append(this.buildHeader(data));
    if (data.rows.length === 0) {
      this.el.append(this.buildEmptyRow(colCount));
      this.syncRovingTabindex();
      return;
    }

    // Use a LOGICAL row counter that advances past collapsed task rows too, so
    // each aria-rowindex matches its position within aria-rowcount (the totals
    // row lands on the final logical index even when drill-downs are collapsed).
    let rowIndex = 2; // header is aria-rowindex 1
    for (const row of data.rows) {
      this.el.append(this.buildResourceRow(row, rowIndex));
      rowIndex += 1;
      if (this.expanded.has(row.resourceId)) {
        for (const task of row.tasks) {
          this.el.append(this.buildTaskRow(row, task, rowIndex));
          rowIndex += 1;
        }
      } else {
        // Reserve the logical indices of the collapsed (DOM-absent) task rows.
        rowIndex += row.tasks.length;
      }
    }
    this.el.append(this.buildTotalsRow(data, rowIndex));
    this.syncRovingTabindex();
  }

  /* ── roving tabindex (single tab stop + arrow-key navigation) ───────────── */

  /** All focusable data gridcells, in DOM (reading) order. */
  private dataCells(): HTMLElement[] {
    return Array.from(
      this.el.querySelectorAll<HTMLElement>(`.${BLOCK}__cell--data`),
    );
  }

  /** Record which cell is the roving anchor from its row/col indices. */
  private rememberActiveCell(cell: HTMLElement): void {
    const colIndex = Number(cell.getAttribute('aria-colindex'));
    const rowIndex = Number(
      cell.closest<HTMLElement>('[role="row"]')?.getAttribute('aria-rowindex'),
    );
    if (Number.isFinite(rowIndex) && Number.isFinite(colIndex)) {
      this.activeCell = { rowIndex, colIndex };
    }
  }

  /**
   * Promote exactly ONE data cell to `tabIndex 0` (the roving anchor) and demote
   * the rest to `-1`, so the treegrid is a single Tab stop. Re-resolves the
   * anchor after every render (expand/collapse may add/remove cells); falls back
   * to the first data cell when the previous anchor is gone.
   */
  private syncRovingTabindex(): void {
    const cells = this.dataCells();
    for (const c of cells) c.tabIndex = -1;
    if (cells.length === 0) {
      // No data cells (e.g. empty state): keep the grid root itself reachable.
      this.el.tabIndex = 0;
      return;
    }
    this.el.tabIndex = -1;
    let anchor: HTMLElement | undefined;
    if (this.activeCell) {
      anchor = cells.find(
        (c) =>
          Number(c.getAttribute('aria-colindex')) === this.activeCell!.colIndex &&
          Number(
            c.closest<HTMLElement>('[role="row"]')?.getAttribute('aria-rowindex'),
          ) === this.activeCell!.rowIndex,
      );
    }
    anchor ??= cells[0]!;
    anchor.tabIndex = 0;
    this.rememberActiveCell(anchor);
  }

  /** Move the roving focus to `cell` (update tabindex + DOM focus + anchor). */
  private focusCell(cell: HTMLElement): void {
    for (const c of this.dataCells()) c.tabIndex = -1;
    cell.tabIndex = 0;
    this.rememberActiveCell(cell);
    cell.focus();
  }

  /** Arrow-key / Home / End navigation across the data gridcells. */
  private onGridKeydown(e: KeyboardEvent): void {
    const NAV = ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Home', 'End'];
    if (!NAV.includes(e.key)) return;
    const current = (e.target as HTMLElement | null)?.closest<HTMLElement>(
      `.${BLOCK}__cell--data`,
    );
    if (!current || !this.el.contains(current)) return;

    const row = current.closest<HTMLElement>('[role="row"]');
    if (!row) return;
    const rowCells = Array.from(
      row.querySelectorAll<HTMLElement>(`.${BLOCK}__cell--data`),
    );
    const rows = Array.from(
      this.el.querySelectorAll<HTMLElement>('[role="row"]'),
    ).filter((r) => r.querySelector(`.${BLOCK}__cell--data`));
    const colInRow = rowCells.indexOf(current);
    const rowPos = rows.indexOf(row);
    if (colInRow < 0 || rowPos < 0) return;

    let target: HTMLElement | undefined;
    switch (e.key) {
      case 'ArrowRight':
        target = rowCells[Math.min(colInRow + 1, rowCells.length - 1)];
        break;
      case 'ArrowLeft':
        target = rowCells[Math.max(colInRow - 1, 0)];
        break;
      case 'Home':
        target = rowCells[0];
        break;
      case 'End':
        target = rowCells[rowCells.length - 1];
        break;
      case 'ArrowDown':
      case 'ArrowUp': {
        const nextRow = rows[e.key === 'ArrowDown' ? rowPos + 1 : rowPos - 1];
        if (nextRow) {
          const nextCells = Array.from(
            nextRow.querySelectorAll<HTMLElement>(`.${BLOCK}__cell--data`),
          );
          target = nextCells[Math.min(colInRow, nextCells.length - 1)];
        }
        break;
      }
    }
    if (target && target !== current) {
      e.preventDefault();
      this.focusCell(target);
    }
  }

  private buildHeader(data: UtilizationData<R>): HTMLElement {
    const head = createEl('div', { className: `${BLOCK}__row ${BLOCK}__row--head` });
    head.setAttribute('role', 'row');
    head.setAttribute('aria-rowindex', '1');

    const name = createEl('div', { className: `${BLOCK}__cell ${BLOCK}__cell--name`, text: 'Resource' });
    name.setAttribute('role', 'columnheader');
    name.setAttribute('aria-colindex', '1');
    head.append(name);

    data.periods.forEach((p, i) => {
      const cell = createEl('div', { className: `${BLOCK}__cell ${BLOCK}__cell--head`, text: p.label });
      cell.setAttribute('role', 'columnheader');
      cell.setAttribute('aria-colindex', String(i + 2));
      cell.title = `${new Date(p.start).toISOString().slice(0, 10)} – ${new Date(p.end).toISOString().slice(0, 10)}`;
      head.append(cell);
    });

    const total = createEl('div', {
      className: `${BLOCK}__cell ${BLOCK}__cell--head ${BLOCK}__cell--total`,
      text: 'Total',
    });
    total.setAttribute('role', 'columnheader');
    total.setAttribute('aria-colindex', String(data.periods.length + 2));
    head.append(total);
    return head;
  }

  private buildResourceRow(row: UtilizationResourceRow<R>, rowIndex: number): HTMLElement {
    const expanded = this.expanded.has(row.resourceId);
    const hasTasks = row.tasks.length > 0;
    const tr = createEl('div', {
      className: `${BLOCK}__row ${BLOCK}__row--resource${row.over ? ` ${BLOCK}__row--over` : ''}`,
    });
    tr.setAttribute('role', 'row');
    tr.setAttribute('aria-rowindex', String(rowIndex));
    tr.setAttribute('aria-level', '1');
    tr.dataset.resourceId = String(row.resourceId);
    if (hasTasks) tr.setAttribute('aria-expanded', expanded ? 'true' : 'false');

    // Name cell — the row header, with a disclosure toggle.
    const nameCell = createEl('div', { className: `${BLOCK}__cell ${BLOCK}__cell--name` });
    nameCell.setAttribute('role', 'rowheader');
    nameCell.setAttribute('aria-colindex', '1');

    if (hasTasks) {
      const toggle = createEl('button', {
        className: `${BLOCK}__toggle`,
        attrs: { type: 'button' },
      });
      toggle.setAttribute(
        'aria-label',
        `${expanded ? 'Collapse' : 'Expand'} ${row.name} tasks`,
      );
      toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      toggle.textContent = expanded ? '▾' : '▸';
      toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleResource(row.resourceId);
      });
      nameCell.append(toggle);
    } else {
      nameCell.append(createEl('span', { className: `${BLOCK}__toggle-spacer` }));
    }

    const label = createEl('span', { className: `${BLOCK}__name-label`, text: row.name });
    nameCell.append(label);
    if (row.over) {
      const badge = createEl('span', {
        className: `${BLOCK}__badge`,
        text: `${Math.round(row.peakPercent)}%`,
      });
      badge.setAttribute('aria-label', `over-allocated, peak ${Math.round(row.peakPercent)} percent`);
      nameCell.append(badge);
    }
    tr.append(nameCell);

    row.cells.forEach((cell, i) => {
      tr.append(this.buildDataCell(row, undefined, cell, i));
    });
    tr.append(this.buildTotalCell(row.totalEffort, row.peakPercent, row.cells.length + 2, false));
    return tr;
  }

  private buildTaskRow(
    row: UtilizationResourceRow<R>,
    task: UtilizationTaskRow,
    rowIndex: number,
  ): HTMLElement {
    const tr = createEl('div', { className: `${BLOCK}__row ${BLOCK}__row--task` });
    tr.setAttribute('role', 'row');
    tr.setAttribute('aria-rowindex', String(rowIndex));
    tr.setAttribute('aria-level', '2');
    tr.dataset.resourceId = String(row.resourceId);
    tr.dataset.taskId = String(task.taskId);

    const nameCell = createEl('div', { className: `${BLOCK}__cell ${BLOCK}__cell--name ${BLOCK}__cell--task` });
    nameCell.setAttribute('role', 'rowheader');
    nameCell.setAttribute('aria-colindex', '1');
    nameCell.append(createEl('span', { className: `${BLOCK}__name-label`, text: task.name }));
    tr.append(nameCell);

    task.cells.forEach((cell, i) => {
      tr.append(this.buildDataCell(row, task, cell, i));
    });
    tr.append(this.buildTotalCell(task.totalEffort, task.totalPercent, task.cells.length + 2, false));
    return tr;
  }

  private buildDataCell(
    row: UtilizationResourceRow<R>,
    task: UtilizationTaskRow | undefined,
    cell: UtilizationCell,
    periodIndex: number,
  ): HTMLElement {
    const mode = this.config.cellMode ?? 'percent';
    const primary = mode === 'effort' ? formatEffortHours(cell.effort) : formatPercent(cell.percent);
    const el = createEl('div', {
      className: `${BLOCK}__cell ${BLOCK}__cell--data${cell.over ? ` ${BLOCK}__cell--over` : ''}${cell.percent > 0 ? '' : ` ${BLOCK}__cell--empty`}`,
      text: primary,
    });
    el.setAttribute('role', 'gridcell');
    el.setAttribute('aria-colindex', String(periodIndex + 2));
    // Single roving-tabindex model: EVERY data cell joins the roving set (-1) and
    // exactly one cell is promoted to tabIndex 0 by syncRovingTabindex(); arrow
    // keys move focus across cells. (Previously only populated cells were tabbable,
    // which created multiple independent Tab stops and left empty cells
    // unreachable — both treegrid anti-patterns.)
    el.tabIndex = -1;
    // Heat fill driven by allocation, capped at 100% for the bar width.
    const fill = Math.max(0, Math.min(100, cell.percent));
    el.style.setProperty('--_ru-fill', `${fill}%`);

    const period = this.data!.periods[periodIndex]!;
    const who = task ? `${row.name} · ${task.name}` : row.name;
    if (cell.percent > 0) {
      const aria = `${who}, ${period.label}: ${Math.round(cell.percent)} percent, ${formatEffortHours(cell.effort) || '0h'}${cell.over ? ', over-allocated' : ''}`;
      el.setAttribute('aria-label', aria);
      el.title = aria;
      const activate = (native: Event): void => {
        const payload: ResourceUtilizationViewEvents['cellActivate'] = {
          resourceId: row.resourceId,
          periodIndex,
          cell,
          native,
        };
        if (task) payload.taskId = task.taskId;
        this.emit('cellActivate', payload);
      };
      el.addEventListener('click', activate);
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          activate(e);
        }
      });
    } else {
      // Give empty cells a MEANINGFUL accessible name (never an empty aria-label
      // that would override / blank the visible content). The visible text is
      // empty for a zero cell, so synthesize "0 percent" / "0h".
      const zero = mode === 'effort' ? '0h' : '0 percent';
      el.setAttribute('aria-label', `${who}, ${period.label}: ${zero}`);
    }
    return el;
  }

  private buildTotalCell(
    effort: number,
    percent: number,
    colIndex: number,
    isTotalsRow: boolean,
  ): HTMLElement {
    const el = createEl('div', {
      className: `${BLOCK}__cell ${BLOCK}__cell--data ${BLOCK}__cell--total`,
      text: formatEffortHours(effort) || (isTotalsRow ? '' : ''),
    });
    el.setAttribute('role', 'gridcell');
    el.setAttribute('aria-colindex', String(colIndex));
    el.tabIndex = -1; // join the roving-tabindex set
    el.setAttribute(
      'aria-label',
      effort > 0
        ? `total ${formatEffortHours(effort)}${percent > 0 ? `, peak ${Math.round(percent)} percent` : ''}`
        : 'total 0h',
    );
    return el;
  }

  private buildTotalsRow(data: UtilizationData<R>, rowIndex: number): HTMLElement {
    const tr = createEl('div', { className: `${BLOCK}__row ${BLOCK}__row--totals` });
    tr.setAttribute('role', 'row');
    tr.setAttribute('aria-rowindex', String(rowIndex));

    const nameCell = createEl('div', {
      className: `${BLOCK}__cell ${BLOCK}__cell--name`,
      text: 'Total',
    });
    nameCell.setAttribute('role', 'rowheader');
    nameCell.setAttribute('aria-colindex', '1');
    tr.append(nameCell);

    data.totalsByPeriod.forEach((effort, i) => {
      const el = createEl('div', {
        className: `${BLOCK}__cell ${BLOCK}__cell--data ${BLOCK}__cell--totals`,
        text: formatEffortHours(effort),
      });
      el.setAttribute('role', 'gridcell');
      el.setAttribute('aria-colindex', String(i + 2));
      el.tabIndex = -1; // join the roving-tabindex set
      el.setAttribute(
        'aria-label',
        effort > 0
          ? `total ${formatEffortHours(effort)} in ${data.periods[i]!.label}`
          : `total 0h in ${data.periods[i]!.label}`,
      );
      tr.append(el);
    });

    const grand = createEl('div', {
      className: `${BLOCK}__cell ${BLOCK}__cell--data ${BLOCK}__cell--total ${BLOCK}__cell--grand`,
      text: formatEffortHours(data.grandTotalEffort),
    });
    grand.setAttribute('role', 'gridcell');
    grand.setAttribute('aria-colindex', String(data.periods.length + 2));
    grand.tabIndex = -1; // join the roving-tabindex set
    grand.setAttribute(
      'aria-label',
      data.grandTotalEffort > 0
        ? `grand total ${formatEffortHours(data.grandTotalEffort)}`
        : 'grand total 0h',
    );
    tr.append(grand);
    return tr;
  }

  private buildEmptyRow(colCount: number): HTMLElement {
    const tr = createEl('div', { className: `${BLOCK}__row ${BLOCK}__row--empty` });
    tr.setAttribute('role', 'row');
    const cell = createEl('div', {
      className: `${BLOCK}__cell ${BLOCK}__cell--name ${BLOCK}__empty`,
      text: 'No resource assignments',
    });
    cell.setAttribute('role', 'gridcell');
    cell.setAttribute('aria-colindex', '1');
    cell.style.gridColumn = `1 / ${colCount + 1}`;
    tr.append(cell);
    return tr;
  }

  /* ── public API ────────────────────────────────────────────────────────── */

  /** Expand/collapse a resource's task drill-down. */
  toggleResource(resourceId: RecordId): this {
    const next = !this.expanded.has(resourceId);
    if (next) this.expanded.add(resourceId);
    else this.expanded.delete(resourceId);
    this.emit('toggle', { resourceId, expanded: next });
    this.render();
    return this;
  }

  /** Whether a resource is currently expanded. */
  isExpanded(resourceId: RecordId): boolean {
    return this.expanded.has(resourceId);
  }

  /** Expand every resource that has drill-down tasks. */
  expandAll(): this {
    for (const row of this.data?.rows ?? this.compute().rows) {
      if (row.tasks.length > 0) this.expanded.add(row.resourceId);
    }
    this.render();
    return this;
  }

  /** Collapse every resource. */
  collapseAll(): this {
    this.expanded.clear();
    this.render();
    return this;
  }

  /** The last computed dataset (recomputed lazily if needed). */
  getData(): UtilizationData<R> {
    return this.data ?? this.compute();
  }
}

register(
  'resourceUtilizationView',
  ResourceUtilizationView as unknown as new (
    host: HTMLElement | string,
    config?: Record<string, unknown>,
  ) => ResourceUtilizationView,
);
