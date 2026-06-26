/**
 * Accessibility (axe-core) + visual/interaction smoke for grouped grids — runs
 * in real Chromium (`pnpm test:browser`). Exercises the Group feature parity:
 * collapsible group-header bands rendered in the body with per-group summaries,
 * click-to-collapse, and zero serious/critical a11y violations.
 */
import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import '@jects/theme/style.css';
import '../styles.css';
import { Grid } from './grid.js';
import { groupFeature, type GroupFeature } from '../features/group.js';
import type { ColumnDef } from '../contract.js';
import { expectNoA11yViolations } from '../test-utils/a11y.js';

interface Row {
  id: number;
  dept: string;
  region: string;
  amount: number;
}

const DATA: Row[] = [
  { id: 1, dept: 'Sales', region: 'EU', amount: 100 },
  { id: 2, dept: 'Sales', region: 'US', amount: 200 },
  { id: 3, dept: 'Sales', region: 'EU', amount: 30 },
  { id: 4, dept: 'Eng', region: 'EU', amount: 50 },
  { id: 5, dept: 'Eng', region: 'US', amount: 70 },
  { id: 6, dept: 'Ops', region: 'APAC', amount: 90 },
];

const cols: ColumnDef<Row>[] = [
  { field: 'dept', header: 'Dept', width: 160 },
  { field: 'region', header: 'Region', width: 120 },
  { field: 'amount', header: 'Amount', type: 'number', width: 120 },
];

let host: HTMLElement;
beforeEach(() => {
  host = document.createElement('div');
  host.style.width = '520px';
  host.style.height = '360px';
  document.body.appendChild(host);
});
afterEach(() => host.remove());

describe('Grouped Grid a11y + interaction', () => {
  it('paints collapsible group bands with summaries and has no serious/critical violations', async () => {
    const g = new Grid<Row>(host, {
      data: DATA,
      columns: cols,
      rowHeight: 30,
      plugins: [groupFeature<Row>({ aggregations: { amount: 'sum' } })],
    });
    const group = g.features.get('group') as GroupFeature<Row>;
    group.setGroups(['dept']);
    g.refresh();

    const root = host.querySelector('.jects-grid') as HTMLElement;
    const bands = root.querySelectorAll<HTMLElement>('.jects-grid-group-row');
    expect(bands.length).toBe(3); // Sales, Eng, Ops

    // Each band is a row with an expanded toggle and a labelled aggregate.
    const sales = bands[0]!;
    expect(sales.getAttribute('role')).toBe('row');
    expect(sales.querySelector('.jects-grid-group__lead')?.getAttribute('aria-expanded')).toBe('true');
    const toggle = sales.querySelector<HTMLButtonElement>('[data-group-toggle]')!;
    expect(toggle.getAttribute('aria-label')).toContain('group');
    expect(sales.querySelector('.jects-grid-group__agg')?.textContent).toBe('330');

    await expectNoA11yViolations(host);
    g.destroy();
  });

  it('collapses a group on band click and stays accessible', async () => {
    const g = new Grid<Row>(host, {
      data: DATA,
      columns: cols,
      rowHeight: 30,
      plugins: [groupFeature<Row>({ aggregations: { amount: 'sum' } })],
    });
    const group = g.features.get('group') as GroupFeature<Row>;
    group.setGroups(['dept']);
    g.refresh();

    const root = host.querySelector('.jects-grid') as HTMLElement;
    const before = g.getRowCount();
    const sales = root.querySelector<HTMLElement>('.jects-grid-group-row')!;
    const key = sales.dataset['groupKey']!;
    sales.click();

    expect(group.isCollapsed(key)).toBe(true);
    expect(g.getRowCount()).toBeLessThan(before);
    // The band reflects the collapsed state for AT.
    const collapsedBand = root.querySelector<HTMLElement>(
      `.jects-grid-group-row[data-group-key="${key}"]`,
    )!;
    expect(collapsedBand.querySelector('.jects-grid-group__lead')?.getAttribute('aria-expanded')).toBe(
      'false',
    );

    await expectNoA11yViolations(host);
    g.destroy();
  });
});
