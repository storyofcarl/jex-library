/**
 * `GanttStm` — the Gantt **State Tracking Manager** (Bryntum/DHTMLX "STM" parity).
 *
 * A transactional undo/redo stack for the Gantt's project model. It captures
 * task / dependency / assignment / constraint edits as **actions** grouped into
 * **transactions**, then replays their inverse (undo) or forward (redo) form.
 *
 * Design (headless, framework-free — this file is pure model math, no DOM):
 *   - The STM is a plain class over the project model. It owns two stacks (undo /
 *     redo) of {@link StmTransaction}s. Each transaction bundles one or more
 *     {@link StmAction}s; each action knows how to `undo()` and `redo()` itself
 *     by carrying the *before* and *after* snapshots of the value it changed.
 *   - It is driven by the Gantt's engine-routed mutation pipeline: every mutation
 *     the UI performs (drag/resize, field edit, constraint change, dependency
 *     add/remove, resource assign/unassign) is *recorded* into the open
 *     transaction. When the gesture ends the transaction is committed onto the
 *     undo stack and the redo stack is cleared (standard linear-history STM).
 *   - **Drag coalescing:** a stream of rapid same-kind, same-target actions inside
 *     one auto-transaction window collapses to a single action — the *first*
 *     before-state and the *latest* after-state — so an interactive drag (dozens
 *     of `setTaskSpan` ticks) becomes ONE undo step. Coalescing is bounded by a
 *     configurable idle window (`coalesceMs`) and explicit transaction boundaries.
 *   - **Transaction boundaries:** `startTransaction()` / `endTransaction()` (or the
 *     `transact(fn)` sugar) group several distinct edits into one atomic undo unit
 *     (e.g. an editor "Save" that touches name + dates + percentDone). Nested
 *     `start/end` are ref-counted so the outermost boundary commits.
 *   - The STM never reaches into the DOM and never schedules. Applying an
 *     undo/redo is delegated to an injected {@link StmApplier} — the Gantt wires
 *     this to its own engine-routed mutation methods so undo/redo reschedule
 *     through the exact same pipeline as a live edit (one source of truth for
 *     dates). While an apply runs, recording is suspended (the applier's own
 *     mutations must not be recorded as new actions — that would corrupt history).
 *
 * All times are epoch milliseconds (UTC), matching the rest of the Gantt contract.
 */

import type { Model, RecordId } from '@jects/core';
import { EventEmitter } from '@jects/core';
import type {
  TaskModel,
  DependencyModel,
  ConstraintType,
} from '../contract.js';
import type { TimeSpan } from '@jects/timeline-core';

/* ═══════════════════════════════════════════════════════════════════════════
   1. ACTION MODEL
   ═══════════════════════════════════════════════════════════════════════════ */

/** The kinds of model change the STM can track and reverse. */
export type StmActionKind =
  | 'taskSpan' // drag / resize / set span
  | 'taskUpdate' // field patch (name, duration, effort, percentDone, manual…)
  | 'constraint' // constraintType / constraintDate change
  | 'dependencyAdd' // link created
  | 'dependencyRemove' // link deleted
  | 'assignmentAdd' // resource assigned to a task
  | 'assignmentRemove'; // resource unassigned from a task

/** A task span change (drag/resize), reversible by re-applying the before span. */
export interface TaskSpanAction {
  kind: 'taskSpan';
  taskId: RecordId;
  before: TimeSpan;
  after: TimeSpan;
}

/** A task field patch, reversible by re-applying the captured before fields. */
export interface TaskUpdateAction<T extends Model = Model> {
  kind: 'taskUpdate';
  taskId: RecordId;
  /** The fields as they were before the edit (only the changed keys). */
  before: Partial<TaskModel<T>>;
  /** The fields as they are after the edit (only the changed keys). */
  after: Partial<TaskModel<T>>;
}

/** A constraint change, reversible by re-applying the prior constraint. */
export interface ConstraintAction {
  kind: 'constraint';
  taskId: RecordId;
  before: { constraintType?: ConstraintType; constraintDate?: number };
  after: { constraintType?: ConstraintType; constraintDate?: number };
}

