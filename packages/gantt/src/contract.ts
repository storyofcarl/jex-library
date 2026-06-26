/**
 * @jects/gantt — FROZEN GANTT CONTRACT (types & interfaces only; no implementation).
 *
 * This file is the stable, contract-first seam between the Gantt SCHEDULING
 * ENGINE (the headless project-scheduling math) and the Gantt UI (which renders
 * on `@jects/timeline-core` and reuses `@jects/grid` for the task-tree pane).
 *
 * Two cooperating surfaces:
 *   - `SchedulingEngine` — the pure, framework-free scheduler: it owns the task
 *     graph, calendars, constraints, and dependencies, and computes start/end
 *     dates, the critical path, and slack. It NEVER touches the DOM.
 *   - `GanttApi` — what the UI calls. The `Gantt` Widget composes a
 *     `timeline-core` `Timeline` plus a `grid` task-tree, drives the
 *     `SchedulingEngine`, and writes recomputed task spans back to the timeline.
 *
 * Rules of the contract (same discipline as packages/grid/src/contract.ts):
 *   - Nothing here imports DOM-building or runtime logic. It re-uses the
 *     framework-free types from `@jects/core` and the shared timeline types from
 *     `@jects/timeline-core` (`TimeMs`, `DurationMs`, `TimeSpan`, `TimelineApi`,
 *     `DependencyTerminal`).
 *   - The `Gantt` Widget class is implemented by the build agent; here we declare
 *     ONLY its public type signature (`GanttCtor` + the `Gantt` interface shape).
 *   - The UI extends behaviour ONLY through `GanttApi`; the engine is reached
 *     ONLY through `SchedulingEngine`. Neither side reaches into the other's
 *     internals.
 *
 * All times are epoch milliseconds (UTC); durations are milliseconds. Calendars
 * convert wall-clock durations ⇄ working-time so scheduling skips non-work time.
 */

import type {
  Model,
  RecordId,
  TreeStore,
  WidgetConfig,
  WidgetEvents,
  EventMap,
} from '@jects/core';
import type {
  TimeMs,
  DurationMs,
  TimeSpan,
  TimelineApi,
  DependencyTerminal,
  ViewPreset,
} from '@jects/timeline-core';
import type {
  ResourceOptions,
  ResourceApi,
  ResourceEvents,
} from './resource/resource-contract.js';

/* ═══════════════════════════════════════════════════════════════════════════
   1. TASK MODEL
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * How a task is anchored relative to the project / its dependencies.
 * `mustStartOn`/`mustFinishOn` are hard (inflexible); the others are soft.
 */
export type ConstraintType =
  | 'asSoonAsPossible'
  | 'asLateAsPossible'
  | 'startNoEarlierThan'
  | 'startNoLaterThan'
  | 'finishNoEarlierThan'
  | 'finishNoLaterThan'
  | 'mustStartOn'
  | 'mustFinishOn';

/**
 * A schedulable task node. Tasks form a tree (parent summary tasks roll up their
 * children). The engine reads & writes these fields during scheduling; the three
 * of {start, end, duration} are mutually constrained and the engine keeps them
 * consistent (durations measured against the task's effective `calendar`).
 */
