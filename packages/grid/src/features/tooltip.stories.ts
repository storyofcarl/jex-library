/**
 * Usage stories for TooltipFeature (per-cell tooltips).
 *
 * Framework-free, imperative examples (the house "stories" format): each builds a
 * real Grid, installs the feature, and returns the instance so a docs shell /
 * playground can mount and tear it down.
 */
import { Grid } from '../engine/grid.js';
import type { ColumnDef } from '../contract.js';
import {
  TooltipFeature,
  tooltipFeature,
  detailTooltip,
  type TooltipColumnDef,
} from './tooltip.js';

interface Person {
  id: number;
  name: string;
  email: string;
  role: string;
  bio: string;
  [key: string]: unknown;
}

const people: Person[] = Array.from({ length: 50 }, (_, i) => ({
  id: i,
  name: `Person ${i}`,
  email: `person${i}@example.com`,
  role: i % 3 === 0 ? 'Administrator' : i % 3 === 1 ? 'Editor' : 'Viewer',
  bio: `Person ${i} has a long biography that will not fit in a narrow column and will be clipped with an ellipsis.`,
}));

/** Explicit per-column tooltip renderers (text + html detail card). */
export function rendererTooltips(host: HTMLElement): Grid<Person> {
  const columns: TooltipColumnDef<Person>[] = [
    {
      field: 'name',
      header: 'Name',
      width: 160,
      // A rich "detail card" tooltip built from multiple fields.
      tooltip: (ctx) =>
        detailTooltip([
          ['Name', ctx.row?.name],
          ['Email', ctx.row?.email],
          ['Role', ctx.row?.role],
        ]),
    },
    { field: 'email', header: 'Email', width: 200, tooltip: (ctx) => String(ctx.value) },
    { field: 'role', header: 'Role', width: 140 },
  ];
  const grid = new Grid<Person>(host, { data: people, columns: columns as ColumnDef<Person>[], rowHeight: 34 });
  grid.use(new TooltipFeature<Person>({ placement: 'top', showDelay: 250 }));
  return grid;
}

/** Overflow-only mode: tooltips appear only for clipped cells (full text). */
export function overflowTooltips(host: HTMLElement): Grid<Person> {
  const columns: ColumnDef<Person>[] = [
    { field: 'name', header: 'Name', width: 120 },
    { field: 'bio', header: 'Bio', width: 160 },
  ];
  const grid = new Grid<Person>(host, { data: people, columns, rowHeight: 32 });
  grid.use(tooltipFeature<Person>({ overflowOnly: true, placement: 'bottom' }));
  return grid;
}

/** Header tooltips + a global fallback renderer, with a veto on the first row. */
export function headerAndVetoTooltips(host: HTMLElement): Grid<Person> {
  const columns: TooltipColumnDef<Person>[] = [
    { field: 'name', header: 'Name', width: 140 },
    { field: 'role', header: 'Role', width: 140 },
  ];
  const grid = new Grid<Person>(host, { data: people, columns: columns as ColumnDef<Person>[], rowHeight: 32 });
  grid.use(
    new TooltipFeature<Person>({
      headers: true,
      renderer: (ctx) =>
        ctx.address.rowIndex === -1
          ? `Column: ${ctx.column.header ?? ''}`
          : `${ctx.column.header}: ${String(ctx.value)}`,
    }),
  );
  // Veto tooltips on the very first data row to demonstrate the gate.
  (grid.on as never as (e: string, fn: (p: unknown) => boolean) => void)(
    'beforeTooltipShow',
    (p) => (p as { address: { rowIndex: number } }).address.rowIndex !== 0,
  );
  return grid;
}
