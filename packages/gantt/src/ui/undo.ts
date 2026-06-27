/**
 * `GanttUndoRedo` — the Gantt **Undo/redo (State Tracking Manager)** feature
 * (Bryntum/DHTMLX "STM" parity).
 *
 * Installs a {@link GanttStm} over the Gantt's engine-routed mutation pipeline
 * and (optionally) renders a token-pure **undo / redo toolbar**. It is a
 * non-destructive `GanttFeature`: installed via `gantt.use(new GanttUndoRedo())`
 * or `new Gantt(el, { plugins: [new GanttUndoRedo()] })`. It touches ONLY the
 * public `GanttApi` (mutation methods, events, root `el`, `track`).
 *
 * How edits are captured (engine-routed, re-entrancy-safe):
 *   - The feature *wraps* the Gantt's public mutation methods on the live
 *     instance (`updateTaskSpan`, `updateTask`, `applyConstraint`,
 *     `addDependency`, `removeDependency`). Each wrapper snapshots the *before*
 *     state, calls the original (which routes through the scheduling engine as
 *     usual), then records the before/after delta into the STM as an action.
 *   - Because the STM applier ALSO calls those same wrapped methods to reverse a
 *     change, the wrappers honour the STM's recording-suspended flag: while an
 *     undo/redo is being applied, the wrappers skip recording (so a reversal
 *     isn't recorded as a brand-new edit — which would corrupt the history).
 *   - This keeps a single source of truth for dates: undo/redo reschedule through
 *     the exact same CPM pipeline as a live edit.
 *
 * Drag coalescing + transaction boundaries are owned by the STM (a rapid stream
 * of `updateTaskSpan` ticks collapses to one undo step; `gantt.features` exposes
 * the feature so a consumer can call `startTransaction()`/`endTransaction()` to
 * group an editor "Save" into one atomic undo unit).
 *
 * The toolbar is built from native buttons styled with `--jects-*` tokens only
 * (no `@jects/widgets` hard dependency, mirroring the Indicators feature), fully
 * keyboard-operable, and exposes `canUndo`/`canRedo` as disabled state + ARIA.
 *
 * All times are epoch milliseconds (UTC), matching the rest of the Gantt contract.
 */

import './undo.css';
import { setHtml, trustedHtml } from '@jects/core';
import type { Model, RecordId } from '@jects/core';
import type { TimeSpan } from '@jects/timeline-core';
import type {
  GanttApi,
  GanttFeature,
  TaskModel,
  DependencyModel,
  ConstraintType,
} from '../contract.js';
import {
  GanttStm,
  type StmApplier,
  type StmConfig,
  type StmEvents,
} from '../engine/stm.js';

/**
 * The minimal slice of `ResourceManager` the STM needs to keep the
 * `AssignmentStore` and `TaskModel.resourceIds` consistent when undoing/redoing a
 * resource assignment. Located structurally (no hard import of the concrete
 * class) so the Undo feature stays a contract-pure, optional-dependency plugin:
 * if no resource layer is installed the assignment path degrades gracefully.
 */
interface AssignmentManager {
  readonly name: string;
  assign(taskId: RecordId, resourceId: RecordId, units?: number): unknown;
  unassign(taskId: RecordId, resourceId: RecordId): boolean;
}

/* ═══════════════════════════════════════════════════════════════════════════
   1. CONFIG / EVENTS
   ═══════════════════════════════════════════════════════════════════════════ */

/** Configuration for the Undo/redo feature. */
export interface GanttUndoRedoConfig extends StmConfig {
  /**
   * Render the built-in undo/redo toolbar into the Gantt root. Default `true`.
   * Set `false` to drive undo/redo purely programmatically (or from your own UI).
   */
  toolbar?: boolean;
  /**
   * A host element to mount the toolbar into. Defaults to the Gantt root `el`
   * (the toolbar is positioned at the top-start corner via CSS).
   */
  toolbarHost?: HTMLElement;
  /** Undo button label / accessible name. Default `'Undo'`. */
  undoLabel?: string;
  /** Redo button label / accessible name. Default `'Redo'`. */
  redoLabel?: string;
  /**
   * Install Ctrl/Cmd+Z (undo) and Ctrl/Cmd+Shift+Z / Ctrl+Y (redo) keyboard
   * shortcuts scoped to the Gantt root. Default `true`.
   */
  keyboardShortcuts?: boolean;
}