export interface TaskModel<Extra extends Model = Model> extends Model {
  /** Stable task id. */
  id: RecordId;
  /** Display name. */
  name?: string;
  /** Scheduled start (epoch ms). Working-time aware. */
  start?: TimeMs;
  /** Scheduled finish (epoch ms, exclusive). */
  end?: TimeMs;
  /** Working-time duration in ms (NOT wall-clock; resolved via `calendar`). */
  duration?: DurationMs;
  /** Total work/effort in ms (drives effort-driven scheduling). */
  effort?: DurationMs;
  /** Completion fraction 0..1. */
  percentDone?: number;
  /** Parent task id (null/undefined = root). Defines the task tree. */
  parentId?: RecordId | null;
  /**
   * When `true`, the task is pinned to its `start`/`end` and the engine will not
   * auto-reschedule it from dependencies (only constraint clamping applies).
   */
  manuallyScheduled?: boolean;
  /** Constraint anchoring this task. Default `'asSoonAsPossible'`. */
  constraintType?: ConstraintType;
  /** The date operand for date-bearing constraint types (epoch ms). */
  constraintDate?: TimeMs;
  /** Calendar id governing this task's working time (defaults to project cal). */
  calendarId?: string;
  /** A zero-duration milestone (drawn as a diamond). */
  milestone?: boolean;
  /**
   * Split/segmented task: the working-time sub-spans this task is broken into,
   * in chronological order, separated by non-working "gaps". When present (length
   * ≥ 2) the task is rendered as multiple bar pieces joined by connector lines,
   * and the scheduler treats the task's working duration as the SUM of the
   * segments' durations — the gaps between segments are skipped, so dependents
   * anchor on the LAST segment's finish, not the wall-clock span end. A single
   * segment (or none) is an ordinary contiguous task. The engine keeps segment
   * `start`/`end`/`duration` mutually consistent (see `engine/segments.ts`).
   */
  segments?: TaskSegment[];
  /** Whether this task is a summary (has children) — engine-derived if omitted. */
  summary?: boolean;
  /** Resource ids assigned to this task (capacity/effort distribution). */
  resourceIds?: RecordId[];
  /** Arbitrary consumer fields. */
  data?: Extra;
}

/**
 * One working segment of a split/segmented task: a half-open `[start, end)`
 * working interval the task is actively worked during. A task may be broken into
 * several segments separated by GAPS (idle stretches where no work happens — a
 * crew is pulled off, a part is awaited, a holiday block is skipped). Segments
 * are non-overlapping and ordered; the spans between consecutive segments are the
 * task's gaps. The engine treats the task's working duration as the SUM of the
 * segments' working durations (gaps do NOT count as work), and the task's outer
 * span runs from the first segment's start to the last segment's end. A task with
 * an absent / single `segments` entry is an ordinary contiguous bar.
 *
 * Times are epoch ms (UTC); durations are working ms (calendar-resolved). The
 * headless segment math lives in `engine/segments.ts`; the renderer + split/join
 * interactions in `ui/segmented-tasks.ts`.
 */
export interface TaskSegment {
  /** Optional stable id for the segment (handy for keyed re-render / drag). */
  id?: RecordId;
  /** Segment start (epoch ms). */
  start: TimeMs;
  /** Segment finish (epoch ms, exclusive). */
  end: TimeMs;
  /** Optional per-segment completion fraction 0..1 (defaults to the task's). */
  percentDone?: number;
}

/* ═══════════════════════════════════════════════════════════════════════════
   2. DEPENDENCY MODEL
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Dependency semantics between two tasks:
 *   FS finish-to-start · SS start-to-start · FF finish-to-finish · SF start-to-finish.
 */
export type DependencyType = 'FS' | 'SS' | 'FF' | 'SF';

/**
 * A directed scheduling dependency from a predecessor to a successor, with an
 * optional lag (positive) or lead (negative) measured in working time.
 */
export interface DependencyModel extends Model {
  /** Stable link id. */
  id: RecordId;
  /** Predecessor task id. */
  fromId: RecordId;
  /** Successor task id. */
  toId: RecordId;
  /** Dependency type. Default `'FS'`. */
  type?: DependencyType;
  /** Lag (+) / lead (−) in working ms applied to the link. */
  lag?: DurationMs;
  /** Whether the link is currently active/enforced. Default `true`. */
  active?: boolean;
}

/** Maps a dependency type to the timeline terminals it connects (for drawing). */
export interface DependencyTerminals {
  from: DependencyTerminal;
  to: DependencyTerminal;
}

/* ═══════════════════════════════════════════════════════════════════════════
   3. CALENDAR MODEL (working time)
   ═══════════════════════════════════════════════════════════════════════════ */

/** A working interval within a day, in minutes-from-midnight `[from, to)`. */
export interface WorkingInterval {
  /** Minutes from local midnight, inclusive. */
  from: number;
  /** Minutes from local midnight, exclusive. */
  to: number;
}