/** A dependency creation, reversed by removing it (and redone by re-adding). */
export interface DependencyAddAction {
  kind: 'dependencyAdd';
  dependency: DependencyModel;
}

/** A dependency removal, reversed by re-adding it (and redone by removing). */
export interface DependencyRemoveAction {
  kind: 'dependencyRemove';
  dependency: DependencyModel;
}

/** A resource assignment, reversed by unassigning (and redone by assigning). */
export interface AssignmentAddAction {
  kind: 'assignmentAdd';
  taskId: RecordId;
  resourceId: RecordId;
  /** Optional units (0..1+) the assignment carried. */
  units?: number;
}

/** A resource unassignment, reversed by re-assigning (and redone by removing). */
export interface AssignmentRemoveAction {
  kind: 'assignmentRemove';
  taskId: RecordId;
  resourceId: RecordId;
  units?: number;
}

/** Any STM action (discriminated by `kind`). */
export type StmAction<T extends Model = Model> =
  | TaskSpanAction
  | TaskUpdateAction<T>
  | ConstraintAction
  | DependencyAddAction
  | DependencyRemoveAction
  | AssignmentAddAction
  | AssignmentRemoveAction;

/** A committed transaction: an ordered, atomic bundle of actions + a label. */
export interface StmTransaction<T extends Model = Model> {
  /** Stable transaction id (monotonic within an STM instance). */
  readonly id: number;
  /** Human-readable label (drives undo/redo button tooltips). */
  readonly title: string;
  /** Actions in apply order; undo replays them in reverse. */
  readonly actions: ReadonlyArray<StmAction<T>>;
  /** When the transaction was committed (epoch ms). */
  readonly committedAt: number;
}

/* ═══════════════════════════════════════════════════════════════════════════
   2. APPLIER (the engine-routed reverse/forward seam)
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * The surface the STM calls to put a model change back (undo) or forward (redo).
 * The Gantt wires every method to its OWN engine-routed mutation pipeline so an
 * undo/redo reschedules exactly like a live edit. The STM suspends recording
 * while these run (re-entrancy guard) so applier mutations aren't re-recorded.
 */
export interface StmApplier<T extends Model = Model> {
  /** Set a task's span (drag/resize undo). */
  setTaskSpan(taskId: RecordId, span: TimeSpan): void;
  /** Patch task fields (field-edit undo). */
  updateTask(taskId: RecordId, patch: Partial<TaskModel<T>>): void;
  /** Apply a constraint (constraint undo). */
  applyConstraint(
    taskId: RecordId,
    constraintType: ConstraintType,
    constraintDate?: number,
  ): void;
  /** Re-create a previously removed dependency with its original id. */
  addDependency(dep: DependencyModel): void;
  /** Remove a dependency by id. */
  removeDependency(depId: RecordId): void;
  /** Assign a resource to a task. */
  assignResource(taskId: RecordId, resourceId: RecordId, units?: number): void;
  /** Unassign a resource from a task. */
  unassignResource(taskId: RecordId, resourceId: RecordId): void;
}

/* ═══════════════════════════════════════════════════════════════════════════
   3. EVENTS / CONFIG
   ═══════════════════════════════════════════════════════════════════════════ */

/** Typed STM event map. */
export interface StmEvents<T extends Model = Model> extends Record<string, unknown> {
  /** The undo/redo availability or stack contents changed. */
  change: {
    canUndo: boolean;
    canRedo: boolean;
    undoCount: number;
    redoCount: number;
  };
  /** A transaction was committed onto the undo stack. */
  commit: { transaction: StmTransaction<T> };
  /** A transaction was undone (moved undo → redo). */
  undo: { transaction: StmTransaction<T> };
  /** A transaction was redone (moved redo → undo). */
  redo: { transaction: StmTransaction<T> };
  /** The stacks were cleared. */
  clear: Record<string, never>;
  /** STM enabled/disabled toggled. */
  enabled: { enabled: boolean };
}