/** Payload mirrored on the Gantt for the convenience `stmChange` event. */
export interface StmChangePayload {
  canUndo: boolean;
  canRedo: boolean;
  undoCount: number;
  redoCount: number;
}

/* ═══════════════════════════════════════════════════════════════════════════
   2. ICONS (inline SVG, currentColor — self-contained like Indicators)
   ═══════════════════════════════════════════════════════════════════════════ */

const UNDO_ICON =
  '<svg class="jects-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" ' +
  'stroke="currentColor" stroke-width="2.25" stroke-linecap="round" ' +
  'stroke-linejoin="round" aria-hidden="true"><path d="M3 7v6h6"/>' +
  '<path d="M3 13a9 9 0 1 0 3-7.7L3 8"/></svg>';

const REDO_ICON =
  '<svg class="jects-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" ' +
  'stroke="currentColor" stroke-width="2.25" stroke-linecap="round" ' +
  'stroke-linejoin="round" aria-hidden="true"><path d="M21 7v6h-6"/>' +
  '<path d="M21 13a9 9 0 1 1-3-7.7L21 8"/></svg>';

/* ═══════════════════════════════════════════════════════════════════════════
   3. THE FEATURE
   ═══════════════════════════════════════════════════════════════════════════ */

type AnyTask<T extends Model> = TaskModel<T>;

/** Public mutation methods on the Gantt that the feature wraps to record edits. */
interface GanttMutations<T extends Model> {
  updateTaskSpan(taskId: RecordId, span: TimeSpan): boolean;
  updateTask(taskId: RecordId, patch: Partial<TaskModel<T>>): boolean;
  applyConstraint(
    taskId: RecordId,
    constraintType: ConstraintType,
    constraintDate?: number,
  ): boolean;
  addDependency(dep: Omit<DependencyModel, 'id'>): DependencyModel | undefined;
  removeDependency(depId: RecordId): void;
}

const TOOLBAR_BLOCK = 'jects-gantt__stm';

/**
 * The Undo/redo (STM) feature. Owns a {@link GanttStm}, wraps the Gantt mutation
 * pipeline to record edits, and renders the undo/redo toolbar. All wrappers,
 * listeners, DOM, and the STM are released on `destroy()` (instance reusable).
 */
export class GanttUndoRedo<T extends Model = Model> implements GanttFeature<T> {
  readonly name = 'undoRedo';

  /** The headless State Tracking Manager (public so consumers can drive it). */
  readonly stm: GanttStm<T>;

  private readonly config: Required<
    Omit<GanttUndoRedoConfig, keyof StmConfig | 'toolbarHost'>
  > &
    Pick<GanttUndoRedoConfig, 'toolbarHost'>;

  private api: GanttApi<T> | null = null;
  private toolbarEl: HTMLElement | null = null;
  private undoBtn: HTMLButtonElement | null = null;
  private redoBtn: HTMLButtonElement | null = null;
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;
  private keyHost: HTMLElement | null = null;
  private disposers: Array<() => void> = [];
  /** Original (unwrapped) mutation methods, restored on destroy(). */
  private originals: Partial<GanttMutations<T>> = {};
  /**
   * The resource manager whose `assign`/`unassign` we wrapped to record
   * assignment edits, plus its original (unwrapped) methods (restored on
   * destroy()). `null` until a manager is located + wrapped.
   */
  private resourceManager: AssignmentManager | null = null;
  private resourceOriginals: {
    assign?: AssignmentManager['assign'];
    unassign?: AssignmentManager['unassign'];
  } = {};
  /** Pending deferred attempt to wrap a later-installed resource manager. */
  private resourceWrapTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * Set while a wrapped `ResourceManager.assign`/`unassign` runs. The manager
   * mirrors the change into `TaskModel.resourceIds` via `api.updateTask`, which
   * our `updateTask` wrapper would otherwise capture as a SEPARATE `taskUpdate`
   * action — duplicating the assignment we already record (and corrupting undo,
   * since the assignment action ALSO re-syncs resourceIds). While this is set the
   * `updateTask` wrapper skips recording a `resourceIds`-only patch.
   */
  private inAssignment = 0;
  private destroyed = false;

