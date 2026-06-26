/**
 * @jects/gantt — default CPM scheduling engine (headless, framework-free).
 *
 * Implements {@link SchedulingEngine}: owns the task tree, dependency graph and
 * calendars, and computes start/finish dates, slack, the critical path, and
 * baselines. PURE LOGIC — no DOM.
 *
 * Pipeline of a full {@link CpmEngine.schedule | schedule} pass:
 *   1. Resolve effective calendars per task and validate (no-working-time →
 *      conflict).
 *   2. Topologically order leaf tasks by their active dependency graph (detect
 *      cycles → abort with `hasCycle`).
 *   3. Forward pass (ASAP): place each task at the latest of project start, its
 *      constraint floor, and its predecessor-derived earliest start; advance the
 *      finish by the working-time duration. Backward direction (ALAP) anchors
 *      from the project deadline instead.
 *   4. Constraint clamping: apply the 8 constraint types (MSO/MFO/SNET/SNLT/
 *      FNET/FNLT/ASAP/ALAP), recording violations as conflicts.
 *   5. Roll parent summary tasks up from their children (start = min child
 *      start, end = max child end, percentDone = duration-weighted).
 *   6. Backward pass for late dates → total/free slack → critical path
 *      (zero total slack).
 *
 * Incremental edits (`setTaskSpan`, `updateTask`, `applyConstraint`,
 * `addDependency`, `removeDependency`, `recalc`) mutate the model then re-run a
 * pass and diff the resulting spans, returning the minimal `ScheduleChange[]`.
 */

import type {
  Model,
  RecordId,
} from '@jects/core';
import type { TimeMs, DurationMs, TimeSpan } from '@jects/timeline-core';
import type {
  TaskModel,
  DependencyModel,
  DependencyType,
  CalendarModel,
  ConstraintType,
  ScheduleOptions,
  ScheduleDirection,
  ScheduleResult,
  TaskSchedule,
  SchedulingConflict,
  ScheduleChange,
  Baseline,
  BaselineTask,
  SchedulingEngine,
  WorkingTimeCalculator,
} from '../contract.js';
import { calculatorFor, type CalendarCalculator } from './calendar.js';
import {
  readSegments,
  segmentsWorkingDuration,
  rescheduleSegments,
} from './segments.js';

/** Default project start when none is supplied (2024-01-01T00:00Z). */
const DEFAULT_PROJECT_START = Date.UTC(2024, 0, 1, 0, 0, 0);
/** Default working duration for a task with no duration/end (1 day in ms). */
const DEFAULT_DURATION: DurationMs = 8 * 60 * 60 * 1000;

/** A synthetic calendar id used when no calendars are configured. */
const FALLBACK_CALENDAR_ID = '__jects_default_cal__';

/** A 24×7 always-working calendar — the safe default when none is provided. */
function fallbackCalendar(): CalendarModel {
  return {
    id: FALLBACK_CALENDAR_ID,
    name: 'Default (24/7)',
    week: Array.from({ length: 7 }, (_, weekday) => ({
      weekday,
      intervals: [{ from: 0, to: 1440 }],
    })),
    hoursPerDay: 8,
  };
}

/** Internal mutable per-task working record. */
interface TaskNode<T extends Model> {
  task: TaskModel<T>;
  /** Resolved calendar id. */
  calendarId: string;
  /** Direct child ids (tree). */
  children: RecordId[];
  /** Whether this is a summary (has children). */
  isSummary: boolean;
}

export class CpmEngine<T extends Model = Model> implements SchedulingEngine<T> {
  private tasks = new Map<RecordId, TaskNode<T>>();
  private deps = new Map<RecordId, DependencyModel>();
  private calendars = new Map<RecordId, CalendarModel>();
  private defaultCalendarId = FALLBACK_CALENDAR_ID;
  private calcCache = new Map<string, CalendarCalculator>();

  private schedules = new Map<RecordId, TaskSchedule>();
  private criticalIds: RecordId[] = [];
  private baselines = new Map<string, Baseline>();

  /**
   * Engine-owned "pinned by drag" anchors: a user dragged a task to this start,
   * so we keep it there (as a soft floor, like a SNET) WITHOUT writing a
   * user-visible `startNoEarlierThan` constraint. The pin is dropped the moment
   * the driving context changes (a dependency touching the task is added or
   * removed, the task's own start/constraint is re-authored, or the tree is
   * restructured) so a later genuine reschedule is not clamped by a stale anchor.
   * Keyed by task id → dragged start (epoch ms).
   */
  private dragPins = new Map<RecordId, TimeMs>();

  /** Cached default options applied between full schedules (for incremental). */
  private lastOptions: Required<Pick<ScheduleOptions, 'direction'>> & ScheduleOptions = {
    direction: 'forward',
  };

  /* ── model loading ─────────────────────────────────────────────────── */

  setTasks(tasks: ReadonlyArray<TaskModel<T>>): void {
    this.tasks.clear();
    this.dragPins.clear();
    // First pass: create nodes.
    for (const task of tasks) {
      this.tasks.set(task.id, {
        task: { ...task },
        calendarId: task.calendarId ?? this.defaultCalendarId,
        children: [],
        isSummary: false,
      });
    }
    this.rebuildTree();
  }

  setDependencies(deps: ReadonlyArray<DependencyModel>): void {
    this.deps.clear();
    for (const dep of deps) this.deps.set(dep.id, { ...dep });
  }

  setCalendars(calendars: ReadonlyArray<CalendarModel>, defaultCalendarId: string): void {
    this.calendars.clear();
    this.calcCache.clear();
    for (const cal of calendars) this.calendars.set(cal.id, cal);
    if (!this.calendars.has(FALLBACK_CALENDAR_ID)) {
      this.calendars.set(FALLBACK_CALENDAR_ID, fallbackCalendar());
    }
    this.defaultCalendarId = this.calendars.has(defaultCalendarId)
      ? defaultCalendarId
      : FALLBACK_CALENDAR_ID;
    // Re-resolve task calendar ids against the new default.
    for (const node of this.tasks.values()) {
      node.calendarId = node.task.calendarId ?? this.defaultCalendarId;
    }
  }

