import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Grid } from '../engine/grid.js';
import type { ColumnDef } from '../contract.js';
import { headerGroupsFeature } from './header-groups-feature.js';
import type { HeaderGroupsFeature } from './header-groups-feature.js';
import type { GroupedColumnDef } from './header-tree.js';

interface Row {
  id: number;
  first: string;
  last: string;
  age: number;
  city: string;
}

const groupedCols: GroupedColumnDef<Row>[] = [
  { field: 'first', header: 'First', width: 120, group: 'Name' },
  { field: 'last', header: 'Last', width: 120, group: 'Name' },
  { field: 'age', header: 'Age', width: 80 },
  { field: 'city', header: 'City', width: 120, group: 'Location' },
];

function rows(n: number): Row[] {
  return Array.from({ length: n }, (_, i) => ({
    id: i,
    first: `f${i}`,
    last: `l${i}`,
    age: 20 + i,
    city: 'NYC',
  }));
}

/** Flush one round of requestAnimationFrame callbacks (jsdom provides rAF). */
function flushRaf(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

let host: HTMLElement;
beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => host.remove());

describe('HeaderGroupsFeature: integration with Grid', () => {
  it('imposes a stacked header with a spanning group cell carrying aria-colspan', async () => {
    const g = new Grid<Row>(host, { data: rows(5), columns: groupedCols as ColumnDef<Row>[] });
    const feat = g.use(headerGroupsFeature<Row>()) as HeaderGroupsFeature<Row>;
    await flushRaf();

    const header = host.querySelector('.jects-grid__header') as HTMLElement;
    expect(header.classList.contains('jects-grid__header--grouped')).toBe(true);
    expect(feat.isActive).toBe(true);

    // Two header rows (group level + leaf level).
    const rowEls = header.querySelectorAll('.jects-grid__header-row');
    expect(rowEls.length).toBe(2);

    // The "Name" group cell spans 2 leaves.
    const groupCells = Array.from(
      header.querySelectorAll<HTMLElement>('.jects-grid__header-group'),
    );
    const nameCell = groupCells.find((c) => c.textContent === 'Name')!;
    expect(nameCell).toBeTruthy();
    expect(nameCell.getAttribute('aria-colspan')).toBe('2');
    expect(nameCell.getAttribute('role')).toBe('columnheader');

    // "Location" group spans just 1 leaf (single grouped column).
    const locCell = groupCells.find((c) => c.textContent === 'Location')!;
    expect(locCell.getAttribute('aria-colspan')).toBeNull(); // colSpan 1 → omitted

    g.destroy();
  });

  it('promotes an ungrouped column with aria-rowspan over the leaf row', async () => {
    const g = new Grid<Row>(host, { data: rows(5), columns: groupedCols as ColumnDef<Row>[] });
    g.use(headerGroupsFeature<Row>());
    await flushRaf();

    const header = host.querySelector('.jects-grid__header') as HTMLElement;
    const ageCell = Array.from(
      header.querySelectorAll<HTMLElement>('.jects-grid__header-cell'),
    ).find((c) => c.textContent === 'Age')!;
    expect(ageCell).toBeTruthy();
    // "Age" has no group, so it spans both header rows.
    expect(ageCell.getAttribute('aria-rowspan')).toBe('2');
    g.destroy();
  });

  it('stays inert (flat header) when no grouping is declared', async () => {
    const flat: ColumnDef<Row>[] = [
      { field: 'first', header: 'First' },
      { field: 'age', header: 'Age' },
    ];
    const g = new Grid<Row>(host, { data: rows(3), columns: flat });
    const feat = g.use(headerGroupsFeature<Row>()) as HeaderGroupsFeature<Row>;
    await flushRaf();

    const header = host.querySelector('.jects-grid__header') as HTMLElement;
    expect(header.classList.contains('jects-grid__header--grouped')).toBe(false);
    expect(feat.isActive).toBe(false);
    // Single flat header row, two cells.
    expect(header.querySelectorAll('.jects-grid__header-group')).toHaveLength(0);
    g.destroy();
  });

  it('renders the stacked header even with no grouping when always:true', async () => {
    const flat: ColumnDef<Row>[] = [{ field: 'first', header: 'First' }];
    const g = new Grid<Row>(host, { data: rows(3), columns: flat });
    const feat = g.use(headerGroupsFeature<Row>({ always: true })) as HeaderGroupsFeature<Row>;
    await flushRaf();
    expect(feat.isActive).toBe(true);
    g.destroy();
  });

  it('accepts an explicit headerGroups tree', async () => {
    const cols: ColumnDef<Row>[] = [
      { field: 'first', header: 'First', width: 100 },
      { field: 'last', header: 'Last', width: 100 },
      { field: 'age', header: 'Age', width: 80 },
    ];
    const g = new Grid<Row>(host, { data: rows(4), columns: cols });
    g.use(
      headerGroupsFeature<Row>({
        headerGroups: [
          { header: 'Person', children: [{ columnId: 'first' }, { columnId: 'last' }] },
          { columnId: 'age' },
        ],
      }),
    );
    await flushRaf();

    const header = host.querySelector('.jects-grid__header') as HTMLElement;
    const person = Array.from(
      header.querySelectorAll<HTMLElement>('.jects-grid__header-group'),
    ).find((c) => c.textContent === 'Person')!;
    expect(person).toBeTruthy();
    expect(person.getAttribute('aria-colspan')).toBe('2');
    g.destroy();
  });

  it('restores the flat header and disposes listeners on destroy / removeFeature', async () => {
    const g = new Grid<Row>(host, { data: rows(5), columns: groupedCols as ColumnDef<Row>[] });
    g.use(headerGroupsFeature<Row>());
    await flushRaf();
    const header = host.querySelector('.jects-grid__header') as HTMLElement;
    expect(header.classList.contains('jects-grid__header--grouped')).toBe(true);

    g.removeFeature('headerGroups');
    await flushRaf();
    expect(header.classList.contains('jects-grid__header--grouped')).toBe(false);
    // Flat header restored: no group cells remain.
    expect(header.querySelectorAll('.jects-grid__header-group')).toHaveLength(0);

    g.destroy();
  });

  it('resolveTree() reflects the live column set without painting', () => {
    const g = new Grid<Row>(host, { data: rows(2), columns: groupedCols as ColumnDef<Row>[] });
    const feat = headerGroupsFeature<Row>();
    g.use(feat);
    const tree = (feat as HeaderGroupsFeature<Row>).resolveTree();
    expect(tree.levelCount).toBe(2);
    expect(tree.cells.some((c) => c.label === 'Name' && c.colSpan === 2)).toBe(true);
    g.destroy();
  });
});
