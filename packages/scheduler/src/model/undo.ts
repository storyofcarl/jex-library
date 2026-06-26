/**
 * Scheduler — Undo / Redo (State Tracking Manager / STM).
 *
 * Bryntum Scheduler ships a `StateTrackingManager` and DHTMLX a comparable
 * undo/redo plugin: every data mutation a user makes — moving / resizing /
 * creating / deleting an event, drawing or removing a dependency, editing an
 * assignment — is captured as a reversible *transaction*, and `undo()` / `redo()`
 * walk that transaction stack. This module is the framework-free heart of that
 * feature for `@jects/scheduler`.
 *
 * `@jects/core` does not (yet) ship a generic `StateTracking` primitive, so the
 * STM is implemented here, self-contained, over the core `Store` change events.
 *
 * ── Design ──────────────────────────────────────────────────────────────────
 *   - **Store-driven capture.** The STM subscribes to each tracked store's
 *     `add` / `remove` / `update` events and records the *inverse* operation as
 *     an {@link StmAction}. It never needs to know HOW a mutation happened (drag,
 *     editor, context menu, programmatic) — it only observes the store deltas, so
 *     it captures move/resize/create/delete + dependency + assignment edits for
 *     free, from a single seam.
 *   - **Transactions.** Actions accumulate into a pending {@link StmTransaction}.
 *     A user gesture that emits several store writes (e.g. an editor save that
 *     changes name + start + end, or an auto-reschedule cascade) is coalesced
 *     into ONE transaction via {@link SchedulerStm.transact} / explicit
 *     `startTransaction()` + `commit()`, so a single Ctrl+Z reverts the whole
 *     gesture — matching Bryntum's "one transaction per UI action".
 *   - **Auto-commit.** Outside an explicit transaction each captured action is
 *     auto-flushed (debounced to the microtask) into its own transaction, so a
 *     lone store write is still individually undoable.
 *   - **Undo / redo stacks.** `undo()` pops the undo stack, applies each action's
 *     inverse (newest→oldest), and pushes the transaction onto the redo stack;
 *     `redo()` is the mirror. A fresh user mutation clears the redo stack
 *     (standard linear history).
 *   - **Re-entrancy guard.** While the STM is itself applying an undo/redo it
 *     suppresses capture, so replaying a transaction does not record a new one.
 *   - **Capacity.** An optional cap drops the oldest transactions (ring buffer).
 *   - **Disposable.** `destroy()` removes every store listener; the class is also
 *     designed to be owned + disposed by the {@link UndoRedoController} plugin,
 *     which auto-disposes on scheduler destroy.
 *
 * The STM operates purely on `@jects/core` `Store` instances, so it is fully
 * testable headless (jsdom) without a real Scheduler — see `undo.test.ts`.
 */

import { EventEmitter, type RecordId, type Model, type EventMap } from '@jects/core';

/* ═══════════════════════════════════════════════════════════════════════════
   Structural store surface
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * A subscription surface compatible with `@jects/core` `Store.events`.
 *
 * The handler parameter is intentionally typed as `any`: the core store's
 * `on` is generic over its closed `StoreEvents` map, and a structural interface
 * with a concrete payload type would be contravariantly incompatible with it.
 * Using `any` here lets ANY real `Store<T>` satisfy the surface while the STM
 * narrows each payload internally at the subscription site.
 */
export interface TrackableEvents {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: string, fn: (payload: any) => unknown): () => void;
}

/** The slice of `@jects/core` `Store` the STM observes + replays through. */
export interface TrackableStore<T extends Model = Model> {
  readonly idField: string;
  readonly events: TrackableEvents;
  add(record: T | T[]): T[];
  remove(target: RecordId | T | Array<RecordId | T>): T[];
  update(id: RecordId, changes: Partial<T>): T | undefined;
  getById(id: RecordId): T | undefined;
}

/** Internal: the mutable `update` slot we temporarily wrap to capture `before`. */
type UpdatableStore = TrackableStore & {
  update(id: RecordId, changes: Partial<Model>): Model | undefined;
};