/** Working hours per weekday (0 = Sunday … 6 = Saturday). */
export interface WeekdayRule {
  /** Day index 0..6. */
  weekday: number;
  /** Working intervals; empty array = non-working day. */
  intervals: WorkingInterval[];
}

/** A dated override (holiday, exception shift) on top of the weekly pattern. */
export interface CalendarException {
  /** The span the override applies to. */
  span: TimeSpan;
  /** Working intervals during the span; empty = non-working (holiday). */
  intervals: WorkingInterval[];
  /** Optional label (e.g. "New Year"). */
  name?: string;
}

/**
 * A working-time calendar. The engine uses it to convert working duration ⇄
 * wall-clock, to advance/skip non-working time, and to clamp constraints.
 */
export interface CalendarModel {
  /** Stable calendar id. */
  id: string;
  /** Display name. */
  name?: string;
  /** Parent calendar id this one inherits from (overrides cascade). */
  parentId?: string;
  /** IANA timezone the intervals are expressed in. Default project tz. */
  timezone?: string;
  /** Weekly working pattern (missing weekdays = non-working). */
  week: WeekdayRule[];
  /** Dated exceptions/holidays. */
  exceptions?: CalendarException[];
  /** Default hours/day used when converting effort↔duration. Default 8. */
  hoursPerDay?: number;
}

/**
 * Working-time arithmetic surface derived from a `CalendarModel`. The engine
 * resolves one of these per calendar; consumers can query it directly.
 */
export interface WorkingTimeCalculator {
  /** The calendar this calculator is built from. */
  readonly calendar: CalendarModel;
  /** Is `time` within working time? */
  isWorkingTime(time: TimeMs): boolean;
  /** Advance `time` by a working duration (skips non-work). */
  addWorkingTime(time: TimeMs, duration: DurationMs): TimeMs;
  /** Working ms between two instants (excludes non-work). */
  workingDurationBetween(start: TimeMs, end: TimeMs): DurationMs;
  /** Snap forward to the next working instant. */
  ceilToWorkingTime(time: TimeMs): TimeMs;
  /** Snap backward to the previous working instant. */
  floorToWorkingTime(time: TimeMs): TimeMs;
}

/* ═══════════════════════════════════════════════════════════════════════════
   4. BASELINE (snapshot for variance tracking)
   ═══════════════════════════════════════════════════════════════════════════ */

/** A saved per-task snapshot taken at baseline time. */
export interface BaselineTask {
  /** The task this snapshot is for. */
  taskId: RecordId;
  /** Snapshotted start. */
  start: TimeMs;
  /** Snapshotted end. */
  end: TimeMs;
  /** Snapshotted working duration. */
  duration: DurationMs;
  /** Snapshotted percent done. */
  percentDone?: number;
}

/** A named baseline: an immutable snapshot of the schedule for variance bars. */
export interface Baseline {
  /** Stable baseline id (e.g. `'baseline-1'`). */
  id: string;
  /** Display name. */
  name?: string;
  /** When the snapshot was taken. */
  takenAt: TimeMs;
  /** Per-task snapshots, keyed by task id. */
  tasks: ReadonlyMap<RecordId, BaselineTask>;
}

/* ═══════════════════════════════════════════════════════════════════════════
   5. SCHEDULING RESULTS
   ═══════════════════════════════════════════════════════════════════════════ */

/** Direction the engine schedules from. */
export type ScheduleDirection = 'forward' | 'backward';

/**
 * Per-task computed scheduling metrics (CPM): early/late dates and slack.
 * Tasks with zero total slack are on the critical path.
 */
