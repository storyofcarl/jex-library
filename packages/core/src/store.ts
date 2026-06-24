/**
 * Store (DataCollection) — the flat data layer every data component binds to.
 * Holds an ordered list of records, supports CRUD, sort/filter/group, and emits
 * lifecycle events through an exposed `EventEmitter` (`.events`).
 */

import { EventEmitter } from './events.js';

export type RecordId = string | number;

/** Minimum shape: an object. The id field is configurable via `idField`. */
export type Model = Record<string, unknown>;

export type Comparator<T> = (a: T, b: T) => number;
export type Predicate<T> = (record: T, index: number) => boolean;
export type SortDir = 'asc' | 'desc';

export interface FilterConfig<T> {
  /** Field to test. */
  field: keyof T & string;
  /** Operator. Default `eq`. */
  operator?: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'startsWith';
  /** Value to compare against. */
  value: unknown;
}

export interface StoreConfig<T extends Model> {
  /** Initial records. */
  data?: T[];
  /** Field used as the unique id. Default `'id'`. */
  idField?: string;
  /** Optional model factory/normalizer applied to each record on load/add. */
  model?: (raw: Partial<T>) => T;
}

export interface StoreEvents<T extends Model> extends Record<string, unknown> {
  load: { records: T[] };
  add: { records: T[]; index: number };
  remove: { records: T[]; ids: RecordId[] };
  update: { record: T; id: RecordId; changes: Partial<T> };
  /** Coarse "something changed" — fired after add/remove/update/sort/filter. */
  change: { action: 'add' | 'remove' | 'update' | 'sort' | 'filter' | 'load' | 'move' };
  sort: { field?: string; dir?: SortDir };
  filter: { active: boolean };
}

export class Store<T extends Model = Model> {
  readonly events = new EventEmitter<StoreEvents<T>>();
  readonly idField: string;
  protected readonly model?: (raw: Partial<T>) => T;

  /** All loaded records (unfiltered, current sort order). */
  protected all: T[] = [];
  /** Filtered view (what `count`/iteration expose). Null when no filter active. */
  protected view: T[] | null = null;
  protected readonly index = new Map<RecordId, T>();
  protected activeFilters: Array<Predicate<T>> = [];

  constructor(config: StoreConfig<T> = {}) {
    this.idField = config.idField ?? 'id';
    if (config.model) this.model = config.model;
    if (config.data) this.parse(config.data);
  }

  protected idOf(record: T): RecordId {
    return record[this.idField] as RecordId;
  }

  protected normalize(raw: Partial<T>): T {
    return this.model ? this.model(raw) : (raw as T);
  }

  protected reindex(): void {
    this.index.clear();
    for (const r of this.all) this.index.set(this.idOf(r), r);
  }

  protected records(): T[] {
    return this.view ?? this.all;
  }

  protected applyFilters(): void {
    if (this.activeFilters.length === 0) {
      this.view = null;
      return;
    }
    this.view = this.all.filter((r, i) => this.activeFilters.every((f) => f(r, i)));
  }

  /** Replace all records from a raw array (no fetch). Fires `load`. */
  parse(data: T[]): void {
    this.all = data.map((d) => this.normalize(d));
    this.reindex();
    this.applyFilters();
    this.events.emit('load', { records: this.all });
    this.events.emit('change', { action: 'load' });
  }

