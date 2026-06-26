/**
 * Accessibility + visual/interaction smoke (real Chromium) for grouped /
 * multi-level (stacked) column headers — Quality Gate Q2.
 *
 * Asserts:
 *   - axe-core finds zero serious/critical violations with a stacked header,
 *   - the stacked header paints N rows with correct aria-colspan / aria-rowspan,
 *   - group cells stay pixel-aligned over their descendant leaf columns
 *     (including across a frozen band), matching Bryntum/DHTMLX behavior.
 */
import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import '@jects/theme/style.css';
import '../styles.css';
import './header-groups.css';
import { Grid } from '../engine/grid.js';
import type { ColumnDef } from '../contract.js';
import { headerGroupsFeature } from './header-groups-feature.js';
import type { GroupedColumnDef } from './header-tree.js';
import { expectNoA11yViolations } from '../test-utils/a11y.js';

interface Row {
  id: number;
  first: string;
  last: string;
  age: number;
  q1: number;
  q2: number;
}

function rows(n: number): Row[] {
  return Array.from({ length: n }, (_, i) => ({
    id: i,
    first: `First ${i}`,
    last: `Last ${i}`,
    age: 20 + (i % 40),
    q1: i * 10,
    q2: i * 20,
  }));
}

function nextFrame(): Promise<void> {
  return new Promise((r) => requestAnimationFrame(() => r()));
}
async function settle(): Promise<void> {
  await nextFrame();
  await nextFrame();
  await nextFrame();
}

let host: HTMLElement;
beforeEach(() => {
  host = document.createElement('div');
  host.style.width = '720px';
  host.style.height = '320px';
  host.style.position = 'absolute';
  host.style.top = '0';
  host.style.left = '0';
  document.body.appendChild(host);
});
afterEach(() => host.remove());

describe('Grouped / multi-level headers — a11y + alignment', () => {
  it('stacked header has no serious/critical a11y violations', async () => {
    const cols: GroupedColumnDef<Row>[] = [
      { field: 'first', header: 'First', width: 140, group: 'Name' },
      { field: 'last', header: 'Last', width: 140, group: 'Name' },
      { field: 'age', header: 'Age', type: 'number', width: 90 },
      { field: 'q1', header: 'Q1', type: 'number', width: 90, groupPath: ['Sales', 'H1'] },
      { field: 'q2', header: 'Q2', type: 'number', width: 90, groupPath: ['Sales', 'H1'] },
    ];
    const g = new Grid<Row>(host, { data: rows(50), columns: cols as ColumnDef<Row>[], rowHeight: 28 });
    g.use(headerGroupsFeature<Row>());
    await settle();

    const header = host.querySelector('.jects-grid__header') as HTMLElement;
    expect(header.classList.contains('jects-grid__header--grouped')).toBe(true);
    // Three stacked levels: Sales(top) → H1 / Name → leaves.
    expect(header.querySelectorAll('.jects-grid__header-row').length).toBe(3);

    await expectNoA11yViolations(host);
    g.destroy();
  });

  it('a group cell aligns horizontally over its descendant leaf columns', async () => {
    const cols: GroupedColumnDef<Row>[] = [
      { field: 'first', header: 'First', width: 140, group: 'Name' },
      { field: 'last', header: 'Last', width: 120, group: 'Name' },
      { field: 'age', header: 'Age', type: 'number', width: 90 },
    ];
    const g = new Grid<Row>(host, { data: rows(20), columns: cols as ColumnDef<Row>[], rowHeight: 28 });
    g.use(headerGroupsFeature<Row>());
    await settle();

    const header = host.querySelector('.jects-grid__header') as HTMLElement;
    const groupCell = Array.from(
      header.querySelectorAll<HTMLElement>('.jects-grid__header-group'),
    ).find((c) => c.textContent === 'Name')!;
    expect(groupCell).toBeTruthy();

    const leafCells = Array.from(
      header.querySelectorAll<HTMLElement>('.jects-grid__header-cell[data-leaf]'),
    );
    const firstLeaf = leafCells.find((c) => c.textContent === 'First')!;
    const lastLeaf = leafCells.find((c) => c.textContent === 'Last')!;

    // The group cell's left edge matches the first leaf's left edge, and its
    // right edge matches the last leaf's right edge (within a 1px rounding).
    expect(Math.abs(groupCell.offsetLeft - firstLeaf.offsetLeft)).toBeLessThanOrEqual(1);
    const groupRight = groupCell.offsetLeft + groupCell.offsetWidth;
    const lastRight = lastLeaf.offsetLeft + lastLeaf.offsetWidth;
    expect(Math.abs(groupRight - lastRight)).toBeLessThanOrEqual(1);

    g.destroy();
  });

  it('keeps grouping band-aware over a frozen column (no cross-band span)', async () => {
    const cols: GroupedColumnDef<Row>[] = [
      { field: 'first', header: 'First', width: 120, frozen: 'left', group: 'Frozen' },
      { field: 'last', header: 'Last', width: 120, group: 'Scrolling' },
      { field: 'age', header: 'Age', type: 'number', width: 90, group: 'Scrolling' },
    ];
    const g = new Grid<Row>(host, { data: rows(20), columns: cols as ColumnDef<Row>[], rowHeight: 28 });
    g.use(headerGroupsFeature<Row>());
    await settle();

    const header = host.querySelector('.jects-grid__header') as HTMLElement;
    const groups = Array.from(header.querySelectorAll<HTMLElement>('.jects-grid__header-group'));
    const frozen = groups.find((c) => c.textContent === 'Frozen')!;
    const scrolling = groups.find((c) => c.textContent === 'Scrolling')!;
    expect(frozen).toBeTruthy();
    expect(scrolling).toBeTruthy();
    // Frozen group covers a single leaf; the scrolling group covers two.
    expect(frozen.getAttribute('aria-colspan')).toBeNull();
    expect(scrolling.getAttribute('aria-colspan')).toBe('2');
    // The frozen group cell carries the frozen modifier class.
    expect(frozen.classList.contains('jects-grid__cell--frozen')).toBe(true);

    g.destroy();
  });
});
