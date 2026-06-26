/**
 * @jects/gantt — effort-driven scheduling (resource-aware).
 *
 * Makes **effort** (total work) a first-class scheduling input, matching the
 * Bryntum / DHTMLX / MS-Project behaviour:
 *
 *   When a task is *effort-driven*, its working DURATION is derived from the
 *   total **work** (effort) divided by the combined **units** of the resources
 *   assigned to it:
 *
 *       duration = effort / Σ(assigned resource units)
 *
 *   so adding resources shortens the task and removing them lengthens it, while
 *   the total work stays constant. Conversely, for a non-effort-driven task the
 *   duration is authoritative and effort is *derived* from it
 *   (`effort = duration × Σ units`), so the trio {effort, duration, units} is
 *   always kept mutually consistent.
 *
 * Units are fractional allocations where **1.0 = one full-time resource** (the
 * familiar "100%"). A resource may carry its own max `units`; an assignment may
 * override with a per-assignment `units`. `effort` and `duration` are both
 * working-ms; calendars convert working-ms ⇄ wall-clock elsewhere. `hoursPerDay`
 * on the effective calendar lets consumers express/inspect effort in
 * person-days (see {@link effortToPersonDays} / {@link personDaysToEffort}).
 *
 * This module is PURE LOGIC — no DOM. It is **additive**: it neither edits nor
 * subclasses the core engines. Instead {@link EffortDrivenEngine} *decorates*
 * any {@link SchedulingEngine} (the package CPM `CpmEngine`, the UI
 * `DefaultGanttEngine`, or a custom one): before every schedule/recalc it
 * resolves each effort-driven task's duration from its assignments and writes
 * the resolved `duration` back onto the task so the inner engine's existing
 * `durationOf()` consumes it unchanged. Resource-aware mutations
 * (`assignResource` / `unassignResource` / `setAssignmentUnits`) reflow the
 * affected durations and re-propagate through the inner engine, returning the
 * minimal `ScheduleChange[]`.
 */

import type { Model, RecordId } from '@jects/core';
import type { TimeMs, DurationMs } from '@jects/timeline-core';
import type {
  TaskModel,
  DependencyModel,
  CalendarModel,
  ConstraintType,
  ScheduleOptions,
  ScheduleResult,
  ScheduleChange,
  TaskSchedule,
  SchedulingEngine,
  WorkingTimeCalculator,
  Baseline,
} from '../contract.js';

/* ═══════════════════════════════════════════════════════════════════════════
   1. RESOURCE / ASSIGNMENT MODELS
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * A resource (person, team, or piece of equipment) that can be assigned to
 * tasks. Units throughout this module follow the Bryntum / DHTMLX / parallel
 * `resource/` convention: a **percentage** where `100` = one full-time unit
 * (one FTE). `capacity` is the resource's maximum simultaneous units in
 * FTE-equivalents (`1` = one FTE = 100%); when an assignment omits its own
 * `units`, the resource's capacity (×100) is used.
 *
 * Structurally compatible with the resource layer's `ResourceModel` (which
 * carries the same `id`/`name`/`capacity`/`calendarId`), so the integrator can
 * feed those records straight into this engine. `maxUnits` is an accepted alias
 * for `capacity` for callers that prefer it.
 */
export interface ResourceModel<Extra extends Model = Model> extends Model {
  /** Stable resource id. */
  id: RecordId;
  /** Display name. */
  name?: string;
  /** Max simultaneous capacity in FTE-equivalents (1 = one FTE = 100%). Default 1. */
  capacity?: number;
  /** Alias for `capacity` (FTE-equivalents). */
  maxUnits?: number;
  /** Calendar id governing this resource's working time (optional). */
  calendarId?: string;
  /** Cost per working hour (optional, for cost rollups). */
  hourlyCost?: number;
  /** Arbitrary consumer fields. */
  data?: Extra;
}

/**
 * An assignment linking a resource to a task at a given allocation. `units` is
 * the allocation **percentage** (`100` = full time). When omitted the resource's
 * capacity (×100, default 100) is used. The effort-driven duration of a task is
 * its effort divided by the sum of its assignments' effective unit *fractions*
 * (`Σ units / 100`).
 *
 * Structurally compatible with the resource layer's `AssignmentModel`.
 */
