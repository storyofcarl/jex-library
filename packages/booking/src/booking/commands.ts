/**
 * commands — a command/history model (undo/redo) plus a multi-select model and a
 * bulk-delete command. Carl requires these UNIVERSAL across components. The
 * widget records book/cancel/reschedule as commands so they can be undone and
 * redone; the manage UI uses the selection model + bulk delete.
 *
 * Each `Command` is a reversible pair of effects; `CommandStack` keeps an undo
 * and a redo stack and emits `change` so a toolbar can enable/disable its buttons.
 */

import { EventEmitter } from '@jects/core';

/** A reversible action. `do()`/`undo()` must be exact inverses. */
export interface Command {
  /** Human-readable label (for the toolbar tooltip / a11y). */
  label: string;
  /** Apply the action. */
  do(): void;
  /** Reverse the action. */
  undo(): void;
}

/** Events emitted by the command stack. */
export interface CommandStackEvents {
  /** Fired after any execute/undo/redo/clear — toolbar re-reads can/undo state. */
  change: { canUndo: boolean; canRedo: boolean };
  [key: string]: Record<string, unknown>;
}

/** Build a one-off command from a label + do/undo closures. */
export function command(label: string, doFn: () => void, undoFn: () => void): Command {
  return { label, do: doFn, undo: undoFn };
}

/** An undo/redo stack of reversible commands. */
export class CommandStack extends EventEmitter<CommandStackEvents> {
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];
  private readonly limit: number;

  constructor(limit = 100) {
    super();
    this.limit = Math.max(1, limit);
  }

  /** Run a command and push it onto the undo stack (clears the redo stack). */
  execute(cmd: Command): void {
    cmd.do();
    this.undoStack.push(cmd);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
    this.emitChange();
  }

  /**
   * Push an already-applied command without running `do()` again (for actions
   * performed inline, e.g. the existing confirm flow), still making them undoable.
   */
  push(cmd: Command): void {
    this.undoStack.push(cmd);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
    this.emitChange();
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** Undo the most recent command. No-op when the undo stack is empty. */
  undo(): boolean {
    const cmd = this.undoStack.pop();
    if (!cmd) return false;
    cmd.undo();
    this.redoStack.push(cmd);
    this.emitChange();
    return true;
  }

  /** Redo the most recently undone command. */
  redo(): boolean {
    const cmd = this.redoStack.pop();
    if (!cmd) return false;
    cmd.do();
    this.undoStack.push(cmd);
    this.emitChange();
    return true;
  }

  /** Drop all history (does not touch event listeners). */
  clearHistory(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.emitChange();
  }

  private emitChange(): void {
    this.emit('change', { canUndo: this.canUndo(), canRedo: this.canRedo() });
  }
}

/** Events emitted by the selection model. */
export interface SelectionEvents<Id> {
  change: { selected: Id[] };
  [key: string]: Record<string, unknown>;
}

/** A multi-select model over opaque ids (bookings, in practice). */
export class SelectionModel<Id> extends EventEmitter<SelectionEvents<Id>> {
  private readonly set = new Set<Id>();

  /** Is `id` selected? */
  has(id: Id): boolean {
    return this.set.has(id);
  }

  /** Add to the selection. */
  select(id: Id): void {
    if (this.set.has(id)) return;
    this.set.add(id);
    this.emitChange();
  }

  /** Remove from the selection. */
  deselect(id: Id): void {
    if (this.set.delete(id)) this.emitChange();
  }

  /** Toggle membership. */
  toggle(id: Id): void {
    if (this.set.has(id)) this.set.delete(id);
    else this.set.add(id);
    this.emitChange();
  }

  /** Replace the selection with exactly `ids`. */
  set_(ids: Id[]): void {
    this.set.clear();
    for (const id of ids) this.set.add(id);
    this.emitChange();
  }

  /** Clear the selection (does not touch event listeners). */
  clearSelection(): void {
    if (this.set.size === 0) return;
    this.set.clear();
    this.emitChange();
  }

  /** Number of selected ids. */
  get size(): number {
    return this.set.size;
  }

  /** Snapshot of selected ids. */
  all(): Id[] {
    return [...this.set];
  }

  private emitChange(): void {
    this.emit('change', { selected: [...this.set] });
  }
}
