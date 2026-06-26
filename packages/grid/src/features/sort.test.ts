/** jsdom unit tests for SortFeature (multi-column sorting). */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ColumnDef } from '../contract.js';
import { SortFeature } from './sort.js';
import { makeHarness, makeStore, type FeatureHarness } from './test-harness.js';

interface Row {
  id: number;
  name: string;
  age: number;
  dept: string;
}

const ROWS: Row[] = [
  { id: 1, name: 'Carol', age: 30, dept: 'B' },
  { id: 2, name: 'Alice', age: 25, dept: 'A' },
  { id: 3, name: 'Bob', age: 30, dept: 'A' },
  { id: 4, name: 'Dave', age: 25, dept: 'B' },
];

const COLUMNS: ColumnDef<Row>[] = [
  { field: 'name', header: 'Name', sortable: true },
  { field: 'age', header: 'Age', type: 'number', sortable: true },
  { field: 'dept', header: 'Dept', sortable: true },
];

let h: FeatureHarness<Row>;

beforeEach(() => {
  h = makeHarness<Row>({ store: makeStore(ROWS), columns: COLUMNS });
});
afterEach(() => h.destroy());

const names = (): string[] => {
  const out: string[] = [];
  for (let i = 0; i < h.api.getRowCount(); i++) out.push(h.api.getRow(i)!.name);
  return out;
};

describe('SortFeature (jsdom)', () => {
  it('toggles a single column asc → desc → none', () => {
    const f = h.api.use(new SortFeature<Row>()) as SortFeature<Row>;
    f.toggle('name');
    expect(names()).toEqual(['Alice', 'Bob', 'Carol', 'Dave']);
    expect(f.directionOf('name')).toBe('asc');

    f.toggle('name');
    expect(names()).toEqual(['Dave', 'Carol', 'Bob', 'Alice']);
    expect(f.directionOf('name')).toBe('desc');

    f.toggle('name');
    expect(f.directionOf('name')).toBe(null);
    expect(f.getState()).toEqual([]);
  });

  it('sorts numbers numerically (not lexically)', () => {
    const store = makeStore<Row>([
      { id: 1, name: 'a', age: 2, dept: 'x' },
      { id: 2, name: 'b', age: 10, dept: 'x' },
      { id: 3, name: 'c', age: 1, dept: 'x' },
    ]);
    const h2 = makeHarness<Row>({ store, columns: COLUMNS });
    const f = h2.api.use(new SortFeature<Row>()) as SortFeature<Row>;
    f.toggle('age');
    const ages: number[] = [];
    for (let i = 0; i < h2.api.getRowCount(); i++) ages.push(h2.api.getRow(i)!.age);
    expect(ages).toEqual([1, 2, 10]);
    h2.destroy();
  });

  it('multi-column: secondary key breaks ties (additive)', () => {
    const f = h.api.use(new SortFeature<Row>({ multi: true })) as SortFeature<Row>;
    f.toggle('age'); // primary asc
    f.toggle('name', true); // secondary asc
    // age asc, then name asc within each age group.
    expect(names()).toEqual(['Alice', 'Dave', 'Bob', 'Carol']);
    expect(f.priorityOf('age')).toBe(1);
    expect(f.priorityOf('name')).toBe(2);
  });

  it('emits sortChange with current state', () => {
    const f = h.api.use(new SortFeature<Row>()) as SortFeature<Row>;
    const spy = vi.fn();
    h.api.on('sortChange', spy);
    f.toggle('dept');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0]).toEqual({ sort: [{ columnId: 'dept', direction: 'asc' }] });
  });

  it('respects non-sortable columns', () => {
    const cols: ColumnDef<Row>[] = [{ field: 'name', sortable: false }];
    const h2 = makeHarness<Row>({ store: makeStore(ROWS), columns: cols });
    const f = h2.api.use(new SortFeature<Row>()) as SortFeature<Row>;
    f.toggle('name');
    expect(f.getState()).toEqual([]);
    h2.destroy();
  });

  it('applies initial sort on init', () => {
    const f = new SortFeature<Row>({ initial: [{ columnId: 'name', direction: 'desc' }] });
    h.api.use(f);
    expect(names()).toEqual(['Dave', 'Carol', 'Bob', 'Alice']);
  });

  it('handleHeaderActivate honors the multi modifier', () => {
    const f = h.api.use(new SortFeature<Row>()) as SortFeature<Row>;
    f.handleHeaderActivate('age');
    f.handleHeaderActivate('name', { shiftKey: true } as KeyboardEvent);
    expect(f.getState().map((s) => s.columnId)).toEqual(['age', 'name']);
  });

  it('clearing a sort restores the original (natural) insertion order', () => {
    const f = h.api.use(new SortFeature<Row>()) as SortFeature<Row>;
    // Natural order is the insertion order: Carol, Alice, Bob, Dave.
    expect(names()).toEqual(['Carol', 'Alice', 'Bob', 'Dave']);
    f.toggle('name'); // asc
    expect(names()).toEqual(['Alice', 'Bob', 'Carol', 'Dave']);
    f.toggle('name'); // desc
    expect(names()).toEqual(['Dave', 'Carol', 'Bob', 'Alice']);
    f.toggle('name'); // none → MUST return to natural order, not stay desc
    expect(f.directionOf('name')).toBe(null);
    expect(names()).toEqual(['Carol', 'Alice', 'Bob', 'Dave']);
  });

  it('clear() after sorting a different column restores natural order', () => {
    const f = h.api.use(new SortFeature<Row>()) as SortFeature<Row>;
    f.toggle('age'); // 25,25,30,30 → Alice,Dave,Carol,Bob (stable within equal age)
    expect(names()).toEqual(['Alice', 'Dave', 'Carol', 'Bob']);
    f.clear();
    expect(names()).toEqual(['Carol', 'Alice', 'Bob', 'Dave']);
  });

  it('destroy clears state and is registered/unregistered cleanly', () => {
    const f = h.api.use(new SortFeature<Row>()) as SortFeature<Row>;
    f.toggle('name');
    h.api.removeFeature('sort');
    expect(h.api.features.has('sort')).toBe(false);
    expect(f.getState()).toEqual([]);
  });
});