/** Configuration for the STM. */
export interface StmConfig {
  /** Start enabled (recording). Default `true`. */
  enabled?: boolean;
  /**
   * Maximum undo depth. When exceeded, the oldest transaction is dropped.
   * `0`/undefined = unbounded. Default `100`.
   */
  maxStack?: number;
  /**
   * Idle window (ms) within which consecutive same-kind/same-target actions are
   * coalesced into one (drag coalescing). `0` disables coalescing. Default `500`.
   */
  coalesceMs?: number;
}

/* ═══════════════════════════════════════════════════════════════════════════
   4. THE STATE TRACKING MANAGER
   ═══════════════════════════════════════════════════════════════════════════ */

const DEFAULT_MAX_STACK = 100;
const DEFAULT_COALESCE_MS = 500;

/**
 * The headless State Tracking Manager. Records model edits into transactions and
 * replays them via an injected {@link StmApplier}. Pure: no DOM, no scheduling.
 */
export class GanttStm<T extends Model = Model> {
  /** Typed event bus (`change`/`commit`/`undo`/`redo`/`clear`/`enabled`). */
  readonly events = new EventEmitter<StmEvents<T>>();

  private applier: StmApplier<T> | null = null;
  private readonly maxStack: number;
  private readonly coalesceMs: number;

  private _enabled: boolean;
  /** Suspends recording (during undo/redo apply, and inside explicit suspends). */
  private suspendDepth = 0;
  /** Open auto/explicit transaction collecting actions; null when idle. */
  private open: MutableTransaction<T> | null = null;
  /** Ref-count for explicit `startTransaction()`/`endTransaction()` nesting. */
  private explicitDepth = 0;
  /** Title for the current explicit transaction (set by `startTransaction`). */
  private explicitTitle = '';
  /** Timer id for the auto-transaction idle flush. */
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  /** Monotonic transaction id. */
  private seq = 0;

  private readonly undoStack: StmTransaction<T>[] = [];
  private readonly redoStack: StmTransaction<T>[] = [];

  constructor(config: StmConfig = {}) {
    this._enabled = config.enabled !== false;
    this.maxStack = config.maxStack ?? DEFAULT_MAX_STACK;
    this.coalesceMs = config.coalesceMs ?? DEFAULT_COALESCE_MS;
  }

  /* ── wiring ──────────────────────────────────────────────────────────── */

  /** Inject the engine-routed applier the STM uses to reverse/forward changes. */
  setApplier(applier: StmApplier<T>): void {
    this.applier = applier;
  }

  /* ── state reads ─────────────────────────────────────────────────────── */

  /** Whether the STM is currently recording. */
  get enabled(): boolean {
    return this._enabled;
  }

  /** Whether an undo step is available. */
  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  /** Whether a redo step is available. */
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** Number of transactions on the undo stack. */
  get undoCount(): number {
    return this.undoStack.length;
  }

  /** Number of transactions on the redo stack. */
  get redoCount(): number {
    return this.redoStack.length;
  }

  /** Title of the next undo step (or `undefined`). */
  get nextUndoTitle(): string | undefined {
    return this.undoStack[this.undoStack.length - 1]?.title;
  }

  /** Title of the next redo step (or `undefined`). */
  get nextRedoTitle(): string | undefined {
    return this.redoStack[this.redoStack.length - 1]?.title;
  }

  /** Whether recording is currently suspended (mid-apply or explicit suspend). */
  get isRecording(): boolean {
    return this._enabled && this.suspendDepth === 0;
  }

  /* ── enable / disable ────────────────────────────────────────────────── */

  /** Enable recording (no-op if already enabled). */
  enable(): void {
    if (this._enabled) return;
    this._enabled = true;
    this.events.emit('enabled', { enabled: true });
  }

  /**
   * Disable recording. Any open auto-transaction is flushed first so we don't
   * lose a half-recorded gesture. Existing stacks are preserved.
   */
  disable(): void {
    if (!this._enabled) return;
    this.flushOpen();
    this._enabled = false;
    this.events.emit('enabled', { enabled: false });
  }

