/**
 * Usage stories for RowResizeFeature (per-row height drag).
 *
 * These are framework-free, imperative usage examples (the house "stories"
 * format): each function builds a real Grid, installs the feature, and returns
 * the instance so a docs shell / playground can mount and tear it down.
 */
import { Grid } from '../engine/grid.js';
import type { ColumnDef } from '../contract.js';
import { RowResizeFeature, rowResizeFeature } from './row-resize.js';

interface Person {
  id: number;
  name: string;
  bio: string;
  /** Index signature so `Person` satisfies the core `Model` constraint. */
  [key: string]: unknown;
}

const people: Person[] = Array.from({ length: 50 }, (_, i) => ({
  id: i,
  name: `Person ${i}`,
  bio: `A longer biographical note for person ${i} that benefits from a taller row.`,
}));

const columns: ColumnDef<Person>[] = [
  { field: 'name', header: 'Name', width: 160 },
  { field: 'bio', header: 'Bio', flex: 1 },
];

/** Basic: drag any row's bottom edge to resize it; logs `rowResize`. */
export function basicRowResize(host: HTMLElement): Grid<Person> {
  const grid = new Grid<Person>(host, {
    data: people,
    columns,
    rowHeight: 36,
    // Variable row height must be on for the engine to persist drag results.
    virtualization: { variableRowHeight: true },
  });
  grid.use(new RowResizeFeature<Person>({ minHeight: 24, maxHeight: 200 }));
  grid.on('rowResize', (e) => {
     
    console.log(`row ${e.id}: ${e.oldHeight}px → ${e.height}px`);
  });
  return grid;
}

/** Restore previously persisted heights on mount. */
export function persistedRowResize(
  host: HTMLElement,
  saved: Record<string, number> = { '0': 96, '3': 72 },
): Grid<Person> {
  const grid = new Grid<Person>(host, {
    data: people,
    columns,
    rowHeight: 36,
    virtualization: { variableRowHeight: true },
  });
  const feature = rowResizeFeature<Person>();
  grid.use(feature);
  feature.setState(saved);
  return grid;
}
