import { describe, it, expect } from 'vitest';
import { Store, TreeStore } from '@jects/core';
import { GridEngine } from './engine.js';
import type { ColumnDef } from '../contract.js';

interface Row {
  id: number;
  name: string;
  age: number;
}

const cols: ColumnDef<Row>[] = [
  { field: 'name', width: 120 },
  { field: 'age', width: 80 },
];

function rows(n: number): Row[] {
  return Array.from({ length: n }, (_, i) => ({ id: i, name: `r${i}`, age: i % 50 }));
}

describe('GridEngine: fixed-height virtualization', () => {
  it('computes a small window for a large dataset', () => {
    const engine = new GridEngine<Row>({ data: rows(50_000), columns: cols, rowHeight: 20 });
    engine.setViewportSize(400, 200);
    engine.setScroll(10_000, 0);
    const w = engine.computeViewportWindow();
    // 200/20 = 10 visible rows; window is small + overscan, NOT 50k.
    expect(w.endIndex - w.startIndex).toBeLessThan(30);
    expect(w.totalSize).toBe(50_000 * 20);
    // first visible at 10000/20 = 500; window brackets it
    expect(w.startIndex).toBeLessThanOrEqual(500);
    expect(w.endIndex).toBeGreaterThanOrEqual(500);
  });

  it('offset aligns with startIndex * rowHeight', () => {
    const engine = new GridEngine<Row>({ data: rows(1000), columns: cols, rowHeight: 30 });
    engine.setViewportSize(300, 300);
    engine.setScroll(900, 0);
    const w = engine.computeViewportWindow();
    expect(w.offset).toBe(w.startIndex * 30);
  });

  it('clamps scroll past the end', () => {
    const engine = new GridEngine<Row>({ data: rows(100), columns: cols, rowHeight: 20 });
    engine.setViewportSize(200, 200);
    engine.setScroll(999_999, 0);
    const w = engine.computeViewportWindow();
    expect(w.endIndex).toBe(99);
  });

  it('handles empty data', () => {
    const engine = new GridEngine<Row>({ data: [], columns: cols, rowHeight: 20 });
    engine.setViewportSize(200, 200);
    const w = engine.computeViewportWindow();
    expect(w.endIndex).toBe(-1);
    expect(w.totalSize).toBe(0);
    expect(engine.getRowCount()).toBe(0);
  });

  it('disabling virtualization renders the full range', () => {
    const engine = new GridEngine<Row>({
      data: rows(40),
      columns: cols,
      rowHeight: 20,
      virtualization: { enabled: false },
    });
    engine.setViewportSize(200, 100);
    const w = engine.computeViewportWindow();
    expect(w.startIndex).toBe(0);
    expect(w.endIndex).toBe(39);
  });
});

describe('GridEngine: variable-height virtualization', () => {
  it('uses OffsetIndex and reflects measured sizes', () => {
    const engine = new GridEngine<Row>({
      data: rows(1000),
      columns: cols,
      rowHeight: 20,
      virtualization: { variableRowHeight: true },
    });
    engine.setViewportSize(200, 200);
    // default total = 1000 * 20
    expect(engine.totalSize()).toBe(20_000);
    engine.measureRow(0, 60);
    expect(engine.rowSize(0)).toBe(60);
    expect(engine.rowOffset(1)).toBe(60);
    expect(engine.totalSize()).toBe(20_000 + 40);
  });

  it('window respects variable heights', () => {
    const engine = new GridEngine<Row>({
      data: rows(500),
      columns: cols,
      rowHeight: 10,
      virtualization: { variableRowHeight: true, overscan: 2 },
    });
    engine.setViewportSize(200, 100);
    engine.setScroll(0, 0);
    const w = engine.computeViewportWindow();
    expect(w.startIndex).toBe(0);
    expect(w.endIndex).toBeGreaterThan(0);
    expect(w.endIndex).toBeLessThan(30);
  });
});

describe('GridEngine: columns', () => {
  it('resolves column geometry and getRowIndex/getRow', () => {
    const engine = new GridEngine<Row>({ data: rows(10), columns: cols, rowHeight: 20 });
    expect(engine.columns).toHaveLength(2);
    expect(engine.getRow(3)?.name).toBe('r3');
    expect(engine.getRowIndex(3)).toBe(3);
    expect(engine.getRowById(3)?.age).toBe(3);
  });

  it('setColumns / updateColumn re-resolve geometry', () => {
    const engine = new GridEngine<Row>({ data: rows(5), columns: cols, rowHeight: 20 });
    engine.updateColumn('age', { hidden: true });
    expect(engine.columns).toHaveLength(1);
    engine.setColumns([{ field: 'name', width: 200 }]);
    expect(engine.columns[0]!.width).toBe(200);
  });

  it('flex columns re-flow when viewport width changes', () => {
    const engine = new GridEngine<Row>({
      data: rows(5),
      columns: [{ field: 'name', flex: 1 }],
      rowHeight: 20,
    });
    engine.setViewportSize(500, 200);
    expect(engine.columns[0]!.width).toBe(500);
    engine.setViewportSize(800, 200);
    expect(engine.columns[0]!.width).toBe(800);
  });
});

describe('GridEngine: data sources', () => {
  it('wraps a raw array in a Store', () => {
    const engine = new GridEngine<Row>({ data: rows(3), columns: cols });
    expect(engine.getRowCount()).toBe(3);
    expect(engine.rowModel.store).toBeInstanceOf(Store);
  });

  it('binds to an existing Store and reflects its filtered view', () => {
    const store = new Store<Row>({ data: rows(10) });
    const engine = new GridEngine<Row>({ data: store, columns: cols });
    expect(engine.getRowCount()).toBe(10);
    store.filter({ field: 'age', operator: 'lt', value: 5 });
    engine.invalidateRows();
    expect(engine.getRowCount()).toBe(5);
  });

  it('binds to a TreeStore showing only visible (expanded) rows', () => {
    const tree = new TreeStore({
      data: [
        { id: 'a', name: 'A', children: [{ id: 'a1', name: 'A1' }, { id: 'a2', name: 'A2' }] },
        { id: 'b', name: 'B' },
      ],
    });
    const engine = new GridEngine({ data: tree, columns: [{ field: 'name', type: 'tree' }], treeMode: true });
    // collapsed: only roots visible
    expect(engine.getRowCount()).toBe(2);
    const entry = engine.getRowEntry(0)!;
    expect(entry.hasChildren).toBe(true);
    expect(entry.depth).toBe(0);
  });
});