  /** (Re)compute the parent/children links and summary flags. */
  private rebuildTree(): void {
    for (const node of this.tasks.values()) {
      node.children = [];
      node.isSummary = false;
    }
    for (const node of this.tasks.values()) {
      const pid = node.task.parentId;
      if (pid != null) {
        const parent = this.tasks.get(pid);
        if (parent) {
          parent.children.push(node.task.id);
          parent.isSummary = true;
        }
      }
    }
  }

  /* ── reads ─────────────────────────────────────────────────────────── */

  getTask(id: RecordId): TaskModel<T> | undefined {
    const node = this.tasks.get(id);
    return node ? node.task : undefined;
  }

  getDependenciesFor(taskId: RecordId): ReadonlyArray<DependencyModel> {
    const out: DependencyModel[] = [];
    for (const dep of this.deps.values()) {
      if (dep.fromId === taskId || dep.toId === taskId) out.push(dep);
    }
    return out;
  }

  getCalculatorFor(taskId: RecordId): WorkingTimeCalculator {
    const node = this.tasks.get(taskId);
    const calId = node ? node.calendarId : this.defaultCalendarId;
    return this.calculator(calId);
  }

  getSchedule(taskId: RecordId): TaskSchedule | undefined {
    return this.schedules.get(taskId);
  }

  /** Memoized calculator for a calendar id (resolving parent cascade). */
  private calculator(calendarId: string): CalendarCalculator {
    let calc = this.calcCache.get(calendarId);
    if (!calc) {
      const map = this.calendars.size > 0 ? this.calendars : new Map([[FALLBACK_CALENDAR_ID, fallbackCalendar()]]);
      const id = map.has(calendarId) ? calendarId : FALLBACK_CALENDAR_ID;
      if (!map.has(FALLBACK_CALENDAR_ID)) map.set(FALLBACK_CALENDAR_ID, fallbackCalendar());
      calc = calculatorFor(id, map as ReadonlyMap<string, CalendarModel>);
      this.calcCache.set(calendarId, calc);
    }
    return calc;
  }

  /* ── duration helpers ──────────────────────────────────────────────── */

  /**
   * Resolve a leaf task's intended working duration from its fields. Priority:
   * SPLIT TASK → the SUM of its segments' working durations (gaps excluded, so a
   * split never inflates effort); else explicit `duration`; else working span
   * between start & end; else milestone → 0; else the package default.
   * Milestones are always 0.
   */
  private durationOf(node: TaskNode<T>, calc: CalendarCalculator): DurationMs {
    const t = node.task;
    if (t.milestone) return 0;
    // A split/segmented task's working duration is the sum of its segments'
    // working durations — the inter-segment gaps are non-working and must not
    // count, so dependents anchor on actual work, not the wall-clock hull.
    const segs = readSegments(t);
    if (segs.length >= 2) return segmentsWorkingDuration(segs, calc);
    if (typeof t.duration === 'number' && t.duration >= 0) return t.duration;
    if (typeof t.start === 'number' && typeof t.end === 'number' && t.end > t.start) {
      return calc.workingDurationBetween(t.start, t.end);
    }
    return DEFAULT_DURATION;
  }

  /* ── scheduling passes ─────────────────────────────────────────────── */

  schedule(options?: ScheduleOptions): ScheduleResult {
    const direction: ScheduleDirection = options?.direction ?? this.lastOptions.direction ?? 'forward';
    this.lastOptions = { ...this.lastOptions, ...options, direction };

    const conflicts: SchedulingConflict[] = [];

    // Validate calendars: a task whose calendar has no working time at all
    // cannot be scheduled meaningfully.
    for (const node of this.tasks.values()) {
      if (node.isSummary) continue;
      const calc = this.calculator(node.calendarId);
      if (!calc.hasAnyWorkingTime()) {
        conflicts.push({
          taskId: node.task.id,
          reason: 'calendarHasNoWorkingTime',
          message: `Task "${node.task.id}" uses calendar "${node.calendarId}" which has no working time.`,
        });
      }
      const dur = this.durationOf(node, calc);
      if (dur < 0) {
        conflicts.push({
          taskId: node.task.id,
          reason: 'negativeDuration',
          message: `Task "${node.task.id}" has a negative duration (${dur}ms).`,
        });
      }
    }

    // Topologically order leaf tasks by active dependencies.
    const order = this.topoOrder();
    if (order === null) {
      // Cycle detected.
      const cycle = this.findCycle();
      conflicts.push({
        taskId: cycle[0] ?? '',
        reason: 'dependencyCycle',
        message: 'The dependency graph contains a cycle; scheduling aborted.',
        related: cycle,
      });
      const result: ScheduleResult = {
        schedules: new Map(this.schedules),
        criticalPath: [],
        projectSpan: this.deriveProjectSpan(options),
        conflicts,
        hasCycle: true,
      };
      return result;
    }

    const projectStart = this.resolveProjectStart(options);
    const projectEnd = options?.projectEnd ?? this.lastOptions.projectEnd;

    // Working maps for early/late dates of LEAF tasks.
    const start = new Map<RecordId, TimeMs>();
    const end = new Map<RecordId, TimeMs>();
    const duration = new Map<RecordId, DurationMs>();

    if (direction === 'forward') {
      this.forwardPass(order, projectStart, start, end, duration, conflicts);
    } else {
      const deadline = projectEnd ?? this.estimateDeadline(order, projectStart, duration);
      this.backwardSchedulePass(order, deadline, start, end, duration, conflicts);
    }

    // Roll up summary tasks (bottom-up).
    this.rollUp(start, end, duration);

    // Write computed start/end/duration back onto task models.
    for (const node of this.tasks.values()) {
      const s = start.get(node.task.id);
      const e = end.get(node.task.id);
      const d = duration.get(node.task.id);

      // Split/segmented leaf: the forward/backward pass placed it as a contiguous
      // block of its SUMMED working duration. Re-derive its segment chain from the
      // recomputed start, PRESERVING the inter-segment working gaps, so the task's
      // true outer span (start → last-segment end, gaps included) is written back
      // and the segments travel with the task when a dependency/constraint moved
      // it. Manually-scheduled split tasks keep their authored split pattern.
      if (!node.isSummary && s != null) {
        const segs = readSegments(node.task);
        if (segs.length >= 2) {
          const calc = this.calculator(node.calendarId);
          const moved = rescheduleSegments(segs, s, calc);
          node.task.segments = moved.segments;
          node.task.start = moved.span.start;
          node.task.end = moved.span.end;
          // Keep the map's end consistent with the real (gap-inclusive) finish so
          // downstream late-date / project-finish math sees the true span.
          end.set(node.task.id, moved.span.end);
          if (d != null) node.task.duration = d;
          continue;
        }
      }

      if (s != null) node.task.start = s;
      if (e != null) node.task.end = e;
      if (d != null) node.task.duration = d;
    }

    // Backward pass for late dates (CPM) over leaves, then slack.
    const projectFinish = this.maxFinish(end);
    const lateStart = new Map<RecordId, TimeMs>();
    const lateFinish = new Map<RecordId, TimeMs>();
    this.latePass(order, projectFinish, end, duration, lateStart, lateFinish);

    // Build per-task TaskSchedule (leaves + summaries).
    this.schedules.clear();
    for (const node of this.tasks.values()) {
      const id = node.task.id;
      const s = start.get(id) ?? node.task.start ?? projectStart;
      const e = end.get(id) ?? node.task.end ?? s;
      const ls = lateStart.get(id) ?? s;
      const lf = lateFinish.get(id) ?? e;
      const calc = this.calculator(node.calendarId);
      const totalSlack = node.isSummary ? 0 : Math.max(0, calc.workingDurationBetween(s, ls) || (ls - s));
      const sched: TaskSchedule = {
        taskId: id,
        start: s,
        end: e,
        earlyStart: s,
        earlyFinish: e,
        lateStart: ls,
        lateFinish: lf,
        totalSlack,
        freeSlack: 0,
        critical: false,
      };
      this.schedules.set(id, sched);
    }
    this.computeFreeSlack(start, end);
    this.markCritical(conflicts);

    const result: ScheduleResult = {
      schedules: new Map(this.schedules),
      criticalPath: [...this.criticalIds],
      projectSpan: { start: this.minStart(start) ?? projectStart, end: projectFinish },
      conflicts,
      hasCycle: false,
    };
    return result;
  }

