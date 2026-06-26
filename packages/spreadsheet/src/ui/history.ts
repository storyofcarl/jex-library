/**
 * A small undo/redo command stack. Each command is a pair of idempotent
 * functions: `do` applies the change, `undo` reverses it. The UI pushes commands
 * as the user edits; `undo()`/`redo()` walk the stack.
 *
 * Commands are coarse-grained (a whole edit, a fill, a paste block) so a single
 * Ctrl+Z reverses a user-visible action.
 */

/** A reversible command. */
export interface Command {
  /** Human label (for menus / debugging). */
  readonly label: string;
  /** Apply the change. */
  redo(): void;
  /** Reverse the change. */
  undo(): void;
}

/** A bounded undo/redo stack. */
export class History {
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];
  private readonly limit: number;
  /** Set while applying so re-entrant pushes from listeners are ignored. */
  private applying = false;

  constructor(limit = 200) {
    this.limit = limit;
  }

  /** Whether an undo is available. */
  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  /** Whether a redo is available. */
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** True while a command is being (re)applied — suppress recursive pushes. */
  get isApplying(): boolean {
    return this.applying;
  }

  /**
   * Run a command's `redo` and record it. A no-op when called re-entrantly
   * (i.e. from within another command's apply) to avoid double-recording.
   */
  push(cmd: Command): void {
    if (this.applying) return;
    this.applying = true;
    try {
      cmd.redo();
    } finally {
      this.applying = false;
    }
    this.undoStack.push(cmd);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  /**
   * Record a command WITHOUT running it (the change was already applied by the
   * caller). Used when capturing an edit that happened inline.
   */
  record(cmd: Command): void {
    if (this.applying) return;
    this.undoStack.push(cmd);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  /** Undo the most recent command; returns it (or `undefined`). */
  undo(): Command | undefined {
    const cmd = this.undoStack.pop();
    if (!cmd) return undefined;
    this.applying = true;
    try {
      cmd.undo();
    } finally {
      this.applying = false;
    }
    this.redoStack.push(cmd);
    return cmd;
  }

  /** Redo the most recently undone command; returns it (or `undefined`). */
  redo(): Command | undefined {
    const cmd = this.redoStack.pop();
    if (!cmd) return undefined;
    this.applying = true;
    try {
      cmd.redo();
    } finally {
      this.applying = false;
    }
    this.undoStack.push(cmd);
    return cmd;
  }

  /** Drop all history. */
  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
  }
}