/** A store registered with the STM under a stable name (used in action labels). */
export interface TrackedStoreEntry {
  /** Stable key identifying the store (e.g. `'events'`, `'dependencies'`). */
  name: string;
  /** The store to observe + replay. */
  store: TrackableStore;
}

/* ═══════════════════════════════════════════════════════════════════════════
   Actions + transactions
   ═══════════════════════════════════════════════════════════════════════════ */

/** The kind of store mutation an action represents. */
export type StmActionType = 'add' | 'remove' | 'update';

/**
 * A single reversible store mutation. Holds everything needed to both *undo*
 * (apply the inverse) and *redo* (re-apply the original) without consulting the
 * live store again, so history survives later unrelated edits.
 */
export interface StmAction {
  /** Which registered store this action targets. */
  store: string;
  /** The mutation kind. */
  type: StmActionType;
  /** The affected record id. */
  id: RecordId;
  /**
   * For `add`: the full record that was added (so redo can re-add it).
   * For `remove`: the full record that was removed (so undo can re-add it).
   * For `update`: the *new* field values (so redo can re-apply them).
   */
  data?: Model;
  /**
   * For `update`: the *previous* values of exactly the changed fields (so undo
   * can restore them). Unused for add/remove.
   */
  before?: Model;
}

/** A named, atomic group of actions undone/redone together. */
export interface StmTransaction {
  /** Stable transaction id (monotonic). */
  id: number;
  /** Human-readable label (for menus / history UI). */
  title: string;
  /** The actions, in the order they occurred. Undo applies them reversed. */
  actions: StmAction[];
}

/* ═══════════════════════════════════════════════════════════════════════════
   Config + events
   ═══════════════════════════════════════════════════════════════════════════ */

/** STM configuration. */
export interface SchedulerStmConfig {
  /** Stores to track. Each must have a unique `name`. */
  stores: TrackedStoreEntry[];
  /**
   * Whether tracking is active on construction. When `false`, mutations are not
   * captured until {@link SchedulerStm.enable} is called. Default `true`.
   */
  enabled?: boolean;
  /**
   * Max number of transactions retained on the undo stack. Older transactions
   * are dropped (ring buffer). `0` / omitted = unlimited. Default unlimited.
   */
  maxTransactions?: number;
  /**
   * Title used for an auto-committed (non-explicit) transaction. Receives the
   * action that triggered the flush. Default derives a label from the action.
   */
  autoTitle?: (action: StmAction) => string;
}

/** Snapshot of the STM's stack state (payload of the `change` event). */
export interface StmState {
  canUndo: boolean;
  canRedo: boolean;
  undoCount: number;
  redoCount: number;
}

/** Typed event map emitted by the STM. */
export interface SchedulerStmEvents extends EventMap {
  /** A transaction was committed onto the undo stack. */
  transaction: { transaction: StmTransaction };
  /** A transaction was undone (moved undo→redo). */
  undo: { transaction: StmTransaction };
  /** A transaction was redone (moved redo→undo). */
  redo: { transaction: StmTransaction };
  /** The undo/redo stacks changed (commit / undo / redo / reset). */
  change: StmState;
}

/* ═══════════════════════════════════════════════════════════════════════════
   Helpers
   ═══════════════════════════════════════════════════════════════════════════ */

/** Shallow copy a record's own enumerable fields into a plain object. */
function snapshot(record: Model): Model {
  return { ...record };
}

/** Pick exactly the keys of `changes` from `source` (the pre-change values). */
function pickBefore(source: Model, changes: Model): Model {
  const before: Model = {};
  for (const key of Object.keys(changes)) before[key] = source[key];
  return before;
}

/** Whether any changed key actually differs from its prior value. */
function changedAny(before: Model, changes: Model): boolean {
  for (const key of Object.keys(changes)) {
    if (before[key] !== changes[key]) return true;
  }
  return false;
}

function defaultAutoTitle(action: StmAction): string {
  const verb =
    action.type === 'add' ? 'Add' : action.type === 'remove' ? 'Remove' : 'Update';
  return `${verb} ${action.store.replace(/s$/, '')}`;
}

