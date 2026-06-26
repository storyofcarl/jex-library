/**
 * `DefaultGanttEngine` — the fallback {@link SchedulingEngine} the Gantt UI uses
 * when the consumer does not inject one via `GanttOptions.engine`.
 *
 * This is a deliberately small, calendar-light scheduler that satisfies the
 * frozen `SchedulingEngine` contract so the UI is functional and testable
 * standalone: it owns the task/dependency graph, keeps `{start,end,duration}`
 * mutually consistent, propagates finish-to-start (and the other three precedence
 * types) along the dependency DAG, rolls summary spans up from children, runs a
 * forward CPM pass with total/free slack + critical path, clamps date
 * constraints, and snapshots baselines. The package's real CPM engine (built in
 * the sibling `engine/` area against the same contract) is a drop-in replacement
 * — the UI only ever talks to the `SchedulingEngine` interface, never to this
 * class directly once an engine is injected.
 *
 * It is intentionally framework-free (no DOM) and shares the contract types only.
 */

import type { Model, RecordId } from '@jects/core';
import type { TimeMs, DurationMs, TimeSpan } from '@jects/timeline-core';
import type {
  TaskModel,
  DependencyModel,
  CalendarModel,
  ConstraintType,
  ScheduleOptions,
  ScheduleResult,
  ScheduleChange,
  TaskSchedule,
  SchedulingConflict,
  SchedulingEngine,
  WorkingTimeCalculator,
  Baseline,
  BaselineTask,
} from '../contract.js';

const MS_PER_DAY = 86_400_000;

/** A wall-clock (calendar-agnostic) working-time calculator. */
class WallClockCalculator implements WorkingTimeCalculator {
  constructor(readonly calendar: CalendarModel) {}
  isWorkingTime(): boolean {
    return true;
  }
  addWorkingTime(time: TimeMs, duration: DurationMs): TimeMs {
    return time + duration;
  }
  workingDurationBetween(start: TimeMs, end: TimeMs): DurationMs {
    return Math.max(0, end - start);
  }
  ceilToWorkingTime(time: TimeMs): TimeMs {
    return time;
  }
  floorToWorkingTime(time: TimeMs): TimeMs {
    return time;
  }
}

/**
 * The default Gantt scheduling engine. Forward-only CPM with constraint clamping,
 * dependency propagation, summary roll-up, slack/critical-path, and baselines.
 */
export class DefaultGanttEngine<T extends Model = Model> implements SchedulingEngine<T> {
  private tasks = new Map<RecordId, TaskModel<T>>();
  private order: RecordId[] = [];
  private deps = new Map<RecordId, DependencyModel>();
  private calendars = new Map<string, CalendarModel>();
  private defaultCalendarId = 'default';
  private schedules = new Map<RecordId, TaskSchedule>();
  private path: RecordId[] = [];
  private baselines = new Map<string, Baseline>();
  private projectStartAnchor: TimeMs | undefined;
  /**
   * Engine-owned "pinned by drag" start anchors. A `setTaskSpan` (drag) records
   * the dragged start here rather than synthesising a permanent
   * `manuallyScheduled` flag / `startNoEarlierThan` constraint: the position is
   * honored on the next pass (so dependents propagate from it) BUT is clearable
   * once its justifying dependency goes away — otherwise a dragged successor
   * would stay frozen at the dragged date after its driving link is removed
   * (stale-pin bug). Mirrors `CpmEngine.dragPins`.
   */
  private dragPins = new Map<RecordId, TimeMs>();

  /* ── model loading ─────────────────────────────────────────────────── */

  setTasks(tasks: ReadonlyArray<TaskModel<T>>): void {
    this.tasks.clear();
    this.order = [];
    this.dragPins.clear();
    for (const raw of tasks) {
      const t = this.normalize({ ...raw });
      this.tasks.set(t.id, t);
      this.order.push(t.id);
    }
  }

  setDependencies(deps: ReadonlyArray<DependencyModel>): void {
    this.deps.clear();
    for (const d of deps) this.deps.set(d.id, { type: 'FS', active: true, ...d });
  }

  setCalendars(calendars: ReadonlyArray<CalendarModel>, defaultCalendarId: string): void {
    this.calendars.clear();
    for (const c of calendars) this.calendars.set(c.id, c);
    this.defaultCalendarId = defaultCalendarId;
  }

  /* ── reads ─────────────────────────────────────────────────────────── */

  getTask(id: RecordId): TaskModel<T> | undefined {
    return this.tasks.get(id);
  }