  constructor(config: GanttUndoRedoConfig = {}) {
    const stmConfig: StmConfig = {};
    if (config.enabled != null) stmConfig.enabled = config.enabled;
    if (config.maxStack != null) stmConfig.maxStack = config.maxStack;
    if (config.coalesceMs != null) stmConfig.coalesceMs = config.coalesceMs;
    this.stm = new GanttStm<T>(stmConfig);

    this.config = {
      toolbar: config.toolbar !== false,
      undoLabel: config.undoLabel ?? 'Undo',
      redoLabel: config.redoLabel ?? 'Redo',
      keyboardShortcuts: config.keyboardShortcuts !== false,
      ...(config.toolbarHost ? { toolbarHost: config.toolbarHost } : {}),
    };
  }

  /* ── GanttFeature lifecycle ────────────────────────────────────────────── */

  init(api: GanttApi<T>): void {
    // Re-init after destroy() (instance reuse) must start clean.
    this.destroyed = false;
    this.disposers = [];
    this.api = api;

    // 1. Wire the STM applier to the Gantt's engine-routed mutation pipeline.
    //    These calls must NOT be recorded — the STM suspends recording while it
    //    applies, and the wrappers honour that (see `recordingActive`).
    this.stm.setApplier(this.makeApplier(api));

    // 2. Wrap the public mutation methods to capture before/after deltas.
    this.installWrappers(api);

    // 2b. Wrap the ResourceManager's assign/unassign so resource edits are
    //     captured as undoable assignment actions (the mutation methods don't
    //     cover assignment, which flows through its own store). The manager may
    //     be installed AFTER this feature (when both are passed as plugins and
    //     the Gantt auto-installs the resource layer after the plugin loop), so
    //     if it isn't present yet we retry once on the next microtask/tick — by
    //     which point the synchronous `setup()` wiring has completed.
    if (!this.wrapResourceManager(api)) this.scheduleResourceWrap(api);

    // 3. Toolbar + keyboard.
    if (this.config.toolbar) this.buildToolbar(api);
    if (this.config.keyboardShortcuts) this.installShortcuts(api);

    // 4. Mirror STM state changes onto the Gantt as `stmChange` (typed via cast,
    //    like the other features' added events) and refresh the toolbar.
    this.disposers.push(
      this.stm.events.on('change', (p) => {
        this.syncToolbar();
        (api as unknown as {
          emit(e: 'stmChange', p: StmChangePayload): boolean;
        }).emit('stmChange', p);
      }),
    );

    api.track(() => this.destroy());
    this.syncToolbar();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;

    for (const off of this.disposers) {
      try {
        off();
      } catch {
        /* best-effort */
      }
    }
    this.disposers = [];

    // Restore the original mutation methods + resource-manager wrappers.
    this.restoreWrappers();
    this.restoreResourceWrappers();
    if (this.resourceWrapTimer != null) {
      clearTimeout(this.resourceWrapTimer);
      this.resourceWrapTimer = null;
    }

    if (this.keyHandler && this.keyHost) {
      this.keyHost.removeEventListener('keydown', this.keyHandler);
    }
    this.keyHandler = null;
    this.keyHost = null;

    this.toolbarEl?.remove();
    this.toolbarEl = null;
    this.undoBtn = null;
    this.redoBtn = null;

    this.stm.destroy();
    this.api = null;
  }

  /* ── public controls (delegate to the STM) ─────────────────────────────── */

  /** Undo the most recent transaction. Returns `false` if nothing to undo. */
  undo(): boolean {
    return this.stm.undo();
  }

  /** Redo the most recently undone transaction. Returns `false` if nothing. */
  redo(): boolean {
    return this.stm.redo();
  }