export interface TaskSchedule {
  /** Task id. */
  taskId: RecordId;
  /** Computed start. */
  start: TimeMs;
  /** Computed end. */
  end: TimeMs;
  /** Earliest start (forward pass). */
  earlyStart: TimeMs;
  /** Earliest finish (forward pass). */
  earlyFinish: TimeMs;
  /** Latest start (backward pass). */
  lateStart: TimeMs;
  /** Latest finish (backward pass). */
  lateFinish: TimeMs;
  /** Total slack (float) in working ms. */
  totalSlack: DurationMs;
  /** Free slack in working ms. */
  freeSlack: DurationMs;
  /** Whether the task lies on the critical path (zero total slack). */
  critical: boolean;
}

/**
 * The outcome of a (re)schedule pass: per-task schedules, the critical path, the
 * overall project span, and any diagnostics (cycles, constraint conflicts).
 */
export interface ScheduleResult {
  /** Per-task computed schedule, keyed by task id. */
  schedules: ReadonlyMap<RecordId, TaskSchedule>;
  /** Ordered task ids forming the critical path. */
  criticalPath: ReadonlyArray<RecordId>;
  /** The resolved overall project span. */
  projectSpan: TimeSpan;
  /** Tasks whose constraints could not be satisfied. */
  conflicts: ReadonlyArray<SchedulingConflict>;
  /** Whether the dependency graph contained a cycle (scheduling aborted). */
  hasCycle: boolean;
}

/** A constraint/dependency conflict surfaced by a scheduling pass. */
export interface SchedulingConflict {
  /** The task that could not be satisfied. */
  taskId: RecordId;
  /** Machine-readable reason. */
  reason:
    | 'constraintViolation'
    | 'dependencyCycle'
    | 'calendarHasNoWorkingTime'
    | 'negativeDuration';
  /** Human-readable detail. */
  message: string;
  /** Other task ids implicated (e.g. the cycle members). */
  related?: ReadonlyArray<RecordId>;
}

/** A single scheduling change emitted to the UI after a recompute. */
export interface ScheduleChange {
  taskId: RecordId;
  /** Span before the change. */
  from: TimeSpan;
  /** Span after the change. */
  to: TimeSpan;
}

/* ═══════════════════════════════════════════════════════════════════════════
   6. SCHEDULING ENGINE (headless, framework-free)
   ═══════════════════════════════════════════════════════════════════════════ */

/** Tuning for a scheduling run. */
export interface ScheduleOptions {
  /** Forward (ASAP from project start) or backward (ALAP from deadline). */
  direction?: ScheduleDirection;
  /** Project start (forward) anchor. */
  projectStart?: TimeMs;
  /** Project deadline (backward) anchor. */
  projectEnd?: TimeMs;
  /** Recompute the critical path as part of the run. Default `true`. */
  computeCriticalPath?: boolean;
  /** Honor manually-scheduled tasks as fixed. Default `true`. */
  respectManual?: boolean;
}

/**
 * The headless project-scheduling engine. It owns the task graph + calendars and
 * implements CPM forward/backward passes, constraint clamping, dependency
 * propagation, and incremental recompute on edits. It is pure (no DOM) and is
 * the seam the `Gantt` UI drives. A consumer may also use it standalone.
 *
 * Lifecycle: `setTasks/setDependencies/setCalendars` load the model; `schedule`
 * runs a full pass; `applyConstraint`/edit methods mutate and `recalc` does the
 * minimal incremental re-propagation, emitting `ScheduleChange`s the UI applies.
 */
export interface SchedulingEngine<T extends Model = Model> {
  /* ── model loading ─────────────────────────────────────────────────── */
  /** Load/replace the task set (tree via `parentId`). */
  setTasks(tasks: ReadonlyArray<TaskModel<T>>): void;
  /** Load/replace the dependency set. */
  setDependencies(deps: ReadonlyArray<DependencyModel>): void;
  /** Load/replace calendars; `defaultCalendarId` is the project calendar. */
  setCalendars(calendars: ReadonlyArray<CalendarModel>, defaultCalendarId: string): void;

