/**
 * `Gantt` — the Gantt chart Widget. It composes the LEFT task-tree grid
 * (`GanttTaskTree`, reusing `@jects/grid` in tree mode) and the RIGHT timeline
 * (`GanttTimelineView`, built on `@jects/timeline-core` primitives), driving a
 * headless `SchedulingEngine` for every date. It implements the frozen
 * `GanttApi`/`Gantt` contract.
 *
 * The engine ⇄ UI seam is strictly one-directional (per the contract notes):
 * every drag, resize, constraint edit, and dependency change is forwarded into
 * the engine, which returns the minimal `ScheduleChange[]`; the widget then
 * writes those recomputed spans back into the panes and repaints. The UI never
 * computes a task's start/end itself.
 *
 * The scheduling engine is injectable (`GanttOptions.engine`); when omitted the
 * package's `DefaultGanttEngine` is used. The two panes are kept in vertical
 * lockstep (scroll + expand/collapse) so bars line up with their tree rows.
 */

import {
  Widget,
  TreeStore,
  createEl,
  register,
  type Model,
  type RecordId,
} from '@jects/core';
import {
  WEEK_AND_DAY,
  getPreset,
  type TimeSpan,
  type ViewPreset,
} from '@jects/timeline-core';
import type {
  GanttOptions,
  GanttEvents,
  GanttApi,
  GanttFeature,
  TaskModel,
  DependencyModel,
  CalendarModel,
  ConstraintType,
  ScheduleOptions,
  ScheduleResult,
  ScheduleChange,
  TaskSchedule,
  Baseline,
  BaselineTask,
  SchedulingEngine,
} from '../contract.js';
import { DefaultGanttEngine } from './default-engine.js';
import {
  toEffortDrivenEngine,
  shouldUseEffortScheduling,
  type EffortResourceModel,
  type EffortAssignmentModel,
  type ResourceAwareEngine,
} from './effort-scheduling.js';
import { toWorkingTimeCalendar } from './calendar-bridge.js';
import { GanttTaskTree, type VisibleTaskRow } from './task-tree.js';
import { rollupFlagPatch } from './rollup-column.js';
import { successorsLabel } from './successors-column.js';
import {
  GanttTimelineView,
  type DragMode,
  type TimelineRowInput,
} from './timeline-view.js';
import { GanttTaskEditor } from './task-editor.js';
import { installResourceLayer } from '../resource/install.js';
import type { ResourceApi } from '../resource/resource-contract.js';
import { GanttExportCsv } from '../export/gantt-export-csv.js';
import { GanttExportXlsx } from '../export/gantt-export-xlsx.js';
import { GanttIcsExportFeature } from '../export/gantt-ics-export.js';
import { GanttImageExportFeature } from '../export/gantt-image-export.js';
import { GanttPdfExportFeature } from '../export/gantt-pdf-export.js';
import { GanttExportMenu } from './export-feature.js';
import type { GanttExportsConfig } from '../contract.js';

const MS_PER_DAY = 86_400_000;
const DEFAULT_TREE_WIDTH = 420;
const DEFAULT_ROW_HEIGHT = 32;
const DEFAULT_HEADER_HEIGHT = 48;

type AnyTask<T extends Model> = TaskModel<T> & { children?: TaskModel<T>[] };