  /** Whether an undo step is available. */
  get canUndo(): boolean {
    return this.stm.canUndo;
  }

  /** Whether a redo step is available. */
  get canRedo(): boolean {
    return this.stm.canRedo;
  }

  /** Begin an explicit transaction (group several edits into one undo unit). */
  startTransaction(title?: string): void {
    this.stm.startTransaction(title);
  }

  /** End the current explicit transaction (commits at the outermost boundary). */
  endTransaction(): void {
    this.stm.endTransaction();
  }

  /** Clear both undo and redo stacks. */
  clear(): void {
    this.stm.clear();
  }

  /* ── applier (engine-routed reverse/forward) ───────────────────────────── */

  private makeApplier(api: GanttApi<T>): StmApplier<T> {
    return {
      setTaskSpan: (taskId, span) => {
        // Restore a span by writing the AUTHORITATIVE start/end/duration fields
        // (via updateTask), not via the drag pipeline. The engine's `setTaskSpan`
        // records a *drag pin* (a soft floor) but leaves the prior anchored
        // `task.start` in place — so it cannot move a task to an EARLIER date than
        // its last anchored start (which is exactly what an undo of a forward drag
        // needs). `updateTask({start,end,duration})` re-authors the anchor and
        // drops the stale drag pin, reflowing dependents from the restored date.
        const task = api.getTask(taskId);
        const patch: Partial<TaskModel<T>> = { start: span.start, end: span.end };
        if (!task?.milestone) patch.duration = Math.max(0, span.end - span.start);
        this.callOriginal('updateTask', api, taskId, patch);
      },
      updateTask: (taskId, patch) => {
        this.callOriginal('updateTask', api, taskId, patch);
      },
      applyConstraint: (taskId, ct, date) => {
        this.callOriginal('applyConstraint', api, taskId, ct, date);
      },
      addDependency: (dep) => {
        // Re-create a removed dependency. The Gantt's public `addDependency`
        // mints a fresh id; to keep undo/redo idempotent we restore via a
        // lower-level path that preserves the original id when available.
        this.restoreDependency(api, dep);
      },
      removeDependency: (depId) => {
        this.callOriginal('removeDependency', api, depId);
      },
      assignResource: (taskId, resourceId, units) => {
        this.applyAssignment(api, taskId, resourceId, units, /*add*/ true);
      },
      unassignResource: (taskId, resourceId) => {
        this.applyAssignment(api, taskId, resourceId, undefined, /*add*/ false);
      },
    };
  }

  /** Whether the wrappers should record (false while the STM applies undo/redo). */
  private get recordingActive(): boolean {
    return this.stm.isRecording;
  }

  /**
   * Whether an `updateTask` patch is the ResourceManager's resourceIds mirror of
   * an in-flight assign/unassign (so the wrapper skips double-recording it).
   */
  private isAssignmentSync(patch: Partial<TaskModel<T>>): boolean {
    if (this.inAssignment === 0) return false;
    const keys = Object.keys(patch);
    return keys.length === 1 && keys[0] === 'resourceIds';
  }

  /* ── mutation-method wrapping ──────────────────────────────────────────── */

