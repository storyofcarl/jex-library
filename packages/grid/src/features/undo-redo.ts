/**
 * UndoRedoFeature — a transaction / undo-redo stack for @jects/grid.
 *
 * Brings the grid to Bryntum/DHTMLX **Undo/redo (StateTracking)** parity: every
 * data mutation (cell edit, paste, fill, row add/remove, row reorder) and —
 * optionally — every grid-state change (column order/width/visibility/frozen,
 * sort, filter, group) is captured as a reversible **command**. `undo()` pops
 * the most recent command and applies its inverse; `redo()` re-applies it.
 *
 * ## How capture works
 * The feature is **automatic**: it subscribes to the backing `Store` events
 * (`add` / `remove` / `update`) and to the grid's `rowReorder`, `sortChange`,
 * `filterChange`, `groupChange`, `columnResize`, and `columnReorder` events, and
 * records the inverse of each. It keeps a **shadow snapshot** of every record so
 * an `update` (which only carries the changed keys) can be reversed precisely to
 * the prior values. No engine internals are touched — everything goes through
 * the public `GridApi` + `Store` surface, exactly like the other features.
 *
 * Several store mutations that belong to one user action (e.g. a paste that
 * writes 50 cells, or a fill across a range) are coalesced into a single undo
 * step via {@link UndoRedoFeature.transact}. Callers that perform multi-cell
 * edits should wrap them; rapid single edits within `mergeWindow` ms on the
 * **same cell** are also auto-merged (matching spreadsheet-style typing).
 *
 * ## Re-entrancy
 * While a command is being applied (undo/redo), capture is suspended so the
 * inverse mutation does not itself get pushed onto the stack.
 *
 * ## Keyboard
 * When `keyboard` is enabled (default) the feature binds, on the grid root:
 *   - **Ctrl/Cmd + Z** → `undo()`
 *   - **Ctrl/Cmd + Y** or **Ctrl/Cmd + Shift + Z** → `redo()`
 *
 * Bindings are ignored while focus is inside an active inline editor / form
 * field so the browser's native text undo keeps working during typing.
 *
 * Everything the feature creates (store + grid subscriptions, the keydown
 * listener) is released on `destroy()`.
 */

import type { Model, RecordId } from '@jects/core';
import type {
  ColumnDef,
  FilterState,
  FrozenSide,
  GridApi,
  GridFeature,
  GroupState,
  SortState,
} from '../contract.js';
import { Disposers, colId } from './shared.js';

/* ═══════════════════════════════════════════════════════════════════════════
   Commands
   ═══════════════════════════════════════════════════════════════════════════ */

/** Discriminates the kind of mutation a command reverses. */
export type UndoCommandKind =
  | 'edit' // one or more cell/field updates on existing records
  | 'add' // records inserted
  | 'remove' // records deleted
  | 'move' // a row reordered within the store
  | 'columnState' // column order/width/visibility/frozen change
  | 'sort'
  | 'filter'
  | 'group';

/** A reversible unit of work. `undo` restores the prior state; `redo` re-applies. */
export interface UndoCommand {
  /** Mutation kind (for events / merging / debugging). */
  readonly kind: UndoCommandKind;
  /** Human-readable label (e.g. `"Edit Age"`, `"Paste 12 cells"`). */
  readonly label: string;
  /** Revert this command (restore the prior state). */
  undo(): void;
  /** Re-apply this command (restore the post state). */
  redo(): void;
  /**
   * Optional merge hook: if the next captured command of the same shape should
   * be folded into this one (e.g. consecutive keystrokes in one cell), return a
   * merged command; otherwise return `null`. Only consulted within `mergeWindow`.
   */
  mergeWith?(next: UndoCommand): UndoCommand | null;
  /** Timestamp (ms) the command was recorded, for merge-window checks. */
  readonly time: number;
}

