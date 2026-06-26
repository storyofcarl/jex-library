/**
 * jsdom unit tests for FilterMenuFeature (gap 3: per-column filter operator menu).
 *
 * Verifies the menu lists the operators applicable to a column's type, that
 * choosing an operator (with/without operands) calls FilterFeature.setColumnFilter
 * with the right directive, and that the popup opens from a `[data-filter-menu]`
 * trigger and closes on apply / Escape.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import type { Model } from '@jects/core';
import { makeHarness, makeStore, type FeatureHarness } from './test-harness.js';
import type { ColumnDef, FilterState } from '../contract.js';
import { filterFeature, FilterFeature } from './filter.js';
import {
  FilterMenuFeature,
  filterMenuFeature,
  operatorsForColumn,
} from './filter-menu.js';

interface Row extends Model {
  id: number;
  name: string;
  age: number;
}

const DATA: Row[] = [
  { id: 1, name: 'Ada', age: 36 },
  { id: 2, name: 'Linus', age: 54 },
  { id: 3, name: 'Grace', age: 85 },
];

const COLS: ColumnDef<Row>[] = [
  { field: 'name', header: 'Name', width: 200, filterable: true },
  { field: 'age', header: 'Age', type: 'number', width: 100, filterable: true },
];

let h: FeatureHarness<Row>;
afterEach(() => h?.destroy());

function setup(): {
  menu: FilterMenuFeature<Row>;
  filter: FilterFeature<Row>;
} {
  h = makeHarness<Row>({ store: makeStore(DATA.map((r) => ({ ...r }))), columns: COLS });
  const filter = h.api.use(filterFeature<Row>()) as FilterFeature<Row>;
  const menu = h.api.use(filterMenuFeature<Row>()) as FilterMenuFeature<Row>;
  return { menu, filter };
}

describe('operatorsForColumn', () => {
  it('offers text operators for text columns and numeric for number columns', () => {
    expect(operatorsForColumn(COLS[0]!)).toContain('contains');
    expect(operatorsForColumn(COLS[0]!)).not.toContain('between');
    expect(operatorsForColumn(COLS[1]!)).toContain('between');
    expect(operatorsForColumn(COLS[1]!)).toContain('gt');
  });

  it('honors a per-column meta.filterOperators override', () => {
    const col: ColumnDef<Row> = { field: 'name', meta: { filterOperators: ['eq'] } };
    expect(operatorsForColumn(col)).toEqual(['eq']);
  });
});

describe('FilterMenuFeature — operator application', () => {
  it('applies a unary operator (contains) with the entered operand', () => {
    const { menu, filter } = setup();
    menu.openFor('name', 0, 0);
    expect(menu.isOpen()).toBe(true);
    const popup = h.el.querySelector('.jects-grid-filter-menu')!;
    const row = popup.querySelector<HTMLElement>('[data-filter-op="contains"]')!.parentElement!;
    const input = row.querySelector<HTMLInputElement>('.jects-grid-filter-menu__input')!;
    input.value = 'da';
    row.querySelector<HTMLButtonElement>('[data-filter-op="contains"]')!.click();
    const state: FilterState[] = filter.forColumn('name');
    expect(state).toEqual([{ columnId: 'name', operator: 'contains', value: 'da' }]);
    expect(menu.isOpen()).toBe(false);
  });

  it('applies a nullary operator (notEmpty) immediately with no operand', () => {
    const { menu, filter } = setup();
    menu.openFor('name', 0, 0);
    const btn = h.el.querySelector<HTMLButtonElement>('[data-filter-op="notEmpty"]')!;
    btn.click();
    expect(filter.forColumn('name')).toEqual([
      { columnId: 'name', operator: 'notEmpty', value: undefined },
    ]);
  });

  it('applies a binary operator (between) with both operands as an array', () => {
    const { menu, filter } = setup();
    menu.openFor('age', 0, 0);
    const row = h.el.querySelector<HTMLElement>('[data-filter-op="between"]')!.parentElement!;
    const inputs = row.querySelectorAll<HTMLInputElement>('.jects-grid-filter-menu__input');
    inputs[0]!.value = '40';
    inputs[1]!.value = '90';
    row.querySelector<HTMLButtonElement>('[data-filter-op="between"]')!.click();
    expect(filter.forColumn('age')).toEqual([
      { columnId: 'age', operator: 'between', value: ['40', '90'] },
    ]);
  });

  it('the clear-filter footer removes the column filter', () => {
    const { menu, filter } = setup();
    filter.setColumnFilter('name', 'contains', 'a');
    expect(filter.isActive('name')).toBe(true);
    menu.openFor('name', 0, 0);
    h.el.querySelector<HTMLButtonElement>('[data-filter-menu-clear]')!.click();
    expect(filter.isActive('name')).toBe(false);
  });

  it('Enter in an operand input applies the operator', () => {
    const { menu, filter } = setup();
    menu.openFor('name', 0, 0);
    const row = h.el.querySelector<HTMLElement>('[data-filter-op="startsWith"]')!.parentElement!;
    const input = row.querySelector<HTMLInputElement>('.jects-grid-filter-menu__input')!;
    input.value = 'Ad';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(filter.forColumn('name')).toEqual([
      { columnId: 'name', operator: 'startsWith', value: 'Ad' },
    ]);
  });
});

describe('FilterMenuFeature — trigger + close', () => {
  it('opens from a [data-filter-menu] header trigger', () => {
    const { menu } = setup();
    const trigger = document.createElement('button');
    trigger.dataset['filterMenu'] = 'name';
    h.el.appendChild(trigger);
    trigger.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(menu.isOpen()).toBe(true);
  });

  it('Escape closes the popup', () => {
    vi.useFakeTimers();
    try {
      const { menu } = setup();
      menu.openFor('name', 0, 0);
      expect(menu.isOpen()).toBe(true);
      // The outside/Escape listener is registered on a deferred (0ms) timeout to
      // avoid catching the opening click — flush it before dispatching Escape.
      vi.runAllTimers();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      expect(menu.isOpen()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not open for a non-filterable column', () => {
    h = makeHarness<Row>({
      store: makeStore(DATA.map((r) => ({ ...r }))),
      columns: [{ field: 'name', filterable: false }],
    });
    h.api.use(filterFeature<Row>());
    const menu = h.api.use(filterMenuFeature<Row>()) as FilterMenuFeature<Row>;
    menu.openFor('name', 0, 0);
    expect(menu.isOpen()).toBe(false);
  });

  it('teardown removes any open popup', () => {
    const { menu } = setup();
    menu.openFor('name', 0, 0);
    h.api.removeFeature('filterMenu');
    expect(menu.isOpen()).toBe(false);
    expect(h.el.querySelector('.jects-grid-filter-menu')).toBeNull();
  });
});