  /** Resolve project start anchor from options / fallback. */
  private resolveProjectStart(options?: ScheduleOptions): TimeMs {
    return options?.projectStart ?? this.lastOptions.projectStart ?? DEFAULT_PROJECT_START;
  }

  private deriveProjectSpan(options?: ScheduleOptions): TimeSpan {
    const start = this.resolveProjectStart(options);
    let end = start;
    for (const node of this.tasks.values()) {
      if (node.task.end != null) end = Math.max(end, node.task.end);
    }
    return { start, end };
  }

  /* ── forward (ASAP) pass ───────────────────────────────────────────── */

  private forwardPass(
    order: RecordId[],
    projectStart: TimeMs,
    start: Map<RecordId, TimeMs>,
    end: Map<RecordId, TimeMs>,
    duration: Map<RecordId, DurationMs>,
    conflicts: SchedulingConflict[],
  ): void {
    for (const id of order) {
      const node = this.tasks.get(id);
      if (!node || node.isSummary) continue;
      const calc = this.calculator(node.calendarId);
      const dur = Math.max(0, this.durationOf(node, calc));
      duration.set(id, dur);

      // Manually-scheduled & pinned: honor its own start/end exactly.
      if (this.lastOptions.respectManual !== false && node.task.manuallyScheduled && node.task.start != null) {
        const s = calc.ceilToWorkingTime(node.task.start);
        const e = node.task.end != null && node.task.end > s ? node.task.end : this.effectiveFinish(node, calc, s, dur);
        start.set(id, s);
        end.set(id, e);
        this.clampConstraint(node, calc, dur, start, end, conflicts, 'forward');
        continue;
      }

      // Earliest start from predecessors.
      let earliest = projectStart;
      for (const dep of this.activeDepsTo(id)) {
        const predEnd = end.get(dep.fromId);
        const predStart = start.get(dep.fromId);
        const candidate = this.successorAnchor(dep, predStart, predEnd, node, dur, calc);
        if (candidate != null) earliest = Math.max(earliest, candidate);
      }
      // Engine-owned drag pin acts as a soft floor (like a SNET) but is dropped
      // when the driving dependency/anchor changes — predecessors may still push
      // the task later than where it was dragged.
      const pin = this.dragPins.get(id);
      if (pin != null) earliest = Math.max(earliest, pin);
      const s = calc.ceilToWorkingTime(earliest);
      // For a split task the finish is the gap-INCLUSIVE end of its last segment,
      // not start + summed-duration; dependents must anchor on that true finish.
      const e = this.effectiveFinish(node, calc, s, dur);
      start.set(id, s);
      end.set(id, e);
      this.clampConstraint(node, calc, dur, start, end, conflicts, 'forward');
    }
  }

  /**
   * The working finish of a leaf placed at start `s` with contiguous working
   * duration `dur`. For a split/segmented task this is the gap-INCLUSIVE finish
   * (the last segment's end after the chain is rescheduled from `s`, preserving
   * inter-segment gaps) so dependency propagation, late-date math and the project
   * span all see the real end. For an ordinary task it is `addWorkingTime(s,dur)`.
   */
  private effectiveFinish(
    node: TaskNode<T>,
    calc: CalendarCalculator,
    s: TimeMs,
    dur: DurationMs,
  ): TimeMs {
    const segs = readSegments(node.task);
    if (segs.length >= 2) {
      const moved = rescheduleSegments(segs, s, calc);
      return moved.span.end;
    }
    return calc.addWorkingTime(s, dur);
  }