export interface AssignmentModel extends Model {
  /** Stable assignment id. */
  id: RecordId;
  /** The task this assignment is on. */
  taskId: RecordId;
  /** The resource being assigned. */
  resourceId: RecordId;
  /** Allocation percentage (100 = full time). Defaults to resource capacity ×100. */
  units?: number;
}

/** Percentage that denotes one full-time unit (one FTE). */
export const FULL_TIME_UNITS = 100;

/**
 * An effort-driven view of a task. `TaskModel` already declares `effort`,
 * `resourceIds`, and `duration`; this interface adds the **effortDriven** flag
 * the scheduler keys on. It is structural — any `TaskModel` whose `effortDriven`
 * is `true` is treated as effort-driven.
 */
export interface EffortDrivenTask<Extra extends Model = Model> extends TaskModel<Extra> {
  /**
   * When `true`, the task's `duration` is *derived* from `effort / Σ units`
   * (and reflows as resources are added/removed). When `false`/absent, the
   * `duration` is authoritative and `effort` is derived from it.
   */
  effortDriven?: boolean;
}

/* ═══════════════════════════════════════════════════════════════════════════
   2. PURE EFFORT ↔ DURATION ↔ UNITS RESOLUTION
   ═══════════════════════════════════════════════════════════════════════════ */

/** ms in one hour — used for person-day conversions. */
const MS_PER_HOUR = 3_600_000;

/** Default working hours per day when a calendar omits `hoursPerDay`. */
export const DEFAULT_HOURS_PER_DAY = 8;

/** A task is effort-driven iff its `effortDriven` flag is strictly `true`. */
export function isEffortDriven(task: TaskModel): boolean {
  return (task as EffortDrivenTask).effortDriven === true;
}

/** A resource's capacity in FTE-equivalents (1 = one FTE). Default 1. */
export function resourceCapacity(resource?: ResourceModel): number {
  const cap = resource?.capacity ?? resource?.maxUnits;
  if (typeof cap === 'number' && isFinite(cap) && cap >= 0) return cap;
  return 1;
}

/**
 * Resolve the effective allocation **percentage** of a single assignment: its
 * own `units` if a finite non-negative number, else the resource's capacity
 * (×100, default 100).
 */
export function assignmentUnits(
  assignment: AssignmentModel,
  resource?: ResourceModel,
): number {
  const own = assignment.units;
  if (typeof own === 'number' && isFinite(own) && own >= 0) return own;
  return resourceCapacity(resource) * FULL_TIME_UNITS;
}

/**
 * Sum the effective allocation **percentages** of a set of assignments.
 * Resources are looked up by id for their capacity fallback. Negative/NaN
 * contributions are ignored. (e.g. two full-time resources → `200`.)
 */
export function totalUnits(
  assignments: ReadonlyArray<AssignmentModel>,
  resources: ReadonlyMap<RecordId, ResourceModel>,
): number {
  let sum = 0;
  for (const a of assignments) {
    const u = assignmentUnits(a, resources.get(a.resourceId));
    if (isFinite(u) && u > 0) sum += u;
  }
  return sum;
}

/** Convert a percentage (100 = full time) into an FTE fraction (1 = full time). */
export function unitsFraction(unitsPercent: number): number {
  return unitsPercent / FULL_TIME_UNITS;
}

/**
 * Effort-driven duration: `effort / (units%/100)`, rounded to whole ms — i.e.
 * effort divided by the combined FTE fraction of the assigned resources. With
 * zero assigned units the duration is undefined (no one can do the work) —
 * callers treat that as "keep the existing duration".
 *
 * @param effort       total work in working-ms.
 * @param unitsPercent combined allocation percentage (100 = one FTE).
 * @returns the derived working-ms duration, or `null` when `units <= 0`.
 */
export function durationFromEffort(effort: DurationMs, unitsPercent: number): DurationMs | null {
  const frac = unitsFraction(unitsPercent);
  if (!(frac > 0)) return null;
  if (!(effort >= 0)) return 0;
  return Math.round(effort / frac);
}

/**
 * Derived effort from an authoritative duration: `duration × (units%/100)`.
 * With no staffing the duration itself is treated as the effort (1 FTE).
 */
export function effortFromDuration(duration: DurationMs, unitsPercent: number): DurationMs {
  const frac = unitsFraction(unitsPercent);
  const f = frac > 0 ? frac : 1;
  return Math.max(0, Math.round(duration * f));
}