/** One field change captured for an `edit` command. */
interface FieldEdit {
  id: RecordId;
  field: string;
  before: unknown;
  after: unknown;
}

/** Tracked per-column geometry attributes (undefined = "not set"). */
interface ColumnGeom {
  width: number | undefined;
  hidden: boolean | undefined;
  frozen: FrozenSide | undefined;
}

/** A reversible snapshot of column order + geometry. */
interface ColumnSnapshotState {
  order: string[];
  geom: Record<string, ColumnGeom>;
}

/* ═══════════════════════════════════════════════════════════════════════════
   Options & events
   ═══════════════════════════════════════════════════════════════════════════ */

export interface UndoRedoFeatureOptions {
  /** Max commands retained on the undo stack. Default `200`. `0` = unbounded. */
  limit?: number;
  /** Bind Ctrl/Cmd+Z / Ctrl/Cmd+Y keyboard shortcuts. Default `true`. */
  keyboard?: boolean;
  /**
   * Auto-capture column/sort/filter/group state changes (not just data).
   * Default `true`. When `false`, only data mutations are tracked.
   */
  trackState?: boolean;
  /**
   * Window (ms) within which consecutive single-cell edits on the **same** cell
   * are merged into one undo step (spreadsheet-style typing). Default `400`.
   * Set `0` to disable merging.
   */
  mergeWindow?: number;
}

/** Snapshot of stack sizes, emitted on every change for UI binding. */
export interface UndoRedoState {
  canUndo: boolean;
  canRedo: boolean;
  undoCount: number;
  redoCount: number;
}

/* ═══════════════════════════════════════════════════════════════════════════
   Feature
   ═══════════════════════════════════════════════════════════════════════════ */

export class UndoRedoFeature<Row extends Model = Model> implements GridFeature<Row> {
  readonly name = 'undoRedo';

  private api!: GridApi<Row>;
  private readonly disposers = new Disposers();

  private readonly undoStack: UndoCommand[] = [];
  private readonly redoStack: UndoCommand[] = [];

  private readonly limit: number;
  private readonly keyboard: boolean;
  private readonly trackState: boolean;
  private readonly mergeWindow: number;

  /** Suspend auto-capture while applying an inverse (undo/redo). */
  private applying = 0;
  /** Depth of an open {@link transact} batch. */
  private batchDepth = 0;
  /** Field edits accumulated within the open batch. */
  private batchEdits: FieldEdit[] | null = null;
  /** Label for the open batch. */
  private batchLabel = '';

  /** Shadow copy of each record's fields, to derive `before` values on update. */
  private readonly shadow = new Map<RecordId, Record<string, unknown>>();

  /** Listeners that want a fresh {@link UndoRedoState} on every change. */
  private readonly stateListeners = new Set<(s: UndoRedoState) => void>();

  constructor(options: UndoRedoFeatureOptions = {}) {
    this.limit = options.limit ?? 200;
    this.keyboard = options.keyboard ?? true;
    this.trackState = options.trackState ?? true;
    this.mergeWindow = options.mergeWindow ?? 400;
  }

  /* ── lifecycle ──────────────────────────────────────────────────────── */

  init(grid: GridApi<Row>): void {
    this.api = grid;
    grid.track(() => this.disposers.dispose());

    this.seedShadow();

    // Data mutations via Store events.
    const store = grid.store;
    const offAdd = store.events.on('add', (e) => this.onStoreAdd(e.records, e.index));
    const offRemove = store.events.on('remove', (e) => this.onStoreRemove(e.records));
    const offUpdate = store.events.on('update', (e) => this.onStoreUpdate(e.id, e.changes));
    this.disposers.add(offAdd);
    this.disposers.add(offRemove);
    this.disposers.add(offUpdate);

    // Row reorder (the store.move that backs it doesn't emit a discrete event,
    // so we capture the grid's notification instead).
    const offReorder = grid.on('rowReorder', (e) => {
      if (this.suspended() || e.crossGrid) return; // cross-grid handled as add/remove
      this.captureMove(e.recordId, e.fromIndex, e.toIndex);
    });
    this.disposers.add(offReorder);

    if (this.trackState) this.wireStateCapture();

    if (this.keyboard) this.wireKeyboard();

    // Re-seed the shadow whenever the dataset is wholesale replaced.
    const offLoad = store.events.on('load', () => {
      this.seedShadow();
      this.clear();
    });
    this.disposers.add(offLoad);
  }