  private installWrappers(api: GanttApi<T>): void {
    const target = api as unknown as GanttMutations<T> & Record<string, unknown>;

    // updateTaskSpan -------------------------------------------------------
    this.originals.updateTaskSpan = target.updateTaskSpan.bind(api);
    target.updateTaskSpan = (taskId: RecordId, span: TimeSpan): boolean => {
      const before = this.recordingActive ? this.spanOf(api, taskId) : undefined;
      const ok = this.originals.updateTaskSpan!(taskId, span);
      if (ok && before && this.recordingActive) {
        const after = this.spanOf(api, taskId) ?? span;
        this.stm.record(
          { kind: 'taskSpan', taskId, before, after },
          'Move task',
        );
      }
      return ok;
    };

    // updateTask -----------------------------------------------------------
    this.originals.updateTask = target.updateTask.bind(api);
    target.updateTask = (taskId: RecordId, patch: Partial<TaskModel<T>>): boolean => {
      // A `resourceIds`-only patch emitted by the ResourceManager while it mirrors
      // an assign/unassign is already captured as an assignment action — don't
      // double-record it as a `taskUpdate`.
      const record = this.recordingActive && !this.isAssignmentSync(patch);
      const before = record ? this.snapshotFields(api, taskId, patch) : undefined;
      const ok = this.originals.updateTask!(taskId, patch);
      if (ok && before && record) {
        const after = this.pickFields(patch);
        this.stm.record({ kind: 'taskUpdate', taskId, before, after }, 'Edit task');
      }
      return ok;
    };

    // applyConstraint ------------------------------------------------------
    this.originals.applyConstraint = target.applyConstraint.bind(api);
    target.applyConstraint = (
      taskId: RecordId,
      ct: ConstraintType,
      date?: number,
    ): boolean => {
      const before = this.recordingActive ? this.constraintOf(api, taskId) : undefined;
      const ok = this.originals.applyConstraint!(taskId, ct, date);
      if (ok && before && this.recordingActive) {
        const after: { constraintType?: ConstraintType; constraintDate?: number } = {
          constraintType: ct,
        };
        if (date != null) after.constraintDate = date;
        this.stm.record(
          { kind: 'constraint', taskId, before, after },
          'Change constraint',
        );
      }
      return ok;
    };

    // addDependency --------------------------------------------------------
    this.originals.addDependency = target.addDependency.bind(api);
    target.addDependency = (
      dep: Omit<DependencyModel, 'id'>,
    ): DependencyModel | undefined => {
      const created = this.originals.addDependency!(dep);
      if (created && this.recordingActive) {
        this.stm.record(
          { kind: 'dependencyAdd', dependency: { ...created } },
          'Add dependency',
        );
      }
      return created;
    };

    // removeDependency -----------------------------------------------------
    this.originals.removeDependency = target.removeDependency.bind(api);
    target.removeDependency = (depId: RecordId): void => {
      const existing = this.recordingActive ? this.depById(api, depId) : undefined;
      this.originals.removeDependency!(depId);
      if (existing && this.recordingActive) {
        this.stm.record(
          { kind: 'dependencyRemove', dependency: { ...existing } },
          'Remove dependency',
        );
      }
    };
  }

  private restoreWrappers(): void {
    const api = this.api;
    if (!api) {
      this.originals = {};
      return;
    }
    const target = api as unknown as Record<string, unknown>;
    if (this.originals.updateTaskSpan) target.updateTaskSpan = this.originals.updateTaskSpan;
    if (this.originals.updateTask) target.updateTask = this.originals.updateTask;
    if (this.originals.applyConstraint) target.applyConstraint = this.originals.applyConstraint;
    if (this.originals.addDependency) target.addDependency = this.originals.addDependency;
    if (this.originals.removeDependency) target.removeDependency = this.originals.removeDependency;
    this.originals = {};
  }

  /** Call an original (unwrapped) mutation method by name. */
  private callOriginal(
    name: keyof GanttMutations<T>,
    api: GanttApi<T>,
    ...args: unknown[]
  ): void {
    const fn = this.originals[name] as ((...a: unknown[]) => unknown) | undefined;
    if (fn) {
      fn(...args);
    } else {
      // Fallback to the (possibly wrapped) public method.
      (api as unknown as Record<string, (...a: unknown[]) => unknown>)[name]?.(...args);
    }
  }

  /* ── before/after snapshots ────────────────────────────────────────────── */

  private spanOf(api: GanttApi<T>, taskId: RecordId): TimeSpan | undefined {
    const task = api.getTask(taskId);
    if (!task) return undefined;
    const start = task.start;
    if (start == null) return undefined;
    const end = task.milestone ? start : (task.end ?? start);
    return { start, end };
  }

  /** Capture the *prior* values of just the keys a patch touches. */
  private snapshotFields(
    api: GanttApi<T>,
    taskId: RecordId,
    patch: Partial<TaskModel<T>>,
  ): Partial<AnyTask<T>> | undefined {
    const task = api.getTask(taskId);
    if (!task) return undefined;
    const before: Partial<AnyTask<T>> = {};
    for (const key of Object.keys(patch) as Array<keyof TaskModel<T>>) {
      (before as Record<string, unknown>)[key as string] = task[key];
    }
    return before;
  }