  /**
   * The gap-INCLUSIVE working width of a leaf's hull (first-segment start →
   * last-segment end, inter-segment working gaps included). For an ordinary task
   * this is just its working duration; for a split task it is wider than the
   * summed work because the preserved interruptions count toward the wall span.
   * Placement-independent (gaps are preserved working ms), so it is the constant
   * that converts a split task's start ⇄ gap-inclusive finish.
   */
  private hullWork(
    node: TaskNode<T>,
    calc: CalendarCalculator,
    dur: DurationMs,
  ): DurationMs {
    const segs = readSegments(node.task);
    if (segs.length < 2) return dur;
    // Measure on a placement at the chain's own start so working-gap arithmetic
    // is exact for the active calendar.
    const moved = rescheduleSegments(segs, segs[0]!.start, calc);
    return calc.workingDurationBetween(moved.span.start, moved.span.end);
  }

  /**
   * Inverse of {@link effectiveFinish}: the start a leaf must take so its
   * gap-INCLUSIVE finish lands at `finish`. For a split task this subtracts the
   * full hull width (work + preserved gaps), NOT just the summed working
   * duration, so a backward/ALAP placement of a split task does not let its
   * segments (or its dependents) overlap the interruption.
   */
  private effectiveStartForFinish(
    node: TaskNode<T>,
    calc: CalendarCalculator,
    finish: TimeMs,
    dur: DurationMs,
  ): TimeMs {
    return calc.addWorkingTime(finish, -this.hullWork(node, calc, dur));
  }

  /**
   * Given a dependency `dep` and the predecessor's resolved start/end, return
   * the earliest successor anchor (start) implied by the link type + lag.
   */
  private successorAnchor(
    dep: DependencyModel,
    predStart: TimeMs | undefined,
    predEnd: TimeMs | undefined,
    succNode: TaskNode<T>,
    succDuration: DurationMs,
    calc: CalendarCalculator,
  ): TimeMs | null {
    const type: DependencyType = dep.type ?? 'FS';
    const lag = dep.lag ?? 0;
    // For a finish-anchored link the successor's start is its finish minus its
    // own hull width (work + preserved inter-segment gaps for a split task), NOT
    // its bare summed duration — otherwise a split successor would overlap its
    // own interruption when pulled by an FF/SF predecessor.
    const startForFinish = (finish: TimeMs): TimeMs =>
      this.effectiveStartForFinish(succNode, calc, finish, succDuration);
    switch (type) {
      case 'FS': {
        if (predEnd == null) return null;
        return calc.addWorkingTime(predEnd, lag);
      }
      case 'SS': {
        if (predStart == null) return null;
        return calc.addWorkingTime(predStart, lag);
      }
      case 'FF': {
        if (predEnd == null) return null;
        // successor finish ≥ pred finish + lag → start = finish − hull
        return startForFinish(calc.addWorkingTime(predEnd, lag));
      }
      case 'SF': {
        if (predStart == null) return null;
        // successor finish ≥ pred start + lag → start = finish − hull
        return startForFinish(calc.addWorkingTime(predStart, lag));
      }
      default:
        return null;
    }
  }

  /* ── backward (ALAP) pass ──────────────────────────────────────────── */

  private backwardSchedulePass(
    order: RecordId[],
    deadline: TimeMs,
    start: Map<RecordId, TimeMs>,
    end: Map<RecordId, TimeMs>,
    duration: Map<RecordId, DurationMs>,
    conflicts: SchedulingConflict[],
  ): void {
    // Process in reverse topo order so successors are placed first.
    for (let i = order.length - 1; i >= 0; i--) {
      const id = order[i];
      if (id == null) continue;
      const node = this.tasks.get(id);
      if (!node || node.isSummary) continue;
      const calc = this.calculator(node.calendarId);
      const dur = Math.max(0, this.durationOf(node, calc));
      duration.set(id, dur);

      if (this.lastOptions.respectManual !== false && node.task.manuallyScheduled && node.task.start != null) {
        const s = calc.ceilToWorkingTime(node.task.start);
        const e = node.task.end != null && node.task.end > s ? node.task.end : this.effectiveFinish(node, calc, s, dur);
        start.set(id, s);
        end.set(id, e);
        this.clampConstraint(node, calc, dur, start, end, conflicts, 'backward');
        continue;
      }

      // Latest finish from successors.
      let latestFinish = deadline;
      for (const dep of this.activeDepsFrom(id)) {
        const succStart = start.get(dep.toId);
        const succEnd = end.get(dep.toId);
        const succNode = this.tasks.get(dep.toId);
        const candidate = this.predecessorAnchor(dep, succStart, succEnd, node, succNode, dur, calc);
        if (candidate != null) latestFinish = Math.min(latestFinish, candidate);
      }
      let e = calc.floorToWorkingTime(latestFinish);
      // For a split predecessor the start that lands its gap-INCLUSIVE finish at
      // `e` is `e − hull`, not `e − summedWork`; otherwise the chain (and any of
      // ITS predecessors) would overlap the interruption.
      let s = this.effectiveStartForFinish(node, calc, e, dur);
      // A drag pin is a start floor even when scheduling ALAP.
      const pin = this.dragPins.get(id);
      if (pin != null && s < pin) {
        s = calc.ceilToWorkingTime(pin);
        e = this.effectiveFinish(node, calc, s, dur);
      }
      start.set(id, s);
      end.set(id, e);
      this.clampConstraint(node, calc, dur, start, end, conflicts, 'backward');
    }
  }

  /** Latest predecessor finish implied by a link, scheduling backward. */
  private predecessorAnchor(
    dep: DependencyModel,
    succStart: TimeMs | undefined,
    succEnd: TimeMs | undefined,
    predNode: TaskNode<T>,
    succNode: TaskNode<T> | undefined,
    predDuration: DurationMs,
    calc: CalendarCalculator,
  ): TimeMs | null {
    const type: DependencyType = dep.type ?? 'FS';
    const lag = dep.lag ?? 0;
    // A start-anchored successor (SS/SF) constrains the predecessor's start; we
    // convert that to the predecessor's gap-INCLUSIVE finish with the pred's hull
    // width so a split predecessor is anchored on its true end. Likewise an SS
    // link reads the successor's start, which for a split successor is already
    // its hull start.
    const predHull = this.hullWork(predNode, calc, predDuration);
    void succNode;
    switch (type) {
      case 'FS': {
        if (succStart == null) return null;
        return calc.addWorkingTime(succStart, -lag);
      }
      case 'SS': {
        if (succStart == null) return null;
        const predStart = calc.addWorkingTime(succStart, -lag);
        return calc.addWorkingTime(predStart, predHull);
      }
      case 'FF': {
        if (succEnd == null) return null;
        return calc.addWorkingTime(succEnd, -lag);
      }
      case 'SF': {
        if (succEnd == null) return null;
        const predStart = calc.addWorkingTime(succEnd, -lag);
        return calc.addWorkingTime(predStart, predHull);
      }
      default:
        return null;
    }
  }

