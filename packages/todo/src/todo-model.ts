/**
 * TodoModel — the headless hierarchy + state engine behind the TodoList widget.
 *
 * Wraps a @jects/core `TreeStore` for indexing / expansion / visible-row
 * flattening, and owns the parent-child mutations (`children` arrays) that the
 * flat Store does not: nested add, subtree remove, reorder among siblings,
 * indent (nest under preceding sibling), outdent (promote to grandparent), and
 * `done` cascade + roll-up. All mutations are DOM-free and event-free; the
 * widget observes the store's `change` event to re-render.
 */

import { TreeStore, type RecordId } from '@jects/core';
import type {
  TodoTask,
  TodoStatus,
  TodoComment,
  TodoAttachment,
  TodoActivity,
  TodoActivityAction,
} from './contract.js';
import {
  childrenOf,
  effectiveDone,
  statusById,
  statusForDone,
  wouldCreateCycle,
  DEFAULT_STATUSES,
} from './todo-utils.js';
import { nextOccurrence } from './todo-recurrence.js';

let taskSeq = 0;
let subSeq = 0;

/** Max retained undo steps. */
const HISTORY_LIMIT = 100;

/** Generate a stable, collision-resistant task id. */
export function nextTaskId(): string {
  return `task-${Date.now().toString(36)}-${(++taskSeq).toString(36)}`;
}

