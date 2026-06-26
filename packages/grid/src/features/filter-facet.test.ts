/** jsdom unit tests for the faceted (set / checklist) filter. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ColumnDef } from '../contract.js';
import { FilterFeature, computeFacet, facetKey } from './filter.js';
import { FilterFacetFeature } from './filter-facet.js';
import { makeHarness, makeStore, type FeatureHarness } from './test-harness.js';

interface Row {
  id: number;
  name: string;
  dept: string;
  age: number;
}

const ROWS: Row[] = [
  { id: 1, name: 'Alice', dept: 'Eng', age: 30 },
  { id: 2, name: 'Bob', dept: 'Sales', age: 25 },
  { id: 3, name: 'Carol', dept: 'Eng', age: 40 },
  { id: 4, name: 'Dave', dept: 'Sales', age: 25 },
  { id: 5, name: 'Erin', dept: 'Eng', age: 35 },
  { id: 6, name: 'Frank', dept: '', age: 50 },
];

const COLUMNS: ColumnDef<Row>[] = [
  { field: 'name', header: 'Name', id: 'name', filterable: true },
  { field: 'dept', header: 'Dept', id: 'dept', filterable: true },
  { field: 'age', header: 'Age', id: 'age', type: 'number', filterable: true },
];

let h: FeatureHarness<Row>;
beforeEach(() => {
  h = makeHarness<Row>({ store: makeStore(ROWS), columns: COLUMNS });
});
afterEach(() => h.destroy());

const ids = (): number[] => {
  const out: number[] = [];
  for (let i = 0; i < h.api.getRowCount(); i++) out.push(h.api.getRow(i)!.id);
  return out.sort((a, b) => a - b);
};

describe('computeFacet', () => {
  it('returns distinct values with counts, blanks last', () => {
    const facet = computeFacet(ROWS, COLUMNS[1]!, null);
    const labels = facet.map((f) => f.label);
    expect(labels).toEqual(['Eng', 'Sales', '(Blanks)']);
    const eng = facet.find((f) => f.label === 'Eng')!;
    expect(eng.count).toBe(3);
    expect(facet.find((f) => f.label === 'Sales')!.count).toBe(2);
    expect(facet.find((f) => f.label === '(Blanks)')!.count).toBe(1);
  });

  it('marks every value selected when selection is null', () => {
    const facet = computeFacet(ROWS, COLUMNS[1]!, null);
    expect(facet.every((f) => f.selected)).toBe(true);
  });

  it('flags selection by value-key', () => {
    const selected = new Set([facetKey('Eng')]);
    const facet = computeFacet(ROWS, COLUMNS[1]!, selected);
    expect(facet.find((f) => f.label === 'Eng')!.selected).toBe(true);
    expect(facet.find((f) => f.label === 'Sales')!.selected).toBe(false);
  });

  it('sorts numbers numerically by value', () => {
    const facet = computeFacet(ROWS, COLUMNS[2]!, null);
    expect(facet.map((f) => f.value)).toEqual([25, 30, 35, 40, 50]);
  });

  it('can sort by count descending', () => {
    const facet = computeFacet(ROWS, COLUMNS[1]!, null, { sort: 'count' });
    expect(facet[0]!.label).toBe('Eng'); // 3 is the largest count
  });
});

describe('FilterFeature facet API', () => {
  it('getFacet reflects distinct values of the unfiltered column', () => {
    const f = h.api.use(new FilterFeature<Row>()) as FilterFeature<Row>;
    const facet = f.getFacet('dept');
    expect(facet.map((v) => v.label).sort()).toEqual(['(Blanks)', 'Eng', 'Sales']);
    expect(facet.every((v) => v.selected)).toBe(true);
  });

  it('setFacetSelection writes an `in` directive and filters the store', () => {
    const f = h.api.use(new FilterFeature<Row>()) as FilterFeature<Row>;
    f.setFacetSelection('dept', new Set([facetKey('Eng')]));
    expect(ids()).toEqual([1, 3, 5]);
    const state = f.forColumn('dept');
    expect(state).toHaveLength(1);
    expect(state[0]!.operator).toBe('in');
    expect(state[0]!.value).toEqual(['Eng']);
  });

  it('selecting ALL distinct values clears the column filter', () => {
    const f = h.api.use(new FilterFeature<Row>()) as FilterFeature<Row>;
    const all = new Set(f.getFacet('dept').map((v) => v.key));
    f.setFacetSelection('dept', all);
    expect(f.isActive('dept')).toBe(false);
    expect(ids().length).toBe(6);
  });

  it('selecting NOTHING shows no rows (empty `in`)', () => {
    const f = h.api.use(new FilterFeature<Row>()) as FilterFeature<Row>;
    f.setFacetSelection('dept', new Set());
    expect(ids()).toEqual([]);
  });

  it('distinct values are scoped by OTHER columns\' filters', () => {
    const f = h.api.use(new FilterFeature<Row>()) as FilterFeature<Row>;
    // Constrain age to 25 → only Sales rows (Bob, Dave) remain in scope.
    f.setColumnFilter('age', 'eq', 25);
    const facet = f.getFacet('dept');
    expect(facet.map((v) => v.label)).toEqual(['Sales']);
    expect(facet[0]!.count).toBe(2);
  });

  it('a column\'s own facet does NOT restrict its own distinct list', () => {
    const f = h.api.use(new FilterFeature<Row>()) as FilterFeature<Row>;
    f.setFacetSelection('dept', new Set([facetKey('Eng')]));
    // Even though Eng is the active filter, the facet still lists all depts so
    // the user can re-widen — and Eng shows as selected.
    const facet = f.getFacet('dept');
    expect(facet.map((v) => v.label).sort()).toEqual(['(Blanks)', 'Eng', 'Sales']);
    expect(facet.find((v) => v.label === 'Eng')!.selected).toBe(true);
    expect(facet.find((v) => v.label === 'Sales')!.selected).toBe(false);
  });

  it('null selection clears the filter', () => {
    const f = h.api.use(new FilterFeature<Row>()) as FilterFeature<Row>;
    f.setFacetSelection('dept', new Set([facetKey('Eng')]));
    expect(ids()).toEqual([1, 3, 5]);
    f.setFacetSelection('dept', null);
    expect(ids().length).toBe(6);
  });
});

describe('FilterFacetFeature (popup, jsdom)', () => {
  it('opens a dialog popup listing distinct values', () => {
    h.api.use(new FilterFeature<Row>());
    const facet = h.api.use(new FilterFacetFeature<Row>()) as FilterFacetFeature<Row>;
    facet.open('dept');
    const popup = h.el.querySelector('.jects-grid-facet')!;
    expect(popup).toBeTruthy();
    expect(popup.getAttribute('role')).toBe('dialog');
    const rows = popup.querySelectorAll('.jects-grid-facet__row');
    expect(rows.length).toBe(3); // Eng, Sales, (Blanks)
    expect(facet.isOpen()).toBe(true);
    expect(facet.openColumn()).toBe('dept');
  });

  it('applying a checklist subset writes an `in` filter', () => {
    const filter = h.api.use(new FilterFeature<Row>()) as FilterFeature<Row>;
    const facet = h.api.use(new FilterFacetFeature<Row>()) as FilterFacetFeature<Row>;
    facet.open('dept');
    // Uncheck Sales + (Blanks) → only Eng remains checked.
    facet.toggleValue(facetKey('Sales'), false);
    facet.toggleValue(facetKey(null), false);
    facet.apply();
    expect(ids()).toEqual([1, 3, 5]);
    expect(filter.forColumn('dept')[0]!.operator).toBe('in');
    expect(facet.isOpen()).toBe(false); // 'apply' mode closes on commit
  });

  it('emits facetApply with cleared flag when all are selected', () => {
    h.api.use(new FilterFeature<Row>());
    const facet = h.api.use(new FilterFacetFeature<Row>()) as FilterFacetFeature<Row>;
    const spy = vi.fn();
    facet.on('facetApply', spy);
    facet.open('dept');
    facet.apply(); // everything still checked
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0].cleared).toBe(true);
  });

  it('beforeFacetApply veto keeps the filter unchanged', () => {
    const filter = h.api.use(new FilterFeature<Row>()) as FilterFeature<Row>;
    const facet = h.api.use(new FilterFacetFeature<Row>()) as FilterFacetFeature<Row>;
    facet.on('beforeFacetApply', () => false);
    facet.open('dept');
    facet.toggleValue(facetKey('Sales'), false);
    const ok = facet.apply();
    expect(ok).toBe(false);
    expect(filter.isActive('dept')).toBe(false);
  });

  it('live mode applies immediately on each toggle', () => {
    h.api.use(new FilterFeature<Row>());
    const facet = h.api.use(
      new FilterFacetFeature<Row>({ applyMode: 'live' }),
    ) as FilterFacetFeature<Row>;
    facet.open('dept');
    facet.toggleValue(facetKey('Sales'), false);
    facet.toggleValue(facetKey(null), false);
    expect(ids()).toEqual([1, 3, 5]);
  });

  it('setAll(false) then setAll(true) round-trips to no filter', () => {
    h.api.use(new FilterFeature<Row>());
    const facet = h.api.use(new FilterFacetFeature<Row>()) as FilterFacetFeature<Row>;
    facet.open('dept');
    facet.setAll(false);
    facet.apply();
    expect(ids()).toEqual([]);

    facet.open('dept');
    facet.setAll(true);
    facet.apply();
    expect(ids().length).toBe(6);
  });

  it('works standalone without a FilterFeature (drives the store)', () => {
    const facet = h.api.use(new FilterFacetFeature<Row>()) as FilterFacetFeature<Row>;
    facet.open('dept');
    facet.toggleValue(facetKey('Sales'), false);
    facet.toggleValue(facetKey(null), false);
    facet.apply();
    expect(ids()).toEqual([1, 3, 5]);
  });

  it('a header trigger opens the popup for its column', () => {
    h.api.use(new FilterFeature<Row>());
    const facet = h.api.use(new FilterFacetFeature<Row>()) as FilterFacetFeature<Row>;
    const trigger = document.createElement('button');
    trigger.dataset['filterFacet'] = 'dept';
    h.el.appendChild(trigger);
    trigger.click();
    expect(facet.isOpen()).toBe(true);
    expect(facet.openColumn()).toBe('dept');
  });

  it('removes its popup + disposes checkboxes on destroy', () => {
    h.api.use(new FilterFeature<Row>());
    const facet = h.api.use(new FilterFacetFeature<Row>()) as FilterFacetFeature<Row>;
    facet.open('dept');
    expect(h.el.querySelector('.jects-grid-facet')).toBeTruthy();
    h.api.removeFeature('filterFacet');
    expect(h.el.querySelector('.jects-grid-facet')).toBeNull();
  });
});