  /**
   * Deadline for ALAP (backward) scheduling when the caller supplies no
   * `projectEnd`. This is the project's REQUIRED finish — the latest instant the
   * plan may legitimately end — so the backward pass can float tasks LATE against
   * it rather than collapsing them onto the forward (ASAP) early dates.
   *
   * It is the maximum of:
   *   - the forward critical-path finish (the minimum time the work needs), and
   *   - any task's date-bearing "no later than" / "must" ceiling
   *     (finishNoLaterThan, mustFinishOn, startNoLaterThan, mustStartOn),
   *     which legitimately permit the project to extend later than the bare
   *     critical-path length.
   *
   * The forward pass here runs on a private scratch span map so it never leaks
   * early dates into the real backward solution.
   */
  private estimateDeadline(
    order: RecordId[],
    projectStart: TimeMs,
    duration: Map<RecordId, DurationMs>,
  ): TimeMs {
    const s = new Map<RecordId, TimeMs>();
    const e = new Map<RecordId, TimeMs>();
    const conflicts: SchedulingConflict[] = [];
    this.forwardPass(order, projectStart, s, e, duration, conflicts);
    let deadline = this.maxFinish(e) || projectStart;

    // Honor explicit "no later than" / "must" ceilings: they define how late the
    // project may legitimately finish, independent of the forward early dates.
    for (const node of this.tasks.values()) {
      if (node.isSummary) continue;
      const cd = node.task.constraintDate;
      if (cd == null) continue;
      const calc = this.calculator(node.calendarId);
      const dur = duration.get(node.task.id) ?? Math.max(0, this.durationOf(node, calc));
      switch (node.task.constraintType) {
        case 'finishNoLaterThan':
        case 'mustFinishOn':
          deadline = Math.max(deadline, cd);
          break;
        case 'startNoLaterThan':
        case 'mustStartOn':
          // A start ceiling implies a finish ceiling one duration later.
          deadline = Math.max(deadline, calc.addWorkingTime(cd, dur));
          break;
        default:
          break;
      }
    }
    return deadline;
  }

  /* ── constraint clamping (8 types) ─────────────────────────────────── */

  /**
   * Apply the task's constraint, mutating `start`/`end` and recording a
   * conflict if a hard constraint contradicts dependency-derived placement.
   */
  private clampConstraint(
    node: TaskNode<T>,
    calc: CalendarCalculator,
    dur: DurationMs,
    start: Map<RecordId, TimeMs>,
    end: Map<RecordId, TimeMs>,
    conflicts: SchedulingConflict[],
    direction: ScheduleDirection,
  ): void {
    const id = node.task.id;
    const ct: ConstraintType = node.task.constraintType ?? 'asSoonAsPossible';
    const cd = node.task.constraintDate;
    const curStart = start.get(id);
    const curEnd = end.get(id);
    if (curStart == null || curEnd == null) return;

    const setFromStart = (s: TimeMs) => {
      const cs = calc.ceilToWorkingTime(s);
      start.set(id, cs);
      end.set(id, calc.addWorkingTime(cs, dur));
    };
    const setFromEnd = (e: TimeMs) => {
      const ce = calc.floorToWorkingTime(e);
      end.set(id, ce);
      start.set(id, calc.addWorkingTime(ce, -dur));
    };

    switch (ct) {
      case 'asSoonAsPossible':
        // Default behavior already places ASAP in forward mode.
        return;
      case 'asLateAsPossible':
        // Honored by backward scheduling; in forward mode it's a no-op floor.
        return;
      case 'startNoEarlierThan':
        if (cd != null && curStart < cd) setFromStart(cd);
        return;
      case 'startNoLaterThan':
        if (cd != null && curStart > cd) {
          setFromStart(cd);
          if (direction === 'forward') {
            conflicts.push(this.softConflict(id, 'startNoLaterThan', cd, curStart));
          }
        }
        return;
      case 'finishNoEarlierThan':
        if (cd != null && curEnd < cd) setFromEnd(cd);
        return;
      case 'finishNoLaterThan':
        if (cd != null && curEnd > cd) {
          setFromEnd(cd);
          if (direction === 'forward') {
            conflicts.push(this.softConflict(id, 'finishNoLaterThan', cd, curEnd));
          }
        }
        return;
      case 'mustStartOn':
        if (cd != null) {
          const pinned = calc.ceilToWorkingTime(cd);
          if (curStart !== pinned) {
            // Hard constraint: pin and flag if dependencies wanted it later.
            if (curStart > pinned) {
              conflicts.push(this.hardConflict(id, 'mustStartOn', cd, curStart));
            }
            setFromStart(cd);
          }
        }
        return;
      case 'mustFinishOn':
        if (cd != null) {
          const pinned = calc.floorToWorkingTime(cd);
          if (curEnd !== pinned) {
            if (curEnd > pinned) {
              conflicts.push(this.hardConflict(id, 'mustFinishOn', cd, curEnd));
            }
            setFromEnd(cd);
          }
        }
        return;
      default:
        return;
    }
  }

  private softConflict(id: RecordId, ct: ConstraintType, date: TimeMs, actual: TimeMs): SchedulingConflict {
    return {
      taskId: id,
      reason: 'constraintViolation',
      message: `Task "${id}" violates ${ct}: scheduled at ${actual} but constraint date is ${date}.`,
    };
  }

  private hardConflict(id: RecordId, ct: ConstraintType, date: TimeMs, actual: TimeMs): SchedulingConflict {
    return {
      taskId: id,
      reason: 'constraintViolation',
      message: `Task "${id}" cannot satisfy hard constraint ${ct} (${date}); dependencies push it to ${actual}.`,
    };
  }

