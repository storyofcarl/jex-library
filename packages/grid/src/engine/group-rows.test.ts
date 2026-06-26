/**
 * jsdom unit tests for the group row-source seam:
 *   - RowModel.setRowSource() drives the visible row list from a provider,
 *   - GridEngine.setRowSource() pass-through + re-materialize,
 *   - paintGroupRow() builds a token-class group-header band, and
 *   - GroupRowSource adapts GroupFeature.getViewRows() into RowEntry[].
 */
import { describe, it, expect } from 'vitest';
import { type Store } from '@jects/core';
import { RowModel, type RowEntry, type RowSource } from './row-model.js';
import { GridEngine } from './engine.js';
import { paintGroupRow, formatGroupValue, formatAggregate } from './group-row-paint.js';
import { resolveColumns } from './column-layout.js';
import { GroupRowSource } from '../features/group-row-source.js';
import { GroupFeature } from '../features/group.js';
import { makeHarness, makeStore } from '../features/test-harness.js';
import type { ColumnDef } from '../contract.js';

interface Row {
  id: number;
  dept: string;
  amount: number;
}

const ROWS: Row[] = [
  { id: 1, dept: 'Sales', amount: 100 },
  { id: 2, dept: 'Sales', amount: 200 },
  { id: 3, dept: 'Eng', amount: 50 },
];

const COLUMNS: ColumnDef<Row>[] = [
  { field: 'dept', header: 'Dept', width: 120 },
  { field: 'amount', header: 'Amount', type: 'number', width: 100 },
];

describe('RowModel row-source seam', () => {
  it('drives visible rows from an installed source and ignores the store', () => {
    const rm = new RowModel<Row>(ROWS);
    expect(rm.count).toBe(3);

    const sourced: RowEntry<Row>[] = [
      {
        row: undefined as unknown as Row,
        id: 'group:Sales',
        depth: 0,
        hasChildren: true,
        expanded: true,
        kind: 'group',
        group: {
          key: 'Sales',
          columnId: 'dept',
          value: 'Sales',
          depth: 0,
          count: 2,
          collapsed: false,
          summary: { amount: 300 },
        },
      },
      { row: ROWS[0]!, id: 1, depth: 1, hasChildren: false, expanded: false, kind: 'row' },
    ];
    const source: RowSource<Row> = { getRowEntries: () => sourced };
    rm.setRowSource(source);

    expect(rm.hasRowSource()).toBe(true);
    expect(rm.count).toBe(2);
    expect(rm.entryAt(0)?.kind).toBe('group');
    expect(rm.entryAt(0)?.group?.value).toBe('Sales');
    // Group bands are NOT id-addressable; leaf rows are.
    expect(rm.indexOf(1)).toBe(1);
    expect(rm.indexOf('group:Sales' as never)).toBe(-1);

    rm.setRowSource(null);
    rm.invalidate();
    expect(rm.hasRowSource()).toBe(false);
    expect(rm.count).toBe(3);
  });

  it('re-pulls the source on invalidate (collapse changes the list)', () => {
    const rm = new RowModel<Row>(ROWS);
    let collapsed = false;
    const source: RowSource<Row> = {
      getRowEntries: () =>
        collapsed
          ? [grpEntry(true)]
          : [grpEntry(false), { row: ROWS[0]!, id: 1, depth: 1, hasChildren: false, expanded: false, kind: 'row' }],
    };
    rm.setRowSource(source);
    expect(rm.count).toBe(2);
    collapsed = true;
    rm.invalidate();
    expect(rm.count).toBe(1);
    expect(rm.entryAt(0)?.group?.collapsed).toBe(true);
  });
});

function grpEntry(collapsed: boolean): RowEntry<Row> {
  return {
    row: undefined as unknown as Row,
    id: 'group:Sales',
    depth: 0,
    hasChildren: true,
    expanded: !collapsed,
    kind: 'group',
    group: {
      key: 'Sales',
      columnId: 'dept',
      value: 'Sales',
      depth: 0,
      count: 2,
      collapsed,
      summary: {},
    },
  };
}

