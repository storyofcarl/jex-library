/**
 * ColumnStateFeature — persist & restore grid column state for @jects/grid.
 *
 * Captures per-column order, width, visibility, and frozen edge, plus the
 * active sort and filter directives (read from the Sort/Filter features when
 * present). The snapshot can be serialized to JSON and rehydrated later —
 * persisted to `localStorage` automatically when a `storageKey` is given, or
 * driven manually via `getState()`/`applyState()`.
 *
 * Mutators (`setVisible`, `setWidth`, `moveColumn`, `setFrozen`) go through
 * `GridApi.updateColumn`/`setColumns` so the engine re-resolves geometry, and
 * persistence is debounced. Everything is confined to `GridApi`; the storage
 * write timer and any subscriptions are released on `destroy()`.
 */

import type { Model } from '@jects/core';
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
import type { SortFeature } from './sort.js';
import type { FilterFeature } from './filter.js';
import type { GroupFeature } from './group.js';

/** One column's persisted geometry. */
export interface ColumnSnapshot {
  id: string;
  width?: number;
  hidden?: boolean;
  frozen?: FrozenSide | null;
}

/** Full persisted state. */
export interface ColumnState {
  /** Column ids in display order. */
  order: string[];
  /** Per-column geometry, keyed by id. */
  columns: Record<string, ColumnSnapshot>;
  /** Active sort directives (if a SortFeature is installed). */
  sort?: SortState[];
  /** Active filter directives (if a FilterFeature is installed). */
  filter?: FilterState[];
  /**
   * Active grouping state — group-by column ids + collapsed group keys (if a
   * GroupFeature is installed), so collapsed/grouped state round-trips.
   */
  group?: GroupState;
  /** Schema version for forward-compatible migrations. */
  version: number;
}

const STATE_VERSION = 1;

export interface ColumnStateFeatureOptions {
  /** localStorage key. When set, state auto-persists on change. */
  storageKey?: string;
  /** Persist debounce (ms). Default `150`. */
  debounce?: number;
  /** Custom storage (defaults to `localStorage` when available). */
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  /** Apply any persisted state during `init`. Default `true`. */
  autoRestore?: boolean;
}

function defaultStorage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch {
    /* access can throw in sandboxed contexts */
  }
  return null;
}

export class ColumnStateFeature<Row extends Model = Model> implements GridFeature<Row> {
  readonly name = 'columnState';

