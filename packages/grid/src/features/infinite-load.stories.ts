/**
 * Usage stories for InfiniteLoadFeature (lazy / infinite load-on-demand).
 *
 * Framework-free, imperative usage examples (the house "stories" format): each
 * function builds a real Grid over an *empty* Store, installs the feature with a
 * range-request data provider, and returns the instance so a docs shell /
 * playground can mount and tear it down. The grid spans the full `totalCount`
 * immediately, renders skeleton placeholders for un-fetched rows, and prefetches
 * pages as the viewport approaches them.
 */
import { Store } from '@jects/core';
import { Grid } from '../engine/grid.js';
import type { ColumnDef } from '../contract.js';
import {
  InfiniteLoadFeature,
  infiniteLoadFeature,
  type RangeRequest,
  type RangeResponse,
} from './infinite-load.js';

interface Person {
  id: number;
  name: string;
  city: string;
  /** Index signature so `Person` satisfies the core `Model` constraint. */
  [key: string]: unknown;
}

const CITIES = ['Paris', 'Berlin', 'Madrid', 'Rome', 'Lisbon', 'Vienna', 'Oslo'];

/** Simulate a paged REST endpoint with network latency. */
function fakeServer(total: number, latency = 250) {
  return async (req: RangeRequest): Promise<RangeResponse<Person>> => {
    await new Promise((r) => setTimeout(r, latency));
    const rows: Person[] = [];
    for (let i = req.start; i < req.end; i++) {
      rows.push({ id: i, name: `Person ${i}`, city: CITIES[i % CITIES.length]! });
    }
    return { rows, totalCount: total };
  };
}

const columns: ColumnDef<Person>[] = [
  { field: 'id', header: 'ID', width: 80 },
  { field: 'name', header: 'Name', width: 220 },
  { field: 'city', header: 'City', flex: 1 },
];

/**
 * Basic: a 1,000,000-row virtual list where only the visible pages are fetched.
 * Scroll anywhere and the approaching page streams in, replacing skeleton rows.
 */
export function basicInfiniteLoad(host: HTMLElement): Grid<Person> {
  const store = new Store<Person>({ data: [], idField: 'id' });
  const grid = new Grid<Person>(host, { data: store, columns, rowHeight: 34 });
  grid.use(
    new InfiniteLoadFeature<Person>({
      totalCount: 1_000_000,
      pageSize: 100,
      prefetchThreshold: 25,
      loadRange: fakeServer(1_000_000),
    }),
  );
  return grid;
}

/**
 * Unknown total: start with `totalCount: 0`; the first response reveals the real
 * total and the virtual list resizes to it.
 */
export function infiniteLoadUnknownTotal(host: HTMLElement): Grid<Person> {
  const store = new Store<Person>({ data: [], idField: 'id' });
  const grid = new Grid<Person>(host, { data: store, columns, rowHeight: 34 });
  const feature = infiniteLoadFeature<Person>({
    totalCount: 0,
    pageSize: 50,
    loadRange: fakeServer(2_500, 200),
  });
  grid.use(feature);
  // Once we know the total from any source, size the list:
  feature.setTotalCount(2_500);
  return grid;
}
