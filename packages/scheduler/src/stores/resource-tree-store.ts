/**
 * Resource tree store — a `TreeStore`-backed hierarchy of resource lanes.
 *
 * The flat `ResourceStore` (`stores.ts`) keeps resources as a flat list. This
 * module adds the hierarchical variant required for parity with the
 * Bryntum/DHTMLX scheduler's **resource tree / grouped lanes**: resources nest
 * under a `parentId` (or arrive pre-nested via a `children` field) and render
 * with expand/collapse, indentation, and group headers — mirroring the grid's
 * tree mode.
 *
 * It is purely additive: it does NOT touch `stores.ts`, so flat-list consumers
 * are unaffected. `buildResourceTreeStore` accepts either form (flat `parentId`
 * array, pre-nested array, or an existing `TreeStore`/`Store`) and always
 * returns a `TreeStore<ResourceTreeNode>` with a stable `id` field.
 *
 * Time/data semantics match the rest of the package: ids are `RecordId`, the
 * children field is `children`, and model coercion is the identity (resources
 * need no normalization beyond hierarchy assembly).
 */

import { Store, TreeStore, type RecordId } from '@jects/core';
import type { ResourceModel } from '../contract.js';

/** A resource node in the tree (its `children` are the same shape). */
export interface ResourceTreeNode extends ResourceModel {
  /** Nested children (assembled from `parentId` when a flat array is supplied). */
  children?: ResourceTreeNode[];
}

/** A `TreeStore` of resource lanes. */
export type ResourceTreeStore = TreeStore<ResourceTreeNode>;

/**
 * Whether a resources source already looks pre-nested (any record carries a
 * non-empty `children` array). When false and any record has a `parentId`, the
 * flat array is assembled into a tree by parent linkage.
 */
function looksNested(data: readonly ResourceModel[]): boolean {
  return data.some(
    (r) => Array.isArray((r as ResourceTreeNode).children) &&
      ((r as ResourceTreeNode).children as ResourceTreeNode[]).length > 0,
  );
}

/**
 * Assemble a flat `parentId`-linked array into a nested tree. Records are cloned
 * shallowly (a fresh `children` array is attached) so the caller's input is not
 * mutated. Root order follows first-seen order; orphans (parent id not present)
 * are treated as roots so nothing is silently dropped. Cycles are broken
 * defensively: a node already attached under an ancestor is not re-attached.
 */
export function nestResourcesByParent(data: readonly ResourceModel[]): ResourceTreeNode[] {
  const byId = new Map<RecordId, ResourceTreeNode>();
  for (const r of data) {
    byId.set(r.id, { ...(r as ResourceTreeNode), children: [] });
  }
  const roots: ResourceTreeNode[] = [];
  // Track ancestor chains to defend against parentId cycles.
  const parentOf = (node: ResourceTreeNode): RecordId | null | undefined => node.parentId;
  const isAncestor = (ancestorId: RecordId, nodeId: RecordId): boolean => {
    let cur = byId.get(nodeId);
    const seen = new Set<RecordId>();
    while (cur) {
      const pid = parentOf(cur);
      if (pid == null) return false;
      if (pid === ancestorId) return true;
      if (seen.has(pid)) return false;
      seen.add(pid);
      cur = byId.get(pid);
    }
    return false;
  };

  for (const r of data) {
    const node = byId.get(r.id)!;
    const pid = node.parentId;
    if (pid == null) {
      roots.push(node);
      continue;
    }
    const parent = byId.get(pid);
    // Orphan parent ref, self-parent, or a cycle → treat as a root.
    if (!parent || parent === node || isAncestor(node.id, pid)) {
      roots.push(node);
      continue;
    }
    (parent.children as ResourceTreeNode[]).push(node);
  }
  // Strip empty `children` arrays so `isLeaf` reports leaves correctly.
  const prune = (nodes: ResourceTreeNode[]): void => {
    for (const n of nodes) {
      const kids = n.children as ResourceTreeNode[];
      if (kids.length === 0) delete n.children;
      else prune(kids);
    }
  };
  prune(roots);
  return roots;
}

/**
 * Build a `ResourceTreeStore` from any supported resources source:
 *
 *  - an existing `TreeStore` → returned as-is;
 *  - an existing flat `Store` → its records are read and assembled by
 *    `parentId` (or kept flat when none nest);
 *  - a pre-nested array (records carry `children`) → wrapped directly;
 *  - a flat `parentId`-linked array → assembled into a tree.
 *
 * `expanded` seeds the initially-expanded node ids (default: all parents
 * expanded so the full hierarchy is visible on first paint, matching the grid
 * tree default of an open tree).
 */
export function buildResourceTreeStore(
  src: TreeStore<ResourceTreeNode> | Store<ResourceModel> | ResourceModel[],
  options: { expanded?: RecordId[]; expandAll?: boolean } = {},
): ResourceTreeStore {
  if (src instanceof TreeStore) return src as ResourceTreeStore;

  const flat: ResourceModel[] = src instanceof Store ? src.toArray() : [...src];
  const data: ResourceTreeNode[] = looksNested(flat)
    ? (flat as ResourceTreeNode[])
    : nestResourcesByParent(flat);

  const store = new TreeStore<ResourceTreeNode>({ data, idField: 'id' });

  // Seed expansion. Default: expand every non-leaf so the tree opens fully
  // (the common scheduler default — collapsed-by-default hides all child lanes).
  const expandAll = options.expandAll ?? options.expanded == null;
  if (options.expanded) {
    for (const id of options.expanded) void store.expand(id);
  }
  if (expandAll) {
    for (const node of store.getItems()) {
      const id = node.id;
      if (!store.isLeaf(id) && !store.isExpanded(id)) void store.expand(id);
    }
  }
  return store;
}