  destroy(): void {
    this.disposers.dispose();
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.shadow.clear();
    this.stateListeners.clear();
  }

  /* ── public API ─────────────────────────────────────────────────────── */

  /** Whether there is at least one command to undo. */
  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  /** Whether there is at least one command to redo. */
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** Number of commands on the undo stack. */
  get undoLength(): number {
    return this.undoStack.length;
  }

  /** Number of commands on the redo stack. */
  get redoLength(): number {
    return this.redoStack.length;
  }

  /** Label of the next undoable command, or `null`. */
  peekUndo(): string | null {
    return this.undoStack[this.undoStack.length - 1]?.label ?? null;
  }

  /** Label of the next redoable command, or `null`. */
  peekRedo(): string | null {
    return this.redoStack[this.redoStack.length - 1]?.label ?? null;
  }

  /** Undo the most recent command. Returns the command applied, or `null`. */
  undo(): UndoCommand | null {
    const cmd = this.undoStack.pop();
    if (!cmd) return null;
    this.applying++;
    try {
      cmd.undo();
    } finally {
      this.applying--;
    }
    this.redoStack.push(cmd);
    this.syncShadow();
    this.emitState();
    return cmd;
  }

  /** Redo the most recently undone command. Returns it, or `null`. */
  redo(): UndoCommand | null {
    const cmd = this.redoStack.pop();
    if (!cmd) return null;
    this.applying++;
    try {
      cmd.redo();
    } finally {
      this.applying--;
    }
    this.undoStack.push(cmd);
    this.syncShadow();
    this.emitState();
    return cmd;
  }

  /** Drop all history (both stacks). */
  clear(): void {
    const had = this.undoStack.length > 0 || this.redoStack.length > 0;
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    if (had) this.emitState();
  }

  /** Snapshot of the current stack sizes. */
  getState(): UndoRedoState {
    return {
      canUndo: this.canUndo,
      canRedo: this.canRedo,
      undoCount: this.undoStack.length,
      redoCount: this.redoStack.length,
    };
  }

  /** Subscribe to stack-size changes (for toolbar enabled/disabled binding). */
  onStateChange(fn: (s: UndoRedoState) => void): () => void {
    this.stateListeners.add(fn);
    return () => this.stateListeners.delete(fn);
  }

  /**
   * Coalesce every data mutation performed inside `fn` into a **single** undo
   * step (used for paste, fill, and any multi-cell batch). Re-entrant and
   * exception-safe; the batch is committed even if `fn` throws.
   */
  transact(label: string, fn: () => void): void {
    if (this.suspended()) {
      fn();
      return;
    }
    const opening = this.batchDepth === 0;
    if (opening) {
      this.batchEdits = [];
      this.batchLabel = label;
    }
    this.batchDepth++;
    try {
      fn();
    } finally {
      this.batchDepth--;
      if (this.batchDepth === 0) this.commitBatch();
    }
  }

  /* ── transactional helpers (perform + auto-capture) ─────────────────── */

  /** Edit a single field on a record, recording an undoable step. */
  editCell(id: RecordId, field: string, value: unknown): void {
    this.api.store.update(id, { [field]: value } as Partial<Row>);
  }

  /** Apply many `{ id, field, value }` edits as one undo step (paste / fill). */
  applyEdits(label: string, edits: ReadonlyArray<{ id: RecordId; field: string; value: unknown }>): void {
    this.transact(label, () => {
      for (const e of edits) this.api.store.update(e.id, { [e.field]: e.value } as Partial<Row>);
    });
  }

