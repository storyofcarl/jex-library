/**
 * @jects/calendar — undo / redo history.
 *
 * A small, framework-free State-Tracking Manager over the calendar's
 * {@link EventStore}, modelled on `@jects/scheduler`'s STM but specialized to the
 * single event store so it stays fully typed (no `any`). It observes the store's
 * `add` / `remove` / `update` deltas and records the *inverse* of each mutation
 * as a reversible action, regardless of HOW the mutation happened (drag, editor,
 * programmatic) — a single capture seam covers create / move / resize / edit /
 * delete for free.
 *
 * Actions accumulate into a pending transaction that auto-flushes on the next
 * microtask, so a single store write (e.g. an editor save that changes several
 * fields in ONE `update`, or a drag that emits ONE move) becomes ONE undoable
 * step — drags are coalesced by construction. `undo()` walks the transaction
 * stack applying inverses; `redo()` mirrors it. A re-entrancy guard suppresses
 * capture while replaying.
 */

import type { RecordId } from '@jects/core';
import type { CalendarEvent } from './contract.js';
import type { EventStore } from './event-store.js';

type ActionType = 'add' | 'remove' | 'update';

interface HistoryAction {
  type: ActionType;
  id: RecordId;
  /** For add/remove: the full record. For update: the new field values. */
  data?: Partial<CalendarEvent>;
  /** For update: the prior values of exactly the changed fields. */
  before?: Partial<CalendarEvent>;
}

interface Transaction {
  actions: HistoryAction[];
}

/** Snapshot of the history stacks (payload of the `change` callback). */
export interface HistoryState {
  canUndo: boolean;
  canRedo: boolean;
  undoCount: number;
  redoCount: number;
}

function snapshot(record: CalendarEvent): CalendarEvent {
  return { ...record };
}

export class CalendarHistory {
  private readonly undoStack: Transaction[] = [];
  private readonly redoStack: Transaction[] = [];
  private pending: Transaction | null = null;
  private flushScheduled = false;
  private applying = false;
  private destroyed = false;
  private readonly disposers: Array<() => void> = [];
  private readonly onChange: ((s: HistoryState) => void) | undefined;

  /** The store's original `update`, restored on destroy. */
  private readonly originalUpdate: EventStore['update'];

  constructor(
    private readonly store: EventStore,
    onChange?: (s: HistoryState) => void,
  ) {
    this.onChange = onChange;

    const offAdd = store.events.on('add', (p) => {
      if (!this.capturing()) return;
      for (const record of p.records) {
        this.capture({ type: 'add', id: record.id, data: snapshot(record) });
      }
    });
    const offRemove = store.events.on('remove', (p) => {
      if (!this.capturing()) return;
      for (const record of p.records) {
        this.capture({ type: 'remove', id: record.id, data: snapshot(record) });
      }
    });

    // Wrap `update` to capture the prior field values BEFORE the store merges the
    // changes (the `update` event fires after the merge, so `before` is gone by
    // then). Restored in destroy().
    this.originalUpdate = store.update.bind(store);
    const wrapped = (id: RecordId, changes: Partial<CalendarEvent>): CalendarEvent | undefined => {
      let before: Partial<CalendarEvent> | undefined;
      if (this.capturing()) {
        const live = store.getById(id);
        if (live) {
          before = {};
          for (const key of Object.keys(changes) as Array<keyof CalendarEvent>) {
            (before as Record<string, unknown>)[key] = live[key];
          }
        }
      }
      const result = this.originalUpdate(id, changes);
      if (result && before && this.changedAny(before, changes)) {
        this.capture({ type: 'update', id, data: { ...changes }, before });
      }
      return result;
    };
    (store as { update: EventStore['update'] }).update = wrapped as EventStore['update'];
    this.disposers.push(offAdd, offRemove, () => {
      if ((store as { update: EventStore['update'] }).update === (wrapped as EventStore['update'])) {
        (store as { update: EventStore['update'] }).update = this.originalUpdate;
      }
    });
  }

  private capturing(): boolean {
    return !this.applying && !this.destroyed;
  }

  private changedAny(before: Partial<CalendarEvent>, changes: Partial<CalendarEvent>): boolean {
    for (const key of Object.keys(changes) as Array<keyof CalendarEvent>) {
      if (before[key] !== changes[key]) return true;
    }
    return false;
  }

  private capture(action: HistoryAction): void {
    if (this.redoStack.length > 0) {
      this.redoStack.length = 0;
      this.emitChange();
    }
    if (!this.pending) this.pending = { actions: [] };
    this.pending.actions.push(action);
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    queueMicrotask(() => {
      this.flushScheduled = false;
      this.commitPending();
    });
  }

  private commitPending(): void {
    const tx = this.pending;
    this.pending = null;
    if (!tx || tx.actions.length === 0) return;
    this.undoStack.push(tx);
    this.emitChange();
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0 || (this.pending?.actions.length ?? 0) > 0;
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** Undo the most recent transaction (flushing any pending one first). */
  undo(): boolean {
    if (this.destroyed) return false;
    this.commitPending();
    const tx = this.undoStack.pop();
    if (!tx) return false;
    this.applying = true;
    try {
      for (let i = tx.actions.length - 1; i >= 0; i--) this.invert(tx.actions[i]!);
    } finally {
      this.applying = false;
    }
    this.redoStack.push(tx);
    this.emitChange();
    return true;
  }

  /** Redo the most recently undone transaction. */
  redo(): boolean {
    if (this.destroyed) return false;
    const tx = this.redoStack.pop();
    if (!tx) return false;
    this.applying = true;
    try {
      for (const action of tx.actions) this.reapply(action);
    } finally {
      this.applying = false;
    }
    this.undoStack.push(tx);
    this.emitChange();
    return true;
  }

  private invert(action: HistoryAction): void {
    switch (action.type) {
      case 'add':
        this.store.remove(action.id);
        break;
      case 'remove':
        if (action.data) this.store.add(action.data as CalendarEvent);
        break;
      case 'update':
        if (action.before) this.originalUpdate(action.id, action.before);
        break;
    }
  }

  private reapply(action: HistoryAction): void {
    switch (action.type) {
      case 'add':
        if (action.data) this.store.add(action.data as CalendarEvent);
        break;
      case 'remove':
        this.store.remove(action.id);
        break;
      case 'update':
        if (action.data) this.originalUpdate(action.id, action.data);
        break;
    }
  }

  state(): HistoryState {
    return {
      canUndo: this.canUndo,
      canRedo: this.canRedo,
      undoCount: this.undoStack.length,
      redoCount: this.redoStack.length,
    };
  }

  private emitChange(): void {
    this.onChange?.(this.state());
  }

  /** Clear both stacks + any pending transaction. */
  reset(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.pending = null;
    this.emitChange();
  }

  /** Remove store listeners, restore the wrapped `update`, drop history. Idempotent. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const off of this.disposers.splice(0)) {
      try {
        off();
      } catch {
        /* already gone */
      }
    }
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.pending = null;
  }
}
