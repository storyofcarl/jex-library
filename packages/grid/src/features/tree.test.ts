/** jsdom unit tests for TreeFeature (tree-grid mode over a TreeStore). */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { TreeStore, type TreeNode } from '@jects/core';
import type { ColumnDef } from '../contract.js';
import { TreeFeature } from './tree.js';
import { makeHarness, type FeatureHarness } from './test-harness.js';

interface Node extends TreeNode {
  id: number;
  name: string;
  children?: Node[];
}

const TREE: Node[] = [
  {
    id: 1,
    name: 'Root A',
    children: [
      { id: 2, name: 'A-1' },
      { id: 3, name: 'A-2', children: [{ id: 4, name: 'A-2-1' }] },
    ],
  },
  { id: 5, name: 'Root B' },
];

const COLUMNS: ColumnDef<Node>[] = [
  { field: 'name', header: 'Name', type: 'tree', id: 'name' },
];

function makeTreeHarness(opts?: {
  loader?: (n: Node) => Promise<Node[]>;
  expanded?: number[];
  data?: Node[];
}): FeatureHarness<Node> & { store: TreeStore<Node> } {
  const store = new TreeStore<Node>({
    data: opts?.data ?? TREE,
    idField: 'id',
    ...(opts?.loader ? { loader: opts.loader } : {}),
    ...(opts?.expanded ? { expanded: opts.expanded } : {}),
  });
  const h = makeHarness<Node>({ store: store as unknown as never, columns: COLUMNS });
  return Object.assign(h, { store });
}

let h: ReturnType<typeof makeTreeHarness>;
afterEach(() => h?.destroy());

describe('TreeFeature (jsdom)', () => {
  it('requires a TreeStore data source', () => {
    const plain = makeHarness<Node>({
      store: { getById: () => undefined } as unknown as never,
      columns: COLUMNS,
    });
    expect(() => plain.api.use(new TreeFeature<Node>())).toThrow(/TreeStore/);
    plain.destroy();
  });

  it('shows only roots when nothing is expanded', () => {
    h = makeTreeHarness();
    const f = h.api.use(new TreeFeature<Node>()) as TreeFeature<Node>;
    const rows = f.getViewRows();
    expect(rows.map((r) => r.row.name)).toEqual(['Root A', 'Root B']);
    expect(rows[0]!.depth).toBe(0);
    expect(rows[0]!.leaf).toBe(false);
    expect(rows[1]!.leaf).toBe(true);
  });

  it('expand reveals children with increased depth', async () => {
    h = makeTreeHarness();
    const f = h.api.use(new TreeFeature<Node>()) as TreeFeature<Node>;
    await f.expand(1);
    const rows = f.getViewRows();
    expect(rows.map((r) => r.row.name)).toEqual(['Root A', 'A-1', 'A-2', 'Root B']);
    const a1 = rows.find((r) => r.row.name === 'A-1')!;
    expect(a1.depth).toBe(1);
  });

  it('toggle collapses an expanded node', async () => {
    h = makeTreeHarness({ expanded: [1] });
    const f = h.api.use(new TreeFeature<Node>()) as TreeFeature<Node>;
    expect(f.getViewRowCount()).toBe(4);
    await f.toggle(1);
    expect(f.getViewRowCount()).toBe(2);
  });

  it('emits rowExpand on expand/collapse', async () => {
    h = makeTreeHarness();
    const f = h.api.use(new TreeFeature<Node>()) as TreeFeature<Node>;
    const spy = vi.fn();
    h.api.on('rowExpand', spy);
    await f.expand(1);
    f.collapse(1);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls[0]![0].expanded).toBe(true);
    expect(spy.mock.calls[1]![0].expanded).toBe(false);
  });

  it('lazy loads children via the store loader on first expand', async () => {
    const loader = vi.fn(async (n: Node): Promise<Node[]> => {
      if (n.id === 10) return [{ id: 11, name: 'lazy child' }];
      return [];
    });
    h = makeTreeHarness({
      data: [{ id: 10, name: 'Lazy parent' }],
      loader,
    });
    const f = h.api.use(new TreeFeature<Node>()) as TreeFeature<Node>;
    await f.expand(10);
    expect(loader).toHaveBeenCalledTimes(1);
    const rows = f.getViewRows();
    expect(rows.map((r) => r.row.name)).toEqual(['Lazy parent', 'lazy child']);
  });

  it('renderTreeCell indents by depth and toggles for non-leaf', async () => {
    h = makeTreeHarness();
    const f = h.api.use(new TreeFeature<Node>()) as TreeFeature<Node>;
    await f.expand(1);
    const a1 = f.getViewRows().find((r) => r.row.name === 'A-1')!;
    const html = f.renderTreeCell(a1, COLUMNS[0]!);
    expect(html).toContain('padding-inline-start:16px');
    expect(html).toContain('jects-grid-tree__spacer'); // A-1 is a leaf
    const rootA = f.getViewRows().find((r) => r.row.name === 'Root A')!;
    expect(f.renderTreeCell(rootA, COLUMNS[0]!)).toContain('data-tree-toggle="1"');
  });

  it('clicking a toggle in the DOM expands the node', async () => {
    h = makeTreeHarness();
    const f = h.api.use(new TreeFeature<Node>()) as TreeFeature<Node>;
    const rootA = f.getViewRows()[0]!;
    const cell = document.createElement('div');
    cell.innerHTML = f.renderTreeCell(rootA, COLUMNS[0]!);
    h.el.appendChild(cell);
    const btn = cell.querySelector<HTMLButtonElement>('[data-tree-toggle]')!;
    btn.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(f.isExpanded(1)).toBe(true);
  });

  it('expandAll / collapseAll', async () => {
    h = makeTreeHarness();
    const f = h.api.use(new TreeFeature<Node>()) as TreeFeature<Node>;
    await f.expandAll();
    expect(f.getViewRowCount()).toBe(5); // all nodes visible
    f.collapseAll();
    expect(f.getViewRowCount()).toBe(2);
  });

  it('resolves the tree column from a type:tree column', () => {
    h = makeTreeHarness();
    const f = h.api.use(new TreeFeature<Node>()) as TreeFeature<Node>;
    expect(f.treeColumn).toBe('name');
  });
});