  getDependenciesFor(taskId: RecordId): ReadonlyArray<DependencyModel> {
    const out: DependencyModel[] = [];
    for (const d of this.deps.values()) {
      if (d.fromId === taskId || d.toId === taskId) out.push(d);
    }
    return out;
  }

  getCalculatorFor(taskId: RecordId): WorkingTimeCalculator {
    const task = this.tasks.get(taskId);
    const calId = task?.calendarId ?? this.defaultCalendarId;
    const cal =
      this.calendars.get(calId) ??
      ({ id: calId, week: [], hoursPerDay: 8 } satisfies CalendarModel);
    return new WallClockCalculator(cal);
  }

  getSchedule(taskId: RecordId): TaskSchedule | undefined {
    return this.schedules.get(taskId);
  }

  /* ── scheduling passes ─────────────────────────────────────────────── */

  schedule(options: ScheduleOptions = {}): ScheduleResult {
    this.projectStartAnchor = options.projectStart;
    const conflicts: SchedulingConflict[] = [];
    const hasCycle = this.detectCycle();

    if (!hasCycle && options.direction !== 'backward') {
      this.forwardPass(options, conflicts);
    } else if (!hasCycle) {
      // Backward direction falls back to the forward solution then anchors the
      // late dates from the project end; spans are still consistent.
      this.forwardPass(options, conflicts);
    }

    this.rollUpSummaries();
    this.computeSlackAndPath();

    const span = this.projectSpan();
    return {
      schedules: new Map(this.schedules),
      criticalPath: [...this.path],
      projectSpan: span,
      conflicts,
      hasCycle,
    };
  }

  criticalPath(): ReadonlyArray<RecordId> {
    return [...this.path];
  }

  /* ── incremental edits ─────────────────────────────────────────────── */

  applyConstraint(
    taskId: RecordId,
    constraintType: ConstraintType,
    constraintDate?: TimeMs,
  ): ScheduleChange[] {
    const task = this.tasks.get(taskId);
    if (!task) return [];
    task.constraintType = constraintType;
    if (constraintDate != null) task.constraintDate = constraintDate;
    else delete task.constraintDate;
    // A genuine, user-authored constraint supersedes any engine drag anchor.
    this.dragPins.delete(taskId);
    return this.recalc();
  }

  setTaskSpan(taskId: RecordId, span: TimeSpan): ScheduleChange[] {
    const task = this.tasks.get(taskId);
    if (!task) return [];
    const before = this.spanOf(task);
    // A drag may resize the bar; persist the new working duration. The dragged
    // START, however, is recorded ONLY as an engine-owned drag pin (a soft,
    // clearable floor) — not written into `task.start` as a permanent anchor —
    // so that once the pin is dropped (e.g. its driving dependency is removed)
    // the task reflows from its real drivers instead of staying frozen at the
    // dragged date. `manuallyScheduled` is intentionally NOT set.
    if (!task.milestone) task.duration = Math.max(0, span.end - span.start);
    this.dragPins.set(taskId, span.start);
    const changes = this.recalc();
    // Ensure the dragged task itself is reported even if propagation is a no-op.
    if (!changes.some((c) => c.taskId === taskId)) {
      changes.unshift({ taskId, from: before, to: this.spanOf(task) });
    }
    return changes;
  }

  updateTask(taskId: RecordId, patch: Partial<TaskModel<T>>): ScheduleChange[] {
    const task = this.tasks.get(taskId);
    if (!task) return [];
    Object.assign(task, patch);
    this.normalize(task);
    // Re-authoring the task's own anchor or constraint drops a stale drag pin.
    if (
      'start' in patch ||
      'end' in patch ||
      'duration' in patch ||
      'constraintType' in patch ||
      'manuallyScheduled' in patch
    ) {
      this.dragPins.delete(taskId);
    }
    return this.recalc();
  }

  addDependency(dep: DependencyModel): ScheduleChange[] {
    const candidate: DependencyModel = { type: 'FS', active: true, ...dep };
    // Reject self-links and cycles defensively.
    if (candidate.fromId === candidate.toId) return [];
    this.deps.set(candidate.id, candidate);
    if (this.detectCycle()) {
      this.deps.delete(candidate.id);
      return [];
    }
    // The successor's position is now dependency-driven; drop its drag anchor so
    // the new link (not a stale dragged date) decides where it lands.
    this.dragPins.delete(candidate.toId);
    return this.recalc();
  }