  /* ── capture: data ──────────────────────────────────────────────────── */

  private onStoreUpdate(id: RecordId, changes: Partial<Row>): void {
    if (this.suspended()) {
      this.refreshShadow(id);
      return;
    }
    const prior = this.shadow.get(id) ?? {};
    const edits: FieldEdit[] = [];
    for (const field of Object.keys(changes)) {
      const after = (changes as Record<string, unknown>)[field];
      const before = prior[field];
      if (Object.is(before, after)) continue;
      edits.push({ id, field, before, after });
    }
    this.refreshShadow(id);
    if (edits.length === 0) return;

    if (this.batchEdits) {
      this.batchEdits.push(...edits);
      return;
    }
    this.pushEdit(edits);
  }

  private pushEdit(edits: FieldEdit[]): void {
    const label = editLabel(edits, this.api);
    const cmd = this.makeEditCommand(label, edits);
    this.push(cmd);
  }

  private makeEditCommand(label: string, edits: FieldEdit[]): UndoCommand {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    return {
      kind: 'edit',
      label,
      time: Date.now(),
      undo() {
        self.applyFieldEdits(edits, 'before');
      },
      redo() {
        self.applyFieldEdits(edits, 'after');
      },
      mergeWith(next) {
        // Merge only a single-cell edit immediately following another on the
        // SAME cell — spreadsheet typing. Multi-cell batches never merge.
        if (next.kind !== 'edit') return null;
        const nextEdits = (next as unknown as { __edits?: FieldEdit[] }).__edits;
        if (!nextEdits || edits.length !== 1 || nextEdits.length !== 1) return null;
        const a = edits[0]!;
        const b = nextEdits[0]!;
        if (a.id !== b.id || a.field !== b.field) return null;
        // Keep the original `before`, take the latest `after`.
        const merged: FieldEdit[] = [{ id: a.id, field: a.field, before: a.before, after: b.after }];
        return self.makeEditCommand(label, merged);
      },
      // Stash the raw edits so mergeWith on the previous command can read them.
      __edits: edits,
    } as UndoCommand & { __edits: FieldEdit[] };
  }

  private applyFieldEdits(edits: FieldEdit[], which: 'before' | 'after'): void {
    const store = this.api.store;
    // Group by id so one record gets a single update() with all its fields.
    const byId = new Map<RecordId, Record<string, unknown>>();
    for (const e of edits) {
      const patch = byId.get(e.id) ?? {};
      patch[e.field] = which === 'before' ? e.before : e.after;
      byId.set(e.id, patch);
    }
    for (const [id, patch] of byId) {
      store.update(id, patch as Partial<Row>);
      this.api.refreshRow(id);
    }
  }

  private onStoreAdd(records: Row[], index: number): void {
    for (const r of records) this.refreshShadow(this.idOf(r));
    if (this.suspended()) return;
    const snapshot = records.map((r) => ({ ...r }));
    const ids = snapshot.map((r) => this.idOf(r as Row));
    const store = this.api.store;
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    const label = `Add ${records.length} row${records.length === 1 ? '' : 's'}`;
    this.push({
      kind: 'add',
      label,
      time: Date.now(),
      undo() {
        store.remove(ids);
        for (const id of ids) self.shadow.delete(id);
      },
      redo() {
        const added = store.add(snapshot.map((r) => ({ ...r })) as Row[]);
        // Restore original position when contiguous & known.
        if (index >= 0 && added.length > 0) {
          const at = store.indexOf(self.idOf(added[0]!));
          if (at >= 0 && at !== index) store.move(at, Math.min(index, store.count - 1));
        }
        for (const r of added) self.refreshShadow(self.idOf(r));
      },
    });
  }

