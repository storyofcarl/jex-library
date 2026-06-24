import { describe, it, expect } from 'vitest';
import { TreeStore, type TreeNode } from './tree-store.js';

interface Node extends TreeNode {
  id: number;
  name: string;
}

const tree = (): Node[] => [
  {
    id: 1,
    name: 'root',
    children: [
      { id: 2, name: 'a', children: [{ id: 4, name: 'a1' }] },
      { id: 3, name: 'b' },
    ],
  },
];

describe('TreeStore', () => {
  it('indexes nested nodes', () => {
    const s = new TreeStore<Node>({ data: tree() });
    expect(s.getById(4)?.name).toBe('a1');
  });

  it('getChildren returns direct children', () => {
    const s = new TreeStore<Node>({ data: tree() });
    expect(s.getChildren(1).map((n) => n.id)).toEqual([2, 3]);
  });

  it('isLeaf detects leaves', () => {
    const s = new TreeStore<Node>({ data: tree() });
    expect(s.isLeaf(3)).toBe(true);
    expect(s.isLeaf(2)).toBe(false);
  });

  it('expand/collapse toggles visibility', async () => {
    const s = new TreeStore<Node>({ data: tree() });
    expect(s.isExpanded(1)).toBe(false);
    await s.expand(1);
    expect(s.isExpanded(1)).toBe(true);
    const visible = s.getVisible().map((v) => v.node.id);
    expect(visible).toContain(2);
    expect(visible).toContain(3);
    s.collapse(1);
    expect(s.getVisible().map((v) => v.node.id)).toEqual([1]);
  });

  it('getVisible respects nested expansion + depth', async () => {
    const s = new TreeStore<Node>({ data: tree() });
    await s.expand(1);
    await s.expand(2);
    const visible = s.getVisible();
    const a1 = visible.find((v) => v.node.id === 4);
    expect(a1?.depth).toBe(2);
  });

  it('lazy loadChildren via loader', async () => {
    const s = new TreeStore<Node>({
      data: [{ id: 1, name: 'lazy' }],
      loader: async (node) => [{ id: 10, name: `${node.name}-child` }],
    });
    await s.expand(1);
    expect(s.getChildren(1).map((n) => n.id)).toEqual([10]);
    expect(s.getById(10)?.name).toBe('lazy-child');
  });
});