  /* ── reads ─────────────────────────────────────────────────────────── */
  /** Current task by id (with engine-maintained start/end/duration). */
  getTask(id: RecordId): TaskModel<T> | undefined;
  /** Dependencies touching a task. */
  getDependenciesFor(taskId: RecordId): ReadonlyArray<DependencyModel>;
  /** The working-time calculator for a task's effective calendar. */
  getCalculatorFor(taskId: RecordId): WorkingTimeCalculator;
  /** Last computed schedule for a task, if any. */
  getSchedule(taskId: RecordId): TaskSchedule | undefined;

  /* ── scheduling passes ─────────────────────────────────────────────── */
  /** Run a full forward/backward CPM pass over all tasks. */
  schedule(options?: ScheduleOptions): ScheduleResult;
  /** Compute (or recompute) just the critical path from the last schedule. */
  criticalPath(): ReadonlyArray<RecordId>;

  /* ── incremental edits (each returns the changes to apply to the UI) ── */
  /** Apply/replace a task's constraint, then re-propagate. */
  applyConstraint(
    taskId: RecordId,
    constraintType: ConstraintType,
    constraintDate?: TimeMs,
  ): ScheduleChange[];
  /** Set a task's span (e.g. from a drag) and re-propagate dependents. */
  setTaskSpan(taskId: RecordId, span: TimeSpan): ScheduleChange[];
  /** Patch task fields (duration/effort/percentDone/manual…) and re-propagate. */
  updateTask(taskId: RecordId, patch: Partial<TaskModel<T>>): ScheduleChange[];
  /** Add a dependency and re-propagate (rejects if it introduces a cycle). */
  addDependency(dep: DependencyModel): ScheduleChange[];
  /** Remove a dependency and re-propagate. */
  removeDependency(depId: RecordId): ScheduleChange[];
  /**
   * Minimal incremental recompute after external model mutations, returning the
   * set of task spans that moved. Cheaper than a full `schedule`.
   */
  recalc(): ScheduleChange[];

  /* ── baselines ─────────────────────────────────────────────────────── */
  /** Snapshot the current schedule as a named baseline. */
  captureBaseline(id: string, name?: string): Baseline;
  /** Variance (ms) of a task vs a baseline (end − baseline end). */
  variance(taskId: RecordId, baselineId: string): DurationMs | undefined;
}

/* ═══════════════════════════════════════════════════════════════════════════
   7. GANTT OPTIONS (top-level config)
   ═══════════════════════════════════════════════════════════════════════════ */

/** Which task-tree columns the left (grid) pane shows. */
export interface GanttColumnConfig {
  /** Column id/field (resolved against the task model). */
  field: string;
  /** Header label. */
  header?: string;
  /** Fixed width in px. */
  width?: number;
}

/**
 * Top-level Gantt configuration. Extends `WidgetConfig` so the `Gantt` widget
 * inherits `cls`/`style`/`hidden`/`disabled` and the standard lifecycle.
 */
export interface GanttOptions<T extends Model = Model, R extends Model = Model>
  extends WidgetConfig,
    ResourceOptions<R> {
  /** Task data source (a core `TreeStore` keyed by `parentId`/children). */
  tasks: TreeStore<TaskModel<T> & { children?: TaskModel<T>[] }> | TaskModel<T>[];
  /** Dependency links. */
  dependencies?: DependencyModel[];
  /** Calendars; `defaultCalendarId` is the project calendar. */
  calendars?: CalendarModel[];
  /** Project calendar id. */
  defaultCalendarId?: string;
  /** Project start anchor (forward scheduling). */
  projectStart?: TimeMs;
  /** Project deadline anchor (backward scheduling). */
  projectEnd?: TimeMs;
  /** Default scheduling direction. Default `'forward'`. */
  direction?: ScheduleDirection;
  /** The timeline view preset to start in. */
  preset?: ViewPreset;
  /** Left task-tree pane columns. */
  columns?: GanttColumnConfig[];
  /** Width of the left task-tree pane in px. */
  treeWidth?: number;
  /** Show the critical path highlighted. Default `true`. */
  showCriticalPath?: boolean;
  /** Baseline id to render as variance bars, if any. */
  baseline?: string;
  /**
   * Inject a custom scheduling engine. When omitted, the package's default
   * CPM engine is used. This is the engine-swap seam.
   */
  engine?: SchedulingEngine<T>;
  /** Features/plugins to install at construction. */
  plugins?: GanttFeature<T>[];
  /**
   * Auto-install the programmatic export surface so `gantt.exportCsv()` /
   * `exportXlsx()` / `exportIcs()` / `exportPng()` / `exportImage()` /
   * `exportPdf()` are available out of the box (Bryntum/DHTMLX export parity).
   * Each is an additive, UI-less {@link GanttFeature} that only grafts methods
   * (no visible affordance, no work until called). Default `true`.
   *
   * - `true` / omitted → install CSV + Excel(XLSX) + ICS + PNG/image + PDF method
   *   features.
   * - `false` → install none (consumers may still add them via `plugins`).
   * - `{ menu: true }` → additionally mount the visible unified **Export menu**
   *   button (the `GanttExportMenu` format dispatcher + Print).
   */
  exports?: boolean | GanttExportsConfig;
}