/* ═══════════════════════════════════════════════════════════════════════════
   The State Tracking Manager
   ═══════════════════════════════════════════════════════════════════════════ */

export class SchedulerStm {
  private readonly emitter = new EventEmitter<SchedulerStmEvents>();
  private readonly stores = new Map<string, TrackableStore>();
  private readonly disposers: Array<() => void> = [];

  private readonly undoStack: StmTransaction[] = [];
  private readonly redoStack: StmTransaction[] = [];

  /** The transaction currently open (explicit or auto). */
  private pending: StmTransaction | null = null;
  /** Whether `pending` was opened by an explicit `startTransaction()`. */
  private explicit = false;
  /** Depth of nested explicit transactions (only the outermost commits). */
  private depth = 0;
  /** Scheduled auto-commit (microtask) handle, so we don't double-flush. */
  private autoFlushScheduled = false;

  private enabled: boolean;
  private readonly maxTransactions: number;
  private readonly autoTitle: (action: StmAction) => string;

  /** True while replaying an undo/redo — suppresses capture (re-entrancy guard). */
  private applying = false;
  private destroyed = false;
  private nextTxId = 1;

  constructor(config: SchedulerStmConfig) {
    this.enabled = config.enabled ?? true;
    this.maxTransactions = config.maxTransactions ?? 0;
    this.autoTitle = config.autoTitle ?? defaultAutoTitle;
    for (const entry of config.stores) this.registerStore(entry);
  }

  /* ── registration ─────────────────────────────────────────────────────── */

  /** Begin tracking a store. Safe to call after construction. */
  registerStore(entry: TrackedStoreEntry): void {
    if (this.destroyed) return;
    if (this.stores.has(entry.name)) {
      throw new Error(`SchedulerStm: a store named "${entry.name}" is already tracked.`);
    }
    const { name, store } = entry;
    this.stores.set(name, store);

    const offAdd = store.events.on('add', (p: { records: Model[] }) => {
      if (!this.shouldCapture()) return;
      for (const record of p.records) {
        this.capture({
          store: name,
          type: 'add',
          id: this.idOf(store, record),
          data: snapshot(record),
        });
      }
    });
    const offRemove = store.events.on('remove', (p: { records: Model[] }) => {
      if (!this.shouldCapture()) return;
      for (const record of p.records) {
        this.capture({
          store: name,
          type: 'remove',
          id: this.idOf(store, record),
          data: snapshot(record),
        });
      }
    });

    // ── Exact `before` capture for updates ──────────────────────────────────
    // The core `Store` fires its `update` event AFTER merging the changes into
    // the record, so by the time a listener runs the previous field values are
    // already gone. To record a faithful inverse we wrap the store's `update`
    // method: read the live record's current values for exactly the changed keys
    // BEFORE delegating to the real update, then emit the action with both the
    // new values (`data`) and the captured prior values (`before`). The wrapper
    // is removed on `destroy()`, restoring the original method.
    const updatable = store as UpdatableStore;
    const originalUpdate = updatable.update.bind(store);
    const wrappedUpdate = (id: RecordId, changes: Partial<Model>): Model | undefined => {
      const capture = this.shouldCapture();
      let before: Model | undefined;
      if (capture) {
        const live = store.getById(id);
        if (live) before = pickBefore(live, changes as Model);
      }
      const result = originalUpdate(id, changes);
      // Only record when the update actually targeted an existing record and at
      // least one value changed (avoid no-op transactions polluting history).
      if (capture && result && before && changedAny(before, changes as Model)) {
        this.capture({
          store: name,
          type: 'update',
          id,
          data: snapshot(changes as Model),
          before,
        });
      }
      return result;
    };
    updatable.update = wrappedUpdate as UpdatableStore['update'];
    this.disposers.push(offAdd, offRemove, () => {
      // Restore the original method only if no later wrapper replaced ours.
      if (updatable.update === (wrappedUpdate as UpdatableStore['update'])) {
        updatable.update = originalUpdate as UpdatableStore['update'];
      }
    });
  }

