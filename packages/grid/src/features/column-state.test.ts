/** jsdom unit tests for ColumnStateFeature (order/width/visibility/sort/filter). */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ColumnDef } from '../contract.js';
import { ColumnStateFeature, type ColumnState } from './column-state.js';
import { SortFeature } from './sort.js';
import { FilterFeature } from './filter.js';
import { GroupFeature } from './group.js';
import { makeHarness, makeStore, type FeatureHarness } from './test-harness.js';

interface Row {
  id: number;
  a: string;
  b: string;
  c: number;
}

const ROWS: Row[] = [
  { id: 1, a: 'x', b: 'p', c: 1 },
  { id: 2, a: 'y', b: 'q', c: 2 },
];

const COLUMNS: ColumnDef<Row>[] = [
  { field: 'a', header: 'A', id: 'a', width: 100 },
  { field: 'b', header: 'B', id: 'b', width: 120 },
  { field: 'c', header: 'C', id: 'c', type: 'number', width: 80 },
];

let h: FeatureHarness<Row>;
beforeEach(() => {
  h = makeHarness<Row>({ store: makeStore(ROWS), columns: COLUMNS });
});
afterEach(() => h.destroy());

const order = (): string[] => h.api.columns.map((c) => c.id!);

class MemStorage {
  private map = new Map<string, string>();
  getItem(k: string): string | null {
    return this.map.has(k) ? this.map.get(k)! : null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, v);
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
}

describe('ColumnStateFeature (jsdom)', () => {
  it('getState captures order, width and visibility', () => {
    const f = h.api.use(new ColumnStateFeature<Row>()) as ColumnStateFeature<Row>;
    const state = f.getState();
    expect(state.order).toEqual(['a', 'b', 'c']);
    expect(state.columns['a']!.width).toBe(100);
    expect(state.version).toBe(1);
  });

  it('setVisible / setWidth / setFrozen patch columns', () => {
    const f = h.api.use(new ColumnStateFeature<Row>()) as ColumnStateFeature<Row>;
    f.setVisible('b', false);
    f.setWidth('a', 222);
    f.setFrozen('c', 'left');
    expect(h.api.getColumn('b')!.hidden).toBe(true);
    expect(h.api.getColumn('a')!.width).toBe(222);
    expect(h.api.getColumn('c')!.frozen).toBe('left');
  });

  it('moveColumn reorders and emits columnReorder', () => {
    const f = h.api.use(new ColumnStateFeature<Row>()) as ColumnStateFeature<Row>;
    const spy = vi.fn();
    h.api.on('columnReorder', spy);
    f.moveColumn(0, 2); // a → end
    expect(order()).toEqual(['b', 'c', 'a']);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0]).toMatchObject({ columnId: 'a', fromIndex: 0, toIndex: 2 });
  });

  it('moveColumnBefore positions relative to another column', () => {
    const f = h.api.use(new ColumnStateFeature<Row>()) as ColumnStateFeature<Row>;
    f.moveColumnBefore('c', 'a');
    expect(order()).toEqual(['c', 'a', 'b']);
  });

  it('applyState restores order + geometry', () => {
    const f = h.api.use(new ColumnStateFeature<Row>()) as ColumnStateFeature<Row>;
    const state: ColumnState = {
      version: 1,
      order: ['c', 'b', 'a'],
      columns: {
        a: { id: 'a', width: 999, hidden: true },
        b: { id: 'b', width: 50 },
        c: { id: 'c', width: 60 },
      },
    };
    f.applyState(state, false);
    expect(order()).toEqual(['c', 'b', 'a']);
    expect(h.api.getColumn('a')!.width).toBe(999);
    expect(h.api.getColumn('a')!.hidden).toBe(true);
  });

  it('round-trips sort + filter state through their features', () => {
    const sort = h.api.use(new SortFeature<Row>()) as SortFeature<Row>;
    const filter = h.api.use(new FilterFeature<Row>()) as FilterFeature<Row>;
    const cs = h.api.use(new ColumnStateFeature<Row>()) as ColumnStateFeature<Row>;

    sort.toggle('a'); // asc
    filter.setColumnFilter('c', 'gte', 2);
    const json = cs.serialize();

    // Mutate, then restore.
    sort.clear();
    filter.clear();
    cs.deserialize(json);

    expect(sort.getState()).toEqual([{ columnId: 'a', direction: 'asc' }]);
    expect(filter.getState()).toEqual([{ columnId: 'c', operator: 'gte', value: 2 }]);
  });

  it('captures group state (group-by columns + collapsed keys)', () => {
    const group = h.api.use(new GroupFeature<Row>()) as GroupFeature<Row>;
    const cs = h.api.use(new ColumnStateFeature<Row>()) as ColumnStateFeature<Row>;

    group.setGroups(['a']);
    // Collapse a real group node by its key.
    const key = group.getViewRows().find((r) => r.kind === 'group')!.key;
    group.toggleGroup(key);

    const state = cs.getState();
    expect(state.group).toEqual({ columnIds: ['a'], collapsed: [key] });
  });

  it('round-trips group state (grouping + collapsed) through the GroupFeature', () => {
    const group = h.api.use(new GroupFeature<Row>()) as GroupFeature<Row>;
    const cs = h.api.use(new ColumnStateFeature<Row>()) as ColumnStateFeature<Row>;

    group.setGroups(['a']);
    const key = group.getViewRows().find((r) => r.kind === 'group')!.key;
    group.toggleGroup(key);
    expect(group.isCollapsed(key)).toBe(true);
    const json = cs.serialize();

    // Mutate, then restore.
    group.clear();
    expect(group.getColumns()).toEqual([]);
    cs.deserialize(json);

    expect(group.getColumns()).toEqual(['a']);
    expect(group.isCollapsed(key)).toBe(true);
  });

  it('auto-persists to storage and restores on init', () => {
    const storage = new MemStorage();
    const f1 = h.api.use(
      new ColumnStateFeature<Row>({ storageKey: 'grid', storage, debounce: 0 }),
    ) as ColumnStateFeature<Row>;
    f1.setWidth('a', 321);
    f1.persistNow();
    expect(storage.getItem('grid')).toBeTruthy();

    // New harness with the same storage restores width.
    const h2 = makeHarness<Row>({ store: makeStore(ROWS), columns: COLUMNS });
    h2.api.use(new ColumnStateFeature<Row>({ storageKey: 'grid', storage }));
    expect(h2.api.getColumn('a')!.width).toBe(321);
    h2.destroy();
  });

  it('reset clears storage', () => {
    const storage = new MemStorage();
    const f = h.api.use(
      new ColumnStateFeature<Row>({ storageKey: 'grid', storage }),
    ) as ColumnStateFeature<Row>;
    f.persistNow();
    expect(storage.getItem('grid')).toBeTruthy();
    f.reset();
    expect(storage.getItem('grid')).toBeNull();
  });

  it('destroy flushes a pending debounced persist', () => {
    const storage = new MemStorage();
    const f = h.api.use(
      new ColumnStateFeature<Row>({ storageKey: 'grid', storage, debounce: 9999 }),
    ) as ColumnStateFeature<Row>;
    f.setWidth('a', 444); // schedules a debounced persist
    expect(storage.getItem('grid')).toBeNull();
    f.destroy();
    expect(storage.getItem('grid')).toBeTruthy();
    expect(JSON.parse(storage.getItem('grid')!).columns.a.width).toBe(444);
  });
});