/** Fine-grained control of the auto-installed export surface (see `GanttOptions.exports`). */
export interface GanttExportsConfig {
  /** Install the CSV export method feature. Default `true`. */
  csv?: boolean;
  /** Install the Excel (XLSX) export method feature. Default `true`. */
  xlsx?: boolean;
  /** Install the iCalendar (ICS) export method feature. Default `true`. */
  ics?: boolean;
  /** Install the PNG/image export method feature. Default `true`. */
  image?: boolean;
  /** Install the PDF export method feature. Default `true`. */
  pdf?: boolean;
  /** Also mount the visible unified Export menu button + Print. Default `false`. */
  menu?: boolean;
}

/* ═══════════════════════════════════════════════════════════════════════════
   8. EVENTS
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Typed Gantt event map. Follows the house veto convention: `beforeX` events are
 * vetoable (a handler returning `false` cancels); plain events notify.
 */
export interface GanttEvents<T extends Model = Model, R extends Model = Model>
  extends WidgetEvents,
    EventMap,
    ResourceEvents<R> {
  /** A task bar was clicked. */
  taskClick: { task: TaskModel<T>; native: MouseEvent };
  /** Vetoable: a task is about to be moved/resized/relinked. */
  beforeTaskChange: { task: TaskModel<T>; from: TimeSpan; to: TimeSpan };
  /** A task changed and the engine re-propagated. */
  taskChange: { task: TaskModel<T>; changes: ReadonlyArray<ScheduleChange> };
  /** Vetoable: a dependency is about to be created. */
  beforeDependencyCreate: { dependency: Omit<DependencyModel, 'id'> };
  /** A dependency was created. */
  dependencyCreate: { dependency: DependencyModel };
  /** A dependency was removed. */
  dependencyRemove: { dependencyId: RecordId };
  /** A full/incremental (re)schedule completed. */
  scheduleChange: { result: ScheduleResult };
  /** The critical path was recomputed. */
  criticalPathChange: { path: ReadonlyArray<RecordId> };
  /** A baseline was captured. */
  baselineCapture: { baseline: Baseline };
  /** A scheduling conflict was detected. */
  conflict: { conflicts: ReadonlyArray<SchedulingConflict> };
  /** The progress-line status date changed (Progress-line feature). */
  progressLineChange: { statusDate: TimeMs };
}

/* ═══════════════════════════════════════════════════════════════════════════
   9. GANTT FEATURE / PLUGIN INTERFACE
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * A Gantt feature/plugin. Features receive the `GanttApi` in `init` and MUST
 * confine all interaction to that surface. `destroy` releases everything created.
 */
export interface GanttFeature<T extends Model = Model> {
  /** Unique feature name (registry key on `GanttApi.features`). */
  readonly name: string;
  /** Called once on install; wire up via the API here. */
  init(api: GanttApi<T>): void;
  /** Called on teardown; release everything. */
  destroy(): void;
}