  /**
   * Run `fn` with recording suspended (re-entrancy guard). Used internally while
   * applying an undo/redo so the applier's mutations are not re-recorded; also
   * public so a consumer can perform a silent (non-undoable) batch.
   */
  suspend<R>(fn: () => R): R {
    this.suspendDepth++;
    try {
      return fn();
    } finally {
      this.suspendDepth--;
    }
  }

  /* ── explicit transaction boundaries ─────────────────────────────────── */

  /**
   * Begin an explicit transaction. All actions recorded until the matching
   * `endTransaction()` collapse into ONE atomic undo unit. Ref-counted: nested
   * `start/end` only commit at the outermost boundary. The first non-empty title
   * wins.
   */
  startTransaction(title = 'Edit'): void {
    if (this.explicitDepth === 0) {
      // Flush any pending auto-transaction so the explicit one starts clean.
      this.flushOpen();
      this.explicitTitle = title;
      this.open = this.newOpen(title, /*explicit*/ true);
    } else if (!this.explicitTitle && title) {
      this.explicitTitle = title;
      if (this.open) this.open.title = title;
    }
    this.explicitDepth++;
  }

  /**
   * End the current explicit transaction. At the outermost boundary the bundled
   * actions are committed onto the undo stack (empty transactions are discarded).
   */
  endTransaction(): void {
    if (this.explicitDepth === 0) return;
    this.explicitDepth--;
    if (this.explicitDepth === 0) {
      const tx = this.open;
      this.open = null;
      this.explicitTitle = '';
      if (tx) this.commit(tx);
    }
  }

  /** Sugar: run `fn` inside one explicit transaction (commits on return/throw). */
  transact<R>(title: string, fn: () => R): R {
    this.startTransaction(title);
    try {
      return fn();
    } finally {
      this.endTransaction();
    }
  }

  /* ── recording (called by the Gantt's mutation pipeline) ─────────────── */

  /**
   * Record an action into the current transaction. If no explicit transaction is
   * open an *auto* transaction is started and flushed after `coalesceMs` of idle
   * (so a drag's stream of span ticks collapses to one undo step). No-op while
   * suspended or disabled.
   */
  record(action: StmAction<T>, title?: string): void {
    if (!this.isRecording) return;

    if (!this.open) {
      this.open = this.newOpen(title ?? defaultTitle(action), /*explicit*/ false);
    } else if (this.open.explicit && title && !this.explicitTitle) {
      this.open.title = title;
    } else if (!this.open.explicit && title) {
      // Auto-transaction inherits the latest descriptive title.
      this.open.title = title;
    }

    this.appendCoalesced(this.open, action);

    // Auto-transactions flush on idle; explicit ones flush on endTransaction.
    if (!this.open.explicit) this.scheduleFlush();
  }

  /**
   * Append an action, coalescing with the previous one when they target the same
   * kind+entity within the same open transaction (drag coalescing). Coalescing
   * keeps the FIRST before-state and the LATEST after-state.
   */
  private appendCoalesced(tx: MutableTransaction<T>, action: StmAction<T>): void {
    const prev = tx.actions[tx.actions.length - 1];
    if (this.coalesceMs > 0 && prev && canCoalesce(prev, action)) {
      tx.actions[tx.actions.length - 1] = coalesce(prev, action);
      return;
    }
    tx.actions.push(action);
  }

  /* ── undo / redo ─────────────────────────────────────────────────────── */

  /**
   * Undo the most recent transaction: replay its actions' inverse (in reverse
   * order) through the applier, then move it to the redo stack. Returns `false`
   * when there's nothing to undo. The open auto-transaction is flushed first.
   */
  undo(): boolean {
    this.flushOpen();
    const tx = this.undoStack.pop();
    if (!tx) return false;
    this.suspend(() => {
      for (let i = tx.actions.length - 1; i >= 0; i--) {
        this.applyInverse(tx.actions[i]!);
      }
    });
    this.redoStack.push(tx);
    this.events.emit('undo', { transaction: tx });
    this.emitChange();
    return true;
  }

