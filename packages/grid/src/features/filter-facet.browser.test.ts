/**
 * FilterFacetFeature — real-Chromium a11y + interaction test.
 *
 * Mounts a real Grid, installs FilterFeature + FilterFacetFeature, opens the
 * faceted (set / checklist) popup, and:
 *   - asserts axe-core finds zero serious/critical violations (Q2 bar),
 *   - asserts the popup exposes a dialog role + labelled checkboxes + a search box,
 *   - exercises real checkbox clicks to narrow the value set and Apply, then
 *     verifies the grid actually filters,
 *   - exercises the search box + Select-all master checkbox,
 *   - verifies Escape closes the popup.
 */
import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import '@jects/theme/style.css';
import '@jects/widgets/style.css';
import '../styles.css';
import './filter-facet.css';
import { Grid } from '../engine/grid.js';
import type { ColumnDef } from '../contract.js';
import { FilterFeature } from './filter.js';
import { FilterFacetFeature } from './filter-facet.js';
import { expectNoA11yViolations } from '../test-utils/a11y.js';

interface Row {
  id: number;
  name: string;
  dept: string;
  city: string;
}

const columns: ColumnDef<Row>[] = [
  { field: 'name', header: 'Name', id: 'name', width: 160 },
  { field: 'dept', header: 'Dept', id: 'dept', width: 140, filterable: true },
  { field: 'city', header: 'City', id: 'city', width: 140, filterable: true },
];

const DEPTS = ['Eng', 'Sales', 'Ops', 'HR'];
const CITIES = ['NYC', 'LA', 'SF'];

function rows(n: number): Row[] {
  return Array.from({ length: n }, (_, i) => ({
    id: i,
    name: `Name ${i}`,
    dept: DEPTS[i % DEPTS.length]!,
    city: CITIES[i % CITIES.length]!,
  }));
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function rowCount(grid: Grid<Row>): number {
  return grid.getRowCount();
}

let host: HTMLElement;
let grid: Grid<Row>;
let filter: FilterFeature<Row>;
let facet: FilterFacetFeature<Row>;

beforeEach(() => {
  host = document.createElement('div');
  host.style.width = '700px';
  host.style.height = '320px';
  host.style.position = 'absolute';
  host.style.top = '0';
  host.style.left = '0';
  document.body.appendChild(host);
  grid = new Grid<Row>(host, { data: rows(40), columns, rowHeight: 32 });
  filter = grid.use(new FilterFeature<Row>()) as FilterFeature<Row>;
  facet = grid.use(new FilterFacetFeature<Row>()) as FilterFacetFeature<Row>;
});

afterEach(() => {
  grid.destroy();
  host.remove();
});

describe('FilterFacetFeature (Chromium)', () => {
  it('opens an accessible checklist popup (axe clean)', async () => {
    await nextFrame();
    facet.open('dept', 20, 20);
    const popup = host.querySelector('.jects-grid-facet') as HTMLElement;
    expect(popup).toBeTruthy();
    expect(popup.getAttribute('role')).toBe('dialog');

    // 4 distinct depts → 4 value checkboxes + 1 "Select all" master = 5 inputs,
    // plus the search input.
    const checks = popup.querySelectorAll<HTMLInputElement>('.jects-checkbox__input');
    expect(checks.length).toBe(5);
    expect(popup.querySelector('.jects-grid-facet__search-input')).toBeTruthy();

    await expectNoA11yViolations(popup);
  });

  it('checking a subset and Apply filters the grid', async () => {
    await nextFrame();
    const before = rowCount(grid);
    expect(before).toBe(40);

    facet.open('dept');
    const popup = host.querySelector('.jects-grid-facet') as HTMLElement;

    // Uncheck every dept except "Eng" via real clicks.
    const valueRows = popup.querySelectorAll<HTMLElement>('.jects-grid-facet__row');
    for (const r of Array.from(valueRows)) {
      const labelText = r.querySelector('.jects-checkbox__label')?.textContent?.trim();
      if (labelText !== 'Eng') {
        r.querySelector<HTMLInputElement>('.jects-checkbox__input')!.click();
      }
    }
    popup.querySelector<HTMLButtonElement>('.jects-grid-facet__apply')!.click();
    await nextFrame();

    // Only Eng rows survive (every 4th id starting at 0 → 10 of 40).
    expect(rowCount(grid)).toBe(10);
    expect(filter.forColumn('dept')[0]!.operator).toBe('in');
    expect(facet.isOpen()).toBe(false);
  });

  it('the search box filters the visible value list', async () => {
    await nextFrame();
    facet.open('city');
    const popup = host.querySelector('.jects-grid-facet') as HTMLElement;
    expect(popup.querySelectorAll('.jects-grid-facet__row').length).toBe(3);

    const search = popup.querySelector<HTMLInputElement>('.jects-grid-facet__search-input')!;
    search.value = 'NY';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    await nextFrame();
    const visible = popup.querySelectorAll('.jects-grid-facet__row');
    expect(visible.length).toBe(1);
    expect(visible[0]!.textContent).toContain('NYC');
  });

  it('the Select-all master checkbox toggles every value', async () => {
    await nextFrame();
    facet.open('dept');
    const popup = host.querySelector('.jects-grid-facet') as HTMLElement;
    const master = popup.querySelector<HTMLInputElement>(
      '.jects-grid-facet__selectall .jects-checkbox__input',
    )!;
    // Uncheck all via the master, then apply → no rows.
    master.click();
    popup.querySelector<HTMLButtonElement>('.jects-grid-facet__apply')!.click();
    await nextFrame();
    expect(rowCount(grid)).toBe(0);
  });

  it('Escape closes the popup', async () => {
    await nextFrame();
    facet.open('dept');
    expect(facet.isOpen()).toBe(true);
    await new Promise((r) => setTimeout(r, 0));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(facet.isOpen()).toBe(false);
  });
});