  private idOf(store: TrackableStore, record: Model): RecordId {
    return record[store.idField] as RecordId;
  }

  /* ── capture ──────────────────────────────────────────────────────────── */

  private shouldCapture(): boolean {
    return this.enabled && !this.applying && !this.destroyed;
  }

  /** Record an action into the pending transaction (opening one if needed). */
  private capture(action: StmAction): void {
    // A fresh user mutation invalidates any redo history (linear undo model).
    if (this.redoStack.length > 0) {
      this.redoStack.length = 0;
      this.emitChange();
    }
    if (!this.pending) {
      this.pending = { id: this.nextTxId++, title: this.autoTitle(action), actions: [] };
      this.explicit = false;
    }
    this.pending.actions.push(action);
    if (!this.explicit) this.scheduleAutoFlush();
  }

  /** Flush a non-explicit pending transaction at the next microtask. */
  private scheduleAutoFlush(): void {
    if (this.autoFlushScheduled || this.explicit) return;
    this.autoFlushScheduled = true;
    queueMicrotask(() => {
      this.autoFlushScheduled = false;
      // An explicit transaction may have opened in the meantime; only flush autos.
      if (!this.explicit && this.pending) this.commitPending();
    });
  }

  /* ── explicit transactions ────────────────────────────────────────────── */

  /**
   * Open an explicit transaction. All captured actions accumulate into it until
   * the matching {@link commit} (nestable — only the outermost commit flushes).
   * Prefer {@link transact} for the common scoped case.
   */
  startTransaction(title?: string): void {
    if (this.destroyed) return;
    this.depth++;
    if (this.depth > 1) return; // nested — reuse the open transaction
    // Adopt any auto-pending actions into this explicit transaction.
    if (this.pending) {
      this.explicit = true;
      if (title) this.pending.title = title;
    } else {
      this.pending = { id: this.nextTxId++, title: title ?? 'Edit', actions: [] };
      this.explicit = true;
    }
  }

  /**
   * Close the current explicit transaction, pushing it onto the undo stack (a
   * no-op transaction with zero actions is discarded). Only the outermost commit
   * of a nested set actually flushes.
   */
  commit(): StmTransaction | null {
    if (this.destroyed || this.depth === 0) return null;
    this.depth--;
    if (this.depth > 0) return null;
    return this.commitPending();
  }

  /** Run `fn` inside an explicit transaction, committing after it returns. */
  transact<R>(title: string, fn: () => R): R {
    this.startTransaction(title);
    try {
      return fn();
    } finally {
      this.commit();
    }
  }

  /** Push the pending transaction onto the undo stack (if it has any actions). */
  private commitPending(): StmTransaction | null {
    const tx = this.pending;
    this.pending = null;
    this.explicit = false;
    if (!tx || tx.actions.length === 0) return null;
    this.undoStack.push(tx);
    this.trim();
    this.emitter.emit('transaction', { transaction: tx });
    this.emitChange();
    return tx;
  }

  private trim(): void {
    if (this.maxTransactions > 0) {
      while (this.undoStack.length > this.maxTransactions) this.undoStack.shift();
    }
  }

  /* ── undo / redo ──────────────────────────────────────────────────────── */