/** Constructor form, for features that take config at construction. */
export type GanttFeatureCtor<T extends Model = Model> = new (
  config?: Record<string, unknown>,
) => GanttFeature<T>;

/* ═══════════════════════════════════════════════════════════════════════════
   10. GANTT API (the surface the UI exposes to features + consumers)
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * The public service surface the `Gantt` widget exposes. It bridges the headless
 * `SchedulingEngine` and the `timeline-core` `TimelineApi`: every UI mutation is
 * routed THROUGH the engine, and the resulting `ScheduleChange`s are written back
 * to the timeline. Features/consumers build entirely against `GanttApi`.
 */
export interface GanttApi<T extends Model = Model, R extends Model = Model> {
  /** The headless scheduling engine (read its results; drive edits via the API). */
  readonly engine: SchedulingEngine<T>;
  /** The underlying timeline surface (axis/viewport/rows/render). */
  readonly timeline: TimelineApi<TaskModel<T>, TaskModel<T>>;
  /** The Gantt root element. */
  readonly el: HTMLElement;
  /** Installed features, keyed by `feature.name`. */
  readonly features: ReadonlyMap<string, GanttFeature<T>>;
  /**
   * The resource-management surface (resources, assignments, allocation). Present
   * when a `ResourceManager` is installed (auto-installed when `GanttOptions`
   * carries `resources`/`assignments`, or via `gantt.use(new ResourceManager(...))`);
   * `undefined` when no resource layer is active. Features/consumers read the
   * resource layer THROUGH this surface.
   */
  readonly resources: ResourceApi<T, R> | undefined;

  /* ── task / dependency reads ───────────────────────────────────────── */
  /** Task by id. */
  getTask(id: RecordId): TaskModel<T> | undefined;
  /** Direct children of a task (tree). */
  getChildren(id: RecordId): ReadonlyArray<TaskModel<T>>;
  /** Dependencies touching a task. */
  getDependenciesFor(taskId: RecordId): ReadonlyArray<DependencyModel>;
  /** Last computed schedule for a task. */
  getSchedule(taskId: RecordId): TaskSchedule | undefined;
  /** The current critical path. */
  getCriticalPath(): ReadonlyArray<RecordId>;

  /* ── mutations (proxied to the engine, then to the timeline) ───────── */
  /** Move/resize a task (fires `beforeTaskChange`/`taskChange`). */
  updateTaskSpan(taskId: RecordId, span: TimeSpan): boolean;
  /** Patch task fields and re-propagate. */
  updateTask(taskId: RecordId, patch: Partial<TaskModel<T>>): boolean;
  /** Apply a constraint and re-propagate. */
  applyConstraint(
    taskId: RecordId,
    constraintType: ConstraintType,
    constraintDate?: TimeMs,
  ): boolean;
  /** Add a dependency (fires `beforeDependencyCreate`/`dependencyCreate`). */
  addDependency(dep: Omit<DependencyModel, 'id'>): DependencyModel | undefined;
  /** Remove a dependency. */
  removeDependency(depId: RecordId): void;
  /** Force a full re-schedule. */
  reschedule(options?: ScheduleOptions): ScheduleResult;

  /* ── baselines / display ───────────────────────────────────────────── */
  /** Capture a baseline snapshot. */
  captureBaseline(id: string, name?: string): Baseline;
  /** Show/hide a baseline's variance bars. */
  showBaseline(baselineId: string | null): void;
  /** Toggle critical-path highlighting. */
  setCriticalPathVisible(visible: boolean): void;

  /* ── feature lifecycle ─────────────────────────────────────────────── */
  use(feature: GanttFeature<T>): GanttFeature<T>;
  removeFeature(name: string): void;

  /* ── events ────────────────────────────────────────────────────────── */
  on<K extends keyof GanttEvents<T>>(
    event: K,
    fn: (payload: GanttEvents<T>[K]) => unknown,
  ): () => void;
  once<K extends keyof GanttEvents<T>>(
    event: K,
    fn: (payload: GanttEvents<T>[K]) => unknown,
  ): () => void;
  off<K extends keyof GanttEvents<T>>(
    event: K,
    fn?: (payload: GanttEvents<T>[K]) => unknown,
  ): void;
  /** Emit; returns `false` if a vetoable `beforeX` was cancelled. */
  emit<K extends keyof GanttEvents<T>>(event: K, payload: GanttEvents<T>[K]): boolean;