  /* ── summary roll-up ───────────────────────────────────────────────── */

  /**
   * Roll summary tasks up from their children bottom-up: start = min child
   * start, end = max child end, duration = working span, percentDone =
   * duration-weighted mean of children.
   */
  private rollUp(
    start: Map<RecordId, TimeMs>,
    end: Map<RecordId, TimeMs>,
    duration: Map<RecordId, DurationMs>,
  ): void {
    // Process parents in order of deepest first.
    const depthSorted = [...this.tasks.values()].sort((a, b) => this.depth(b.task.id) - this.depth(a.task.id));
    for (const node of depthSorted) {
      if (!node.isSummary) continue;
      let minS = Infinity;
      let maxE = -Infinity;
      let weightedDone = 0;
      let weightSum = 0;
      for (const childId of node.children) {
        const cs = start.get(childId);
        const ce = end.get(childId);
        if (cs != null) minS = Math.min(minS, cs);
        if (ce != null) maxE = Math.max(maxE, ce);
        const cd = duration.get(childId) ?? 0;
        const cp = this.tasks.get(childId)?.task.percentDone ?? 0;
        weightedDone += cp * cd;
        weightSum += cd;
      }
      if (minS !== Infinity && maxE !== -Infinity) {
        start.set(node.task.id, minS);
        end.set(node.task.id, maxE);
        const calc = this.calculator(node.calendarId);
        duration.set(node.task.id, calc.workingDurationBetween(minS, maxE));
        node.task.percentDone = weightSum > 0 ? weightedDone / weightSum : 0;
      }
    }
  }

  /** Tree depth of a task (root = 0). */
  private depth(id: RecordId): number {
    let d = 0;
    let cur = this.tasks.get(id);
    const seen = new Set<RecordId>();
    while (cur && cur.task.parentId != null && !seen.has(cur.task.id)) {
      seen.add(cur.task.id);
      cur = this.tasks.get(cur.task.parentId);
      d++;
    }
    return d;
  }

  /* ── backward (late dates) pass ────────────────────────────────────── */

  private latePass(
    order: RecordId[],
    projectFinish: TimeMs,
    end: Map<RecordId, TimeMs>,
    duration: Map<RecordId, DurationMs>,
    lateStart: Map<RecordId, TimeMs>,
    lateFinish: Map<RecordId, TimeMs>,
  ): void {
    for (let i = order.length - 1; i >= 0; i--) {
      const id = order[i];
      if (id == null) continue;
      const node = this.tasks.get(id);
      if (!node || node.isSummary) continue;
      const calc = this.calculator(node.calendarId);
      const dur = duration.get(id) ?? 0;

      const hull = this.hullWork(node, calc, dur);
      let lf = projectFinish;
      const succs = this.activeDepsFrom(id);
      if (succs.length > 0) {
        lf = Infinity;
        for (const dep of succs) {
          const succLS = lateStart.get(dep.toId);
          const succLF = lateFinish.get(dep.toId);
          const cand = this.lateFinishFromSucc(dep, succLS, succLF, hull, calc);
          if (cand != null) lf = Math.min(lf, cand);
        }
        if (lf === Infinity) lf = projectFinish;
      }
      // A task can't finish later than its constraint-pinned finish.
      lf = Math.max(lf, end.get(id) ?? lf);
      // For a split task the late START is the late FINISH minus the gap-inclusive
      // hull (work + preserved gaps), so its late dates span the interruption too.
      const ls = calc.addWorkingTime(lf, -hull);
      lateFinish.set(id, lf);
      lateStart.set(id, ls);
    }
  }

  /**
   * Late finish of a predecessor implied by a successor's late dates.
   * `predHull` is the predecessor's gap-INCLUSIVE hull width (== its working
   * duration for an ordinary task), used by the start-anchored (SS/SF) cases to
   * convert the predecessor's required late start into its late finish.
   */
  private lateFinishFromSucc(
    dep: DependencyModel,
    succLateStart: TimeMs | undefined,
    succLateFinish: TimeMs | undefined,
    predHull: DurationMs,
    calc: CalendarCalculator,
  ): TimeMs | null {
    const type: DependencyType = dep.type ?? 'FS';
    const lag = dep.lag ?? 0;
    switch (type) {
      case 'FS':
        if (succLateStart == null) return null;
        return calc.addWorkingTime(succLateStart, -lag);
      case 'SS':
        if (succLateStart == null) return null;
        return calc.addWorkingTime(calc.addWorkingTime(succLateStart, -lag), predHull);
      case 'FF':
        if (succLateFinish == null) return null;
        return calc.addWorkingTime(succLateFinish, -lag);
      case 'SF':
        if (succLateFinish == null) return null;
        return calc.addWorkingTime(calc.addWorkingTime(succLateFinish, -lag), predHull);
      default:
        return null;
    }
  }

  /* ── slack & critical path ─────────────────────────────────────────── */

  /** Free slack = min over successors of (succ early start − this early finish). */
  private computeFreeSlack(start: Map<RecordId, TimeMs>, end: Map<RecordId, TimeMs>): void {
    for (const [id, sched] of this.schedules) {
      const node = this.tasks.get(id);
      if (!node || node.isSummary) continue;
      const succs = this.activeDepsFrom(id);
      if (succs.length === 0) {
        // Free slack equals total slack for terminal tasks.
        this.schedules.set(id, { ...sched, freeSlack: sched.totalSlack });
        continue;
      }
      const calc = this.calculator(node.calendarId);
      let free = Infinity;
      for (const dep of succs) {
        const succStart = start.get(dep.toId);
        const succEnd = end.get(dep.toId);
        const myStart = start.get(id);
        const myEnd = end.get(id);
        if (succStart == null || myEnd == null || myStart == null) continue;
        const slack = this.freeSlackForLink(dep, myStart, myEnd, succStart, succEnd, calc);
        if (slack != null) free = Math.min(free, slack);
      }
      if (free === Infinity) free = sched.totalSlack;
      this.schedules.set(id, { ...sched, freeSlack: Math.max(0, free) });
    }
  }

