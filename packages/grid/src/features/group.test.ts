/** jsdom unit tests for GroupFeature + SummaryFeature aggregations. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Model } from '@jects/core';
import type { ColumnDef } from '../contract.js';
import { GroupFeature, computeAggregate, type GroupViewRow } from './group.js';
import { SummaryFeature } from './summary.js';
import { makeHarness, makeStore, type FeatureHarness } from './test-harness.js';

interface Row {
  id: number;
  dept: string;
  region: string;
  amount: number;
}

const ROWS: Row[] = [
  { id: 1, dept: 'Sales', region: 'EU', amount: 100 },
  { id: 2, dept: 'Sales', region: 'US', amount: 200 },
  { id: 3, dept: 'Eng', region: 'EU', amount: 50 },
  { id: 4, dept: 'Eng', region: 'US', amount: 70 },
  { id: 5, dept: 'Sales', region: 'EU', amount: 30 },
];

const COLUMNS: ColumnDef<Row>[] = [
  { field: 'dept', header: 'Dept' },
  { field: 'region', header: 'Region' },
  { field: 'amount', header: 'Amount', type: 'number' },
];

let h: FeatureHarness<Row>;
beforeEach(() => {
  h = makeHarness<Row>({ store: makeStore(ROWS), columns: COLUMNS });
});
afterEach(() => h.destroy());

describe('computeAggregate', () => {
  const col: ColumnDef<Row> = { field: 'amount', type: 'number' };
  it('sum / avg / min / max / count', () => {
    expect(computeAggregate(ROWS, col, 'sum')).toBe(450);
    expect(computeAggregate(ROWS, col, 'avg')).toBe(90);
    expect(computeAggregate(ROWS, col, 'min')).toBe(30);
    expect(computeAggregate(ROWS, col, 'max')).toBe(200);
    expect(computeAggregate(ROWS, col, 'count')).toBe(5);
  });
  it('custom reducer', () => {
    const agg = computeAggregate(ROWS, col, (rows) => rows.length * 2);
    expect(agg).toBe(10);
  });
  it('empty rows give null for math aggs', () => {
    expect(computeAggregate([], col, 'avg')).toBe(null);
    expect(computeAggregate([], col, 'sum')).toBe(0);
  });
});

describe('GroupFeature (jsdom)', () => {
  it('groups by one column with per-group sums', () => {
    const f = h.api.use(
      new GroupFeature<Row>({ aggregations: { amount: 'sum' } }),
    ) as GroupFeature<Row>;
    f.setGroups(['dept']);
    const view = f.getViewRows();
    const groups = view.filter((r): r is Extract<GroupViewRow<Row>, { kind: 'group' }> => r.kind === 'group');
    expect(groups.map((g) => g.value)).toEqual(['Sales', 'Eng']);
    const sales = groups.find((g) => g.value === 'Sales')!;
    expect(sales.count).toBe(3);
    expect(sales.summary['amount']).toBe(330);
  });

  it('flattened view interleaves group headers and leaf rows', () => {
    const f = h.api.use(new GroupFeature<Row>()) as GroupFeature<Row>;
    f.setGroups(['dept']);
    const kinds = f.getViewRows().map((r) => r.kind);
    // group, row, row, row, group, row, row
    expect(kinds).toEqual(['group', 'row', 'row', 'row', 'group', 'row', 'row']);
  });

  it('nested grouping builds a two-level hierarchy', () => {
    const f = h.api.use(
      new GroupFeature<Row>({ aggregations: { amount: 'sum' } }),
    ) as GroupFeature<Row>;
    f.setGroups(['dept', 'region']);
    const view = f.getViewRows();
    const depths = view.filter((r) => r.kind === 'group').map((r) => r.depth);
    expect(depths).toContain(0);
    expect(depths).toContain(1);
  });

  it('collapsing a group hides its leaf rows', () => {
    const f = h.api.use(new GroupFeature<Row>()) as GroupFeature<Row>;
    f.setGroups(['dept']);
    const salesKey = f
      .getViewRows()
      .find((r) => r.kind === 'group' && r.value === 'Sales')! as Extract<
      GroupViewRow<Row>,
      { kind: 'group' }
    >;
    const before = f.getViewRowCount();
    f.toggleGroup(salesKey.key);
    expect(f.getViewRowCount()).toBe(before - 3);
    expect(f.isCollapsed(salesKey.key)).toBe(true);
  });

  it('footer aggregates over the whole view', () => {
    const f = h.api.use(
      new GroupFeature<Row>({ aggregations: { amount: 'sum' }, footerAggregations: { amount: 'sum', id: 'count' } }),
    ) as GroupFeature<Row>;
    f.setGroups(['dept']);
    const footer = f.getFooter();
    expect(footer['amount']).toBe(450);
    expect(footer['id']).toBe(5);
  });

  it('emits groupChange and refreshes', () => {
    const f = h.api.use(new GroupFeature<Row>()) as GroupFeature<Row>;
    const spy = vi.fn();
    h.api.on('groupChange', spy);
    f.groupBy('dept');
    expect(spy).toHaveBeenCalled();
    expect(spy.mock.calls.at(-1)![0].group.columnIds).toEqual(['dept']);
  });

  it('clear restores a flat view', () => {
    const f = h.api.use(new GroupFeature<Row>()) as GroupFeature<Row>;
    f.setGroups(['dept']);
    f.clear();
    expect(f.isActive()).toBe(false);
    expect(f.getViewRows().every((r) => r.kind === 'row')).toBe(true);
    expect(f.getViewRowCount()).toBe(5);
  });

  it('does not alias distinct group paths whose segments contain the join delimiter', () => {
    // Values chosen so a naive `path.join(' ')` would collapse two distinct
    // 2-level paths to the same key: ['A', 'B C'] vs ['A B', 'C'] both join to
    // "string:A string:B C"-ish. A collision would make collapsing one group
    // wrongly hide rows of the other.
    interface R extends Model {
      id: number;
      a: string;
      b: string;
    }
    const data: R[] = [
      { id: 1, a: 'A', b: 'B C' },
      { id: 2, a: 'A B', b: 'C' },
    ];
    const cols: ColumnDef<R>[] = [
      { field: 'a', header: 'A' },
      { field: 'b', header: 'B' },
    ];
    const h2 = makeHarness<R>({ store: makeStore(data), columns: cols });
    const f = h2.api.use(new GroupFeature<R>()) as GroupFeature<R>;
    f.setGroups(['a', 'b']);

    const leafGroups = f
      .getViewRows()
      .filter((r): r is Extract<GroupViewRow<R>, { kind: 'group' }> => r.kind === 'group')
      .filter((g) => g.depth === 1);
    const keys = new Set(leafGroups.map((g) => g.key));
    // Two distinct depth-1 groups → two distinct keys (no collision).
    expect(leafGroups.length).toBe(2);
    expect(keys.size).toBe(2);

    // Collapsing one leaf group must not collapse the other (independent state).
    const [first, second] = leafGroups;
    f.toggleGroup(first!.key);
    expect(f.isCollapsed(first!.key)).toBe(true);
    expect(f.isCollapsed(second!.key)).toBe(false);
    h2.destroy();
  });
});

describe('SummaryFeature (jsdom)', () => {
  it('renders a footer with per-column aggregates', () => {
    const f = h.api.use(
      new SummaryFeature<Row>({ aggregations: { amount: 'sum' } }),
    ) as SummaryFeature<Row>;
    expect(h.el.querySelector('.jects-grid-summary')).toBeTruthy();
    expect(f.valueOf('amount')).toBe(450);
    const cells = h.el.querySelectorAll('.jects-grid-summary__cell');
    expect(cells.length).toBe(3);
  });

  it('recomputes when the store changes', () => {
    const f = h.api.use(
      new SummaryFeature<Row>({ aggregations: { amount: 'sum' } }),
    ) as SummaryFeature<Row>;
    expect(f.valueOf('amount')).toBe(450);
    h.api.store.add({ id: 6, dept: 'Eng', region: 'US', amount: 50 });
    expect(f.valueOf('amount')).toBe(500);
  });

  it('removes its DOM on destroy', () => {
    h.api.use(new SummaryFeature<Row>({ aggregations: { amount: 'count' } }));
    h.api.removeFeature('summary');
    expect(h.el.querySelector('.jects-grid-summary')).toBeNull();
  });
});
