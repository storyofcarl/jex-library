import { describe, it, expect } from 'vitest';
import { Store, TreeStore } from '@jects/core';
import { RowModel } from './row-model.js';

interface Row {
  id: number;
  name: string;
}

describe('RowModel', () => {
  it('wraps a raw array', () => {
    const rm = new RowModel<Row>([{ id: 1, name: 'a' }, { id: 2, name: 'b' }]);
    expect(rm.tree).toBe(false);
    expect(rm.count).toBe(2);
    expect(rm.rowAt(1)?.name).toBe('b');
    expect(rm.indexOf(2)).toBe(1);
    expect(rm.rowById(1)?.name).toBe('a');
  });

  it('binds to a Store and reflects filtered view after invalidate', () => {
    const store = new Store<Row>({ data: [{ id: 1, name: 'a' }, { id: 2, name: 'b' }] });
    const rm = new RowModel<Row>(store);
    expect(rm.count).toBe(2);
    store.filter((r) => r.name === 'a');
    rm.invalidate();
    expect(rm.count).toBe(1);
    expect(rm.rowAt(0)?.name).toBe('a');
  });

  it('uses a custom idField for raw arrays', () => {
    const rm = new RowModel([{ key: 7, name: 'x' }] as never[], { idField: 'key' });
    expect(rm.indexOf(7)).toBe(0);
  });

  it('tree mode exposes only visible rows with depth', () => {
    const tree = new TreeStore({
      data: [
        { id: 'a', name: 'A', children: [{ id: 'a1', name: 'A1' }] },
        { id: 'b', name: 'B' },
      ],
      expanded: ['a'],
    });
    const rm2 = new RowModel(tree as never, { treeMode: true });
    // a, a1, b visible (a expanded)
    expect(rm2.count).toBe(3);
    expect(rm2.entryAt(0)?.depth).toBe(0);
    expect(rm2.entryAt(1)?.depth).toBe(1);
    expect(rm2.entryAt(1)?.id).toBe('a1');
  });

  it('returns -1 for unknown id', () => {
    const rm = new RowModel<Row>([{ id: 1, name: 'a' }]);
    expect(rm.indexOf(999)).toBe(-1);
  });

  it('auto-wraps a raw array into a TreeStore when treeMode is enabled', async () => {
    // DX: `new Grid(el, { data: array, treeMode: true })` should work without the
    // caller constructing a TreeStore (mirrors the flat-Store auto-wrap).
    const rm = new RowModel(
      [
        { id: 'a', name: 'A', children: [{ id: 'a1', name: 'A1' }] },
        { id: 'b', name: 'B' },
      ] as never[],
      { treeMode: true },
    );
    expect(rm.tree).toBe(true);
    expect(rm.store).toBeInstanceOf(TreeStore);
    // Collapsed by default: only the two roots are visible.
    expect(rm.count).toBe(2);
    expect(rm.entryAt(0)?.id).toBe('a');
    expect(rm.entryAt(0)?.hasChildren).toBe(true);
    expect(rm.entryAt(1)?.id).toBe('b');
    expect(rm.entryAt(1)?.hasChildren).toBe(false);
    // Expanding a root reveals its child at depth 1.
    await (rm.store as unknown as { expand: (id: string) => Promise<void> }).expand('a');
    rm.invalidate();
    expect(rm.count).toBe(3);
    expect(rm.entryAt(1)?.id).toBe('a1');
    expect(rm.entryAt(1)?.depth).toBe(1);
  });

  it('honors a custom idField when auto-wrapping an array in tree mode', () => {
    const rm = new RowModel([{ key: 'r', name: 'Root' }] as never[], {
      treeMode: true,
      idField: 'key',
    });
    expect(rm.tree).toBe(true);
    expect(rm.store).toBeInstanceOf(TreeStore);
    expect(rm.indexOf('r')).toBe(0);
  });
});