  removeDependency(depId: RecordId): ScheduleChange[] {
    const dep = this.deps.get(depId);
    if (!this.deps.delete(depId)) return [];
    // Removing the link that justified a dragged successor position clears that
    // engine anchor so the task floats back per its remaining drivers instead of
    // staying frozen at the dragged date forever (incremental-staleness fix).
    if (dep) {
      this.dragPins.delete(dep.toId);
      this.dragPins.delete(dep.fromId);
    }
    return this.recalc();
  }

  recalc(): ScheduleChange[] {
    const before = new Map<RecordId, TimeSpan>();
    for (const id of this.order) {
      const t = this.tasks.get(id)!;
      before.set(id, this.spanOf(t));
    }
    const opts: ScheduleOptions = {};
    if (this.projectStartAnchor != null) opts.projectStart = this.projectStartAnchor;
    this.schedule(opts);
    const changes: ScheduleChange[] = [];
    for (const id of this.order) {
      const t = this.tasks.get(id)!;
      const from = before.get(id)!;
      const to = this.spanOf(t);
      if (from.start !== to.start || from.end !== to.end) {
        changes.push({ taskId: id, from, to });
      }
    }
    return changes;
  }

  /* ── baselines ─────────────────────────────────────────────────────── */

  captureBaseline(id: string, name?: string): Baseline {
    const tasksMap = new Map<RecordId, BaselineTask>();
    for (const id2 of this.order) {
      const t = this.tasks.get(id2)!;
      const span = this.spanOf(t);
      const snap: BaselineTask = {
        taskId: id2,
        start: span.start,
        end: span.end,
        duration: Math.max(0, span.end - span.start),
      };
      if (t.percentDone != null) snap.percentDone = t.percentDone;
      tasksMap.set(id2, snap);
    }
    const baseline: Baseline = { id, takenAt: Date.now(), tasks: tasksMap };
    if (name != null) baseline.name = name;
    this.baselines.set(id, baseline);
    return baseline;
  }

  variance(taskId: RecordId, baselineId: string): DurationMs | undefined {
    const baseline = this.baselines.get(baselineId);
    const snap = baseline?.tasks.get(taskId);
    const task = this.tasks.get(taskId);
    if (!snap || !task) return undefined;
    return this.spanOf(task).end - snap.end;
  }

  /* ── internals ─────────────────────────────────────────────────────── */

  /** Keep {start,end,duration} consistent for a single task. */
  private normalize(task: TaskModel<T>): TaskModel<T> {
    if (task.milestone) {
      // A milestone is zero-duration; pin end = start when one is known.
      const at = task.start ?? task.end;
      if (at != null) {
        task.start = at;
        task.end = at;
        task.duration = 0;
      }
      return task;
    }
    const { start, end, duration } = task;
    if (start != null && end != null) {
      task.duration = Math.max(0, end - start);
    } else if (start != null && duration != null) {
      task.end = start + duration;
    } else if (end != null && duration != null) {
      task.start = end - duration;
    } else if (start != null && duration == null && end == null) {
      task.duration = MS_PER_DAY;
      task.end = start + MS_PER_DAY;
    }
    return task;
  }

  private spanOf(task: TaskModel<T>): TimeSpan {
    const start = task.start ?? this.projectStartAnchor ?? 0;
    const end = task.end ?? start + (task.duration ?? MS_PER_DAY);
    return { start, end };
  }

  private childIdsOf(parentId: RecordId): RecordId[] {
    const out: RecordId[] = [];
    for (const id of this.order) {
      const t = this.tasks.get(id)!;
      if (t.parentId === parentId) out.push(id);
    }
    return out;
  }

  /** Active links whose successor is `taskId`. */
  private incomingLinks(taskId: RecordId): DependencyModel[] {
    const out: DependencyModel[] = [];
    for (const d of this.deps.values()) {
      if (d.active === false) continue;
      if (d.toId === taskId) out.push(d);
    }
    return out;
  }