  /** Fetch JSON from `url` and parse it. Expects an array, or `{ data: [...] }`. */
  async load(url: string): Promise<void> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Jects Store.load: ${res.status} ${res.statusText}`);
    const json: unknown = await res.json();
    const data = Array.isArray(json)
      ? json
      : ((json as { data?: T[] }).data ?? []);
    this.parse(data as T[]);
  }

  /** Number of records in the current (filtered) view. */
  get count(): number {
    return this.records().length;
  }

  /** Total records ignoring filters. */
  get totalCount(): number {
    return this.all.length;
  }

  /** Append one or more records. Fires `add`. */
  add(record: T | T[]): T[] {
    const incoming = (Array.isArray(record) ? record : [record]).map((r) => this.normalize(r));
    const index = this.all.length;
    this.all.push(...incoming);
    for (const r of incoming) this.index.set(this.idOf(r), r);
    this.applyFilters();
    this.events.emit('add', { records: incoming, index });
    this.events.emit('change', { action: 'add' });
    return incoming;
  }

  /** Remove by id(s) or record(s). Fires `remove`. */
  remove(target: RecordId | T | Array<RecordId | T>): T[] {
    const list = Array.isArray(target) ? target : [target];
    const ids = list.map((t) => (typeof t === 'object' ? this.idOf(t as T) : t));
    const removed: T[] = [];
    this.all = this.all.filter((r) => {
      if (ids.includes(this.idOf(r))) {
        removed.push(r);
        this.index.delete(this.idOf(r));
        return false;
      }
      return true;
    });
    if (removed.length) {
      this.applyFilters();
      this.events.emit('remove', { records: removed, ids: removed.map((r) => this.idOf(r)) });
      this.events.emit('change', { action: 'remove' });
    }
    return removed;
  }

  /** Merge `changes` into the record with `id`. Fires `update`. */
  update(id: RecordId, changes: Partial<T>): T | undefined {
    const record = this.index.get(id);
    if (!record) return undefined;
    Object.assign(record, changes);
    this.applyFilters();
    this.events.emit('update', { record, id, changes });
    this.events.emit('change', { action: 'update' });
    return record;
  }

  /** Move a record from one position to another (in the unfiltered list). Fires `change`. */
  move(from: number, to: number): void {
    if (from < 0 || from >= this.all.length || to < 0 || to >= this.all.length) return;
    const [item] = this.all.splice(from, 1);
    if (item) this.all.splice(to, 0, item);
    this.applyFilters();
    this.events.emit('change', { action: 'move' });
  }

  /** Change a record's id (and reindex). */
  changeId(oldId: RecordId, newId: RecordId): void {
    const record = this.index.get(oldId);
    if (!record) return;
    this.index.delete(oldId);
    (record as Model)[this.idField] = newId;
    this.index.set(newId, record);
  }

  getById(id: RecordId): T | undefined {
    return this.index.get(id);
  }

  /** Position of a record in the current view, or -1. */
  indexOf(target: RecordId | T): number {
    const id = typeof target === 'object' ? this.idOf(target as T) : target;
    return this.records().findIndex((r) => this.idOf(r) === id);
  }

  /** Record at `i` in the current view. */
  getAt(i: number): T | undefined {
    return this.records()[i];
  }

  forEach(fn: (record: T, index: number) => void): void {
    this.records().forEach(fn);
  }

  map<R>(fn: (record: T, index: number) => R): R[] {
    return this.records().map(fn);
  }

  find(predicate: Predicate<T>): T | undefined {
    return this.records().find(predicate);
  }

  /** Snapshot the current view as a plain array. */
  toArray(): T[] {
    return [...this.records()];
  }

  /** Sort by field name or comparator. Mutates order; fires `sort`. */
  sort(by: (keyof T & string) | Comparator<T>, dir: SortDir = 'asc'): void {
    const cmp: Comparator<T> =
      typeof by === 'function'
        ? by
        : (a, b) => {
            const av = a[by];
            const bv = b[by];
            if (av === bv) return 0;
            return (av as never) < (bv as never) ? -1 : 1;
          };
    const factor = dir === 'desc' ? -1 : 1;
    this.all.sort((a, b) => cmp(a, b) * factor);
    this.applyFilters();
    this.events.emit('sort', typeof by === 'string' ? { field: by, dir } : { dir });
    this.events.emit('change', { action: 'sort' });
  }

  /** Apply a predicate or filter config. Replaces existing filters. Fires `filter`. */
  filter(filter: Predicate<T> | FilterConfig<T> | Array<Predicate<T> | FilterConfig<T>>): void {
    const list = Array.isArray(filter) ? filter : [filter];
    this.activeFilters = list.map((f) => (typeof f === 'function' ? f : toPredicate(f)));
    this.applyFilters();
    this.events.emit('filter', { active: true });
    this.events.emit('change', { action: 'filter' });
  }

  /** Remove all filters; the full data set is visible again. Fires `filter`. */
  clearFilters(): void {
    this.activeFilters = [];
    this.view = null;
    this.events.emit('filter', { active: false });
    this.events.emit('change', { action: 'filter' });
  }

  /** Group the current view by `field` into a `Map` keyed by field value. */
  group<K = unknown>(field: keyof T & string): Map<K, T[]> {
    const groups = new Map<K, T[]>();
    for (const r of this.records()) {
      const key = r[field] as K;
      const bucket = groups.get(key);
      if (bucket) bucket.push(r);
      else groups.set(key, [r]);
    }
    return groups;
  }

  /** Serialize the full (unfiltered) data set to plain objects. */
  serialize(): T[] {
    return this.all.map((r) => ({ ...r }));
  }
}

function toPredicate<T extends Model>(config: FilterConfig<T>): Predicate<T> {
  const { field, value } = config;
  const op = config.operator ?? 'eq';
  return (record) => {
    const v = record[field];
    switch (op) {
      case 'eq':
        return v === value;
      case 'neq':
        return v !== value;
      case 'gt':
        return (v as never) > (value as never);
      case 'gte':
        return (v as never) >= (value as never);
      case 'lt':
        return (v as never) < (value as never);
      case 'lte':
        return (v as never) <= (value as never);
      case 'contains':
        return String(v).toLowerCase().includes(String(value).toLowerCase());
      case 'startsWith':
        return String(v).toLowerCase().startsWith(String(value).toLowerCase());
      default:
        return true;
    }
  };
}