  private freeSlackForLink(
    dep: DependencyModel,
    predStart: TimeMs,
    predEnd: TimeMs,
    succStart: TimeMs,
    succEnd: TimeMs | undefined,
    calc: CalendarCalculator,
  ): DurationMs | null {
    const type: DependencyType = dep.type ?? 'FS';
    const lag = dep.lag ?? 0;
    switch (type) {
      case 'FS': {
        const required = calc.addWorkingTime(predEnd, lag);
        return Math.max(0, calc.workingDurationBetween(required, succStart));
      }
      case 'SS': {
        const required = calc.addWorkingTime(predStart, lag);
        return Math.max(0, calc.workingDurationBetween(required, succStart));
      }
      case 'FF': {
        if (succEnd == null) return null;
        const required = calc.addWorkingTime(predEnd, lag);
        return Math.max(0, calc.workingDurationBetween(required, succEnd));
      }
      case 'SF': {
        if (succEnd == null) return null;
        const required = calc.addWorkingTime(predStart, lag);
        return Math.max(0, calc.workingDurationBetween(required, succEnd));
      }
      default:
        return null;
    }
  }

  /** Mark critical (zero total slack) tasks and assemble the critical path. */
  private markCritical(conflicts: SchedulingConflict[]): void {
    // Tolerance: one minute of working time absorbs rounding.
    const TOL = 60_000;
    const critical = new Set<RecordId>();
    for (const [id, sched] of this.schedules) {
      const node = this.tasks.get(id);
      if (!node || node.isSummary) continue;
      const isCrit = sched.totalSlack <= TOL;
      this.schedules.set(id, { ...sched, critical: isCrit });
      if (isCrit) critical.add(id);
    }
    // Order the path by start, following FS-style chains where possible.
    this.criticalIds = [...critical].sort((a, b) => {
      const sa = this.schedules.get(a)?.start ?? 0;
      const sb = this.schedules.get(b)?.start ?? 0;
      return sa - sb;
    });
    void conflicts;
  }

  criticalPath(): ReadonlyArray<RecordId> {
    return [...this.criticalIds];
  }

  /* ── topological ordering ──────────────────────────────────────────── */

  /** Active (enabled) dependencies whose successor is `id`. */
  private activeDepsTo(id: RecordId): DependencyModel[] {
    const out: DependencyModel[] = [];
    for (const dep of this.deps.values()) {
      if (dep.toId === id && dep.active !== false && this.tasks.has(dep.fromId)) out.push(dep);
    }
    return out;
  }

  /** Active dependencies whose predecessor is `id`. */
  private activeDepsFrom(id: RecordId): DependencyModel[] {
    const out: DependencyModel[] = [];
    for (const dep of this.deps.values()) {
      if (dep.fromId === id && dep.active !== false && this.tasks.has(dep.toId)) out.push(dep);
    }
    return out;
  }

  /**
   * Kahn topological sort of LEAF tasks by active dependencies. Returns null if
   * a cycle is present. Summary tasks are excluded (they roll up post-hoc).
   */
  private topoOrder(): RecordId[] | null {
    const leaves: RecordId[] = [];
    for (const node of this.tasks.values()) if (!node.isSummary) leaves.push(node.task.id);

    const indeg = new Map<RecordId, number>();
    const adj = new Map<RecordId, RecordId[]>();
    for (const id of leaves) {
      indeg.set(id, 0);
      adj.set(id, []);
    }
    for (const dep of this.deps.values()) {
      if (dep.active === false) continue;
      if (!indeg.has(dep.fromId) || !indeg.has(dep.toId)) continue;
      adj.get(dep.fromId)!.push(dep.toId);
      indeg.set(dep.toId, (indeg.get(dep.toId) ?? 0) + 1);
    }
    // Deterministic queue: stable by insertion order of leaves.
    const queue = leaves.filter((id) => (indeg.get(id) ?? 0) === 0);
    const order: RecordId[] = [];
    while (queue.length > 0) {
      const id = queue.shift()!;
      order.push(id);
      for (const next of adj.get(id) ?? []) {
        const d = (indeg.get(next) ?? 0) - 1;
        indeg.set(next, d);
        if (d === 0) queue.push(next);
      }
    }
    return order.length === leaves.length ? order : null;
  }

  /** Find the members of a dependency cycle (best-effort) for diagnostics. */
  private findCycle(): RecordId[] {
    const WHITE = 0, GRAY = 1, BLACK = 2;
    const color = new Map<RecordId, number>();
    const stack: RecordId[] = [];
    const adj = new Map<RecordId, RecordId[]>();
    for (const node of this.tasks.values()) if (!node.isSummary) adj.set(node.task.id, []);
    for (const dep of this.deps.values()) {
      if (dep.active === false) continue;
      if (adj.has(dep.fromId) && adj.has(dep.toId)) adj.get(dep.fromId)!.push(dep.toId);
    }
    let cycle: RecordId[] = [];
    const dfs = (id: RecordId): boolean => {
      color.set(id, GRAY);
      stack.push(id);
      for (const next of adj.get(id) ?? []) {
        const c = color.get(next) ?? WHITE;
        if (c === GRAY) {
          const idx = stack.indexOf(next);
          cycle = stack.slice(idx);
          return true;
        }
        if (c === WHITE && dfs(next)) return true;
      }
      stack.pop();
      color.set(id, BLACK);
      return false;
    };
    for (const id of adj.keys()) {
      if ((color.get(id) ?? WHITE) === WHITE && dfs(id)) break;
    }
    return cycle;
  }

  /* ── min/max helpers ───────────────────────────────────────────────── */

  private maxFinish(end: Map<RecordId, TimeMs>): TimeMs {
    let max = -Infinity;
    for (const node of this.tasks.values()) {
      if (node.isSummary) continue;
      const e = end.get(node.task.id);
      if (e != null) max = Math.max(max, e);
    }
    return max === -Infinity ? 0 : max;
  }