  /**
   * Forward pass: visit tasks in dependency (topological) order, pushing each
   * successor's start to satisfy its predecessors and its date constraints.
   */
  private forwardPass(options: ScheduleOptions, conflicts: SchedulingConflict[]): void {
    const topo = this.topoOrder();
    const projStart = options.projectStart ?? this.minStart();

    for (const id of topo) {
      const task = this.tasks.get(id)!;
      // Summary tasks roll up later; skip span solving here when they have kids.
      if (this.childIdsOf(id).length > 0) continue;

      const dur = task.milestone ? 0 : task.duration ?? MS_PER_DAY;
      const links = this.incomingLinks(id);
      const pin = this.dragPins.get(id);
      // ASAP from the task's own anchor: a leaf with an authored start keeps it
      // unless a predecessor or constraint pushes it later. Tasks with no start
      // and no predecessor flow from the project start.
      let earliest =
        task.manuallyScheduled || (links.length === 0 && task.start != null)
          ? task.start ?? projStart
          : projStart;

      for (const link of links) {
        const pred = this.tasks.get(link.fromId);
        if (!pred) continue;
        const predSpan = this.spanOf(pred);
        const lag = link.lag ?? 0;
        const candidate = this.linkDriven(link.type ?? 'FS', predSpan, dur) + lag;
        if (candidate > earliest) earliest = candidate;
      }

      // Engine-owned drag pin acts as a soft floor (like a SNET) but is cleared
      // when its driving dependency/anchor changes — predecessors may still push
      // the task later than where it was dragged.
      if (pin != null && pin > earliest) earliest = pin;

      // Constraint clamping.
      earliest = this.applyConstraintClamp(task, earliest, dur, conflicts);

      if (!task.manuallyScheduled || task.start == null) {
        task.start = earliest;
        task.end = task.milestone ? earliest : earliest + dur;
        task.duration = task.milestone ? 0 : dur;
      } else {
        // Manually scheduled: honor its pinned span but keep duration synced.
        task.end = task.milestone ? task.start : task.start + dur;
        task.duration = task.milestone ? 0 : dur;
      }
    }
  }

  /** The earliest start a successor may take from one predecessor link. */
  private linkDriven(type: string, predSpan: TimeSpan, dur: DurationMs): TimeMs {
    switch (type) {
      case 'SS':
        return predSpan.start;
      case 'FF':
        return predSpan.end - dur;
      case 'SF':
        return predSpan.start - dur;
      case 'FS':
      default:
        return predSpan.end;
    }
  }

  private applyConstraintClamp(
    task: TaskModel<T>,
    earliest: TimeMs,
    dur: DurationMs,
    conflicts: SchedulingConflict[],
  ): TimeMs {
    const c = task.constraintType;
    const d = task.constraintDate;
    if (!c || c === 'asSoonAsPossible' || c === 'asLateAsPossible') return earliest;
    if (d == null) return earliest;
    switch (c) {
      case 'startNoEarlierThan':
        return Math.max(earliest, d);
      case 'mustStartOn':
        if (earliest > d)
          conflicts.push({
            taskId: task.id,
            reason: 'constraintViolation',
            message: `mustStartOn ${d} violated by predecessors (${earliest}).`,
          });
        return d;
      case 'startNoLaterThan':
        return Math.min(earliest, d);
      case 'finishNoEarlierThan':
        return Math.max(earliest, d - dur);
      case 'finishNoLaterThan':
        return Math.min(earliest, d - dur);
      case 'mustFinishOn':
        return d - dur;
      default:
        return earliest;
    }
  }

  /** Roll summary task spans up to the min/max of their descendants. */
  private rollUpSummaries(): void {
    // Process deepest-first so nested summaries aggregate correctly.
    const byDepth = [...this.order].sort((a, b) => this.depthOf(b) - this.depthOf(a));
    for (const id of byDepth) {
      const kids = this.childIdsOf(id);
      if (kids.length === 0) continue;
      let min = Infinity;
      let max = -Infinity;
      for (const kid of kids) {
        const span = this.spanOf(this.tasks.get(kid)!);
        if (span.start < min) min = span.start;
        if (span.end > max) max = span.end;
      }
      if (min !== Infinity) {
        const task = this.tasks.get(id)!;
        task.start = min;
        task.end = max;
        task.duration = Math.max(0, max - min);
        task.summary = true;
      }
    }
  }

  private depthOf(id: RecordId): number {
    let depth = 0;
    let cur = this.tasks.get(id);
    const seen = new Set<RecordId>();
    while (cur && cur.parentId != null && !seen.has(cur.id)) {
      seen.add(cur.id);
      depth++;
      cur = this.tasks.get(cur.parentId);
    }
    return depth;
  }