  private api!: GridApi<Row>;
  private readonly disposers = new Disposers();
  private readonly storageKey?: string;
  private readonly storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
  private readonly debounceMs: number;
  private readonly autoRestore: boolean;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: ColumnStateFeatureOptions = {}) {
    if (options.storageKey != null) this.storageKey = options.storageKey;
    this.storage = options.storage ?? defaultStorage();
    this.debounceMs = options.debounce ?? 150;
    this.autoRestore = options.autoRestore ?? true;
  }

  init(grid: GridApi<Row>): void {
    this.api = grid;
    grid.track(() => this.disposers.dispose());
    this.disposers.add(() => {
      if (this.timer != null) clearTimeout(this.timer);
    });

    if (this.autoRestore && this.storageKey && this.storage) {
      const raw = this.storage.getItem(this.storageKey);
      if (raw) {
        try {
          this.applyState(JSON.parse(raw) as ColumnState, /*persist*/ false);
        } catch {
          /* corrupt state — ignore and start fresh */
        }
      }
    }

    // Persist when sort/filter/group/geometry change.
    const offSort = grid.on('sortChange', () => this.schedulePersist());
    const offFilter = grid.on('filterChange', () => this.schedulePersist());
    const offGroup = grid.on('groupChange', () => this.schedulePersist());
    const offResize = grid.on('columnResize', () => this.schedulePersist());
    const offReorder = grid.on('columnReorder', () => this.schedulePersist());
    this.disposers.add(offSort);
    this.disposers.add(offFilter);
    this.disposers.add(offGroup);
    this.disposers.add(offResize);
    this.disposers.add(offReorder);
  }

  /** Snapshot the current column + sort + filter state. */
  getState(): ColumnState {
    const order: string[] = [];
    const columns: Record<string, ColumnSnapshot> = {};
    for (const col of this.api.columns) {
      const id = colId(col);
      if (!id) continue;
      order.push(id);
      const snap: ColumnSnapshot = { id };
      if (col.width != null) snap.width = col.width;
      if (col.hidden != null) snap.hidden = col.hidden;
      snap.frozen = col.frozen ?? null;
      columns[id] = snap;
    }

    const state: ColumnState = { order, columns, version: STATE_VERSION };

    const sort = this.api.features.get('sort') as SortFeature<Row> | undefined;
    if (sort) state.sort = sort.getState();
    const filter = this.api.features.get('filter') as FilterFeature<Row> | undefined;
    if (filter) state.filter = filter.getState();
    const group = this.api.features.get('group') as GroupFeature<Row> | undefined;
    if (group) state.group = group.getState();

    return state;
  }

  /** Serialize the current state to a JSON string. */
  serialize(): string {
    return JSON.stringify(this.getState());
  }

  /** Apply a previously captured state. */
  applyState(state: ColumnState, persist = true): void {
    if (!state || !Array.isArray(state.order)) return;

    // Reorder + patch geometry. Build a new column array in persisted order,
    // appending any columns not present in the snapshot (new schema columns).
    const current = this.api.columns;
    const byId = new Map<string, ColumnDef<Row>>();
    for (const c of current) byId.set(colId(c), c);

    const next: ColumnDef<Row>[] = [];
    const used = new Set<string>();
    for (const id of state.order) {
      const col = byId.get(id);
      if (!col) continue;
      used.add(id);
      const snap = state.columns[id];
      next.push(applySnapshot(col, snap));
    }
    // Preserve columns the snapshot didn't know about (keep their order).
    for (const c of current) {
      const id = colId(c);
      if (!used.has(id)) next.push(c);
    }
    this.api.setColumns(next);

    // Restore sort / filter through their features.
    if (state.sort) {
      const sort = this.api.features.get('sort') as SortFeature<Row> | undefined;
      sort?.setState(state.sort);
    }
    if (state.filter) {
      const filter = this.api.features.get('filter') as FilterFeature<Row> | undefined;
      filter?.setState(state.filter);
    }

    // Restore grouping (group-by columns + collapsed group keys) when a
    // GroupFeature is installed. setGroups replaces the group-by list; collapsed
    // keys are then re-applied so collapsed/grouped state round-trips.
    if (state.group) {
      const group = this.api.features.get('group') as GroupFeature<Row> | undefined;
      if (group) {
        group.setGroups(state.group.columnIds);
        const want = new Set(state.group.collapsed ?? []);
        // Toggle each key whose current collapsed state differs from the target.
        const keys = new Set<string>([
          ...want,
          ...group.getState().collapsed ?? [],
        ]);
        for (const key of keys) {
          if (want.has(key) !== group.isCollapsed(key)) group.toggleGroup(key);
        }
      }
    }

    if (persist) this.schedulePersist();
  }

  /** Restore from JSON. */
  deserialize(json: string): void {
    try {
      this.applyState(JSON.parse(json) as ColumnState);
    } catch {
      /* ignore malformed input */
    }
  }

  /** Reset persisted state (and clear storage). */
  reset(): void {
    if (this.storageKey && this.storage) this.storage.removeItem(this.storageKey);
  }

  /* ── geometry mutators (drive the engine + persist) ─────────────────── */

  /** Show/hide a column. */
  setVisible(columnId: string, visible: boolean): void {
    this.api.updateColumn(columnId, { hidden: !visible } as Partial<ColumnDef<Row>>);
    this.schedulePersist();
  }

  /** Set a column's width (px). */
  setWidth(columnId: string, width: number): void {
    this.api.updateColumn(columnId, { width } as Partial<ColumnDef<Row>>);
    this.schedulePersist();
  }

  /** Pin/unpin a column to an edge. */
  setFrozen(columnId: string, frozen: FrozenSide | null): void {
    this.api.updateColumn(columnId, { frozen: frozen ?? undefined } as Partial<ColumnDef<Row>>);
    this.schedulePersist();
  }

  /** Move a column from one display index to another. */
  moveColumn(fromIndex: number, toIndex: number): void {
    const cols = [...this.api.columns];
    if (
      fromIndex < 0 ||
      fromIndex >= cols.length ||
      toIndex < 0 ||
      toIndex >= cols.length ||
      fromIndex === toIndex
    ) {
      return;
    }
    const [moved] = cols.splice(fromIndex, 1);
    cols.splice(toIndex, 0, moved!);
    this.api.setColumns(cols);
    this.api.emit('columnReorder', {
      columnId: colId(moved!),
      fromIndex,
      toIndex,
    });
    this.schedulePersist();
  }

  /** Move a column (by id) before another column (by id). */
  moveColumnBefore(columnId: string, beforeColumnId: string): void {
    const cols = [...this.api.columns];
    const from = cols.findIndex((c) => colId(c) === columnId);
    let to = cols.findIndex((c) => colId(c) === beforeColumnId);
    if (from < 0 || to < 0) return;
    if (from < to) to -= 1;
    this.moveColumn(from, to);
  }

  private schedulePersist(): void {
    if (!this.storageKey || !this.storage) return;
    if (this.timer != null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.persistNow();
    }, this.debounceMs);
  }

  /** Persist immediately (bypasses debounce). */
  persistNow(): void {
    if (!this.storageKey || !this.storage) return;
    try {
      this.storage.setItem(this.storageKey, this.serialize());
    } catch {
      /* storage full / unavailable — non-fatal */
    }
  }

  destroy(): void {
    // Flush a pending persist so state isn't lost on teardown.
    if (this.timer != null) {
      clearTimeout(this.timer);
      this.timer = null;
      this.persistNow();
    }
    this.disposers.dispose();
  }
}

function applySnapshot<Row extends Model>(
  col: ColumnDef<Row>,
  snap: ColumnSnapshot | undefined,
): ColumnDef<Row> {
  if (!snap) return col;
  const next: ColumnDef<Row> = { ...col };
  if (snap.width != null) next.width = snap.width;
  if (snap.hidden != null) next.hidden = snap.hidden;
  if (snap.frozen != null) next.frozen = snap.frozen;
  else if (snap.frozen === null) delete next.frozen;
  return next;
}

/** Convenience factory. */
export function columnStateFeature<Row extends Model = Model>(
  options?: ColumnStateFeatureOptions,
): ColumnStateFeature<Row> {
  return new ColumnStateFeature<Row>(options);
}