  private pickFields(patch: Partial<TaskModel<T>>): Partial<AnyTask<T>> {
    return { ...patch };
  }

  private constraintOf(
    api: GanttApi<T>,
    taskId: RecordId,
  ): { constraintType?: ConstraintType; constraintDate?: number } | undefined {
    const task = api.getTask(taskId);
    if (!task) return undefined;
    const out: { constraintType?: ConstraintType; constraintDate?: number } = {};
    if (task.constraintType != null) out.constraintType = task.constraintType;
    if (task.constraintDate != null) out.constraintDate = task.constraintDate;
    return out;
  }

  private depById(api: GanttApi<T>, depId: RecordId): DependencyModel | undefined {
    // Fast path: the Gantt indexes dependencies in an internal `deps` map keyed by
    // id — read it directly when available (covers links touching tasks that
    // aren't currently in the timeline's row window).
    const direct = (api as unknown as { deps?: Map<RecordId, DependencyModel> }).deps;
    if (direct?.has(depId)) return direct.get(depId);
    // Fallback: scan dependencies via the public `getDependenciesFor` over every
    // known task id.
    const seen = new Set<RecordId>();
    for (const task of this.allTaskIds(api)) {
      for (const d of api.getDependenciesFor(task)) {
        if (seen.has(d.id)) continue;
        seen.add(d.id);
        if (d.id === depId) return d;
      }
    }
    return undefined;
  }

  private allTaskIds(api: GanttApi<T>): RecordId[] {
    const ids: RecordId[] = [];
    // Walk the timeline rows (whole plan) for task ids.
    const rows = (api.timeline as unknown as {
      rows?: { count: number; rowAt(i: number): { record: TaskModel<T> } | undefined };
    }).rows;
    if (rows) {
      for (let i = 0; i < rows.count; i++) {
        const r = rows.rowAt(i);
        if (r?.record?.id != null) ids.push(r.record.id);
      }
    }
    return ids;
  }

  /* ── dependency restore (preserves original id) ────────────────────────── */

  private restoreDependency(api: GanttApi<T>, dep: DependencyModel): void {
    // The public `addDependency` mints a new id, which would break a subsequent
    // redo's removeDependency(originalId). If the Gantt exposes its dep map we
    // re-insert with the original id; otherwise fall back to the public path.
    const internal = api as unknown as {
      deps?: Map<RecordId, DependencyModel>;
      engine?: { addDependency(d: DependencyModel): unknown };
      reschedule?: () => void;
    };
    const original = this.originals.addDependency;
    if (internal.deps && internal.engine) {
      internal.deps.set(dep.id, { ...dep });
      internal.engine.addDependency({ ...dep });
      internal.reschedule?.();
      return;
    }
    // Fallback: public add (new id). Best-effort; redo of the matching remove
    // will then no-op on the stale id, but the link is restored visually.
    if (original) {
      const { id: _id, ...rest } = dep;
      void _id;
      original(rest);
    }
  }

  /* ── resource assignment apply (engine-routed via ResourceManager) ──────── */