  /** Topological order of tasks by their active dependency DAG. */
  private topoOrder(): RecordId[] {
    const indeg = new Map<RecordId, number>();
    for (const id of this.order) indeg.set(id, 0);
    for (const d of this.deps.values()) {
      if (d.active === false) continue;
      if (indeg.has(d.toId)) indeg.set(d.toId, (indeg.get(d.toId) ?? 0) + 1);
    }
    const queue = this.order.filter((id) => (indeg.get(id) ?? 0) === 0);
    const out: RecordId[] = [];
    const seen = new Set<RecordId>();
    while (queue.length) {
      const id = queue.shift()!;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(id);
      for (const d of this.deps.values()) {
        if (d.active === false || d.fromId !== id) continue;
        const left = (indeg.get(d.toId) ?? 0) - 1;
        indeg.set(d.toId, left);
        if (left <= 0) queue.push(d.toId);
      }
    }
    // Any tasks left out (cycles) get appended in declaration order.
    for (const id of this.order) if (!seen.has(id)) out.push(id);
    return out;
  }

  private detectCycle(): boolean {
    const WHITE = 0;
    const GRAY = 1;
    const BLACK = 2;
    const color = new Map<RecordId, number>();
    for (const id of this.order) color.set(id, WHITE);
    const adj = new Map<RecordId, RecordId[]>();
    for (const d of this.deps.values()) {
      if (d.active === false) continue;
      (adj.get(d.fromId) ?? adj.set(d.fromId, []).get(d.fromId)!).push(d.toId);
    }
    const visit = (id: RecordId): boolean => {
      color.set(id, GRAY);
      for (const next of adj.get(id) ?? []) {
        const cc = color.get(next) ?? WHITE;
        if (cc === GRAY) return true;
        if (cc === WHITE && visit(next)) return true;
      }
      color.set(id, BLACK);
      return false;
    };
    for (const id of this.order) {
      if ((color.get(id) ?? WHITE) === WHITE && visit(id)) return true;
    }
    return false;
  }

  /** Compute total/free slack via a backward pass, then mark critical tasks. */
  private computeSlackAndPath(): void {
    this.schedules.clear();
    this.path = [];
    const projEnd = this.maxEnd();

    // Late-finish per task: min over successors of (successor.lateStart) else projEnd.
    const lateFinish = new Map<RecordId, TimeMs>();
    const topo = this.topoOrder();
    for (let i = topo.length - 1; i >= 0; i--) {
      const id = topo[i]!;
      let lf = projEnd;
      let first = true;
      for (const d of this.deps.values()) {
        if (d.active === false || d.fromId !== id) continue;
        const succ = this.tasks.get(d.toId);
        if (!succ) continue;
        const succSpan = this.spanOf(succ);
        const lag = d.lag ?? 0;
        // FS: this finish must be ≤ successor start − lag.
        const limit = succSpan.start - lag;
        if (first || limit < lf) {
          lf = limit;
          first = false;
        }
      }
      lateFinish.set(id, lf);
    }

    for (const id of this.order) {
      const task = this.tasks.get(id)!;
      const span = this.spanOf(task);
      const dur = Math.max(0, span.end - span.start);
      const lf = lateFinish.get(id) ?? span.end;
      const ls = lf - dur;
      const totalSlack = Math.max(0, ls - span.start);
      // Free slack: slack before the earliest successor start.
      let freeSlack = totalSlack;
      let firstSucc = true;
      for (const d of this.deps.values()) {
        if (d.active === false || d.fromId !== id) continue;
        const succ = this.tasks.get(d.toId);
        if (!succ) continue;
        const gap = this.spanOf(succ).start - span.end - (d.lag ?? 0);
        if (firstSucc || gap < freeSlack) {
          freeSlack = Math.max(0, Math.min(freeSlack, gap));
          firstSucc = false;
        }
      }
      const critical = totalSlack === 0 && this.childIdsOf(id).length === 0;
      this.schedules.set(id, {
        taskId: id,
        start: span.start,
        end: span.end,
        earlyStart: span.start,
        earlyFinish: span.end,
        lateStart: ls,
        lateFinish: lf,
        totalSlack,
        freeSlack,
        critical,
      });
      if (critical) this.path.push(id);
    }
  }

  private minStart(): TimeMs {
    let min = Infinity;
    for (const id of this.order) {
      const t = this.tasks.get(id)!;
      if (t.start != null && t.start < min) min = t.start;
    }
    return min === Infinity ? (this.projectStartAnchor ?? 0) : min;
  }

  private maxEnd(): TimeMs {
    let max = -Infinity;
    for (const id of this.order) {
      const span = this.spanOf(this.tasks.get(id)!);
      if (span.end > max) max = span.end;
    }
    return max === -Infinity ? this.minStart() : max;
  }

  private projectSpan(): TimeSpan {
    const start = this.minStart();
    const end = this.maxEnd();
    return { start, end: Math.max(end, start + 1) };
  }
}