  /**
   * Redo the most recently undone transaction: replay its actions forward through
   * the applier, then move it back to the undo stack. Returns `false` when
   * there's nothing to redo.
   */
  redo(): boolean {
    this.flushOpen();
    const tx = this.redoStack.pop();
    if (!tx) return false;
    this.suspend(() => {
      for (const action of tx.actions) this.applyForward(action);
    });
    this.undoStack.push(tx);
    this.events.emit('redo', { transaction: tx });
    this.emitChange();
    return true;
  }

  /** Clear both stacks and any open transaction. */
  clear(): void {
    this.cancelFlush();
    this.open = null;
    this.explicitDepth = 0;
    this.explicitTitle = '';
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.events.emit('clear', {});
    this.emitChange();
  }

  /** Snapshot of the undo stack (oldest → newest), for inspection/persistence. */
  getUndoStack(): ReadonlyArray<StmTransaction<T>> {
    return this.undoStack.slice();
  }

  /** Snapshot of the redo stack (oldest → newest). */
  getRedoStack(): ReadonlyArray<StmTransaction<T>> {
    return this.redoStack.slice();
  }

  /** Release timers + listeners. Stacks are dropped. */
  destroy(): void {
    this.cancelFlush();
    this.open = null;
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.applier = null;
    this.events.clear();
  }

  /* ── internals ───────────────────────────────────────────────────────── */

  private newOpen(title: string, explicit: boolean): MutableTransaction<T> {
    return { id: ++this.seq, title, actions: [], committedAt: 0, explicit };
  }

  /** Commit a transaction onto the undo stack and clear the redo stack. */
  private commit(tx: MutableTransaction<T>): void {
    if (tx.actions.length === 0) return; // discard empty
    tx.committedAt = Date.now();
    const frozen: StmTransaction<T> = {
      id: tx.id,
      title: tx.title,
      actions: tx.actions.slice(),
      committedAt: tx.committedAt,
    };
    this.undoStack.push(frozen);
    // A new edit invalidates the redo future (linear history).
    if (this.redoStack.length) this.redoStack.length = 0;
    // Bound the undo depth.
    if (this.maxStack > 0) {
      while (this.undoStack.length > this.maxStack) this.undoStack.shift();
    }
    this.events.emit('commit', { transaction: frozen });
    this.emitChange();
  }

  /** Commit + clear any pending auto-transaction immediately. */
  private flushOpen(): void {
    this.cancelFlush();
    // Never flush an explicit (still-open) transaction here — only auto ones.
    if (this.open && !this.open.explicit) {
      const tx = this.open;
      this.open = null;
      this.commit(tx);
    }
  }