  /**
   * Apply (or reverse) a resource assignment during undo/redo. Routes through the
   * installed {@link ResourceManager} (`assign`/`unassign`) — the SINGLE source of
   * truth for assignments — so the `AssignmentStore` AND `TaskModel.resourceIds`
   * stay in lock-step (the histogram / utilization / cost views read the store,
   * while renderers read the field; routing only through `updateTask({resourceIds})`
   * left them divergent). We call the manager's ORIGINAL (unwrapped) methods so an
   * undo/redo apply is not re-recorded as a brand-new edit (recording is also
   * suspended during apply, but this keeps the guarantee local + explicit).
   *
   * If no resource layer is installed we degrade to the prior field-only path so
   * the bars still reflect the change visually.
   */
  private applyAssignment(
    api: GanttApi<T>,
    taskId: RecordId,
    resourceId: RecordId,
    units: number | undefined,
    add: boolean,
  ): void {
    if (api.getTask(taskId) == null) return;

    // Ensure we have the manager (it may have been installed after init).
    const manager = this.resourceManager ?? this.locateResourceManager(api);
    if (manager) {
      const orig = this.resourceOriginals;
      if (add) {
        (orig.assign ?? manager.assign).call(manager, taskId, resourceId, units);
      } else {
        (orig.unassign ?? manager.unassign).call(manager, taskId, resourceId);
      }
      return;
    }

    // Fallback (no resource layer): mirror the change into resourceIds only.
    const task = api.getTask(taskId);
    if (!task) return;
    const current = Array.isArray(task.resourceIds) ? [...task.resourceIds] : [];
    const next = add
      ? current.includes(resourceId)
        ? current
        : [...current, resourceId]
      : current.filter((r) => r !== resourceId);
    this.callOriginal('updateTask', api, taskId, { resourceIds: next } as Partial<TaskModel<T>>);
  }

  /**
   * Record a resource assignment edit. Invoked automatically by the
   * {@link wrapResourceManager} wrappers (the resource layer's `assign`/`unassign`
   * don't flow through the core mutation methods), and also callable directly by
   * consumer wiring that bypasses the manager.
   */
  recordAssignment(
    taskId: RecordId,
    resourceId: RecordId,
    add: boolean,
    units?: number,
  ): void {
    if (!this.recordingActive) return;
    if (add) {
      const action = { kind: 'assignmentAdd' as const, taskId, resourceId, ...(units != null ? { units } : {}) };
      this.stm.record(action, 'Assign resource');
    } else {
      const action = { kind: 'assignmentRemove' as const, taskId, resourceId, ...(units != null ? { units } : {}) };
      this.stm.record(action, 'Unassign resource');
    }
  }

  /* ── resource-manager location + wrapping ──────────────────────────────── */

  /**
   * Find an installed resource manager exposing `assign`/`unassign`. Looks up the
   * `'resourceManager'` feature first (the canonical key), then falls back to any
   * feature that structurally implements the assignment surface.
   */
  private locateResourceManager(api: GanttApi<T>): AssignmentManager | null {
    const direct = api.features.get('resourceManager');
    if (isAssignmentManager(direct)) return direct;
    for (const feature of api.features.values()) {
      if (isAssignmentManager(feature)) return feature;
    }
    return null;
  }

  /**
   * Wrap the located resource manager's `assign`/`unassign` so user/UI assignment
   * edits are captured as undoable `assignmentAdd`/`assignmentRemove` actions.
   * Idempotent + safe to call repeatedly. Returns `true` once a manager has been
   * wrapped (or was already wrapped).
   */
  private wrapResourceManager(api: GanttApi<T>): boolean {
    if (this.resourceManager) return true;
    const manager = this.locateResourceManager(api);
    if (!manager) return false;

    const origAssign = manager.assign.bind(manager);
    const origUnassign = manager.unassign.bind(manager);
    this.resourceOriginals = { assign: origAssign, unassign: origUnassign };

    manager.assign = (taskId: RecordId, resourceId: RecordId, units?: number): unknown => {
      this.inAssignment++;
      let result: unknown;
      try {
        result = origAssign(taskId, resourceId, units);
      } finally {
        this.inAssignment--;
      }
      // Only record a genuine assignment (the manager returns undefined when a
      // `beforeAssign` veto cancels it), and never while applying an undo/redo.
      if (result !== undefined && this.recordingActive) {
        this.recordAssignment(taskId, resourceId, /*add*/ true, units);
      }
      return result;
    };
    manager.unassign = (taskId: RecordId, resourceId: RecordId): boolean => {
      this.inAssignment++;
      let removed: boolean;
      try {
        removed = origUnassign(taskId, resourceId);
      } finally {
        this.inAssignment--;
      }
      if (removed && this.recordingActive) {
        this.recordAssignment(taskId, resourceId, /*add*/ false);
      }
      return removed;
    };

    this.resourceManager = manager;
    return true;
  }