  /** Whether there is at least one transaction to undo. */
  get canUndo(): boolean {
    return this.undoStack.length > 0 || (this.pending?.actions.length ?? 0) > 0;
  }
  /** Whether there is at least one transaction to redo. */
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }
  /** Number of transactions on the undo stack. */
  get undoLength(): number {
    return this.undoStack.length;
  }
  /** Number of transactions on the redo stack. */
  get redoLength(): number {
    return this.redoStack.length;
  }

  /**
   * Undo the most recent transaction (committing any open auto-transaction
   * first). Returns the reverted transaction, or `null` if there was nothing to
   * undo.
   */
  undo(): StmTransaction | null {
    if (this.destroyed) return null;
    // Flush a pending auto/explicit transaction so an un-committed gesture is
    // still undoable with a single call (Bryntum commits on undo too).
    this.flushPendingForHistory();
    const tx = this.undoStack.pop();
    if (!tx) return null;
    this.applyReverse(tx);
    this.redoStack.push(tx);
    this.emitter.emit('undo', { transaction: tx });
    this.emitChange();
    return tx;
  }

  /**
   * Redo the most recently undone transaction. Returns the re-applied
   * transaction, or `null` if there was nothing to redo.
   */
  redo(): StmTransaction | null {
    if (this.destroyed) return null;
    const tx = this.redoStack.pop();
    if (!tx) return null;
    this.applyForward(tx);
    this.undoStack.push(tx);
    this.emitter.emit('redo', { transaction: tx });
    this.emitChange();
    return tx;
  }

  /** Force-commit any pending transaction so it can be (re)played by undo. */
  private flushPendingForHistory(): void {
    if (this.pending && this.pending.actions.length > 0) {
      // Treat an open (explicit or auto) transaction as done for undo purposes.
      this.depth = 0;
      this.commitPending();
    }
  }

  /** Apply the inverse of every action in a transaction, newest action first. */
  private applyReverse(tx: StmTransaction): void {
    this.applying = true;
    try {
      for (let i = tx.actions.length - 1; i >= 0; i--) {
        this.invert(tx.actions[i]!);
      }
    } finally {
      this.applying = false;
    }
  }

  /** Re-apply every action in a transaction, oldest action first. */
  private applyForward(tx: StmTransaction): void {
    this.applying = true;
    try {
      for (const action of tx.actions) this.reapply(action);
    } finally {
      this.applying = false;
    }
  }

  /** Undo a single action by applying its inverse against the live store. */
  private invert(action: StmAction): void {
    const store = this.stores.get(action.store);
    if (!store) return;
    switch (action.type) {
      case 'add':
        // It was added → remove it.
        store.remove(action.id);
        break;
      case 'remove':
        // It was removed → re-add the snapshot.
        if (action.data) store.add(action.data as Model);
        break;
      case 'update':
        // It was changed → restore the prior field values.
        if (action.before) store.update(action.id, action.before);
        break;
    }
  }

  /** Redo a single action by re-applying the original mutation. */
  private reapply(action: StmAction): void {
    const store = this.stores.get(action.store);
    if (!store) return;
    switch (action.type) {
      case 'add':
        if (action.data) store.add(action.data as Model);
        break;
      case 'remove':
        store.remove(action.id);
        break;
      case 'update':
        if (action.data) store.update(action.id, action.data);
        break;
    }
  }

  /* ── state / events ───────────────────────────────────────────────────── */

  /** Subscribe to an STM event (`transaction` / `undo` / `redo` / `change`). */
  on<K extends keyof SchedulerStmEvents>(
    event: K,
    fn: (payload: SchedulerStmEvents[K]) => unknown,
  ): () => void {
    return this.emitter.on(event, fn);
  }

  /** Current stack snapshot. */
  state(): StmState {
    return {
      canUndo: this.canUndo,
      canRedo: this.canRedo,
      undoCount: this.undoStack.length,
      redoCount: this.redoStack.length,
    };
  }

  private emitChange(): void {
    this.emitter.emit('change', this.state());
  }

  /** Enable capture (mutations are recorded again). */
  enable(): this {
    this.enabled = true;
    return this;
  }
  /** Disable capture (mutations pass through untracked). */
  disable(): this {
    this.enabled = false;
    return this;
  }
  /** Whether capture is currently active. */
  get isEnabled(): boolean {
    return this.enabled;
  }
  /** Whether the STM is in the middle of replaying an undo/redo. */
  get isApplying(): boolean {
    return this.applying;
  }

  /** Clear both stacks + any pending transaction (history is lost). */
  reset(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.pending = null;
    this.explicit = false;
    this.depth = 0;
    this.emitChange();
  }

  /** Remove all store listeners + clear history. Idempotent. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const off of this.disposers.splice(0)) {
      try {
        off();
      } catch {
        /* listener already gone */
      }
    }
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.pending = null;
    this.stores.clear();
    this.emitter.clear();
  }
}
