/**
 * Usage stories for FilterFacetFeature (Excel-style faceted / set filter).
 *
 * Framework-free, imperative usage examples (the house "stories" format): each
 * function builds a real Grid, installs the feature(s), and returns the instance
 * so a docs shell / playground can mount and tear it down.
 */
import { Grid } from '../engine/grid.js';
import type { ColumnDef } from '../contract.js';
import { FilterFeature } from './filter.js';
import { FilterFacetFeature, filterFacetFeature } from './filter-facet.js';

interface Employee {
  id: number;
  name: string;
  dept: string;
  city: string;
  /** Index signature so `Employee` satisfies the core `Model` constraint. */
  [key: string]: unknown;
}

const DEPTS = ['Engineering', 'Sales', 'Operations', 'Support', 'Finance'];
const CITIES = ['New York', 'London', 'Berlin', 'Tokyo'];

const people: Employee[] = Array.from({ length: 200 }, (_, i) => ({
  id: i,
  name: `Employee ${i}`,
  dept: DEPTS[i % DEPTS.length]!,
  city: CITIES[i % CITIES.length]!,
}));

const columns: ColumnDef<Employee>[] = [
  { field: 'name', header: 'Name', id: 'name', width: 180 },
  { field: 'dept', header: 'Department', id: 'dept', width: 160, filterable: true },
  { field: 'city', header: 'City', id: 'city', width: 160, filterable: true },
];

/**
 * Basic faceted filter. A header button carrying `data-filter-facet="<id>"`
 * opens the checklist popup for that column. Here we add such a button to every
 * filterable header cell after mount.
 */
export function basicFacetFilter(host: HTMLElement): Grid<Employee> {
  const grid = new Grid<Employee>(host, { data: people, columns, rowHeight: 32 });
  grid.use(new FilterFeature<Employee>());
  grid.use(new FilterFacetFeature<Employee>());
  attachHeaderTriggers(grid);
  return grid;
}

/** Live-apply variant: every checkbox toggle filters the grid immediately. */
export function liveFacetFilter(host: HTMLElement): Grid<Employee> {
  const grid = new Grid<Employee>(host, { data: people, columns, rowHeight: 32 });
  grid.use(new FilterFeature<Employee>());
  grid.use(filterFacetFeature<Employee>({ applyMode: 'live', sort: 'count' }));
  attachHeaderTriggers(grid);
  return grid;
}

/**
 * Open the facet popup programmatically (no header button needed) — useful for
 * wiring the feature into a custom header menu.
 */
export function programmaticFacet(host: HTMLElement): Grid<Employee> {
  const grid = new Grid<Employee>(host, { data: people, columns, rowHeight: 32 });
  grid.use(new FilterFeature<Employee>());
  const facet = grid.use(new FilterFacetFeature<Employee>()) as FilterFacetFeature<Employee>;
  // Open the Department facet at the top-left of the grid.
  const rect = host.getBoundingClientRect();
  facet.open('dept', rect.left + 8, rect.top + 8);
  return grid;
}

/** Add a small ⏷ trigger button to each filterable header cell. */
function attachHeaderTriggers(grid: Grid<Employee>): void {
  requestAnimationFrame(() => {
    for (const col of grid.columns) {
      if (col.filterable === false || !col.id) continue;
      const cell = grid.el.querySelector<HTMLElement>(
        `.jects-grid__header-cell[data-column-id="${col.id}"]`,
      );
      if (!cell || cell.querySelector('[data-filter-facet]')) continue;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset['filterFacet'] = col.id;
      btn.setAttribute('aria-label', `Filter ${col.header ?? col.id}`);
      btn.textContent = '⏷';
      cell.appendChild(btn);
    }
  });
}