  private onStoreRemove(records: Row[]): void {
    if (this.suspended()) {
      for (const r of records) this.shadow.delete(this.idOf(r));
      return;
    }
    const store = this.api.store;
    // Snapshot each removed row for faithful re-insertion on undo. The remove
    // payload doesn't carry the prior index, so undo re-adds via store.add()
    // (which appends); callers needing exact-position restore should reorder.
    const snaps = records.map((r) => ({ row: { ...r } as Row, id: this.idOf(r) }));
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    for (const s of snaps) this.shadow.delete(s.id);
    const label = `Delete ${records.length} row${records.length === 1 ? '' : 's'}`;
    this.push({
      kind: 'remove',
      label,
      time: Date.now(),
      undo() {
        const added = store.add(snaps.map((s) => ({ ...s.row })) as Row[]);
        for (const r of added) self.refreshShadow(self.idOf(r));
      },
      redo() {
        store.remove(snaps.map((s) => s.id));
        for (const s of snaps) self.shadow.delete(s.id);
      },
    });
  }

  private captureMove(id: RecordId, fromIndex: number, toIndex: number): void {
    if (fromIndex === toIndex) return;
    const store = this.api.store;
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    const label = `Move row`;
    this.push({
      kind: 'move',
      label,
      time: Date.now(),
      undo() {
        const cur = store.indexOf(id);
        if (cur >= 0) store.move(cur, fromIndex);
        self.api.refresh();
      },
      redo() {
        const cur = store.indexOf(id);
        if (cur >= 0) store.move(cur, toIndex);
        self.api.refresh();
      },
    });
  }

  /* ── capture: grid state (columns / sort / filter / group) ──────────── */

  private columnSnapshot(): ColumnSnapshotState {
    const order: string[] = [];
    const geom: Record<string, ColumnGeom> = {};
    for (const col of this.api.columns) {
      const id = colId(col);
      if (!id) continue;
      order.push(id);
      // Record every tracked attribute explicitly (including `undefined`) so a
      // restore can *clear* a value that was set after this snapshot.
      geom[id] = {
        width: col.width,
        hidden: col.hidden,
        frozen: col.frozen,
      };
    }
    return { order, geom };
  }

  private applyColumnSnapshot(snap: ColumnSnapshotState): void {
    const byId = new Map<string, ColumnDef<Row>>();
    for (const c of this.api.columns) byId.set(colId(c), c);
    const next: ColumnDef<Row>[] = [];
    const used = new Set<string>();
    for (const id of snap.order) {
      const col = byId.get(id);
      if (!col) continue;
      used.add(id);
      const g = snap.geom[id];
      const merged = { ...col } as ColumnDef<Row>;
      if (g) {
        if (g.width == null) delete merged.width;
        else merged.width = g.width;
        if (g.hidden == null) delete merged.hidden;
        else merged.hidden = g.hidden;
        if (g.frozen == null) delete merged.frozen;
        else merged.frozen = g.frozen;
      }
      next.push(merged);
    }
    for (const c of this.api.columns) {
      const id = colId(c);
      if (!used.has(id)) next.push(c);
    }
    this.api.setColumns(next);
  }