/** Convert a working-ms effort into person-days for a given hours/day. */
export function effortToPersonDays(effort: DurationMs, hoursPerDay = DEFAULT_HOURS_PER_DAY): number {
  const h = hoursPerDay > 0 ? hoursPerDay : DEFAULT_HOURS_PER_DAY;
  return effort / MS_PER_HOUR / h;
}

/** Convert person-days into a working-ms effort for a given hours/day. */
export function personDaysToEffort(personDays: number, hoursPerDay = DEFAULT_HOURS_PER_DAY): DurationMs {
  const h = hoursPerDay > 0 ? hoursPerDay : DEFAULT_HOURS_PER_DAY;
  return Math.max(0, Math.round(personDays * h * MS_PER_HOUR));
}

/** The outcome of resolving a task's effort/duration/units trio. */
export interface EffortResolution {
  /** The task id resolved. */
  taskId: RecordId;
  /** Resolved working-ms duration (what the engine should schedule with). */
  duration: DurationMs;
  /** Resolved total work in working-ms. */
  effort: DurationMs;
  /** Combined assigned units (Σ). */
  units: number;
  /** Whether the duration was driven BY effort (effort-driven) this pass. */
  effortDriven: boolean;
  /** Whether the resolution actually changed `duration` from its prior value. */
  durationChanged: boolean;
}

/**
 * Resolve {effort, duration, units} for one task given its assignments. This is
 * the single source of truth for the effort math and is engine-independent.
 *
 *   - Milestones are always zero on all three axes.
 *   - **Effort-driven** (`effortDriven === true`): the duration is recomputed as
 *     `effort / Σunits`. With no effort yet (first assignment) the *current*
 *     duration seeds the effort (`effort = duration × Σunits`) so assigning the
 *     first resource at 100% is a no-op and a second 100% resource then halves
 *     the duration. With zero units the prior duration is kept and effort is
 *     left as-is.
 *   - **Fixed-duration** (default): the duration is authoritative; effort is
 *     derived as `duration × Σunits` (so it reflects the staffing).
 *
 * @param task        the task (read-only here; the engine writes the result).
 * @param assignments the task's assignments.
 * @param resources   resource lookup for `maxUnits` fallbacks.
 */
