/**
 * Usage stories for ColumnAutoSizeFeature (header double-click auto-fit).
 *
 * Framework-free, imperative usage examples (the house "stories" format): each
 * function builds a real Grid, installs the feature, and returns the instance so
 * a docs shell / playground can mount and tear it down. Double-click the thin
 * handle at a header's trailing edge to auto-fit that column to its content
 * (Excel-style) — or focus it and press Enter / Space.
 */
import { Grid } from '../engine/grid.js';
import type { ColumnDef } from '../contract.js';
import { ColumnAutoSizeFeature, columnAutoSizeFeature } from './column-auto-size.js';

interface Person {
  id: number;
  name: string;
  email: string;
  city: string;
  /** Index signature so `Person` satisfies the core `Model` constraint. */
  [key: string]: unknown;
}

const NAMES = ['Ada Lovelace', 'Grace Hopper', 'Alan Turing', 'Edsger W. Dijkstra'];
const CITIES = ['Wellington', 'San Francisco', 'Cambridge', 'Amsterdam'];

const people: Person[] = Array.from({ length: 60 }, (_, i) => ({
  id: i,
  name: NAMES[i % NAMES.length]!,
  email: `user${i}@example.com`,
  city: CITIES[i % CITIES.length]!,
}));

const columns: ColumnDef<Person>[] = [
  // Deliberately over-wide so an auto-fit visibly tightens them to content.
  { field: 'name', header: 'Name', width: 320 },
  { field: 'email', header: 'Email Address', width: 320 },
  { field: 'city', header: 'City', width: 320 },
];

/** Basic: double-click a header's trailing handle to fit the column; logs the event. */
export function basicColumnAutoSize(host: HTMLElement): Grid<Person> {
  const grid = new Grid<Person>(host, { data: people, columns });
  grid.use(new ColumnAutoSizeFeature<Person>());
  grid.on('columnAutoSize', (e) => {
    console.log(`column ${e.columnId}: content ${Math.round(e.contentWidth)}px → ${e.width}px`);
  });
  return grid;
}

/** Programmatic: fit every column to content once on load. */
export function autoFitAllColumns(host: HTMLElement): Grid<Person> {
  const grid = new Grid<Person>(host, { data: people, columns });
  const feature = grid.use(
    columnAutoSizeFeature<Person>({ sampleLimit: 100 }),
  ) as ColumnAutoSizeFeature<Person>;
  for (const col of grid.columns) {
    const id = col.id ?? col.field;
    if (id) feature.autoSizeColumn(id);
  }
  return grid;
}