  private minStart(start: Map<RecordId, TimeMs>): TimeMs | undefined {
    let min = Infinity;
    for (const node of this.tasks.values()) {
      if (node.isSummary) continue;
      const s = start.get(node.task.id);
      if (s != null) min = Math.min(min, s);
    }
    return min === Infinity ? undefined : min;
  }

  /* ── incremental edits ─────────────────────────────────────────────── */

  applyConstraint(
    taskId: RecordId,
    constraintType: ConstraintType,
    constraintDate?: TimeMs,
  ): ScheduleChange[] {
    const node = this.tasks.get(taskId);
    if (!node) return [];
    node.task.constraintType = constraintType;
    if (constraintDate !== undefined) node.task.constraintDate = constraintDate;
    // A genuine, user-authored constraint supersedes any engine drag anchor.
    this.dragPins.delete(taskId);
    return this.recalc();
  }

  setTaskSpan(taskId: RecordId, span: TimeSpan): ScheduleChange[] {
    const node = this.tasks.get(taskId);
    if (!node) return [];
    const calc = this.calculator(node.calendarId);
    node.task.start = span.start;
    node.task.end = span.end;
    node.task.duration = calc.workingDurationBetween(span.start, span.end);
    // A user-driven span move pins the task at the dragged start — but as an
    // ENGINE-OWNED anchor, not a synthesised `startNoEarlierThan` constraint.
    // This keeps the position relative to dependents on the next pass while
    // remaining clearable once the driving dependency/anchor goes away (so a
    // later genuine reschedule is not clamped by a stale SNET). User-authored
    // constraints are left untouched and continue to win in `clampConstraint`.
    this.dragPins.set(taskId, span.start);
    return this.recalc();
  }

  updateTask(taskId: RecordId, patch: Partial<TaskModel<T>>): ScheduleChange[] {
    const node = this.tasks.get(taskId);
    if (!node) return [];
    const structural = 'parentId' in patch || 'calendarId' in patch;
    Object.assign(node.task, patch);
    if ('calendarId' in patch) {
      node.calendarId = patch.calendarId ?? this.defaultCalendarId;
    }
    // Re-authoring the task's own anchor or constraint drops a stale drag pin.
    if ('start' in patch || 'end' in patch || 'duration' in patch || 'constraintType' in patch) {
      this.dragPins.delete(taskId);
    }
    if (structural) {
      this.dragPins.delete(taskId);
      this.rebuildTree();
    }
    return this.recalc();
  }

  addDependency(dep: DependencyModel): ScheduleChange[] {
    // Reject if it would introduce a cycle.
    if (this.wouldCycle(dep.fromId, dep.toId)) return [];
    this.deps.set(dep.id, { ...dep });
    // The successor's position is now dependency-driven; drop its drag anchor so
    // the new link (not a stale dragged date) decides where it lands.
    this.dragPins.delete(dep.toId);
    return this.recalc();
  }

  removeDependency(depId: RecordId): ScheduleChange[] {
    const dep = this.deps.get(depId);
    if (!this.deps.delete(depId)) return [];
    // Removing the link that justified a dragged successor position clears that
    // engine anchor, so the task floats back per its remaining drivers instead
    // of staying frozen at the dragged date forever (incremental-staleness fix).
    if (dep) {
      this.dragPins.delete(dep.toId);
      this.dragPins.delete(dep.fromId);
    }
    return this.recalc();
  }

  /** Would adding from→to create a cycle in the active dependency graph? */
  private wouldCycle(fromId: RecordId, toId: RecordId): boolean {
    if (fromId === toId) return true;
    // DFS from `toId`; if we reach `fromId`, a cycle would form.
    const adj = new Map<RecordId, RecordId[]>();
    for (const dep of this.deps.values()) {
      if (dep.active === false) continue;
      if (!adj.has(dep.fromId)) adj.set(dep.fromId, []);
      adj.get(dep.fromId)!.push(dep.toId);
    }
    const stack = [toId];
    const seen = new Set<RecordId>();
    while (stack.length) {
      const cur = stack.pop()!;
      if (cur === fromId) return true;
      if (seen.has(cur)) continue;
      seen.add(cur);
      for (const n of adj.get(cur) ?? []) stack.push(n);
    }
    return false;
  }

  recalc(): ScheduleChange[] {
    const before = this.snapshotSpans();
    this.schedule(this.lastOptions);
    const after = this.snapshotSpans();
    const changes: ScheduleChange[] = [];
    for (const [id, to] of after) {
      const from = before.get(id);
      if (!from) continue;
      if (from.start !== to.start || from.end !== to.end) {
        changes.push({ taskId: id, from, to });
      }
    }
    return changes;
  }

  private snapshotSpans(): Map<RecordId, TimeSpan> {
    const m = new Map<RecordId, TimeSpan>();
    for (const node of this.tasks.values()) {
      const s = node.task.start;
      const e = node.task.end;
      if (s != null && e != null) m.set(node.task.id, { start: s, end: e });
    }
    return m;
  }

  /* ── baselines ─────────────────────────────────────────────────────── */

  captureBaseline(id: string, name?: string): Baseline {
    const tasks = new Map<RecordId, BaselineTask>();
    for (const node of this.tasks.values()) {
      const t = node.task;
      if (t.start == null || t.end == null) continue;
      const snap: BaselineTask = {
        taskId: t.id,
        start: t.start,
        end: t.end,
        duration: t.duration ?? 0,
      };
      if (t.percentDone !== undefined) snap.percentDone = t.percentDone;
      tasks.set(t.id, snap);
    }
    const baseline: Baseline = { id, takenAt: Date.now(), tasks };
    if (name !== undefined) baseline.name = name;
    this.baselines.set(id, baseline);
    return baseline;
  }

  variance(taskId: RecordId, baselineId: string): DurationMs | undefined {
    const baseline = this.baselines.get(baselineId);
    if (!baseline) return undefined;
    const snap = baseline.tasks.get(taskId);
    const node = this.tasks.get(taskId);
    if (!snap || !node || node.task.end == null) return undefined;
    return node.task.end - snap.end;
  }
}

/** Factory: build the default CPM scheduling engine. */
export function createSchedulingEngine<T extends Model = Model>(): SchedulingEngine<T> {
  return new CpmEngine<T>();
}