describe('GridEngine.setRowSource', () => {
  it('routes getRowEntry/getRowCount through the source and back', () => {
    const engine = new GridEngine<Row>({ data: ROWS, columns: COLUMNS });
    expect(engine.getRowCount()).toBe(3);

    const source: RowSource<Row> = { getRowEntries: () => [grpEntry(false)] };
    engine.setRowSource(source);
    expect(engine.hasRowSource()).toBe(true);
    expect(engine.getRowCount()).toBe(1);
    expect(engine.getRowEntry(0)?.kind).toBe('group');

    engine.setRowSource(null);
    expect(engine.getRowCount()).toBe(3);
  });
});

describe('paintGroupRow', () => {
  it('paints a full-width band with toggle, caption, count, and aggregate cells', () => {
    const layout = resolveColumns(COLUMNS, 600);
    const el = document.createElement('div');
    el.className = 'jects-grid__row';
    paintGroupRow(
      el,
      {
        key: 'Sales',
        columnId: 'dept',
        value: 'Sales',
        depth: 0,
        count: 2,
        collapsed: false,
        summary: { amount: 300 },
      },
      layout,
      { columnHeader: 'Dept' },
    );

    expect(el.classList.contains('jects-grid-group-row')).toBe(true);
    expect(el.getAttribute('role')).toBe('row');
    // aria-expanded lives on the lead gridcell (a grid `row` can't carry it).
    expect(el.hasAttribute('aria-expanded')).toBe(false);
    expect(el.dataset['groupKey']).toBe('Sales');

    const lead = el.querySelector('.jects-grid-group__lead') as HTMLElement;
    expect(lead.getAttribute('role')).toBe('gridcell');
    expect(lead.getAttribute('aria-expanded')).toBe('true');

    const toggle = el.querySelector('[data-group-toggle]') as HTMLButtonElement;
    expect(toggle).toBeTruthy();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.querySelector('.jects-grid-group__chevron--open')).toBeTruthy();

    expect(el.querySelector('.jects-grid-group__value')?.textContent).toBe('Sales');
    expect(el.querySelector('.jects-grid-group__count')?.textContent).toBe('(2)');

    const agg = el.querySelector('.jects-grid-group__agg') as HTMLElement;
    expect(agg).toBeTruthy();
    expect(agg.getAttribute('role')).toBe('gridcell');
    expect(agg.textContent).toBe('300');
    // numeric column → end-aligned aggregate.
    expect(agg.classList.contains('jects-grid-group__agg--end')).toBe(true);
  });

  it('shows a collapsed chevron + (none) for empty values', () => {
    const layout = resolveColumns(COLUMNS, 600);
    const el = document.createElement('div');
    paintGroupRow(
      el,
      { key: 'k', columnId: 'dept', value: null, depth: 0, count: 0, collapsed: true, summary: {} },
      layout,
    );
    expect(el.querySelector('.jects-grid-group__lead')?.getAttribute('aria-expanded')).toBe('false');
    expect(el.querySelector('.jects-grid-group__chevron--open')).toBeNull();
    expect(el.querySelector('.jects-grid-group__value')?.textContent).toBe('(none)');
  });

  it('formatters handle numbers, dates, and nullish', () => {
    expect(formatAggregate(300)).toBe('300');
    expect(formatAggregate(1.5)).toBe('1.50');
    expect(formatAggregate(null)).toBe('');
    expect(formatGroupValue('')).toBe('(none)');
    expect(formatGroupValue('EU')).toBe('EU');
  });
});

describe('GroupRowSource adapter', () => {
  it('maps a GroupFeature view into engine row entries', () => {
    const h = makeHarness<Row>({ store: makeStore(ROWS), columns: COLUMNS });
    const f = h.api.use(new GroupFeature<Row>({ aggregations: { amount: 'sum' } })) as GroupFeature<Row>;
    f.setGroups(['dept']);

    const source = new GroupRowSource<Row>(f, (h.api.store as Store<Row>).idField);
    const entries = source.getRowEntries();

    // group(Sales), row, row, group(Eng), row
    expect(entries.map((e) => e.kind)).toEqual(['group', 'row', 'row', 'group', 'row']);
    const salesGroup = entries[0]!;
    expect(salesGroup.group?.value).toBe('Sales');
    expect(salesGroup.group?.count).toBe(2);
    expect(salesGroup.group?.summary['amount']).toBe(300);
    // leaf rows carry their store id.
    expect(entries[1]!.id).toBe(1);
    expect(entries[1]!.row.dept).toBe('Sales');
    h.destroy();
  });
});
