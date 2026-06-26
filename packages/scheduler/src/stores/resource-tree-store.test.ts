import { describe, it, expect } from 'vitest';
import { TreeStore } from '@jects/core';
import {
  buildResourceTreeStore,
  nestResourcesByParent,
  type ResourceTreeNode,
} from './resource-tree-store.js';
import { createResourceStore } from './stores.js';
import type { ResourceModel } from '../contract.js';

const FLAT: ResourceModel[] = [
  { id: 'team-a', name: 'Team A' },
  { id: 'alice', name: 'Alice', parentId: 'team-a' },
  { id: 'bob', name: 'Bob', parentId: 'team-a' },
  { id: 'team-b', name: 'Team B' },
  { id: 'carol', name: 'Carol', parentId: 'team-b' },
];

describe('nestResourcesByParent', () => {
  it('assembles a flat parentId array into a tree', () => {
    const roots = nestResourcesByParent(FLAT);
    expect(roots.map((r) => r.id)).toEqual(['team-a', 'team-b']);
    expect(roots[0]!.children?.map((c) => c.id)).toEqual(['alice', 'bob']);
    expect(roots[1]!.children?.map((c) => c.id)).toEqual(['carol']);
  });

  it('does not mutate the input records', () => {
    const input = [{ id: 'p', name: 'P' }, { id: 'c', name: 'C', parentId: 'p' }];
    nestResourcesByParent(input);
    expect((input[0] as ResourceTreeNode).children).toBeUndefined();
  });

  it('treats orphans (missing parent) as roots', () => {
    const roots = nestResourcesByParent([
      { id: 'a', name: 'A', parentId: 'ghost' },
      { id: 'b', name: 'B' },
    ]);
    expect(roots.map((r) => r.id).sort()).toEqual(['a', 'b']);
  });

  it('breaks parentId cycles defensively (no infinite recursion)', () => {
    const roots = nestResourcesByParent([
      { id: 'x', name: 'X', parentId: 'y' },
      { id: 'y', name: 'Y', parentId: 'x' },
    ]);
    // One becomes a root; the other nests — but neither loops.
    const allIds = new Set<string>();
    const walk = (ns: ResourceTreeNode[]): void => {
      for (const n of ns) {
        expect(allIds.has(String(n.id))).toBe(false);
        allIds.add(String(n.id));
        if (n.children) walk(n.children);
      }
    };
    walk(roots);
    expect(allIds).toEqual(new Set(['x', 'y']));
  });

  it('leaves leaf nodes without an empty children array', () => {
    const roots = nestResourcesByParent(FLAT);
    expect(roots[0]!.children![0]!.children).toBeUndefined();
  });
});

describe('buildResourceTreeStore', () => {
  it('builds a TreeStore from a flat parentId array', () => {
    const store = buildResourceTreeStore(FLAT);
    expect(store).toBeInstanceOf(TreeStore);
    expect(store.items.map((n) => n.id)).toEqual(['team-a', 'team-b']);
  });

  it('expands every parent by default (full tree visible)', () => {
    const store = buildResourceTreeStore(FLAT);
    expect(store.isExpanded('team-a')).toBe(true);
    expect(store.isExpanded('team-b')).toBe(true);
    expect(store.getVisible().map((v) => v.node.id)).toEqual([
      'team-a', 'alice', 'bob', 'team-b', 'carol',
    ]);
  });

  it('honors an explicit expanded set (others collapsed)', () => {
    const store = buildResourceTreeStore(FLAT, { expanded: ['team-a'] });
    expect(store.isExpanded('team-a')).toBe(true);
    expect(store.isExpanded('team-b')).toBe(false);
    expect(store.getVisible().map((v) => v.node.id)).toEqual([
      'team-a', 'alice', 'bob', 'team-b',
    ]);
  });

  it('accepts a pre-nested array directly', () => {
    const nested: ResourceTreeNode[] = [
      { id: 'p', name: 'P', children: [{ id: 'c', name: 'C' }] },
    ];
    const store = buildResourceTreeStore(nested);
    expect(store.getChildren('p').map((c) => c.id)).toEqual(['c']);
  });

  it('reads records from an existing flat Store', () => {
    const flatStore = createResourceStore(FLAT);
    const store = buildResourceTreeStore(flatStore);
    expect(store.getChildren('team-a').map((c) => c.id)).toEqual(['alice', 'bob']);
  });

  it('returns an existing TreeStore unchanged', () => {
    const original = buildResourceTreeStore(FLAT);
    expect(buildResourceTreeStore(original)).toBe(original);
  });
});