  private wireStateCapture(): void {
    const grid = this.api;

    // Column geometry / order. We snapshot lazily: keep the last applied
    // snapshot and, on each change, push a command from prev→next.
    let prevCols = this.columnSnapshot();
    const onColChange = (): void => {
      if (this.suspended()) {
        prevCols = this.columnSnapshot();
        return;
      }
      const before = prevCols;
      const after = this.columnSnapshot();
      prevCols = after;
      // eslint-disable-next-line @typescript-eslint/no-this-alias
      const self = this;
      this.push({
        kind: 'columnState',
        label: 'Column change',
        time: Date.now(),
        undo() {
          self.applyColumnSnapshot(before);
          prevCols = before;
        },
        redo() {
          self.applyColumnSnapshot(after);
          prevCols = after;
        },
      });
    };
    this.disposers.add(grid.on('columnResize', onColChange));
    this.disposers.add(grid.on('columnReorder', onColChange));

    // Sort.
    let prevSort: SortState[] = this.readSort();
    this.disposers.add(
      grid.on('sortChange', (e) => {
        if (this.suspended()) {
          prevSort = e.sort.map((s) => ({ ...s }));
          return;
        }
        const before = prevSort;
        const after = e.sort.map((s) => ({ ...s }));
        prevSort = after;
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        const self = this;
        this.push({
          kind: 'sort',
          label: 'Sort',
          time: Date.now(),
          undo() {
            self.applySort(before);
            prevSort = before;
          },
          redo() {
            self.applySort(after);
            prevSort = after;
          },
        });
      }),
    );

    // Filter.
    let prevFilter: FilterState[] = this.readFilter();
    this.disposers.add(
      grid.on('filterChange', (e) => {
        if (this.suspended()) {
          prevFilter = e.filter.map((f) => ({ ...f }));
          return;
        }
        const before = prevFilter;
        const after = e.filter.map((f) => ({ ...f }));
        prevFilter = after;
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        const self = this;
        this.push({
          kind: 'filter',
          label: 'Filter',
          time: Date.now(),
          undo() {
            self.applyFilter(before);
            prevFilter = before;
          },
          redo() {
            self.applyFilter(after);
            prevFilter = after;
          },
        });
      }),
    );

    // Group.
    let prevGroup: GroupState = this.readGroup();
    this.disposers.add(
      grid.on('groupChange', (e) => {
        if (this.suspended()) {
          prevGroup = cloneGroup(e.group);
          return;
        }
        const before = prevGroup;
        const after = cloneGroup(e.group);
        prevGroup = after;
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        const self = this;
        this.push({
          kind: 'group',
          label: 'Group',
          time: Date.now(),
          undo() {
            self.applyGroup(before);
            prevGroup = before;
          },
          redo() {
            self.applyGroup(after);
            prevGroup = after;
          },
        });
      }),
    );
  }

  /* ── feature delegation for state restore ───────────────────────────── */

  private readSort(): SortState[] {
    const f = this.api.features.get('sort') as { getState?(): SortState[] } | undefined;
    return f?.getState ? f.getState().map((s) => ({ ...s })) : [];
  }
  private applySort(state: SortState[]): void {
    const f = this.api.features.get('sort') as { setState?(s: SortState[]): void } | undefined;
    f?.setState?.(state.map((s) => ({ ...s })));
  }
  private readFilter(): FilterState[] {
    const f = this.api.features.get('filter') as { getState?(): FilterState[] } | undefined;
    return f?.getState ? f.getState().map((s) => ({ ...s })) : [];
  }
  private applyFilter(state: FilterState[]): void {
    const f = this.api.features.get('filter') as { setState?(s: FilterState[]): void } | undefined;
    f?.setState?.(state.map((s) => ({ ...s })));
  }
  private readGroup(): GroupState {
    const f = this.api.features.get('group') as { getState?(): GroupState } | undefined;
    return f?.getState ? cloneGroup(f.getState()) : { columnIds: [] };
  }
  private applyGroup(state: GroupState): void {
    const f = this.api.features.get('group') as { setState?(s: GroupState): void } | undefined;
    f?.setState?.(cloneGroup(state));
  }

  /* ── keyboard ───────────────────────────────────────────────────────── */

  private wireKeyboard(): void {
    const handler = (ev: KeyboardEvent): void => {
      if (!(ev.ctrlKey || ev.metaKey)) return;
      // Don't steal native undo while typing in an editor / field.
      if (isEditableTarget(ev.target)) return;
      const key = ev.key.toLowerCase();
      if (key === 'z' && !ev.shiftKey) {
        ev.preventDefault();
        this.undo();
      } else if (key === 'y' || (key === 'z' && ev.shiftKey)) {
        ev.preventDefault();
        this.redo();
      }
    };
    this.api.el.addEventListener('keydown', handler);
    this.disposers.add(() => this.api.el.removeEventListener('keydown', handler));
  }

