/**
 * Usage stories for grouping — group header rows + per-group `GroupSummary`
 * rows + a grand-total footer (Bryntum/DHTMLX Group-feature parity, PARITY.md →
 * Grid → "Group: collapsible + GroupSummary + footer Summary").
 *
 * Framework-free imperative examples (the house "stories" format): each function
 * builds a real Grid, turns grouping on, and returns the instance so a docs
 * shell / playground can mount and tear it down. Group header bands are
 * collapsible (click the caption's toggle); each band shows aggregated
 * `GroupSummary` cells, and the footer shows the grand totals.
 */
import { Grid } from '../engine/grid.js';
import type { ColumnDef } from '../contract.js';
import { GroupFeature, groupFeature } from './group.js';

interface Sale {
  id: number;
  region: string;
  category: string;
  units: number;
  amount: number;
  /** Index signature so `Sale` satisfies the core `Model` constraint. */
  [key: string]: unknown;
}

const REGIONS = ['EMEA', 'AMER', 'APAC'];
const CATEGORIES = ['Hardware', 'Software', 'Services'];

const data: Sale[] = Array.from({ length: 60 }, (_, i) => ({
  id: i + 1,
  region: REGIONS[i % REGIONS.length]!,
  category: CATEGORIES[(i >> 1) % CATEGORIES.length]!,
  units: ((i * 7) % 13) + 1,
  amount: (((i * 37) % 50) + 1) * 100,
}));

const columns: ColumnDef<Sale>[] = [
  { field: 'region', header: 'Region', width: 140 },
  { field: 'category', header: 'Category', width: 160 },
  { field: 'units', header: 'Units', type: 'number', width: 110 },
  { field: 'amount', header: 'Amount', type: 'number', width: 130 },
];

/**
 * Basic: group by `region`, summing `amount` and `units` per group + a grand
 * total in the footer. Installed via the explicit feature instance.
 */
export function groupByRegion(host: HTMLElement): Grid<Sale> {
  const grid = new Grid<Sale>(host, { data, columns, rowHeight: 30 });
  grid.use(
    new GroupFeature<Sale>({
      initial: { columnIds: ['region'] },
      aggregations: { amount: 'sum', units: 'sum' },
    }),
  );
  grid.on('groupChange', (e) => {
    console.log(`group by: ${e.group.columnIds.join(', ') || '(none)'}`);
  });
  return grid;
}

/**
 * Declarative: grouping + aggregations entirely through `features.group` config
 * (the integrator-wired path — no explicit `grid.use`). Groups by `region` then
 * `category`, averaging units and summing amount.
 */
export function declarativeGroups(host: HTMLElement): Grid<Sale> {
  return new Grid<Sale>(host, {
    data,
    columns,
    rowHeight: 30,
    features: {
      group: {
        initial: { columnIds: ['region', 'category'] },
        aggregations: { amount: 'sum', units: 'avg' },
        footerAggregations: { amount: 'sum', units: 'sum' },
      },
    },
  });
}

/**
 * Plugin form: same as {@link groupByRegion} but installed via the
 * `plugins:[groupFeature(...)]` construction-time path.
 */
export function groupViaPlugin(host: HTMLElement): Grid<Sale> {
  return new Grid<Sale>(host, {
    data,
    columns,
    rowHeight: 30,
    plugins: [
      groupFeature<Sale>({
        initial: { columnIds: ['category'] },
        aggregations: { amount: 'sum', units: 'count' },
      }),
    ],
  });
}