/** Generate a stable id for a sub-record (comment / attachment / activity). */
export function nextSubId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${(++subSeq).toString(36)}`;
}

/** Fields whose changes are recorded in the activity trail. */
const TRACKED_FIELDS = new Set([
  'title', 'priority', 'due', 'startDate', 'estimate', 'timeSpent',
  'assignees', 'tags', 'notes', 'milestone', 'recurrence',
]);

function stringifyValue(v: unknown): string {
  if (v == null) return '';
  if (Array.isArray(v)) return v.map((x) => (typeof x === 'object' && x ? JSON.stringify(x) : String(x))).join(', ');
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

interface ParentLocation {
  /** The sibling array containing the task, or null if not found. */
  siblings: TodoTask[] | null;
  /** Parent task (null when the task is a root). */
  parent: TodoTask | null;
  /** Index of the task within `siblings`. */
  index: number;
}

export class TodoModel {
  readonly store: TreeStore<TodoTask>;
  readonly idField: string;
  /** Active workflow statuses (kept in sync with the widget config). */
  statuses: readonly TodoStatus[];
  /** Author recorded on comments + activity entries. */
  currentUser: string | undefined;

  // ── undo/redo history (snapshot based) ──────────────────────────────────
  historyEnabled = true;
  private past: TodoTask[][] = [];
  private future: TodoTask[][] = [];
  /** The last committed snapshot (== current state after the previous mutation). */
  private baseline: TodoTask[] = [];
  /** While true, mutations don't record history (drag coalescing / batches). */
  private batching = false;

  constructor(tasks: TodoTask[] = [], idField = 'id', statuses?: readonly TodoStatus[]) {
    this.idField = idField;
    this.statuses = statuses && statuses.length ? statuses : DEFAULT_STATUSES;
    this.store = new TreeStore<TodoTask>({
      idField,
      data: normalizeTree(tasks, idField, this.statuses),
      childrenField: 'children',
    });
    this.baseline = cloneTree(this.roots);
  }

  // ── reads ──────────────────────────────────────────────────────────────

  get roots(): TodoTask[] {
    return this.store.items;
  }

  getTask(id: RecordId): TodoTask | undefined {
    return this.store.getById(id);
  }

  isExpanded(id: RecordId): boolean {
    return this.store.isExpanded(id);
  }

  /** Locate a task's sibling array + parent + index. */
  locate(id: RecordId): ParentLocation {
    const search = (
      siblings: TodoTask[],
      parent: TodoTask | null,
    ): ParentLocation | null => {
      for (let i = 0; i < siblings.length; i++) {
        const node = siblings[i]!;
        if (this.idOf(node) === id) return { siblings, parent, index: i };
        const found = search(childrenOf(node), node);
        if (found) return found;
      }
      return null;
    };
    return search(this.roots, null) ?? { siblings: null, parent: null, index: -1 };
  }

  parentOf(id: RecordId): TodoTask | null {
    return this.locate(id).parent;
  }

  // ── mutations ────────────────────────────────────────────────────────────

  /** Add a task under `parentId` (null = root) at the end. Returns the task. */
  add(partial: Partial<TodoTask>, parentId: RecordId | null = null): TodoTask {
    const task = normalizeTask(partial, this.idField, this.statuses);
    this.pushActivity(task, { action: 'create' });
    if (parentId == null) {
      this.roots.push(task);
    } else {
      const parent = this.getTask(parentId);
      if (!parent) {
        // Unknown parent → treat as a root add rather than silently dropping.
        this.roots.push(task);
      } else {
        const kids = (parent.children ??= []);
        kids.push(task);
        // A newly-parented node should reveal its new child.
        void this.store.expand(parentId);
      }
    }
    this.reindex();
    return task;
  }

  /** Remove a task and its subtree. Returns the removed task (or undefined). */
  remove(id: RecordId): TodoTask | undefined {
    const loc = this.locate(id);
    if (!loc.siblings || loc.index < 0) return undefined;
    const [removed] = loc.siblings.splice(loc.index, 1);
    pruneEmpty(loc.parent);
    this.reindex();
    return removed;
  }

  /** Patch a task's plain fields. Returns the task. */
  update(id: RecordId, changes: Partial<TodoTask>): TodoTask | undefined {
    const task = this.getTask(id);
    if (!task) return undefined;
    // Record activity for tracked field changes BEFORE mutating.
    for (const key of Object.keys(changes)) {
      if (!TRACKED_FIELDS.has(key)) continue;
      const before = stringifyValue((task as Record<string, unknown>)[key]);
      const after = stringifyValue((changes as Record<string, unknown>)[key]);
      if (before !== after) {
        this.pushActivity(task, { action: 'update', field: key, from: before, to: after });
      }
    }
    Object.assign(task, changes);
    this.store.events.emit('change', { action: 'update' });
    this.recordHistory();
    return task;
  }

  /** Append an activity entry to a task (id + timestamp + author filled in). */
  pushActivity(
    task: TodoTask,
    entry: { action: TodoActivityAction; field?: string; from?: string; to?: string },
  ): void {
    const record: TodoActivity = {
      id: nextSubId('act'),
      action: entry.action,
      when: Date.now(),
    };
    if (entry.field !== undefined) record.field = entry.field;
    if (this.currentUser !== undefined) record.who = this.currentUser;
    if (entry.from !== undefined) record.from = entry.from;
    if (entry.to !== undefined) record.to = entry.to;
    (task.activity ??= []).push(record);
  }

  // ── collaboration ──────────────────────────────────────────────────────────

  /** Add a comment (mentions resolved against `knownNames`). Returns it. */
  addComment(id: RecordId, text: string, author: string, knownNames: readonly string[]): TodoComment | undefined {
    const task = this.getTask(id);
    if (!task) return undefined;
    const mentions = resolveMentions(text, knownNames);
    const comment: TodoComment = {
      id: nextSubId('cm'),
      author,
      text,
      createdAt: Date.now(),
    };
    if (mentions.length) comment.mentions = mentions;
    (task.comments ??= []).push(comment);
    this.pushActivity(task, { action: 'comment' });
    this.store.events.emit('change', { action: 'update' });
    this.recordHistory();
    return comment;
  }

  /** Add an attachment (id minted when missing). Returns it. */
  addAttachment(id: RecordId, partial: Partial<TodoAttachment>): TodoAttachment | undefined {
    const task = this.getTask(id);
    if (!task) return undefined;
    const att: TodoAttachment = {
      id: partial.id ?? nextSubId('att'),
      name: partial.name ?? partial.url ?? 'attachment',
    };
    if (partial.url !== undefined) att.url = partial.url;
    if (partial.size !== undefined) att.size = partial.size;
    if (partial.type !== undefined) att.type = partial.type;
    (task.attachments ??= []).push(att);
    this.pushActivity(task, { action: 'attachment', to: att.name });
    this.store.events.emit('change', { action: 'update' });
    this.recordHistory();
    return att;
  }

  /** Remove an attachment by id. */
  removeAttachment(id: RecordId, attachmentId: string): boolean {
    const task = this.getTask(id);
    if (!task?.attachments) return false;
    const idx = task.attachments.findIndex((a) => a.id === attachmentId);
    if (idx < 0) return false;
    task.attachments.splice(idx, 1);
    if (!task.attachments.length) delete task.attachments;
    this.store.events.emit('change', { action: 'update' });
    this.recordHistory();
    return true;
  }

  // ── time tracking ──────────────────────────────────────────────────────────

  /** Start a running timer (records the start instant). Returns whether it started. */
  startTimer(id: RecordId, nowMs: number): boolean {
    const task = this.getTask(id);
    if (!task || task.timerStartedAt != null) return false;
    task.timerStartedAt = nowMs;
    this.store.events.emit('change', { action: 'update' });
    return true;
  }

  /** Stop the running timer, folding elapsed time into `timeSpent`. Returns hours added. */
  stopTimer(id: RecordId, nowMs: number): number {
    const task = this.getTask(id);
    if (!task || task.timerStartedAt == null) return 0;
    const hours = Math.max(0, (nowMs - task.timerStartedAt) / 3_600_000);
    task.timerStartedAt = null;
    task.timeSpent = Number(((task.timeSpent ?? 0) + hours).toFixed(4));
    this.store.events.emit('change', { action: 'update' });
    this.recordHistory();
    return hours;
  }

  isTimerRunning(id: RecordId): boolean {
    return this.getTask(id)?.timerStartedAt != null;
  }

  // ── dependencies ───────────────────────────────────────────────────────────

  /**
   * Add a "`id` is blocked by `blockerId`" edge, keeping the reverse `blocks`
   * edge consistent. Rejected (returns false) when it would create a cycle.
   */
  addDependency(id: RecordId, blockerId: RecordId): boolean {
    const task = this.getTask(id);
    const blocker = this.getTask(blockerId);
    if (!task || !blocker || id === blockerId) return false;
    if (wouldCreateCycle(this.roots, id, blockerId)) return false;
    const dep = (task.dependencies ??= {});
    const blockedBy = (dep.blockedBy ??= []);
    if (!blockedBy.includes(blockerId)) blockedBy.push(blockerId);
    const bdep = (blocker.dependencies ??= {});
    const blocks = (bdep.blocks ??= []);
    if (!blocks.includes(id)) blocks.push(id);
    this.store.events.emit('change', { action: 'update' });
    this.recordHistory();
    return true;
  }

  /** Remove a blocked-by edge (and its reverse). */
  removeDependency(id: RecordId, blockerId: RecordId): boolean {
    const task = this.getTask(id);
    const blocker = this.getTask(blockerId);
    let changed = false;
    if (task?.dependencies?.blockedBy) {
      const i = task.dependencies.blockedBy.indexOf(blockerId);
      if (i >= 0) { task.dependencies.blockedBy.splice(i, 1); changed = true; }
    }
    if (blocker?.dependencies?.blocks) {
      const i = blocker.dependencies.blocks.indexOf(id);
      if (i >= 0) { blocker.dependencies.blocks.splice(i, 1); changed = true; }
    }
    if (changed) {
      this.store.events.emit('change', { action: 'update' });
      this.recordHistory();
    }
    return changed;
  }

  /** Replace the entire tree (used by import). Resets history baseline. */
  replaceAll(tasks: TodoTask[]): void {
    const fresh = normalizeTree(tasks, this.idField, this.statuses);
    this.roots.splice(0, this.roots.length, ...fresh);
    this.store.parse(this.roots);
    this.resetHistory();
  }

  /** Append tasks to the roots (used by import append mode). */
  appendAll(tasks: TodoTask[]): TodoTask[] {
    const fresh = normalizeTree(tasks, this.idField, this.statuses);
    this.roots.push(...fresh);
    this.reindex();
    return fresh;
  }

  /**
   * Set a task's `done`. With `rollUp`, cascades to all descendants and then
   * rolls ancestors up/down so a parent's stored flag tracks its children.
   * Returns every task whose stored `done` changed.
   */
  setDone(id: RecordId, done: boolean, rollUp: boolean): TodoTask[] {
    const task = this.getTask(id);
    if (!task) return [];
    const affected: TodoTask[] = [];

    const apply = (t: TodoTask, value: boolean): void => {
      if (t.done !== value) {
        t.done = value;
        // Keep the workflow status in lock-step with the done flag, but don't
        // clobber a bespoke non-done status (e.g. in-progress/blocked) when the
        // flag is merely staying false.
        const cur = statusById(this.statuses, t.status);
        if (!cur || cur.isDone !== value) t.status = statusForDone(this.statuses, value).id;
        affected.push(t);
      }
    };

    apply(task, done);

    if (rollUp) {
      // Cascade down to every descendant.
      const cascade = (t: TodoTask): void => {
        for (const c of childrenOf(t)) {
          apply(c, done);
          cascade(c);
        }
      };
      cascade(task);

      // Roll ancestors: a parent is done iff every child is effectively done.
      let parent = this.parentOf(id);
      while (parent) {
        const next = childrenOf(parent).every((c) => effectiveDone(c));
        apply(parent, next);
        parent = this.parentOf(this.idOf(parent));
      }
    }

    if (affected.length) {
      this.store.events.emit('change', { action: 'update' });
      this.recordHistory();
    }
    return affected;
  }

  /** Reorder a task among its current siblings to `index`. */
  reorder(id: RecordId, index: number): boolean {
    const loc = this.locate(id);
    if (!loc.siblings || loc.index < 0) return false;
    const arr = loc.siblings;
    const clamped = Math.max(0, Math.min(index, arr.length - 1));
    if (clamped === loc.index) return false;
    const [item] = arr.splice(loc.index, 1);
    if (item) arr.splice(clamped, 0, item);
    // (reorder keeps the item in the same array, so the parent never empties —
    // pruneEmpty would be a no-op here, but we keep the contract uniform.)
    pruneEmpty(loc.parent);
    this.reindex();
    return true;
  }

  /** Nest a task under its immediately-preceding sibling. */
  indent(id: RecordId): boolean {
    const loc = this.locate(id);
    if (!loc.siblings || loc.index <= 0) return false;
    const arr = loc.siblings;
    const prev = arr[loc.index - 1]!;
    const [item] = arr.splice(loc.index, 1);
    if (!item) return false;
    (prev.children ??= []).push(item);
    void this.store.expand(this.idOf(prev));
    this.reindex();
    return true;
  }

  /** Promote a task to sit just after its parent in the grandparent list. */
  outdent(id: RecordId): boolean {
    const loc = this.locate(id);
    if (!loc.siblings || loc.index < 0 || !loc.parent) return false;
    const parentLoc = this.locate(this.idOf(loc.parent));
    if (!parentLoc.siblings || parentLoc.index < 0) return false;
    const [item] = loc.siblings.splice(loc.index, 1);
    if (!item) return false;
    parentLoc.siblings.splice(parentLoc.index + 1, 0, item);
    // The former parent may have just lost its last child.
    pruneEmpty(loc.parent);
    this.reindex();
    return true;
  }

  /**
   * Relocate a task under `parentId` (null = root) at `index`. Refuses to move
   * a task into its own subtree. Returns whether the move happened.
   */
  moveTo(id: RecordId, parentId: RecordId | null, index: number): boolean {
    if (parentId != null) {
      if (parentId === id) return false;
      if (this.isDescendant(parentId, id)) return false;
    }
    const loc = this.locate(id);
    if (!loc.siblings || loc.index < 0) return false;

    let target: TodoTask[];
    if (parentId == null) {
      target = this.roots;
    } else {
      const parent = this.getTask(parentId);
      if (!parent) return false;
      target = parent.children ??= [];
    }

    const [item] = loc.siblings.splice(loc.index, 1);
    if (!item) return false;

    let dest = Math.max(0, Math.min(index, target.length));
    // Same-array move that started before the insertion point already shifted.
    if (target === loc.siblings && loc.index < dest) dest -= 1;
    target.splice(dest, 0, item);

    // The source parent may have just lost its last child (only possible on a
    // cross-parent move; same-array moves reinsert into the same array).
    if (target !== loc.siblings) pruneEmpty(loc.parent);

    if (parentId != null) void this.store.expand(parentId);
    this.reindex();
    return true;
  }

  /** True when `maybeAncestorId` is `nodeId` or an ancestor of `nodeId`'s subtree. */
  isDescendant(maybeDescendantId: RecordId, ancestorId: RecordId): boolean {
    const ancestor = this.getTask(ancestorId);
    if (!ancestor) return false;
    const walk = (t: TodoTask): boolean => {
      for (const c of childrenOf(t)) {
        if (this.idOf(c) === maybeDescendantId) return true;
        if (walk(c)) return true;
      }
      return false;
    };
    return walk(ancestor);
  }

  serialize(): TodoTask[] {
    return cloneTree(this.roots);
  }

  // ── internals ──────────────────────────────────────────────────────────

  private idOf(task: TodoTask): RecordId {
    return task[this.idField] as RecordId;
  }

  /** Re-parse the roots so the TreeStore re-indexes the whole tree + fires change. */
  private reindex(): void {
    this.store.parse(this.roots);
    this.recordHistory();
  }

  // ── workflow status ──────────────────────────────────────────────────────

  /**
   * Set a task's workflow status. Updates the `done` flag to the status'
   * `isDone`, then (with `rollUp`) cascades/rolls the done state exactly like
   * {@link setDone}. Returns every task whose stored state changed.
   */
  setStatus(id: RecordId, statusId: string, rollUp: boolean): TodoTask[] {
    const task = this.getTask(id);
    if (!task) return [];
    const status = statusById(this.statuses, statusId);
    if (!status) return [];
    const prevStatus = task.status;
    task.status = status.id;
    const statusChanged = prevStatus !== status.id;
    if (statusChanged) {
      this.pushActivity(task, {
        action: 'status',
        field: 'status',
        from: prevStatus ?? '',
        to: status.id,
      });
    }
    // setDone handles done-flag sync + cascade/rollup + change emission.
    const affected = this.setDone(id, status.isDone, rollUp);
    if (!affected.length && statusChanged) {
      // Pure status change with no done-flag delta still needs a render + record.
      this.store.events.emit('change', { action: 'update' });
      this.recordHistory();
      return [task];
    }
    return affected;
  }

  // ── recurrence ────────────────────────────────────────────────────────────

  /**
   * If `id` is a recurring task, spawn its next occurrence as a fresh sibling
   * (reset to not-done, dates rolled forward) and return it. Returns undefined
   * when the task has no recurrence or the series has ended.
   */
  spawnNext(id: RecordId, nowIso: string): TodoTask | undefined {
    const task = this.getTask(id);
    if (!task?.recurrence) return undefined;
    const anchor = task.recurrenceAnchor ?? task.due ?? nowIso;
    const from = task.due ?? nowIso;
    const next = nextOccurrence(task.recurrence, from, anchor);
    if (!next) return undefined;

    // Shift startDate by the same delta as the due date when both exist.
    let startDate = task.startDate ?? null;
    if (task.due && task.startDate) {
      const dueMs = Date.parse(`${task.due}T00:00:00`);
      const nextMs = Date.parse(`${next}T00:00:00`);
      const startMs = Date.parse(`${task.startDate}T00:00:00`);
      if (!Number.isNaN(dueMs) && !Number.isNaN(nextMs) && !Number.isNaN(startMs)) {
        const shifted = new Date(startMs + (nextMs - dueMs));
        startDate = `${shifted.getFullYear()}-${String(shifted.getMonth() + 1).padStart(2, '0')}-${String(shifted.getDate()).padStart(2, '0')}`;
      }
    }

    const notDone = statusForDone(this.statuses, false);
    // Build conditionally so we never set an optional key to `undefined`
    // (forbidden under exactOptionalPropertyTypes).
    const spawn: Partial<TodoTask> = {
      title: task.title,
      due: next,
      startDate,
      priority: (task.priority ?? 'none'),
      notes: task.notes ?? '',
      estimate: task.estimate ?? null,
      recurrence: task.recurrence,
      recurrenceAnchor: anchor,
      done: false,
      status: notDone.id,
    };
    if (task.assignees) spawn.assignees = [...task.assignees];
    if (task.tags) spawn.tags = task.tags.map((t) => ({ ...t }));
    // Insert as a sibling immediately after the source task.
    const loc = this.locate(id);
    const created = normalizeTask(spawn, this.idField, this.statuses);
    if (loc.siblings && loc.index >= 0) {
      loc.siblings.splice(loc.index + 1, 0, created);
    } else {
      this.roots.push(created);
    }
    this.reindex();
    return created;
  }

  // ── undo / redo ────────────────────────────────────────────────────────────

  /** Suspend history recording (e.g. during a drag) — pair with {@link endBatch}. */
  beginBatch(): void {
    this.batching = true;
  }

  /** Resume history recording and record one coalesced step for the batch. */
  endBatch(): void {
    if (!this.batching) return;
    this.batching = false;
    this.recordHistory();
  }

  canUndo(): boolean {
    return this.past.length > 0;
  }

  canRedo(): boolean {
    return this.future.length > 0;
  }

  undo(): boolean {
    if (!this.past.length) return false;
    this.future.unshift(this.baseline);
    const prev = this.past.pop()!;
    this.baseline = prev;
    this.restore(prev);
    return true;
  }

  redo(): boolean {
    if (!this.future.length) return false;
    this.past.push(this.baseline);
    const next = this.future.shift()!;
    this.baseline = next;
    this.restore(next);
    return true;
  }

  /** Reset the history baseline (e.g. after a full data load). */
  resetHistory(): void {
    this.past = [];
    this.future = [];
    this.baseline = cloneTree(this.roots);
  }

  /** Record a committed snapshot (no-op while batching / history disabled). */
  private recordHistory(): void {
    if (!this.historyEnabled || this.batching) return;
    this.past.push(this.baseline);
    if (this.past.length > HISTORY_LIMIT) this.past.shift();
    this.baseline = cloneTree(this.roots);
    this.future = [];
  }

  /** Replace the live tree with a snapshot and re-index (fires change). */
  private restore(snapshot: TodoTask[]): void {
    const fresh = cloneTree(snapshot);
    this.roots.splice(0, this.roots.length, ...fresh);
    this.store.parse(this.roots);
  }
}

// ── tree normalization helpers ─────────────────────────────────────────────

/**
 * Drop a now-empty `children` array off a parent so a former parent reverts to
 * a genuine LEAF. Without this, `effectiveDone`/`computeProgress` (which branch
 * on `children.length === 0`) would treat the node as a leaf reporting its STALE
 * stored `done`, and serialize()/cloneTree (which strip empty `children`) would
 * disagree with the live model. Called from every sibling-array mutation that
 * can remove the last child (remove/reorder/outdent/moveTo), mirroring
 * normalizeTask/cloneTree which already drop empty children.
 */
/**
 * Resolve `@name` mentions in a comment body against a set of known names.
 * Matches the longest known name that follows an `@`, case-insensitively, so
 * multi-word names ("@Ada Lovelace") resolve as one mention.
 */
function resolveMentions(text: string, knownNames: readonly string[]): string[] {
  if (!knownNames.length) return [];
  const found = new Set<string>();
  const lower = text.toLowerCase();
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '@') continue;
    const rest = lower.slice(i + 1);
    let best: string | null = null;
    for (const name of knownNames) {
      const n = name.toLowerCase();
      if (rest.startsWith(n) && (!best || n.length > best.length)) best = n;
    }
    if (best) {
      const exact = knownNames.find((x) => x.toLowerCase() === best);
      if (exact) found.add(exact);
    }
  }
  return [...found];
}

function pruneEmpty(parent: TodoTask | null): void {
  if (parent && Array.isArray(parent.children) && parent.children.length === 0) {
    delete parent.children;
  }
}

function normalizeTask(
  partial: Partial<TodoTask>,
  idField: string,
  statuses: readonly TodoStatus[],
): TodoTask {
  const id = (partial as Record<string, unknown>)[idField] as RecordId | undefined;
  // Reconcile done <-> status: an explicit status wins (and dictates done);
  // otherwise the done flag maps onto the status set.
  const explicit = statusById(statuses, partial.status);
  const done = explicit ? explicit.isDone : partial.done ?? false;
  const status = explicit ? explicit.id : statusForDone(statuses, done).id;
  const task: TodoTask = {
    ...partial,
    title: partial.title ?? '',
    done,
    status,
    due: partial.due ?? null,
    priority: partial.priority ?? 'none',
    notes: partial.notes ?? '',
    createdAt: partial.createdAt ?? Date.now(),
  } as TodoTask;
  (task as Record<string, unknown>)[idField] = id ?? nextTaskId();
  if (Array.isArray(partial.children) && partial.children.length) {
    task.children = normalizeTree(partial.children, idField, statuses);
  } else {
    delete task.children;
  }
  return task;
}

function normalizeTree(
  tasks: TodoTask[],
  idField: string,
  statuses: readonly TodoStatus[],
): TodoTask[] {
  return tasks.map((t) => normalizeTask(t, idField, statuses));
}

function cloneTree(tasks: TodoTask[]): TodoTask[] {
  return tasks.map((t) => {
    const copy: TodoTask = { ...t };
    // Deep-copy the mutable sub-objects so snapshots (history) and public
    // serialize() results never alias the live model's arrays/records.
    if (t.assignees) copy.assignees = [...t.assignees];
    if (t.tags) copy.tags = t.tags.map((x) => ({ ...x }));
    if (t.customFields) copy.customFields = { ...t.customFields };
    if (t.dependencies) {
      copy.dependencies = {
        ...(t.dependencies.blocks ? { blocks: [...t.dependencies.blocks] } : {}),
        ...(t.dependencies.blockedBy ? { blockedBy: [...t.dependencies.blockedBy] } : {}),
      };
    }
    if (t.comments) copy.comments = t.comments.map((c) => ({ ...c, ...(c.mentions ? { mentions: [...c.mentions] } : {}) }));
    if (t.activity) copy.activity = t.activity.map((a) => ({ ...a }));
    if (t.attachments) copy.attachments = t.attachments.map((a) => ({ ...a }));
    const kids = childrenOf(t);
    if (kids.length) copy.children = cloneTree(kids);
    else delete copy.children;
    return copy;
  });
}