  /* ── stack management ──────────────────────────────────────────────── */

  private push(cmd: UndoCommand): void {
    // Any new user action invalidates the redo branch.
    if (this.redoStack.length > 0) this.redoStack.length = 0;

    // Try to merge with the previous command (typing in one cell).
    const top = this.undoStack[this.undoStack.length - 1];
    if (
      top &&
      this.mergeWindow > 0 &&
      cmd.time - top.time <= this.mergeWindow &&
      typeof top.mergeWith === 'function'
    ) {
      const merged = top.mergeWith(cmd);
      if (merged) {
        this.undoStack[this.undoStack.length - 1] = merged;
        this.emitState();
        return;
      }
    }

    this.undoStack.push(cmd);
    if (this.limit > 0 && this.undoStack.length > this.limit) {
      this.undoStack.splice(0, this.undoStack.length - this.limit);
    }
    this.emitState();
  }

  private commitBatch(): void {
    const edits = this.batchEdits;
    const label = this.batchLabel;
    this.batchEdits = null;
    this.batchLabel = '';
    if (!edits || edits.length === 0) return;
    this.pushEditBatch(label || pasteLabel(edits), edits);
  }

  private pushEditBatch(label: string, edits: FieldEdit[]): void {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    this.push({
      kind: 'edit',
      label,
      time: Date.now(),
      undo() {
        self.applyFieldEdits(edits, 'before');
      },
      redo() {
        self.applyFieldEdits(edits, 'after');
      },
    });
  }

  /* ── shadow bookkeeping ─────────────────────────────────────────────── */

  private suspended(): boolean {
    return this.applying > 0;
  }

  private idOf(row: Row): RecordId {
    return row[this.api.store.idField] as RecordId;
  }

  private seedShadow(): void {
    this.shadow.clear();
    for (const r of this.api.store.toArray()) {
      this.shadow.set(this.idOf(r), { ...r });
    }
  }

  /** Refresh the shadow for a single record from the live store. */
  private refreshShadow(id: RecordId): void {
    const rec = this.api.store.getById(id);
    if (rec) this.shadow.set(id, { ...rec });
    else this.shadow.delete(id);
  }

  /** Re-sync the entire shadow (after an undo/redo applies many changes). */
  private syncShadow(): void {
    this.seedShadow();
  }

  private emitState(): void {
    if (this.stateListeners.size === 0) return;
    const snap = this.getState();
    for (const fn of this.stateListeners) fn(snap);
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   Helpers
   ═══════════════════════════════════════════════════════════════════════════ */

function editLabel<Row extends Model>(edits: FieldEdit[], api: GridApi<Row>): string {
  if (edits.length === 1) {
    const col = api.columns.find((c) => c.field === edits[0]!.field || c.id === edits[0]!.field);
    const name = col?.header ?? edits[0]!.field;
    return `Edit ${name}`;
  }
  return pasteLabel(edits);
}

function pasteLabel(edits: FieldEdit[]): string {
  return `Edit ${edits.length} cell${edits.length === 1 ? '' : 's'}`;
}

function cloneGroup(g: GroupState): GroupState {
  return {
    columnIds: [...(g.columnIds ?? [])],
    ...(g.collapsed ? { collapsed: [...g.collapsed] } : {}),
  };
}

/** True when an event target is a text input / editable region we must not hijack. */
function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.closest !== 'function') return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  // Inside an active inline editor mounted by the engine.
  return el.closest('.jects-grid__editor, [contenteditable="true"]') != null;
}

/** Convenience factory. */
export function undoRedoFeature<Row extends Model = Model>(
  options?: UndoRedoFeatureOptions,
): UndoRedoFeature<Row> {
  return new UndoRedoFeature<Row>(options);
}
