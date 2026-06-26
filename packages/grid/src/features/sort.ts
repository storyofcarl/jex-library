/**
 * SortFeature — multi-column sorting plugin for @jects/grid.
 *
 * Maintains an ordered list of `SortState` directives (primary, secondary, …).
 * Clicking a sortable header cycles asc → desc → none. With the modifier key
 * (shift/ctrl/meta) held, additional columns are appended to the sort instead
 * of replacing it, giving a stable multi-key sort.
 *
 * The feature drives the backing `Store` via a single composite comparator and
 * repaints through `api.refresh()`, then emits the contract's `sortChange`
 * event. All wiring is confined to `GridApi`; `destroy()` releases every
 * listener it added.
 */

import type { Model, RecordId } from '@jects/core';
import type { ColumnDef, GridApi, GridFeature, SortState } from '../contract.js';
import { Disposers, compareValues, getValue } from './shared.js';

export interface SortFeatureOptions {
  /** Allow more than one active sort column. Default `true`. */
  multi?: boolean;
  /** Initial sort directives. */
  initial?: SortState[];
  /**
   * Header-click modifier that *adds* a column to a multi-sort (instead of
   * replacing). Default: any of shift/ctrl/meta.
   */
  multiSortKey?: (e: MouseEvent | KeyboardEvent) => boolean;
}

const defaultMultiKey = (e: MouseEvent | KeyboardEvent): boolean =>
  e.shiftKey || e.ctrlKey || e.metaKey;

export class SortFeature<Row extends Model = Model> implements GridFeature<Row> {
  readonly name = 'sort';

  private api!: GridApi<Row>;
  private readonly disposers = new Disposers();
  private state: SortState[] = [];
  private readonly multi: boolean;
  private readonly multiSortKey: (e: MouseEvent | KeyboardEvent) => boolean;
  /**
   * Snapshot of the store's *natural* (pre-sort) row order, captured as
   * `id → original position` the first time we are about to mutate that order.
   * `Store.sort` mutates `all` in place and keeps no original-order snapshot, so
   * a constant-0 comparator only preserves the CURRENT order. To honor the
   * documented asc → desc → none cycle we must restore this captured order
   * explicitly on clear.
   */
  private naturalOrder: Map<RecordId, number> | null = null;

  constructor(options: SortFeatureOptions = {}) {
    this.multi = options.multi ?? true;
    this.multiSortKey = options.multiSortKey ?? defaultMultiKey;
    if (options.initial) this.state = options.initial.map((s) => ({ ...s }));
  }

  init(grid: GridApi<Row>): void {
    this.api = grid;
    grid.track(() => this.disposers.dispose());
    if (this.state.length) this.apply();
  }

  /** Current sort directives (a defensive copy). */
  getState(): SortState[] {
    return this.state.map((s) => ({ ...s }));
  }

  /** Direction currently applied to a column, or `null`. */
  directionOf(columnId: string): 'asc' | 'desc' | null {
    return this.state.find((s) => s.columnId === columnId)?.direction ?? null;
  }

  /** 1-based position of a column within a multi-sort, or 0 if not sorted. */
  priorityOf(columnId: string): number {
    const i = this.state.findIndex((s) => s.columnId === columnId);
    return i < 0 ? 0 : i + 1;
  }

  /** Replace the whole sort state. */
  setState(state: SortState[]): void {
    this.state = state.map((s) => ({ ...s }));
    this.apply();
    this.emitChange();
  }

  /** Clear all sorting (restores the captured natural order). */
  clear(): void {
    if (this.state.length === 0) return;
    this.state = [];
    this.restoreNaturalOrder();
    this.api.refresh();
    this.emitChange();
  }

  /**
   * Capture the store's current order as the natural baseline, the first time we
   * are about to sort. Idempotent: once captured it is never overwritten by a
   * later (already-sorted) order, so `restoreNaturalOrder` always returns to the
   * true original insertion order.
   */
  private captureNaturalOrder(): void {
    if (this.naturalOrder) return;
    const order = new Map<RecordId, number>();
    const idField = this.api.store.idField;
    this.api.store.toArray().forEach((row, i) => {
      order.set((row as Model)[idField] as RecordId, i);
    });
    this.naturalOrder = order;
  }

  /**
   * Restore the captured natural order by sorting on the original positions.
   * A stable no-op comparator cannot do this because `Store.sort` mutates order
   * in place with no original-order snapshot — we must sort by the captured
   * index explicitly. Rows added after capture (unknown ids) sort last, in their
   * current relative order.
   */
  private restoreNaturalOrder(): void {
    const order = this.naturalOrder;
    if (!order) {
      // Never sorted → order is already natural.
      return;
    }
    const idField = this.api.store.idField;
    const posOf = (row: Row): number => {
      const id = (row as Model)[idField] as RecordId;
      const p = order.get(id);
      return p === undefined ? Number.MAX_SAFE_INTEGER : p;
    };
    this.api.store.sort((a, b) => posOf(a) - posOf(b));
  }

  /**
   * Toggle a column through asc → desc → none. When `additive` (or the multi
   * modifier was held), the column is added to / updated within the existing
   * multi-sort; otherwise it replaces the sort.
   */
  toggle(columnId: string, additive = false): void {
    const col = this.api.getColumn(columnId);
    if (col && col.sortable === false) return;

    const useMulti = this.multi && additive;
    const existing = this.state.find((s) => s.columnId === columnId);

    if (!useMulti) {
      if (!existing) {
        this.state = [{ columnId, direction: 'asc' }];
      } else if (existing.direction === 'asc') {
        this.state = [{ columnId, direction: 'desc' }];
      } else {
        this.state = [];
      }
    } else {
      if (!existing) {
        this.state = [...this.state, { columnId, direction: 'asc' }];
      } else if (existing.direction === 'asc') {
        this.state = this.state.map((s) =>
          s.columnId === columnId ? { ...s, direction: 'desc' } : s,
        );
      } else {
        this.state = this.state.filter((s) => s.columnId !== columnId);
      }
    }

    this.apply();
    this.emitChange();
  }

  /** Sort the store using the current multi-key comparator. */
  private apply(): void {
    // Snapshot the natural order before the first mutation so `none`/clear can
    // restore it (a constant-0 comparator would only keep the current order).
    this.captureNaturalOrder();

    if (this.state.length === 0) {
      this.restoreNaturalOrder();
      this.api.refresh();
      return;
    }
    const directives = this.state
      .map((s) => ({ column: this.api.getColumn(s.columnId), direction: s.direction }))
      .filter((d): d is { column: ColumnDef<Row>; direction: 'asc' | 'desc' } => !!d.column);

    this.api.store.sort((a, b) => {
      for (const { column, direction } of directives) {
        const cmp = compareValues(getValue(a, column), getValue(b, column));
        if (cmp !== 0) return direction === 'desc' ? -cmp : cmp;
      }
      return 0;
    });
    this.api.refresh();
  }

  /**
   * Notify the engine that a sortable header was activated. Engines forward
   * pointer/keyboard header events here; the modifier on the event decides
   * additive vs replace.
   */
  handleHeaderActivate(columnId: string, event?: MouseEvent | KeyboardEvent): void {
    const additive = event ? this.multiSortKey(event) : false;
    this.toggle(columnId, additive);
  }

  private emitChange(): void {
    this.api.emit('sortChange', { sort: this.getState() });
  }

  destroy(): void {
    this.disposers.dispose();
    this.state = [];
  }
}

/** Convenience factory. */
export function sortFeature<Row extends Model = Model>(
  options?: SortFeatureOptions,
): SortFeature<Row> {
  return new SortFeature<Row>(options);
}