export class Gantt<T extends Model = Model>
  extends Widget<GanttOptions<T>, GanttEvents<T>>
  implements GanttApi<T>
{
  // NOTE: `super()` (Widget constructor) calls `render()` → `setup()` BEFORE any
  // class-field initializers here run, so these are assigned inside `setup()`
  // rather than via initializers (see Button.buildEl for the same caveat).
  private declare _engine: SchedulingEngine<T>;
  /**
   * When effort-driven scheduling is active, the {@link _engine} is an
   * `EffortDrivenEngine` wrapper and this holds the same instance typed as
   * resource-aware (so `assignResource`/`unassignResource`/`setAssignmentUnits`
   * are reachable). `null` when no effort scheduling is wired — the public
   * `engine` getter then returns the base engine unchanged. See effort-scheduling.ts.
   */
  private declare _effortEngine: ResourceAwareEngine<T> | null;
  private declare _store: TreeStore<AnyTask<T>>;
  private declare deps: Map<RecordId, DependencyModel>;
  private declare depSeq: number;

  private declare tree: GanttTaskTree<T>;
  private declare view: GanttTimelineView<T>;
  private declare editor: GanttTaskEditor<T>;
  private declare _features: Map<string, GanttFeature<T>>;
  /**
   * The active resource-management surface, or `null` when no resource layer is
   * wired. Set by {@link installResourceLayer} in `setup()` — auto-installed from
   * `GanttOptions.resources`/`.assignments` or adopted from a consumer-provided
   * `ResourceManager` plugin. Exposed via the {@link resources} getter.
   *
   * NOTE: `declare` (no initializer) — `super()` runs `render()` → `setup()`
   * BEFORE class-field initializers, so an `= null` initializer would clobber the
   * value `setup()` assigns. It is set explicitly inside `setup()`.
   */
  private declare _resourceApi: ResourceApi<T> | null;

  private declare criticalVisible: boolean;
  private declare activeBaseline: string | null;
  private lastResult: ScheduleResult | null = null;
  private declare syncingScroll: boolean;
  /** The resolved project `CalendarModel` (drives non-working backdrop shading). */
  private projectCalendar: CalendarModel | undefined;
  /**
   * Re-entrancy guard: `writeBackSpans()` calls `store.update()`, which emits a
   * `change` event that the `onStoreChange` subscription handles. Without this
   * flag every legitimate external edit would re-enter `onStoreChange` →
   * `recalc` → `writeBackSpans` again (at best a redundant double reschedule;
   * with a non-idempotent recalc, potentially unbounded). Mirrors the
   * `syncingScroll` pattern used for the two panes' scroll lockstep.
   */
  private declare applyingSpans: boolean;

  /* ── Widget overrides ──────────────────────────────────────────────────── */

  protected override defaults(): Partial<GanttOptions<T>> {
    return {
      direction: 'forward',
      showCriticalPath: true,
      treeWidth: DEFAULT_TREE_WIDTH,
    } as Partial<GanttOptions<T>>;
  }

  protected buildEl(): HTMLElement {
    const el = createEl('div', { className: 'jects-gantt' });
    el.tabIndex = -1;
    return el;
  }

  protected override render(): void {
    // First render builds the panes; subsequent renders refresh them.
    if (!this.tree) {
      this.setup();
    }
    this.el.setAttribute('role', 'group');
    this.el.setAttribute('aria-label', 'Gantt chart');
    this.refreshPanes();
  }

  private setup(): void {
    const cfg = this.config;
    this.deps = new Map<RecordId, DependencyModel>();
    this.depSeq = 0;
    this._features = new Map<string, GanttFeature<T>>();
    this._resourceApi = null;
    this.syncingScroll = false;
    this.applyingSpans = false;
    this.criticalVisible = cfg.showCriticalPath !== false;
    this.activeBaseline = cfg.baseline ?? null;

    // 1. Build the task store (TreeStore keyed by parentId).
    this._store = this.toTreeStore(cfg.tasks);

    // 2. Build the engine and load the model.
    const baseEngine = cfg.engine ?? new DefaultGanttEngine<T>();
    const tasks = this._store.getItems();
    const { resources, assignments } = this.readResourceConfig();
    // Effort-driven default-engine path: when the consumer wired resources /
    // assignments, or any task carries effort / effortDriven, decorate the base
    // engine so DURATION is derived from `effort / Σ units` and reflows as
    // resources change (Bryntum/DHTMLX effort-driven parity). The PUBLIC `engine`
    // getter unwraps so `gantt.engine` is still the base scheduler.
    if (shouldUseEffortScheduling({ engine: baseEngine, resources, assignments, tasks })) {
      this._effortEngine = toEffortDrivenEngine<T>(baseEngine);
      this._engine = this._effortEngine;
    } else {
      this._effortEngine = null;
      this._engine = baseEngine;
    }
    this._engine.setTasks(tasks);
    for (const d of cfg.dependencies ?? []) this.deps.set(d.id, d);
    this._engine.setDependencies([...this.deps.values()]);
    const calendars: CalendarModel[] = cfg.calendars ?? [];
    const projectCalendarId = cfg.defaultCalendarId ?? calendars[0]?.id ?? 'default';
    this._engine.setCalendars(calendars, projectCalendarId);
    this.projectCalendar = calendars.find((c) => c.id === projectCalendarId);
    // Load the resource/assignment layer into the effort engine (if any) so the
    // initial schedule already reflects effort-driven durations.
    if (this._effortEngine) {
      if (resources) this._effortEngine.setResources(resources);
      if (assignments) this._effortEngine.setAssignments(assignments);
    }

    // 3. Initial full schedule.
    this.lastResult = this._engine.schedule(this.scheduleOptions());
    this.writeBackSpans(this.allChanges());

    // 4. Build the panes.
    const preset = this.resolvePreset(cfg.preset);
    const range = this.computeRange();
    const treeWidth = cfg.treeWidth ?? DEFAULT_TREE_WIDTH;

    const splitter = createEl('div', { className: 'jects-gantt__split' });

    this.tree = new GanttTaskTree<T>({
      store: this._store,
      ...(cfg.columns ? { columns: cfg.columns } : {}),
      rowHeight: DEFAULT_ROW_HEIGHT,
      headerHeight: DEFAULT_HEADER_HEIGHT,
      width: treeWidth,
      predecessorsOf: (id) => this.predecessorsLabel(id),
      // Symmetric read-only Successors column resolver (links OUT of the task).
      successorsOf: (id) => this.successorsLabel(id),
      // Rollup DATA column ('flag' mode): route toggles through the engine so
      // the same task.rollup flag the visual overlay reads re-propagates +
      // reschedules. (Standalone fallback writes the store directly.)
      onRollupToggle: (id, next) => {
        this.updateTask(id, rollupFlagPatch(next) as Partial<TaskModel<T>>);
      },
      // Effort/Units columns: resolve the engine's hours/day + assigned Σ units.
      ...(this._effortEngine?.getHoursPerDay
        ? { hoursPerDay: this._effortEngine.getHoursPerDay() }
        : {}),
      unitsOf: (id) => this._effortEngine?.getAssignedUnits(id),
      onRowExpand: () => this.refreshPanes(),
      onScroll: (top) => this.onTreeScroll(top),
      onTaskClick: (id) => this.emitTaskClick(id),
      onTaskDblClick: (id) => this.openEditor(id),
    });

    const backdropCalendar = toWorkingTimeCalendar(this.projectCalendar);
    this.view = new GanttTimelineView<T>({
      preset,
      zoom: cfg.preset ? 1 : 1,
      range,
      ...(backdropCalendar ? { calendar: backdropCalendar } : {}),
      onTaskSpanChange: (id, span, mode) => this.handleTaskDrag(id, span, mode),
      onDependencyCreate: (link) => this.handleLinkCreate(link),
      onTaskClick: (id, native) => this.emitTaskClick(id, native),
      onTaskDblClick: (id) => this.openEditor(id),
      onScroll: (top) => this.onTimelineScroll(top),
    });

    this.editor = new GanttTaskEditor<T>({
      // Surface the effort / effortDriven fields only when the effort engine is
      // wired (a plain Gantt's editor is unchanged). hoursPerDay drives the
      // person-day ⇄ working-ms conversion the editor displays.
      effortEnabled: this._effortEngine != null,
      ...(this._effortEngine?.getHoursPerDay
        ? { hoursPerDay: this._effortEngine.getHoursPerDay() }
        : {}),
      onSave: (id, patch) => {
        const next: Partial<TaskModel<T>> = {};
        if (patch.name != null) next.name = patch.name;
        if (patch.start != null) next.start = patch.start;
        if (patch.end != null) next.end = patch.end;
        if (patch.duration != null) next.duration = patch.duration;
        if (patch.percentDone != null) next.percentDone = patch.percentDone;
        if (patch.milestone != null) next.milestone = patch.milestone;
        if (patch.effort != null) next.effort = patch.effort;
        if (patch.effortDriven != null) {
          (next as TaskModel<T> & { effortDriven?: boolean }).effortDriven = patch.effortDriven;
        }
        this.updateTask(id, next);
      },
    });

    splitter.append(this.tree.el, this.view.el);
    this.el.append(splitter);

    // React to store mutations (external edits) by re-syncing the engine.
    const off = this._store.events.on('change', () => this.onStoreChange());
    this.track(off);

    // Lazily upgrade the left pane to the real grid (best-effort).
    void this.tree.mountGrid().then(() => this.refreshPanes());

    // Install plugins.
    for (const feature of this.config.plugins ?? []) this.use(feature);

    // Wire the resource data layer: adopt a consumer-provided ResourceManager
    // (passed via `plugins`), else auto-install one from
    // `GanttOptions.resources`/`.assignments`. Inert when none are present.
    this._resourceApi =
      installResourceLayer<T>(this, {
        ...(this.config.resources ? { resources: this.config.resources } : {}),
        ...(this.config.assignments ? { assignments: this.config.assignments } : {}),
      }) ?? null;

    // Auto-install the export surface so `gantt.exportCsv()` / `exportXlsx()` /
    // `exportIcs()` / `exportPng()` / `exportImage()` / `exportPdf()` are
    // available out of the box (Bryntum/DHTMLX export parity). Each feature is
    // additive (only grafts methods) and self-registers its teardown via
    // `api.track`. Opt out with `{ exports: false }`; refine via `{ exports: {…} }`;
    // mount the visible Export menu with `{ exports: { menu: true } }`.
    this.installExportFeatures();
  }

  /**
   * Install the configured auto-export features. Reads {@link GanttOptions.exports}
   * (`true`/omitted = all method features; `false` = none; an object selects which
   * + whether to mount the visible {@link GanttExportMenu}). A consumer-supplied
   * plugin with the same feature name takes precedence (already installed → skip).
   */
  private installExportFeatures(): void {
    const raw = (this.config as { exports?: boolean | GanttExportsConfig }).exports;
    if (raw === false) return;
    const cfg: GanttExportsConfig = raw && typeof raw === 'object' ? raw : {};
    const want = (flag: boolean | undefined): boolean => flag !== false;

    const add = (name: string, make: () => GanttFeature<T>): void => {
      if (this._features.has(name)) return; // consumer already installed one
      this.use(make());
    };

    if (want(cfg.csv)) add('exportCsv', () => new GanttExportCsv<T>());
    if (want(cfg.xlsx)) add('exportXlsx', () => new GanttExportXlsx<T>());
    if (want(cfg.ics)) add('icsExport', () => new GanttIcsExportFeature<T>());
    if (want(cfg.image)) add('gantt-image-export', () => new GanttImageExportFeature<T>());
    if (want(cfg.pdf)) add('gantt-pdf-export', () => new GanttPdfExportFeature<T>());
    // The visible unified Export menu button is opt-in (mounts UI).
    if (cfg.menu === true) add('gantt-export-menu', () => new GanttExportMenu<T>());
  }

  /* ── GanttApi: readonly surfaces ───────────────────────────────────────── */

  get engine(): SchedulingEngine<T> {
    // When effort scheduling is active `_engine` is the EffortDrivenEngine
    // wrapper; the public contract surfaces the BASE scheduler (so consumers
    // that injected one still get back exactly that instance, and the default
    // path still reports the DefaultGanttEngine).
    if (this._effortEngine) return this._effortEngine.baseEngine;
    return this._engine;
  }

  /**
   * The resource-aware engine when effort-driven scheduling is active, else
   * `null`. Use this for resource assignment/units mutations that reflow
   * effort-driven durations. Most consumers should prefer the
   * {@link assignResource} / {@link unassignResource} / {@link setAssignmentUnits}
   * methods, which proxy through here and repaint.
   */
  get effortEngine(): ResourceAwareEngine<T> | null {
    return this._effortEngine;
  }

  get timeline(): GanttApi<T>['timeline'] {
    // No concrete Timeline engine is shipped by timeline-core; the Gantt composes
    // the timeline from core primitives. Expose a minimal structural adapter over
    // the bits consumers/features actually use (axis projection, root el, repaint,
    // span writes). Cast at the seam — the contract type is a frozen interface.
    return this.timelineAdapter as unknown as GanttApi<T>['timeline'];
  }

  get features(): ReadonlyMap<string, GanttFeature<T>> {
    return this._features;
  }

  /**
   * The resource-management surface (resources, assignments, allocation), or
   * `undefined` when no resource layer is wired. Auto-installed from
   * `GanttOptions.resources`/`.assignments`, or adopted from a consumer-provided
   * `ResourceManager` plugin. Read the resource layer THROUGH this surface.
   */
  get resources(): ResourceApi<T> | undefined {
    return this._resourceApi ?? undefined;
  }

  private get timelineAdapter(): {
    axis: GanttTimelineView<T>['axis'];
    el: HTMLElement;
    refresh(): void;
    updateEventSpan(id: RecordId, span: TimeSpan): boolean;
    getEventById(id: RecordId): TaskModel<T> | undefined;
  } {
    return {
      axis: this.view.axis,
      el: this.view.el,
      refresh: () => this.view.refresh(),
      updateEventSpan: (id, span) => this.updateTaskSpan(id, span),
      getEventById: (id) => this._engine.getTask(id),
    };
  }

  /* ── GanttApi: reads ───────────────────────────────────────────────────── */

  getTask(id: RecordId): TaskModel<T> | undefined {
    return this._engine.getTask(id) ?? this._store.getById(id);
  }

  getChildren(id: RecordId): ReadonlyArray<TaskModel<T>> {
    return this._store.getChildren(id) as ReadonlyArray<TaskModel<T>>;
  }

  getDependenciesFor(taskId: RecordId): ReadonlyArray<DependencyModel> {
    const out: DependencyModel[] = [];
    for (const d of this.deps.values()) {
      if (d.fromId === taskId || d.toId === taskId) out.push(d);
    }
    return out;
  }

  getSchedule(taskId: RecordId): TaskSchedule | undefined {
    return this._engine.getSchedule(taskId);
  }

  getCriticalPath(): ReadonlyArray<RecordId> {
    return this._engine.criticalPath();
  }

  /* ── GanttApi: mutations (routed through the engine) ───────────────────── */

  updateTaskSpan(taskId: RecordId, span: TimeSpan): boolean {
    const task = this.getTask(taskId);
    if (!task) return false;
    const from = this.spanOf(task);
    if (this.emit('beforeTaskChange', { task, from, to: span }) === false) return false;

    const changes = this._engine.setTaskSpan(taskId, span);
    this.applyChanges(changes);
    const updated = this.getTask(taskId)!;
    this.emit('taskChange', { task: updated, changes });
    this.afterSchedule();
    return true;
  }

  updateTask(taskId: RecordId, patch: Partial<TaskModel<T>>): boolean {
    const task = this.getTask(taskId);
    if (!task) return false;
    const changes = this._engine.updateTask(taskId, patch);
    // Mirror non-date fields into the store so the tree reflects them. This is an
    // engine-routed mutation (the engine already has the patch), so suppress the
    // store `change` echo to avoid a redundant re-entrant reschedule.
    const prevApplying = this.applyingSpans;
    this.applyingSpans = true;
    try {
      this._store.update(taskId, patch as Partial<AnyTask<T>>);
    } finally {
      this.applyingSpans = prevApplying;
    }
    this.applyChanges(changes);
    this.emit('taskChange', { task: this.getTask(taskId)!, changes });
    this.afterSchedule();
    return true;
  }

  applyConstraint(
    taskId: RecordId,
    constraintType: ConstraintType,
    constraintDate?: number,
  ): boolean {
    const task = this.getTask(taskId);
    if (!task) return false;
    const changes = this._engine.applyConstraint(taskId, constraintType, constraintDate);
    this.applyChanges(changes);
    this.emit('taskChange', { task: this.getTask(taskId)!, changes });
    this.afterSchedule();
    return true;
  }

  /* ── effort-driven resource mutations (active only when wired) ──────────── */

  /**
   * Assign a resource to a task at `units` allocation (a fraction; `1` =
   * full-time). For an effort-driven task this reflows its DURATION
   * (`effort / Σ units`) and re-propagates dependents; for a fixed-duration task
   * the duration is kept and its `effort` tracks the staffing. Spans are written
   * back and both panes repaint. Returns the created assignment, or `undefined`
   * when effort scheduling is not active.
   */
  assignResource(
    taskId: RecordId,
    resourceId: RecordId,
    units?: number,
  ): EffortAssignmentModel | undefined {
    const eng = this._effortEngine;
    if (!eng) return undefined;
    const { assignment, changes } = eng.assignResource(taskId, resourceId, units);
    this.afterResourceChange(taskId, changes);
    return assignment;
  }

  /** Remove an assignment by id; reflows/re-propagates and repaints. */
  unassignResource(assignmentId: RecordId): boolean {
    const eng = this._effortEngine;
    if (!eng) return false;
    const changes = eng.unassignResource(assignmentId);
    this.afterResourceChange(undefined, changes);
    return true;
  }

  /** Remove `resourceId` from `taskId` (if assigned); reflows and repaints. */
  unassignResourceFromTask(taskId: RecordId, resourceId: RecordId): boolean {
    const eng = this._effortEngine;
    if (!eng) return false;
    const changes = eng.unassignResourceFromTask(taskId, resourceId);
    this.afterResourceChange(taskId, changes);
    return true;
  }

  /** Change an assignment's units; reflows the effort-driven duration + repaints. */
  setAssignmentUnits(assignmentId: RecordId, units: number): boolean {
    const eng = this._effortEngine;
    if (!eng) return false;
    const changes = eng.setAssignmentUnits(assignmentId, units);
    this.afterResourceChange(undefined, changes);
    return true;
  }

  /** Combined assigned units (Σ) on a task (0 when no effort engine). */
  getAssignedUnits(taskId: RecordId): number {
    return this._effortEngine?.getAssignedUnits(taskId) ?? 0;
  }

  /** Assignments on a task (empty when no effort engine). */
  getAssignmentsFor(taskId: RecordId): ReadonlyArray<EffortAssignmentModel> {
    return this._effortEngine?.getAssignmentsFor(taskId) ?? [];
  }

  /**
   * Apply the engine's resource-reflow changes: mirror the reflowed
   * effort/duration into the store (so the tree's Effort/Units columns update),
   * write back the moved spans, repaint, and emit `taskChange`/`scheduleChange`.
   */
  private afterResourceChange(
    taskId: RecordId | undefined,
    changes: ReadonlyArray<ScheduleChange>,
  ): void {
    // Mirror the reflowed effort + resourceIds onto the store rows touched, so
    // the grid columns reflect the new staffing without a full reload.
    const ids = new Set<RecordId>(changes.map((c) => c.taskId));
    if (taskId != null) ids.add(taskId);
    const prevApplying = this.applyingSpans;
    this.applyingSpans = true;
    try {
      for (const id of ids) {
        const t = this._engine.getTask(id);
        if (!t) continue;
        this._store.update(id, {
          effort: t.effort,
          resourceIds: t.resourceIds,
          duration: t.duration,
        } as Partial<AnyTask<T>>);
      }
    } finally {
      this.applyingSpans = prevApplying;
    }
    this.applyChanges(changes);
    if (taskId != null) {
      const updated = this.getTask(taskId);
      if (updated) this.emit('taskChange', { task: updated, changes });
    }
    this.afterSchedule();
  }

  addDependency(dep: Omit<DependencyModel, 'id'>): DependencyModel | undefined {
    if (this.emit('beforeDependencyCreate', { dependency: dep }) === false) return undefined;
    const id = `dep-${++this.depSeq}`;
    const src = dep as DependencyModel;
    const full: DependencyModel = {
      id,
      fromId: src.fromId,
      toId: src.toId,
      type: src.type ?? 'FS',
      active: src.active ?? true,
      ...(src.lag != null ? { lag: src.lag } : {}),
    };
    const changes = this._engine.addDependency(full);
    // Engine rejects cycles by returning []  AND not storing the dep; detect that.
    const stored = this._engine.getDependenciesFor(full.fromId).some((d) => d.id === id);
    if (!stored && changes.length === 0 && this.wouldCycle(full)) return undefined;
    this.deps.set(id, full);
    this.applyChanges(changes);
    this.emit('dependencyCreate', { dependency: full });
    this.afterSchedule();
    return full;
  }

  removeDependency(depId: RecordId): void {
    if (!this.deps.has(depId)) return;
    this.deps.delete(depId);
    const changes = this._engine.removeDependency(depId);
    this.applyChanges(changes);
    this.emit('dependencyRemove', { dependencyId: depId });
    this.afterSchedule();
  }

  reschedule(options?: ScheduleOptions): ScheduleResult {
    this.lastResult = this._engine.schedule(options ?? this.scheduleOptions());
    this.writeBackSpans(this.allChanges());
    this.refreshPanes();
    this.emit('scheduleChange', { result: this.lastResult });
    if (this.lastResult.conflicts.length) {
      this.emit('conflict', { conflicts: this.lastResult.conflicts });
    }
    return this.lastResult;
  }

  /* ── GanttApi: baselines / display ─────────────────────────────────────── */

  captureBaseline(id: string, name?: string): Baseline {
    const baseline = this._engine.captureBaseline(id, name);
    this.capturedBaselines.set(id, baseline.tasks);
    this.emit('baselineCapture', { baseline });
    return baseline;
  }

  showBaseline(baselineId: string | null): void {
    this.activeBaseline = baselineId;
    this.refreshPanes();
  }

  setCriticalPathVisible(visible: boolean): void {
    this.criticalVisible = visible;
    this.refreshPanes();
  }

  /* ── GanttApi: feature lifecycle ───────────────────────────────────────── */

  use(feature: GanttFeature<T>): GanttFeature<T> {
    this._features.set(feature.name, feature);
    feature.init(this);
    this.track(() => {
      this._features.delete(feature.name);
      feature.destroy();
    });
    return feature;
  }

  removeFeature(name: string): void {
    const feature = this._features.get(name);
    if (!feature) return;
    this._features.delete(name);
    feature.destroy();
  }

  /* ── GanttApi: disposal registration (alias the Widget helper) ─────────── */

  override track(disposer: () => void): void {
    super.track(disposer);
  }

  /* ── internal wiring ───────────────────────────────────────────────────── */

  /**
   * Read the (additive, non-frozen-contract) resource + assignment options off
   * the config. The resource-management workflow may add `resources` /
   * `assignments` to `GanttOptions`; we read them structurally so the effort
   * engine can be seeded without coupling to that contract. The effort engine's
   * `ResourceModel`/`AssignmentModel` are structurally compatible with the
   * resource layer's (same `id`/`name`/`capacity`/`calendarId`/`hourlyCost`, and
   * `units` as a percentage where 100 = full-time), so records flow straight
   * through. Returns `undefined` arrays when absent.
   */
  private readResourceConfig(): {
    resources: EffortResourceModel[] | undefined;
    assignments: EffortAssignmentModel[] | undefined;
  } {
    const cfg = this.config as unknown as {
      resources?: Array<{ id: RecordId; name?: string; maxUnits?: number; capacity?: number; calendarId?: string; costPerHour?: number; hourlyCost?: number }>;
      assignments?: Array<{ id?: RecordId; taskId: RecordId; resourceId: RecordId; units?: number }>;
    };
    const resources = cfg.resources?.map((r) => {
      const out: EffortResourceModel = { id: r.id };
      if (r.name != null) out.name = r.name;
      // `capacity`/`maxUnits` are both FTE-equivalents (1 = one full-time unit).
      const cap = r.capacity ?? r.maxUnits;
      if (cap != null) out.capacity = cap;
      if (r.calendarId != null) out.calendarId = r.calendarId;
      const cost = r.hourlyCost ?? r.costPerHour;
      if (cost != null) out.hourlyCost = cost;
      return out;
    });
    let asgSeq = 0;
    const assignments = cfg.assignments?.map((a) => {
      const out: EffortAssignmentModel = {
        id: a.id ?? `__jects_cfg_asg_${++asgSeq}`,
        taskId: a.taskId,
        resourceId: a.resourceId,
      };
      if (a.units != null) out.units = a.units;
      return out;
    });
    return { resources, assignments };
  }

  private toTreeStore(
    src: GanttOptions<T>['tasks'],
  ): TreeStore<AnyTask<T>> {
    if (src instanceof TreeStore) {
      const store = src as TreeStore<AnyTask<T>>;
      this.expandAll(store);
      return store;
    }
    const data = src as TaskModel<T>[];
    // Build a parentId-keyed nested tree so TreeStore's children resolution works.
    const byId = new Map<RecordId, AnyTask<T>>();
    for (const t of data) byId.set(t.id, { ...t, children: [] } as AnyTask<T>);
    const roots: AnyTask<T>[] = [];
    const allIds: RecordId[] = [];
    for (const t of byId.values()) {
      allIds.push(t.id);
      const parentId = t.parentId ?? null;
      if (parentId != null && byId.has(parentId)) {
        byId.get(parentId)!.children!.push(t);
      } else {
        roots.push(t);
      }
    }
    // Summary tasks expanded by default so the whole plan is visible.
    return new TreeStore<AnyTask<T>>({ data: roots, expanded: allIds });
  }

  /** Expand every non-leaf node of a store (Gantt shows the full plan). */
  private expandAll(store: TreeStore<AnyTask<T>>): void {
    for (const node of store.getItems()) {
      if (!store.isLeaf(node)) void store.expand(node);
    }
  }

  private resolvePreset(preset?: ViewPreset): ViewPreset {
    if (preset) return preset;
    return getPreset('weekAndDay') ?? WEEK_AND_DAY;
  }

  private scheduleOptions(): ScheduleOptions {
    const cfg = this.config;
    const opts: ScheduleOptions = {
      direction: cfg.direction ?? 'forward',
      computeCriticalPath: true,
      respectManual: true,
    };
    if (cfg.projectStart != null) opts.projectStart = cfg.projectStart;
    if (cfg.projectEnd != null) opts.projectEnd = cfg.projectEnd;
    return opts;
  }

  /** Compute the visible time range from the task spans (padded a week). */
  private computeRange(): TimeSpan {
    let min = Infinity;
    let max = -Infinity;
    for (const t of this._store.getItems()) {
      const span = this.spanOf(t);
      if (span.start < min) min = span.start;
      if (span.end > max) max = span.end;
    }
    if (min === Infinity) {
      const now = Date.now();
      min = now;
      max = now + 30 * MS_PER_DAY;
    }
    const pad = 7 * MS_PER_DAY;
    return { start: min - pad, end: max + pad };
  }

  private spanOf(task: TaskModel<T>): TimeSpan {
    const start = task.start ?? this.config.projectStart ?? Date.now();
    const end = task.milestone ? start : task.end ?? start + (task.duration ?? MS_PER_DAY);
    return { start, end };
  }

  /** Produce a synthetic change-set for every task (used after a full schedule). */
  private allChanges(): ScheduleChange[] {
    const out: ScheduleChange[] = [];
    for (const t of this._store.getItems()) {
      const engineTask = this._engine.getTask(t.id);
      if (!engineTask) continue;
      const to = this.spanOf(engineTask);
      out.push({ taskId: t.id, from: this.spanOf(t), to });
    }
    return out;
  }

  /** Write recomputed spans back into the task store (single source for the tree). */
  private writeBackSpans(changes: ReadonlyArray<ScheduleChange>): void {
    // The `store.update()` calls below each emit a `change` event; flag them so
    // the `onStoreChange` subscription ignores our own write-backs and does not
    // re-enter the schedule pipeline. Restore the prior value (not blindly
    // `false`) so nested write-backs don't prematurely re-open the gate.
    const prev = this.applyingSpans;
    this.applyingSpans = true;
    try {
      for (const c of changes) {
        const engineTask = this._engine.getTask(c.taskId);
        if (!engineTask) continue;
        this._store.update(c.taskId, {
          start: engineTask.start,
          end: engineTask.end,
          duration: engineTask.duration,
          summary: engineTask.summary,
        } as Partial<AnyTask<T>>);
      }
    } finally {
      this.applyingSpans = prev;
    }
  }

  private applyChanges(changes: ReadonlyArray<ScheduleChange>): void {
    this.writeBackSpans(changes);
    this.refreshPanes();
  }

  private afterSchedule(): void {
    const result = this._engine.schedule(this.scheduleOptions());
    this.lastResult = result;
    this.emit('scheduleChange', { result });
    this.emit('criticalPathChange', { path: result.criticalPath });
    if (result.conflicts.length) this.emit('conflict', { conflicts: result.conflicts });
    this.refreshPanes();
  }

  private refreshPanes(): void {
    if (!this.tree || !this.view) return;
    const visible: VisibleTaskRow<T>[] = this.tree.getVisibleRows();
    const critical = new Set(this.criticalVisible ? this._engine.criticalPath() : []);
    const baseline =
      this.activeBaseline != null ? this.getBaselineTasks(this.activeBaseline) : undefined;

    const rows: TimelineRowInput<T>[] = visible.map((r) => {
      const row: TimelineRowInput<T> = {
        task: this._engine.getTask(r.task.id) ?? r.task,
        top: r.top,
        height: r.height,
        critical: critical.has(r.task.id),
      };
      const snap = baseline?.get(r.task.id);
      if (snap) row.baseline = snap;
      return row;
    });
    this.view.setRows(rows, [...this.deps.values()]);
    this.tree.refresh();
  }

  private capturedBaselines = new Map<string, ReadonlyMap<RecordId, BaselineTask>>();

  private getBaselineTasks(
    baselineId: string,
  ): ReadonlyMap<RecordId, BaselineTask> | undefined {
    // A `SchedulingEngine` exposes no baseline *read* in the contract, so the
    // widget remembers the snapshot map returned by `captureBaseline` (which it
    // proxies) and renders the overlay from that. Re-capturing here would clobber
    // the original snapshot with the current schedule, so we never do.
    return this.capturedBaselines.get(baselineId);
  }

  private predecessorsLabel(taskId: RecordId): string {
    const labels: string[] = [];
    for (const d of this.deps.values()) {
      if (d.toId !== taskId || d.active === false) continue;
      const lag = d.lag ? `${d.lag >= 0 ? '+' : ''}${Math.round(d.lag / MS_PER_DAY)}d` : '';
      labels.push(`${d.fromId}${d.type && d.type !== 'FS' ? d.type : ''}${lag}`);
    }
    return labels.join(', ');
  }

  /**
   * The **successors** notation string for a task — the symmetric mirror of
   * {@link predecessorsLabel}: every active link whose `fromId` is `taskId`,
   * formatted as `"<toId><TYPE?><±lag d?>"` and comma-joined. Drives the
   * read-only "Successors" task-tree column. Delegates to the shared, DOM-free
   * `successorsLabel` helper so both columns format identically.
   */
  private successorsLabel(taskId: RecordId): string {
    return successorsLabel(this.deps.values(), taskId);
  }

  private wouldCycle(dep: DependencyModel): boolean {
    // Walk forward from dep.toId; a cycle exists if we can reach dep.fromId.
    const adj = new Map<RecordId, RecordId[]>();
    for (const d of this.deps.values()) {
      if (d.active === false) continue;
      (adj.get(d.fromId) ?? adj.set(d.fromId, []).get(d.fromId)!).push(d.toId);
    }
    (adj.get(dep.fromId) ?? adj.set(dep.fromId, []).get(dep.fromId)!).push(dep.toId);
    const seen = new Set<RecordId>();
    const stack = [dep.toId];
    while (stack.length) {
      const cur = stack.pop()!;
      if (cur === dep.fromId) return true;
      if (seen.has(cur)) continue;
      seen.add(cur);
      for (const n of adj.get(cur) ?? []) stack.push(n);
    }
    return false;
  }

  /* ── pane events ───────────────────────────────────────────────────────── */

  private handleTaskDrag(taskId: RecordId, span: TimeSpan, _mode: DragMode): void {
    this.updateTaskSpan(taskId, span);
  }

  private handleLinkCreate(link: { fromId: RecordId; toId: RecordId; type: DependencyModel['type'] }): void {
    this.addDependency({ fromId: link.fromId, toId: link.toId, type: link.type });
  }

  private emitTaskClick(taskId: RecordId, native?: MouseEvent): void {
    const task = this.getTask(taskId);
    if (!task) return;
    this.emit('taskClick', {
      task,
      native: native ?? new MouseEvent('click'),
    });
  }

  private openEditor(taskId: RecordId): void {
    const task = this.getTask(taskId);
    if (task) void this.editor.open(task);
  }

  private onTreeScroll(top: number): void {
    if (this.syncingScroll) return;
    this.syncingScroll = true;
    this.view.syncScrollTop(top);
    this.syncingScroll = false;
  }

  private onTimelineScroll(top: number): void {
    if (this.syncingScroll) return;
    this.syncingScroll = true;
    this.tree.syncScrollTop(top);
    this.syncingScroll = false;
  }

  private onStoreChange(): void {
    // Ignore the `change` events our own engine-routed write-backs emit (set/edit
    // span → store.update). Only genuine *external* store edits should trigger a
    // re-sync; otherwise this re-enters recalc → writeBackSpans indefinitely for
    // any non-idempotent engine. See `applyingSpans`.
    if (this.applyingSpans) return;
    // External store edits: reload the engine's task set and re-propagate.
    this._engine.setTasks(this._store.getItems());
    this._engine.setDependencies([...this.deps.values()]);
    const changes = this._engine.recalc();
    this.applyChanges(changes);
  }

  /* ── teardown ──────────────────────────────────────────────────────────── */

  override destroy(): void {
    if (this.isDestroyed) return;
    this.editor?.destroy();
    this.view?.destroy();
    this.tree?.destroy();
    // The ResourceManager feature is disposed via its tracked `destroy()`; drop
    // the reference so a destroyed Gantt reports no resource layer.
    this._resourceApi = null;
    this._features.clear();
    super.destroy();
  }
}

// Register for declarative composition: create({ type: 'gantt', tasks: [...] }).
register(
  'gantt',
  Gantt as unknown as new (host: HTMLElement | string, config?: Record<string, unknown>) => Gantt,
);
