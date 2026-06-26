/** jsdom unit tests for FilterFeature + FilterBarFeature. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ColumnDef } from '../contract.js';
import { FilterFeature, makeFilterPredicate } from './filter.js';
import { FilterBarFeature } from './filter-bar.js';
import { makeHarness, makeStore, type FeatureHarness } from './test-harness.js';

interface Row {
  id: number;
  name: string;
  age: number;
  active: boolean;
}

const ROWS: Row[] = [
  { id: 1, name: 'Alice', age: 30, active: true },
  { id: 2, name: 'Bob', age: 25, active: false },
  { id: 3, name: 'Carol', age: 40, active: true },
  { id: 4, name: 'Dave', age: 25, active: false },
];

const COLUMNS: ColumnDef<Row>[] = [
  { field: 'name', header: 'Name', filterable: true },
  { field: 'age', header: 'Age', type: 'number', filterable: true },
  { field: 'active', header: 'Active', type: 'check' },
];

let h: FeatureHarness<Row>;
beforeEach(() => {
  h = makeHarness<Row>({ store: makeStore(ROWS), columns: COLUMNS });
});
afterEach(() => h.destroy());

const ids = (): number[] => {
  const out: number[] = [];
  for (let i = 0; i < h.api.getRowCount(); i++) out.push(h.api.getRow(i)!.id);
  return out;
};

describe('makeFilterPredicate', () => {
  const col: ColumnDef<Row> = { field: 'name' };
  it('contains is case-insensitive by default', () => {
    const p = makeFilterPredicate<Row>(col, 'contains', 'ar');
    expect(p({ id: 1, name: 'Carol', age: 0, active: false })).toBe(true);
    expect(p({ id: 2, name: 'Bob', age: 0, active: false })).toBe(false);
  });
  it('numeric comparisons coerce', () => {
    const ageCol: ColumnDef<Row> = { field: 'age', type: 'number' };
    const gt = makeFilterPredicate<Row>(ageCol, 'gt', 28);
    expect(gt({ id: 1, name: '', age: 30, active: false })).toBe(true);
    expect(gt({ id: 2, name: '', age: 25, active: false })).toBe(false);
  });
  it('between is inclusive', () => {
    const ageCol: ColumnDef<Row> = { field: 'age', type: 'number' };
    const p = makeFilterPredicate<Row>(ageCol, 'between', [25, 30]);
    expect(p({ id: 1, name: '', age: 25, active: false })).toBe(true);
    expect(p({ id: 1, name: '', age: 40, active: false })).toBe(false);
  });
  it('empty / notEmpty', () => {
    const p = makeFilterPredicate<Row>(col, 'empty', undefined);
    expect(p({ id: 1, name: '', age: 0, active: false })).toBe(true);
    expect(p({ id: 1, name: 'x', age: 0, active: false })).toBe(false);
  });
});

describe('FilterFeature (jsdom)', () => {
  it('filters the store by a single contains directive', () => {
    const f = h.api.use(new FilterFeature<Row>()) as FilterFeature<Row>;
    f.setColumnFilter('name', 'contains', 'a');
    expect(ids().sort()).toEqual([1, 3, 4]); // Alice, Carol, Dave
    expect(f.isActive('name')).toBe(true);
  });

  it('combines multiple column filters with AND', () => {
    const f = h.api.use(new FilterFeature<Row>()) as FilterFeature<Row>;
    f.setColumnFilter('age', 'eq', 25);
    f.setColumnFilter('name', 'contains', 'd');
    expect(ids()).toEqual([4]); // Dave, age 25
  });

  it('clear(columnId) removes only that column filter', () => {
    const f = h.api.use(new FilterFeature<Row>()) as FilterFeature<Row>;
    f.setColumnFilter('age', 'gte', 30);
    f.setColumnFilter('name', 'contains', 'a');
    f.clear('name');
    expect(ids().sort()).toEqual([1, 3]); // age >= 30
  });

  it('empty value clears that column filter', () => {
    const f = h.api.use(new FilterFeature<Row>()) as FilterFeature<Row>;
    f.setColumnFilter('name', 'contains', 'a');
    expect(h.api.getRowCount()).toBe(3);
    f.setColumnFilter('name', 'contains', '');
    expect(h.api.getRowCount()).toBe(4);
  });

  it('emits filterChange', () => {
    const f = h.api.use(new FilterFeature<Row>()) as FilterFeature<Row>;
    const spy = vi.fn();
    h.api.on('filterChange', spy);
    f.setColumnFilter('age', 'lt', 30);
    expect(spy).toHaveBeenCalled();
    const payload = spy.mock.calls.at(-1)![0];
    expect(payload.filter).toEqual([{ columnId: 'age', operator: 'lt', value: 30 }]);
  });

  it('applies initial filters on init', () => {
    const f = new FilterFeature<Row>({ initial: [{ columnId: 'active', operator: 'eq', value: true }] });
    h.api.use(f);
    expect(ids().sort()).toEqual([1, 3]);
  });

  it('destroy clears filter state', () => {
    const f = h.api.use(new FilterFeature<Row>()) as FilterFeature<Row>;
    f.setColumnFilter('name', 'contains', 'a');
    h.api.removeFeature('filter');
    expect(f.getState()).toEqual([]);
  });
});

describe('FilterBarFeature (jsdom)', () => {
  it('renders one filter cell per column and an input for filterable ones', () => {
    h.api.use(new FilterBarFeature<Row>());
    const bar = h.el.querySelector('.jects-grid-filterbar')!;
    expect(bar).toBeTruthy();
    expect(bar.querySelectorAll('.jects-grid-filterbar__cell').length).toBe(3);
    expect(bar.querySelectorAll('.jects-grid-filterbar__input').length).toBeGreaterThanOrEqual(2);
  });

  it('applyColumn drives the store directly (standalone)', () => {
    const bar = h.api.use(new FilterBarFeature<Row>()) as FilterBarFeature<Row>;
    bar.applyColumn('name', 'al');
    expect(ids()).toEqual([1]); // Alice
  });

  it('delegates to FilterFeature when present', () => {
    const filter = h.api.use(new FilterFeature<Row>()) as FilterFeature<Row>;
    const bar = h.api.use(new FilterBarFeature<Row>()) as FilterBarFeature<Row>;
    bar.setValue('age', '25');
    expect(filter.isActive('age')).toBe(true);
    expect(ids().sort()).toEqual([2, 4]);
  });

  it('clearAll removes filters and empties inputs', () => {
    const bar = h.api.use(new FilterBarFeature<Row>()) as FilterBarFeature<Row>;
    bar.applyColumn('name', 'a');
    expect(h.api.getRowCount()).toBe(3);
    bar.clearAll();
    expect(h.api.getRowCount()).toBe(4);
    const input = h.el.querySelector<HTMLInputElement>('[data-filter-input="name"]')!;
    expect(input.value).toBe('');
  });

  it('removes its DOM on destroy', () => {
    const bar = h.api.use(new FilterBarFeature<Row>()) as FilterBarFeature<Row>;
    expect(bar.element).toBeTruthy();
    h.api.removeFeature('filterBar');
    expect(h.el.querySelector('.jects-grid-filterbar')).toBeNull();
  });
});
