/**
 * jsdom integration tests: grouping actually changes what the Grid body paints.
 *
 * These exercise the full seam end to end through the real Grid widget — the
 * GroupFeature installs a RowSource on the engine, the DomRenderer paints
 * full-width collapsible group-header bands, and a click on a band toggles the
 * group (re-pulling the row source + repainting). This is the behavior that was
 * previously a no-op (grouping computed a view model nobody rendered).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { type Store } from '@jects/core';
import { Grid } from './grid.js';
import { type GroupFeature, groupFeature } from '../features/group.js';
import type { ColumnDef } from '../contract.js';

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
];

const COLUMNS: ColumnDef<Row>[] = [
  { field: 'dept', header: 'Dept', width: 120 },
  { field: 'region', header: 'Region', width: 100 },
  { field: 'amount', header: 'Amount', type: 'number', width: 100 },
];

let host: HTMLElement;
beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => host.remove());

function groupBands(): NodeListOf<HTMLElement> {
  return host.querySelectorAll<HTMLElement>('.jects-grid-group-row');
}

describe('Grid grouping renders in the body', () => {
  it('paints a group-header band per group when grouping is applied', () => {
    const g = new Grid<Row>(host, {
      data: ROWS,
      columns: COLUMNS,
      rowHeight: 20,
      features: { group: true },
    });
    const group = g.features.get('group') as GroupFeature<Row>;
    expect(group).toBeTruthy();

    group.setAggregations({ amount: 'sum' });
    group.setGroups(['dept']);
    g.refresh();

    const bands = groupBands();
    // Two groups: Sales, Eng.
    expect(bands.length).toBe(2);
    const values = [...bands].map((b) => b.querySelector('.jects-grid-group__value')?.textContent);
    expect(values).toEqual(['Sales', 'Eng']);

    // Count badge + per-group aggregate cell paint.
    const salesBand = bands[0]!;
    expect(salesBand.querySelector('.jects-grid-group__count')?.textContent).toBe('(2)');
    const agg = salesBand.querySelector('.jects-grid-group__agg') as HTMLElement;
    expect(agg?.textContent).toBe('300');
    g.destroy();
  });

  it('clicking a group band collapses it (hides its leaf rows)', () => {
    const g = new Grid<Row>(host, {
      data: ROWS,
      columns: COLUMNS,
      rowHeight: 20,
      plugins: [groupFeature<Row>({ aggregations: { amount: 'sum' } })],
    });
    const group = g.features.get('group') as GroupFeature<Row>;
    group.setGroups(['dept']);
    g.refresh();

    const before = g.getRowCount(); // 2 groups + 4 leaves = 6
    expect(before).toBe(6);

    const salesBand = groupBands()[0]!;
    const key = salesBand.dataset['groupKey']!;
    expect(key).toBeTruthy();
    salesBand.click();

    expect(group.isCollapsed(key)).toBe(true);
    // Sales had 2 leaves; collapsing removes them from the visible row list.
    expect(g.getRowCount()).toBe(before - 2);
    g.destroy();
  });

  it('toggle chevron Enter key collapses the group', () => {
    const g = new Grid<Row>(host, {
      data: ROWS,
      columns: COLUMNS,
      rowHeight: 20,
      plugins: [groupFeature<Row>()],
    });
    const group = g.features.get('group') as GroupFeature<Row>;
    group.setGroups(['dept']);
    g.refresh();

    const band = groupBands()[0]!;
    const key = band.dataset['groupKey']!;
    const toggle = band.querySelector<HTMLButtonElement>('[data-group-toggle]')!;
    toggle.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(group.isCollapsed(key)).toBe(true);
    g.destroy();
  });

  it('clearing grouping restores the flat (no-band) view', () => {
    const g = new Grid<Row>(host, { data: ROWS, columns: COLUMNS, rowHeight: 20, features: { group: true } });
    const group = g.features.get('group') as GroupFeature<Row>;
    group.setGroups(['dept']);
    g.refresh();
    expect(groupBands().length).toBe(2);

    group.clear();
    g.refresh();
    expect(groupBands().length).toBe(0);
    // Flat view: 4 data rows, no bands.
    expect(g.getRowCount()).toBe(4);
    g.destroy();
  });

  it('emits groupChange and recovers leaf cells when a band recycles to a row', () => {
    const g = new Grid<Row>(host, { data: ROWS, columns: COLUMNS, rowHeight: 20, features: { group: true } });
    const group = g.features.get('group') as GroupFeature<Row>;

    let fired = false;
    g.on('groupChange', () => (fired = true));
    group.setGroups(['dept']);
    g.refresh();
    expect(fired).toBe(true);

    // Removing grouping reuses pooled rows that were group bands as leaf rows;
    // those must repaint real data cells (regression guard for stale band DOM).
    group.clear();
    g.refresh();
    const cells = host.querySelectorAll('.jects-grid__row:not(.jects-grid-group-row) .jects-grid__cell');
    expect(cells.length).toBeGreaterThan(0);
    expect(groupBands().length).toBe(0);
    g.destroy();
  });

  it('nested grouping paints bands at multiple depths', () => {
    const g = new Grid<Row>(host, { data: ROWS, columns: COLUMNS, rowHeight: 20, features: { group: true } });
    const group = g.features.get('group') as GroupFeature<Row>;
    group.setGroups(['dept', 'region']);
    g.refresh();
    const depths = new Set([...groupBands()].map((b) => b.dataset['groupDepth']));
    expect(depths.has('0')).toBe(true);
    expect(depths.has('1')).toBe(true);
    g.destroy();
  });

  it('row-source is uninstalled when the group feature is removed', () => {
    const g = new Grid<Row>(host, { data: ROWS, columns: COLUMNS, rowHeight: 20, features: { group: true } });
    const group = g.features.get('group') as GroupFeature<Row>;
    group.setGroups(['dept']);
    g.refresh();
    expect(groupBands().length).toBe(2);

    g.removeFeature('group');
    g.refresh();
    expect(groupBands().length).toBe(0);
    expect((g.store as Store<Row>).count).toBe(4);
    g.destroy();
  });
});
