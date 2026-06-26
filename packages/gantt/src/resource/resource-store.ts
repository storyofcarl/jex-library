/**
 * `ResourceStore` — the flat data collection of project resources (people /
 * equipment / material / cost). Extends the framework-free `@jects/core` `Store`,
 * inheriting CRUD + sort/filter/group + the typed `events` emitter, and adds
 * resource-specific reads (defaults normalization, group buckets, cost lookup).
 *
 * Bryntum/DHTMLX parity: resources are a flat collection (grouping is a field,
 * not a tree). Each resource carries a capacity, an hourly cost, and a calendar
 * id; the `AssignmentStore` links them to tasks. This store owns ONLY resource
 * records — it knows nothing about tasks or assignments (single responsibility).
 */

import { Store, type RecordId } from '@jects/core';
import type { Model } from '@jects/core';
import type { ResourceModel, ResourceType } from './resource-contract.js';

/** Default capacity (one full-time unit) when a resource omits it. */
export const DEFAULT_RESOURCE_CAPACITY = 1;
/** Default resource type. */
export const DEFAULT_RESOURCE_TYPE: ResourceType = 'work';

export interface ResourceStoreConfig<R extends Model = Model> {
  /** Initial resource records. */
  data?: ResourceModel<R>[];
  /** Id field. Default `'id'`. */
  idField?: string;
}

/**
 * Normalize a raw resource: fill `type`/`capacity` defaults and coerce a
 * non-finite/negative capacity to the default. Pure — exported for testing.
 */
export function normalizeResource<R extends Model = Model>(
  raw: Partial<ResourceModel<R>>,
): ResourceModel<R> {
  const capacityRaw = raw.capacity;
  const capacity =
    typeof capacityRaw === 'number' && Number.isFinite(capacityRaw) && capacityRaw >= 0
      ? capacityRaw
      : DEFAULT_RESOURCE_CAPACITY;
  const out: ResourceModel<R> = {
    ...(raw as ResourceModel<R>),
    type: raw.type ?? DEFAULT_RESOURCE_TYPE,
    capacity,
  };
  return out;
}

export class ResourceStore<R extends Model = Model> extends Store<ResourceModel<R>> {
  constructor(config: ResourceStoreConfig<R> = {}) {
    super({
      ...(config.data ? { data: config.data } : {}),
      idField: config.idField ?? 'id',
      model: (raw) => normalizeResource<R>(raw),
    });
  }

  /** All resources (snapshot). */
  getResources(): ResourceModel<R>[] {
    return this.toArray();
  }

  /** A resource's effective capacity (already normalized; never undefined). */
  capacityOf(id: RecordId): number {
    return this.getById(id)?.capacity ?? DEFAULT_RESOURCE_CAPACITY;
  }

  /** A resource's hourly cost, or 0 if unset. */
  hourlyCostOf(id: RecordId): number {
    const c = this.getById(id)?.hourlyCost;
    return typeof c === 'number' && Number.isFinite(c) ? c : 0;
  }

  /**
   * Bucket resources by their `group` field (resources with no group land under
   * the empty-string key). Stable order within each bucket (insertion order).
   */
  byGroup(): Map<string, ResourceModel<R>[]> {
    const out = new Map<string, ResourceModel<R>[]>();
    for (const r of this.toArray()) {
      const key = typeof r.group === 'string' ? r.group : '';
      const bucket = out.get(key) ?? out.set(key, []).get(key)!;
      bucket.push(r);
    }
    return out;
  }

  /** Resources of a given type. */
  ofType(type: ResourceType): ResourceModel<R>[] {
    return this.toArray().filter((r) => (r.type ?? DEFAULT_RESOURCE_TYPE) === type);
  }
}