  /** Restore the resource manager's original `assign`/`unassign` (destroy path). */
  private restoreResourceWrappers(): void {
    const manager = this.resourceManager;
    if (manager) {
      if (this.resourceOriginals.assign) manager.assign = this.resourceOriginals.assign;
      if (this.resourceOriginals.unassign) manager.unassign = this.resourceOriginals.unassign;
    }
    this.resourceManager = null;
    this.resourceOriginals = {};
  }

  /**
   * Schedule a single deferred attempt to wrap a resource manager installed after
   * this feature (constructor-time plugin ordering). Runs after the synchronous
   * `setup()` wiring completes.
   */
  private scheduleResourceWrap(api: GanttApi<T>): void {
    if (this.resourceWrapTimer != null || typeof setTimeout !== 'function') return;
    this.resourceWrapTimer = setTimeout(() => {
      this.resourceWrapTimer = null;
      if (!this.destroyed) this.wrapResourceManager(api);
    }, 0);
  }

  /* ── toolbar ───────────────────────────────────────────────────────────── */

  private buildToolbar(api: GanttApi<T>): void {
    const host = this.config.toolbarHost ?? api.el;
    const bar = document.createElement('div');
    bar.className = TOOLBAR_BLOCK;
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', 'Undo and redo');

    this.undoBtn = this.makeButton(`${TOOLBAR_BLOCK}__undo`, this.config.undoLabel, UNDO_ICON, () =>
      this.undo(),
    );
    this.redoBtn = this.makeButton(`${TOOLBAR_BLOCK}__redo`, this.config.redoLabel, REDO_ICON, () =>
      this.redo(),
    );
    bar.append(this.undoBtn, this.redoBtn);
    host.appendChild(bar);
    this.toolbarEl = bar;
  }

  private makeButton(
    cls: string,
    label: string,
    icon: string,
    onClick: () => void,
  ): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `${TOOLBAR_BLOCK}__btn ${cls}`;
    btn.setAttribute('aria-label', label);
    btn.title = label;
    btn.disabled = true;
    setHtml(btn, trustedHtml(icon));
    const handler = (e: Event): void => {
      e.preventDefault();
      onClick();
    };
    btn.addEventListener('click', handler);
    this.disposers.push(() => btn.removeEventListener('click', handler));
    return btn;
  }

  private syncToolbar(): void {
    if (this.undoBtn) {
      const canUndo = this.stm.canUndo;
      this.undoBtn.disabled = !canUndo;
      this.undoBtn.setAttribute('aria-disabled', String(!canUndo));
      const title = this.stm.nextUndoTitle;
      this.undoBtn.title = title ? `${this.config.undoLabel}: ${title}` : this.config.undoLabel;
    }
    if (this.redoBtn) {
      const canRedo = this.stm.canRedo;
      this.redoBtn.disabled = !canRedo;
      this.redoBtn.setAttribute('aria-disabled', String(!canRedo));
      const title = this.stm.nextRedoTitle;
      this.redoBtn.title = title ? `${this.config.redoLabel}: ${title}` : this.config.redoLabel;
    }
  }

  /* ── keyboard shortcuts ────────────────────────────────────────────────── */

  private installShortcuts(api: GanttApi<T>): void {
    const host = api.el;
    const handler = (e: KeyboardEvent): void => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault();
        this.undo();
      } else if ((key === 'z' && e.shiftKey) || key === 'y') {
        e.preventDefault();
        this.redo();
      }
    };
    host.addEventListener('keydown', handler);
    this.keyHandler = handler;
    this.keyHost = host;
  }
}

/** Structural guard: a feature exposing the assignment surface (`assign`/`unassign`). */
function isAssignmentManager(value: unknown): value is AssignmentManager {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { assign?: unknown }).assign === 'function' &&
    typeof (value as { unassign?: unknown }).unassign === 'function'
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   4. FACTORY
   ═══════════════════════════════════════════════════════════════════════════ */

/** Convenience factory mirroring the other Gantt feature factories. */
export function createUndoRedo<T extends Model = Model>(
  config?: GanttUndoRedoConfig,
): GanttUndoRedo<T> {
  return new GanttUndoRedo<T>(config);
}

export type { StmEvents };