  private scheduleFlush(): void {
    this.cancelFlush();
    if (this.coalesceMs <= 0 || typeof setTimeout !== 'function') {
      // No idle window: commit each auto-transaction immediately.
      this.flushOpen();
      return;
    }
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flushOpen();
    }, this.coalesceMs);
  }

  private cancelFlush(): void {
    if (this.flushTimer != null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }

  private emitChange(): void {
    this.events.emit('change', {
      canUndo: this.canUndo,
      canRedo: this.canRedo,
      undoCount: this.undoStack.length,
      redoCount: this.redoStack.length,
    });
  }

  /** Replay an action's inverse (undo direction) through the applier. */
  private applyInverse(action: StmAction<T>): void {
    const ap = this.applier;
    if (!ap) return;
    switch (action.kind) {
      case 'taskSpan':
        ap.setTaskSpan(action.taskId, action.before);
        break;
      case 'taskUpdate':
        ap.updateTask(action.taskId, action.before);
        break;
      case 'constraint':
        ap.applyConstraint(
          action.taskId,
          action.before.constraintType ?? 'asSoonAsPossible',
          action.before.constraintDate,
        );
        break;
      case 'dependencyAdd':
        ap.removeDependency(action.dependency.id);
        break;
      case 'dependencyRemove':
        ap.addDependency(action.dependency);
        break;
      case 'assignmentAdd':
        ap.unassignResource(action.taskId, action.resourceId);
        break;
      case 'assignmentRemove':
        ap.assignResource(action.taskId, action.resourceId, action.units);
        break;
    }
  }

  /** Replay an action forward (redo direction) through the applier. */
  private applyForward(action: StmAction<T>): void {
    const ap = this.applier;
    if (!ap) return;
    switch (action.kind) {
      case 'taskSpan':
        ap.setTaskSpan(action.taskId, action.after);
        break;
      case 'taskUpdate':
        ap.updateTask(action.taskId, action.after);
        break;
      case 'constraint':
        ap.applyConstraint(
          action.taskId,
          action.after.constraintType ?? 'asSoonAsPossible',
          action.after.constraintDate,
        );
        break;
      case 'dependencyAdd':
        ap.addDependency(action.dependency);
        break;
      case 'dependencyRemove':
        ap.removeDependency(action.dependency.id);
        break;
      case 'assignmentAdd':
        ap.assignResource(action.taskId, action.resourceId, action.units);
        break;
      case 'assignmentRemove':
        ap.unassignResource(action.taskId, action.resourceId);
        break;
    }
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   5. COALESCING (pure helpers — unit-testable without an STM instance)
   ═══════════════════════════════════════════════════════════════════════════ */

/** A still-open transaction (mutable actions array). */
interface MutableTransaction<T extends Model = Model> {
  id: number;
  title: string;
  actions: StmAction<T>[];
  committedAt: number;
  explicit: boolean;
}

/**
 * Whether two consecutive actions describe the same continuous gesture and may
 * collapse into one undo step (drag coalescing). Only span/update/constraint
 * actions on the SAME entity coalesce; structural actions (dependency,
 * assignment) never coalesce (each is a discrete, separately-reversible event).
 */
export function canCoalesce<T extends Model>(
  prev: StmAction<T>,
  next: StmAction<T>,
): boolean {
  if (prev.kind !== next.kind) return false;
  switch (next.kind) {
    case 'taskSpan':
      return (prev as TaskSpanAction).taskId === next.taskId;
    case 'taskUpdate':
      return (prev as TaskUpdateAction<T>).taskId === next.taskId;
    case 'constraint':
      return (prev as ConstraintAction).taskId === next.taskId;
    default:
      return false;
  }
}

/**
 * Coalesce two compatible actions: keep `prev`'s before-state and `next`'s
 * after-state (the net effect of the whole gesture). For field patches the
 * before/after maps are merged so the union of touched fields is reversible.
 */
export function coalesce<T extends Model>(
  prev: StmAction<T>,
  next: StmAction<T>,
): StmAction<T> {
  switch (next.kind) {
    case 'taskSpan': {
      const p = prev as TaskSpanAction;
      return { kind: 'taskSpan', taskId: next.taskId, before: p.before, after: next.after };
    }
    case 'taskUpdate': {
      const p = prev as TaskUpdateAction<T>;
      return {
        kind: 'taskUpdate',
        taskId: next.taskId,
        // Earlier before-values win (the first time a field was touched).
        before: { ...next.before, ...p.before },
        // Latest after-values win.
        after: { ...p.after, ...next.after },
      };
    }
    case 'constraint': {
      const p = prev as ConstraintAction;
      return { kind: 'constraint', taskId: next.taskId, before: p.before, after: next.after };
    }
    default:
      return next;
  }
}

/** Default human-readable title for an action (drives undo/redo tooltips). */
export function defaultTitle(action: StmAction): string {
  switch (action.kind) {
    case 'taskSpan':
      return 'Move task';
    case 'taskUpdate':
      return 'Edit task';
    case 'constraint':
      return 'Change constraint';
    case 'dependencyAdd':
      return 'Add dependency';
    case 'dependencyRemove':
      return 'Remove dependency';
    case 'assignmentAdd':
      return 'Assign resource';
    case 'assignmentRemove':
      return 'Unassign resource';
  }
}