  /* ── disposal registration for features ────────────────────────────── */
  /** Register a disposer the Gantt runs on `destroy()` (leak-safe). */
  track(disposer: () => void): void;
}

/* ═══════════════════════════════════════════════════════════════════════════
   11. GANTT WIDGET — PUBLIC TYPE SIGNATURE ONLY (implemented by build agent)
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Public shape of the `Gantt` Widget instance. The concrete class extends
 * `Widget<GanttOptions, GanttEvents>` from `@jects/core`; only its public type
 * signature is frozen here. `Gantt` IS-A `GanttApi` plus the Widget lifecycle.
 */
export interface Gantt<T extends Model = Model> extends GanttApi<T> {
  /** Stable instance id (from Widget). */
  readonly id: string;
  /** The Gantt root element (from Widget). */
  readonly el: HTMLElement;
  /** Merge options and re-render. */
  update(patch: Partial<GanttOptions<T>>): this;
  /** Current resolved options (read-only). */
  getConfig(): Readonly<GanttOptions<T>>;
  /** Show/hide the root. */
  show(): this;
  hide(): this;
  /** Whether the instance has been destroyed. */
  readonly isDestroyed: boolean;
  /** Vetoable teardown (`beforeDestroy`); disposes engine, timeline, features. */
  destroy(): void;
}

/**
 * Constructor signature of the `Gantt` Widget class. Mirrors
 * `new Gantt(host, options)` and the factory `register('gantt', Gantt)`.
 */
export interface GanttCtor {
  new <T extends Model = Model>(
    host: HTMLElement | string,
    options: GanttOptions<T>,
  ): Gantt<T>;
}

/* ═══════════════════════════════════════════════════════════════════════════
   12. NOTES — THE "SchedulingEngine EXTENSION MODEL"
   ═══════════════════════════════════════════════════════════════════════════

   The engine ⇄ UI boundary is deliberately one-directional and swappable:

     • `SchedulingEngine` is the single source of truth for dates. The UI never
       computes task start/end itself — every drag, resize, constraint edit, and
       dependency change is forwarded into the engine (`setTaskSpan`,
       `applyConstraint`, `addDependency`, …), which returns the minimal set of
       `ScheduleChange`s. The `Gantt` widget then writes those spans back to the
       `timeline-core` surface via `timeline.updateEventSpan`. This guarantees the
       bars on screen always reflect a consistent CPM solution.

     • The engine is injectable (`GanttOptions.engine`). The default is a
       calendar-aware CPM scheduler (forward/backward passes, total/free slack,
       critical path, constraint clamping). A consumer can drop in an alternative
       (resource-leveling, Monte-Carlo, server-backed) as long as it satisfies the
       `SchedulingEngine` interface — the UI is unchanged because it only calls
       that interface.

     • Vetoable `beforeX` events are the policy seam: a feature can veto
       `beforeTaskChange` (e.g. forbid moving a locked task) or
       `beforeDependencyCreate` (e.g. forbid a link that would create a cycle —
       the engine also rejects cycles defensively in `addDependency`).

     • Calendars convert effort/duration ⇄ wall-clock through
       `WorkingTimeCalculator`, so scheduling skips weekends/holidays uniformly;
       `Baseline` snapshots enable variance bars without a second engine.

     • `GanttApi` composes `TimelineApi` (it does NOT subclass the timeline). The
       left task-tree pane is a `@jects/grid` instance in tree mode reusing the
       same `TreeStore`; the right pane is a `timeline-core` `Timeline`. The Gantt
       widget keeps the two panes' vertical row windows in lockstep. This is the
       D10 layering: timeline-core engine ← gantt (+ scheduler) products. */