export function resolveEffort(
  task: TaskModel,
  assignments: ReadonlyArray<AssignmentModel>,
  resources: ReadonlyMap<RecordId, ResourceModel>,
): EffortResolution {
  const taskId = task.id;
  const priorDuration = typeof task.duration === 'number' && task.duration >= 0 ? task.duration : 0;

  if (task.milestone) {
    return {
      taskId,
      duration: 0,
      effort: 0,
      units: totalUnits(assignments, resources),
      effortDriven: isEffortDriven(task),
      durationChanged: priorDuration !== 0,
    };
  }

  const units = totalUnits(assignments, resources);
  const priorEffort = typeof task.effort === 'number' && task.effort >= 0 ? task.effort : undefined;

  if (isEffortDriven(task)) {
    // Seed effort from current duration on first staffing if none recorded yet.
    const effort = priorEffort ?? effortFromDuration(priorDuration, units || FULL_TIME_UNITS);
    const derived = durationFromEffort(effort, units);
    const duration = derived == null ? priorDuration : derived;
    return {
      taskId,
      duration,
      effort,
      units,
      effortDriven: true,
      durationChanged: duration !== priorDuration,
    };
  }

  // Fixed-duration: duration wins; effort tracks staffing.
  const effort = effortFromDuration(priorDuration, units);
  return {
    taskId,
    duration: priorDuration,
    effort,
    units,
    effortDriven: false,
    durationChanged: false,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   3. RESOURCE-AWARE SCHEDULING ENGINE (decorator)
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Resource-aware hooks layered on top of the base {@link SchedulingEngine}. The
 * UI / consumers drive resources & assignments through these; effort-driven
 * durations reflow automatically and re-propagate through the inner engine.
 */
export interface ResourceAwareEngine<T extends Model = Model> extends SchedulingEngine<T> {
  /** Load/replace the resource set. */
  setResources(resources: ReadonlyArray<ResourceModel>): void;
  /** Load/replace the assignment set. */
  setAssignments(assignments: ReadonlyArray<AssignmentModel>): void;
  /** All resources. */
  getResources(): ReadonlyArray<ResourceModel>;
  /** Resource by id. */
  getResource(id: RecordId): ResourceModel | undefined;
  /** Assignments on a task. */
  getAssignmentsFor(taskId: RecordId): ReadonlyArray<AssignmentModel>;
  /** Combined assigned units (Σ) on a task. */
  getAssignedUnits(taskId: RecordId): number;
  /** Resolved effort/duration/units trio for a task (read-only). */
  getEffortResolution(taskId: RecordId): EffortResolution | undefined;
  /**
   * Assign a resource to a task at `units` allocation (default = resource max
   * or 1). Reflows the (effort-driven) duration and re-propagates. Returns the
   * created assignment plus the engine changes.
   */
  assignResource(
    taskId: RecordId,
    resourceId: RecordId,
    units?: number,
    assignmentId?: RecordId,
  ): { assignment: AssignmentModel; changes: ScheduleChange[] };
  /** Remove an assignment (by id) and reflow/re-propagate. */
  unassignResource(assignmentId: RecordId): ScheduleChange[];
  /** Remove the assignment of `resourceId` from `taskId`, if present. */
  unassignResourceFromTask(taskId: RecordId, resourceId: RecordId): ScheduleChange[];
  /** Change an assignment's units and reflow/re-propagate. */
  setAssignmentUnits(assignmentId: RecordId, units: number): ScheduleChange[];
  /** Hours/day from the resolved project calendar (for person-day conversion). */
  getHoursPerDay(): number;
  /** The wrapped base scheduling engine (read its results; drive edits via this). */
  readonly baseEngine: SchedulingEngine<T>;
}

let assignmentSeq = 0;
/** Generate a stable-ish assignment id when the caller supplies none. */
function nextAssignmentId(): string {
  assignmentSeq += 1;
  return `__jects_asg_${assignmentSeq}`;
}

/**
 * Decorates any {@link SchedulingEngine} with effort-driven, resource-aware
 * scheduling. It owns resources + assignments, resolves effort↔duration↔units
 * before every pass, writes the resolved `duration`/`effort` back onto the inner
 * engine's tasks (via `updateTask`) so the base `durationOf()` schedules with
 * them, and exposes resource mutation hooks that reflow durations.
 *
 * The wrapper is transparent: all base `SchedulingEngine` methods delegate to
 * the inner engine, with a resolution pass injected around schedule/recalc and
 * the task-loading hooks.
 */
export class EffortDrivenEngine<T extends Model = Model> implements ResourceAwareEngine<T> {
  private readonly inner: SchedulingEngine<T>;
  private resources = new Map<RecordId, ResourceModel>();
  /** assignmentId → assignment. */
  private assignments = new Map<RecordId, AssignmentModel>();
  /** taskId → set of assignmentIds (index for fast lookup). */
  private byTask = new Map<RecordId, Set<RecordId>>();
  /** All task ids loaded into the inner engine (declaration order). */
  private knownTaskIds: RecordId[] = [];
  /** Last resolved trios, keyed by task id. */
  private resolutions = new Map<RecordId, EffortResolution>();
  /** Hours/day used for person-day conversions (from the project calendar). */
  private hoursPerDay = DEFAULT_HOURS_PER_DAY;

  constructor(inner: SchedulingEngine<T>) {
    this.inner = inner;
  }

  /** The wrapped base engine (read its results; drive edits via this wrapper). */
  get baseEngine(): SchedulingEngine<T> {
    return this.inner;
  }

  /* ── model loading ─────────────────────────────────────────────────── */

  setTasks(tasks: ReadonlyArray<TaskModel<T>>): void {
    this.inner.setTasks(tasks);
    this.knownTaskIds = tasks.map((t) => t.id);
    this.pruneAssignments();
    this.resolveAll();
  }

  setDependencies(deps: ReadonlyArray<DependencyModel>): void {
    this.inner.setDependencies(deps);
  }

  setCalendars(calendars: ReadonlyArray<CalendarModel>, defaultCalendarId: string): void {
    this.inner.setCalendars(calendars, defaultCalendarId);
    const def = calendars.find((c) => c.id === defaultCalendarId) ?? calendars[0];
    if (def?.hoursPerDay != null && def.hoursPerDay > 0) this.hoursPerDay = def.hoursPerDay;
  }

  setResources(resources: ReadonlyArray<ResourceModel>): void {
    this.resources.clear();
    for (const r of resources) this.resources.set(r.id, { ...r });
    this.resolveAll();
  }

  setAssignments(assignments: ReadonlyArray<AssignmentModel>): void {
    this.assignments.clear();
    this.byTask.clear();
    for (const a of assignments) this.indexAssignment({ ...a });
    this.pruneAssignments();
    this.resolveAll();
  }

  private indexAssignment(a: AssignmentModel): void {
    this.assignments.set(a.id, a);
    let set = this.byTask.get(a.taskId);
    if (!set) {
      set = new Set();
      this.byTask.set(a.taskId, set);
    }
    set.add(a.id);
  }

  private deindexAssignment(a: AssignmentModel): void {
    this.assignments.delete(a.id);
    const set = this.byTask.get(a.taskId);
    if (set) {
      set.delete(a.id);
      if (set.size === 0) this.byTask.delete(a.taskId);
    }
  }

  /** Drop assignments whose task no longer exists. */
  private pruneAssignments(): void {
    for (const a of [...this.assignments.values()]) {
      if (!this.inner.getTask(a.taskId)) this.deindexAssignment(a);
    }
  }

  /**
   * Build the patch that applies a new effort-driven `duration` to a task. The
   * duration alone is not enough for engines that *derive* duration from
   * start/end on every normalize (e.g. the UI `DefaultGanttEngine`): they would
   * recompute it straight back from the stale span. So we also recompute the
   * task's `end` from its `start` (calendar-aware) so the trio is internally
   * consistent regardless of the inner engine's normalization order. The inner
   * engine still re-propagates dependents from this consistent span.
   */
  private durationPatch(taskId: RecordId, duration: DurationMs): Partial<TaskModel<T>> {
    const task = this.inner.getTask(taskId);
    const patch: Partial<TaskModel<T>> = { duration };
    if (task?.start != null) {
      const calc = this.inner.getCalculatorFor(taskId);
      patch.end = calc.addWorkingTime(task.start, duration);
    }
    return patch;
  }

  /* ── reads ─────────────────────────────────────────────────────────── */

  getTask(id: RecordId): TaskModel<T> | undefined {
    return this.inner.getTask(id);
  }

  getDependenciesFor(taskId: RecordId): ReadonlyArray<DependencyModel> {
    return this.inner.getDependenciesFor(taskId);
  }

  getCalculatorFor(taskId: RecordId): WorkingTimeCalculator {
    return this.inner.getCalculatorFor(taskId);
  }

  getSchedule(taskId: RecordId): TaskSchedule | undefined {
    return this.inner.getSchedule(taskId);
  }

  getResources(): ReadonlyArray<ResourceModel> {
    return [...this.resources.values()];
  }

  getResource(id: RecordId): ResourceModel | undefined {
    return this.resources.get(id);
  }

  getAssignmentsFor(taskId: RecordId): ReadonlyArray<AssignmentModel> {
    const set = this.byTask.get(taskId);
    if (!set) return [];
    const out: AssignmentModel[] = [];
    for (const id of set) {
      const a = this.assignments.get(id);
      if (a) out.push(a);
    }
    return out;
  }

  getAssignedUnits(taskId: RecordId): number {
    return totalUnits(this.getAssignmentsFor(taskId), this.resources);
  }

  getEffortResolution(taskId: RecordId): EffortResolution | undefined {
    return this.resolutions.get(taskId);
  }

  /** Hours/day from the resolved project calendar (for person-day conversion). */
  getHoursPerDay(): number {
    return this.hoursPerDay;
  }

  /* ── effort resolution pass ────────────────────────────────────────── */

  /**
   * Resolve effort/duration/units for every task and push any duration change
   * onto the inner engine's task model (so its `durationOf()` consumes it). Also
   * keeps each task's `effort`/`resourceIds` mirrors in sync for consumers. This
   * does NOT itself run a schedule pass — callers wrap it around `schedule`.
   *
   * @returns the set of task ids whose duration changed.
   */
  private resolveAll(): RecordId[] {
    const changedTasks: RecordId[] = [];
    // Iterate every task the inner engine knows about that we can see via the
    // assignment index plus any task carrying effort/effortDriven directly.
    const taskIds = this.collectTaskIds();
    for (const id of taskIds) {
      const task = this.inner.getTask(id);
      if (!task) continue;
      const assignments = this.getAssignmentsFor(id);
      const res = resolveEffort(task, assignments, this.resources);
      this.resolutions.set(id, res);

      let patch: Partial<TaskModel<T>> = {};
      let needsPatch = false;
      if (res.durationChanged) {
        patch = this.durationPatch(id, res.duration);
        needsPatch = true;
        changedTasks.push(id);
      }
      // Mirror derived effort + assigned resource ids onto the task (idempotent).
      if (task.effort !== res.effort) {
        patch.effort = res.effort;
        needsPatch = true;
      }
      const resourceIds = assignments.map((a) => a.resourceId);
      if (!sameIds(task.resourceIds, resourceIds)) {
        patch.resourceIds = resourceIds;
        needsPatch = true;
      }
      if (needsPatch) this.inner.updateTask(id, patch);
    }
    return changedTasks;
  }

  /** Every inner-engine task id (so pre-seeded effort/effortDriven is honored). */
  private collectTaskIds(): RecordId[] {
    const ids = new Set<RecordId>(this.knownTaskIds);
    for (const taskId of this.byTask.keys()) ids.add(taskId);
    for (const res of this.resolutions.keys()) ids.add(res);
    return [...ids];
  }

  /* ── scheduling passes ─────────────────────────────────────────────── */

  schedule(options?: ScheduleOptions): ScheduleResult {
    this.resolveAll();
    return this.inner.schedule(options);
  }

  criticalPath(): ReadonlyArray<RecordId> {
    return this.inner.criticalPath();
  }

  recalc(): ScheduleChange[] {
    this.resolveAll();
    return this.inner.recalc();
  }

  /* ── incremental edits ─────────────────────────────────────────────── */

  applyConstraint(
    taskId: RecordId,
    constraintType: ConstraintType,
    constraintDate?: TimeMs,
  ): ScheduleChange[] {
    return this.inner.applyConstraint(taskId, constraintType, constraintDate);
  }

  setTaskSpan(taskId: RecordId, span: { start: TimeMs; end: TimeMs }): ScheduleChange[] {
    const changes = this.inner.setTaskSpan(taskId, span);
    // A drag re-authors the duration; if the task is effort-driven, the *effort*
    // must follow the new duration at the current staffing (resizing a bar
    // changes the work, not the crew). Refresh the resolution from the new
    // duration so the recorded effort matches.
    this.reseedEffortFromDuration(taskId);
    return changes;
  }

  updateTask(taskId: RecordId, patch: Partial<TaskModel<T>>): ScheduleChange[] {
    const wasEffortDriven = isEffortDriven(this.inner.getTask(taskId) ?? ({ id: taskId } as TaskModel));
    const changes = this.inner.updateTask(taskId, patch);
    const nowEffortDriven = isEffortDriven(this.inner.getTask(taskId) ?? ({ id: taskId } as TaskModel));

    // If the caller directly set effort or duration, or flipped the
    // effort-driven flag, reflow consistently and re-propagate.
    const touchedEffort = 'effort' in patch;
    const touchedDuration = 'duration' in patch || 'start' in patch || 'end' in patch;
    const flipped = wasEffortDriven !== nowEffortDriven;

    if (touchedEffort && nowEffortDriven) {
      // New effort → new duration at current units; re-propagate dependents.
      return mergeChanges(changes, this.reflow(taskId));
    }
    if (touchedDuration && !touchedEffort) {
      // Duration authored → effort tracks it (effort-driven keeps work = D×U).
      this.reseedEffortFromDuration(taskId);
    }
    if (flipped) {
      // On flip, settle the trio under the new mode.
      return mergeChanges(changes, this.reflow(taskId));
    }
    return changes;
  }

  addDependency(dep: DependencyModel): ScheduleChange[] {
    return this.inner.addDependency(dep);
  }

  removeDependency(depId: RecordId): ScheduleChange[] {
    return this.inner.removeDependency(depId);
  }

  /* ── resource-aware mutations ──────────────────────────────────────── */

  assignResource(
    taskId: RecordId,
    resourceId: RecordId,
    units?: number,
    assignmentId?: RecordId,
  ): { assignment: AssignmentModel; changes: ScheduleChange[] } {
    const assignment: AssignmentModel = {
      id: assignmentId ?? nextAssignmentId(),
      taskId,
      resourceId,
    };
    if (units != null) assignment.units = units;
    this.indexAssignment(assignment);
    const changes = this.reflow(taskId);
    return { assignment, changes };
  }

  unassignResource(assignmentId: RecordId): ScheduleChange[] {
    const a = this.assignments.get(assignmentId);
    if (!a) return [];
    this.deindexAssignment(a);
    return this.reflow(a.taskId);
  }

  unassignResourceFromTask(taskId: RecordId, resourceId: RecordId): ScheduleChange[] {
    const set = this.byTask.get(taskId);
    if (!set) return [];
    let target: AssignmentModel | undefined;
    for (const id of set) {
      const a = this.assignments.get(id);
      if (a && a.resourceId === resourceId) {
        target = a;
        break;
      }
    }
    if (!target) return [];
    this.deindexAssignment(target);
    return this.reflow(taskId);
  }

  setAssignmentUnits(assignmentId: RecordId, units: number): ScheduleChange[] {
    const a = this.assignments.get(assignmentId);
    if (!a) return [];
    a.units = units;
    return this.reflow(a.taskId);
  }

  /**
   * Reflow one task's effort-driven duration from its current staffing, write it
   * onto the inner engine, and re-propagate. Returns the minimal change set,
   * always including the reflowed task itself when its span moved.
   */
  private reflow(taskId: RecordId): ScheduleChange[] {
    const task = this.inner.getTask(taskId);
    if (!task) return [];
    const before = spanOf(task);
    const assignments = this.getAssignmentsFor(taskId);
    const res = resolveEffort(task, assignments, this.resources);
    this.resolutions.set(taskId, res);

    const patch: Partial<TaskModel<T>> = res.durationChanged
      ? this.durationPatch(taskId, res.duration)
      : {};
    patch.effort = res.effort;
    patch.resourceIds = assignments.map((a) => a.resourceId);
    const changes = this.inner.updateTask(taskId, patch);

    const after = spanOf(this.inner.getTask(taskId) ?? task);
    if (
      (after.start !== before.start || after.end !== before.end) &&
      !changes.some((c) => c.taskId === taskId)
    ) {
      changes.unshift({ taskId, from: before, to: after });
    }
    return changes;
  }

  /**
   * Re-derive the recorded `effort` from the task's CURRENT duration at the
   * current staffing (used when a duration edit/drag should change the work, not
   * the crew). Effort-driven tasks: effort = duration × Σunits.
   */
  private reseedEffortFromDuration(taskId: RecordId): void {
    const task = this.inner.getTask(taskId);
    if (!task) return;
    const units = this.getAssignedUnits(taskId);
    const duration = typeof task.duration === 'number' ? task.duration : 0;
    const effort = effortFromDuration(duration, units || FULL_TIME_UNITS);
    this.resolutions.set(taskId, {
      taskId,
      duration,
      effort,
      units,
      effortDriven: isEffortDriven(task),
      durationChanged: false,
    });
    if (task.effort !== effort) {
      this.inner.updateTask(taskId, { effort } as Partial<TaskModel<T>>);
    }
  }

  /* ── baselines (delegated) ─────────────────────────────────────────── */

  captureBaseline(id: string, name?: string): Baseline {
    return this.inner.captureBaseline(id, name);
  }

  variance(taskId: RecordId, baselineId: string): DurationMs | undefined {
    return this.inner.variance(taskId, baselineId);
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   4. HELPERS / FACTORY
   ═══════════════════════════════════════════════════════════════════════════ */

/** Span accessor tolerant of partially-scheduled tasks. */
function spanOf(task: TaskModel): { start: TimeMs; end: TimeMs } {
  const start = task.start ?? 0;
  const end = task.end ?? start + (task.duration ?? 0);
  return { start, end };
}

/** Shallow id-array equality (order-sensitive). */
function sameIds(a: ReadonlyArray<RecordId> | undefined, b: ReadonlyArray<RecordId>): boolean {
  if (!a) return b.length === 0;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Merge two change lists, de-duplicating by task id (later wins). */
function mergeChanges(a: ScheduleChange[], b: ScheduleChange[]): ScheduleChange[] {
  const byId = new Map<RecordId, ScheduleChange>();
  for (const c of a) byId.set(c.taskId, c);
  for (const c of b) byId.set(c.taskId, c);
  return [...byId.values()];
}

/**
 * Wrap a base {@link SchedulingEngine} (or build a default one) into an
 * effort-driven, resource-aware engine. Drop-in for `GanttOptions.engine`.
 */
export function createEffortDrivenEngine<T extends Model = Model>(
  inner: SchedulingEngine<T>,
): ResourceAwareEngine<T> {
  return new EffortDrivenEngine<T>(inner);
}
