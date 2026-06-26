/**
 * Dependency store — a typed `@jects/core` Store of `DependencyModel`.
 *
 * Bryntum/DHTMLX hold dependencies in a reactive `DependencyStore`, not a plain
 * array, so links can be added/removed/edited at runtime and the view repaints
 * reactively (the same discipline as the resource/event stores in
 * `stores/stores.ts`). The dependency-editing UI writes into THIS store rather
 * than mutating the `dependencies` config array, so a created/deleted link is a
 * first-class, observable mutation that other features (PRO auto-reschedule,
 * persistence) can subscribe to.
 *
 * A `coerceDependencyStore` helper accepts either a live Store or the raw
 * `DependencyModel[]` from `SchedulerConfig.dependencies`, exactly like the
 * resource/event coercers, so the Scheduler can adopt either form.
 */

import { Store } from '@jects/core';
import type { RecordId } from '@jects/core';
import type { DependencyModel, DependencyType } from '../contract.js';

/** A Store of directed event⇄event dependencies. */
export type DependencyStore = Store<DependencyModel>;

/** Build a dependency store from raw data. */
export function createDependencyStore(data: DependencyModel[] = []): DependencyStore {
  return new Store<DependencyModel>({ data, idField: 'id' });
}

/** Accept either a live Store or a plain array and return a Store. */
export function coerceDependencyStore(
  src: DependencyStore | DependencyModel[] | undefined,
): DependencyStore {
  if (!src) return createDependencyStore();
  return src instanceof Store ? src : createDependencyStore(src);
}

/**
 * Whether a (fromId, toId, type) triple already exists in the store — used to
 * suppress duplicate links (Bryntum silently ignores an identical re-link).
 * Order matters: `A→B` is distinct from `B→A`.
 */
export function hasDependency(
  store: DependencyStore,
  fromId: RecordId,
  toId: RecordId,
  type: DependencyType,
): boolean {
  return store.toArray().some(
    (d) => d.fromId === fromId && d.toId === toId && (d.type ?? 'FS') === type,
  );
}

/**
 * Whether adding `from → to` would close a directed cycle (i.e. `to` already
 * reaches `from` through existing links). A self-link (`from === to`) is also a
 * cycle. Bryntum rejects cyclic dependencies; we surface this so the editing UI
 * can veto the gesture rather than create an unschedulable graph.
 */
export function wouldCreateCycle(
  store: DependencyStore,
  fromId: RecordId,
  toId: RecordId,
): boolean {
  if (fromId === toId) return true;
  // Build a forward adjacency (predecessor → successors) and BFS from `to`,
  // looking for `from`. If reachable, the new edge from→to closes a cycle.
  const adjacency = new Map<RecordId, RecordId[]>();
  for (const d of store.toArray()) {
    const list = adjacency.get(d.fromId) ?? [];
    list.push(d.toId);
    adjacency.set(d.fromId, list);
  }
  const seen = new Set<RecordId>();
  const queue: RecordId[] = [toId];
  while (queue.length > 0) {
    const node = queue.shift()!;
    if (node === fromId) return true;
    if (seen.has(node)) continue;
    seen.add(node);
    for (const next of adjacency.get(node) ?? []) queue.push(next);
  }
  return false;
}
