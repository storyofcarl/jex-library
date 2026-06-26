# @jects/pivot

> Drag-and-drop pivot table that aggregates a flat dataset into a cross-tab, with conditional formatting, collapsible groups, custom aggregators, and OOXML XLSX export.

## Overview

`@jects/pivot` is a pivot/aggregation grid built on `@jects/core` and `@jects/grid` (it
reuses the Grid for tabular rendering). It cross-tabulates a flat array of rows into a
row × column matrix of aggregated measures, with a drag-and-drop field-assignment panel,
multiple value measures, custom aggregators, conditional formatting (cell-value rules,
color scales, data bars), collapsible header trees, tree/flat layouts, and CSV / legacy
`.xls` / real OOXML `.xlsx` export. It targets the feature bar of an enterprise **pivot
table** product such as **WebPivotTable**.

The core paradigm is a **framework-free, light-DOM Widget class** (`PivotTable`) with a
stable imperative API. The computation layer (`PivotEngine`, aggregators, conditional
formatting, export) is a pure, DOM-free engine you can also use standalone. Theming is via
`--jects-*` CSS custom properties — no Shadow DOM.

## Installation

```bash
pnpm add @jects/pivot @jects/core @jects/grid @jects/widgets @jects/theme
```

`@jects/core`, `@jects/grid`, `@jects/widgets`, and `@jects/theme` are peer dependencies.
The package ships **ESM** (`./dist/pivot.js`, with a UMD/CJS fallback), is
**tree-shakeable**, and is **framework-free**.

## Integration

### Side-effect CSS + theme base

Import the pivot stylesheet (a side-effect import), the grid stylesheet it composes, and
the `@jects/theme` token base so `--jects-*` variables resolve:

```ts
import '@jects/theme/style.css';   // 3-tier OKLCH token base
import '@jects/grid/style.css';    // composed Grid styles
import '@jects/pivot/style.css';   // pivot panel + cross-tab styles
```

### Vanilla TS usage

```ts
import { PivotTable } from '@jects/pivot';

const host = document.getElementById('pivot')!;
const pivot = new PivotTable(host, {
  data: sales,
  rows: ['region', 'product'],
  columns: ['quarter'],
  values: [{ field: 'amount', aggregator: 'sum', label: 'Revenue' }],
});
```

`new PivotTable(host, config)` accepts an `HTMLElement` (or selector) as host. The widget
**pivots in its constructor**, so any custom aggregator registry must be seeded *before*
construction and passed via the `aggregators` config (see Examples).

### Framework usage (React / Angular / Vue)

`PivotTable` is an imperative class; wrap it with a thin adapter — instantiate in a mount
effect against a ref'd element, push data via `setData(...)` / `update(...)`, and call
`.destroy()` on unmount. Create the instance once, not per render.

```tsx
import { useEffect, useRef } from 'react';
import { PivotTable } from '@jects/pivot';
import type { PivotTableConfig } from '@jects/pivot';
import '@jects/theme/style.css';
import '@jects/grid/style.css';
import '@jects/pivot/style.css';

export function Pivot({ config }: { config: PivotTableConfig }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const ref = useRef<PivotTable | null>(null);

  useEffect(() => {
    const pivot = new PivotTable(hostRef.current!, config);
    ref.current = pivot;
    return () => pivot.destroy();          // tear down on unmount
  }, []);

  useEffect(() => {
    ref.current?.setData(config.data ?? []); // push new data imperatively
  }, [config.data]);

  return <div ref={hostRef} style={{ height: 480 }} />;
}
```

Angular/Vue follow the same lifecycle (`ngAfterViewInit` + `ngOnDestroy`, or `onMounted` +
`onUnmounted`).

### Theming

The pivot renders into light DOM and reads `@jects/theme` tokens (3-tier OKLCH tokens with
a single `--jects-radius`). Customize by overriding `--jects-*` custom properties on any
ancestor. Dark mode comes from the `@jects/theme` base (toggled via its documented theme
hook); the pivot inherits it automatically. See **Theming** below.

## Features

- **Dimensions & measures** — assign fields to **rows**, **columns**, **values**, and
  **filters** axes, declaratively or by dragging chips in the config panel.
- **Aggregations** — built-in aggregators `sum`, `count`, `counta`, `countunique`, `min`,
  `max`, `average`, `median`, `product`, `stddev`, `variance`; plus **custom aggregators**
  registered via `addMathMethod` / an `AggregatorRegistry`.
- **Multiple value fields** — any number of measures, including the same field aggregated
  several ways (e.g. sum + a custom avg).
- **Filters** — pre-seeded or interactive per-chip filter editor with type-aware operators
  (`eq`, `ne`, `lt`, `lte`, `gt`, `gte`, `in`, `notin`, `contains`, `empty`, `notempty`);
  multi-value `in`/`notin` via a comma list.
- **Totals** — grand total, per-row-group totals column, and per-column-group totals row
  (each independently toggleable, or all off).
- **Collapsible header trees** — collapse/expand row and column header nodes by identity
  key, with auto-collapse depth limits (`rowExpandLevel` / `columnExpandLevel`); subtotals
  always reconcile with the expanded view.
- **Tree / flat layout** — hierarchical (`tree`) output keeping the grouping hierarchy, or
  a flattened (`flat`) cross-tab.
- **Conditional formatting** — a callback or declarative rules: `cellValue` thresholds
  (`eq`/`lt`/`between`/…), two/three-point `colorScale` (linear RGB interpolation over the
  column's observed range), and `dataBar` (proportional gradient bars).
- **Number formatting** — locale-aware value formatting (`Intl.NumberFormat`-style
  options: `locale`, `style`, `currency`, `maximumFractionDigits`, …).
- **Custom cell templates** — a `cellTemplate` callback receiving the value + column-leaf
  descriptor (e.g. tag grand-total leaves).
- **Drag-and-drop panel** — keyboard-accessible field reassignment (pick up / move /
  drop with announcements via a live region); hideable.
- **Frozen row headers** and configurable grid row height.
- **Export** — serialize/download as **CSV**, real **OOXML `.xlsx`**, or legacy
  SpreadsheetML **`.xls`**.
- **Standalone engine** — `PivotEngine` (and the aggregator/conditional/export helpers)
  are pure and DOM-free for headless computation or testing.

## Quick start

```html
<div id="pivot" style="height: 460px"></div>
```

```ts
import { PivotTable } from '@jects/pivot';
import '@jects/theme/style.css';
import '@jects/grid/style.css';
import '@jects/pivot/style.css';

const sales = [
  { region: 'West', product: 'A', quarter: 'Q1', amount: 1200, units: 4 },
  { region: 'West', product: 'B', quarter: 'Q2', amount: 900,  units: 3 },
  { region: 'East', product: 'A', quarter: 'Q1', amount: 1500, units: 5 },
  { region: 'East', product: 'B', quarter: 'Q2', amount: 700,  units: 2 },
];

const pivot = new PivotTable(document.getElementById('pivot')!, {
  data: sales,
  fields: [
    { field: 'region',  label: 'Region' },
    { field: 'product', label: 'Product' },
    { field: 'quarter', label: 'Quarter' },
    { field: 'amount',  label: 'Amount', aggregator: 'sum' },
  ],
  rows: ['region', 'product'],
  columns: ['quarter'],
  values: [{ field: 'amount', aggregator: 'sum', label: 'Revenue' }],
  mode: 'tree',
  totals: { grand: true, rows: true, columns: true },
  numberFormat: { locale: 'en-US', style: 'currency', currency: 'USD', maximumFractionDigits: 0 },
});

pivot.on('pivot', ({ result }) => console.log('rows:', result.matrix.length));
```

## Configuration

`PivotTableConfig` (extends `WidgetConfig`, so `cls` / `style` / `hidden` / `disabled` are
also accepted).

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `data` | `Row[]` | — | Source flat dataset. |
| `fields` | `PivotFieldSpec[]` | inferred from data | Available fields for the config panel (`{ field, label?, aggregator? }`). |
| `rows` | `string[]` | `[]` | Initial row-axis field assignment. |
| `columns` | `string[]` | `[]` | Initial column-axis fields. |
| `values` | `Array<string \| { field, aggregator?, label? }>` | `[]` | Initial value fields. |
| `filters` | `PivotFilter<Row>[]` | `[]` | Initial filters (`{ field, operator?, value?, values? }`). |
| `mode` | `'tree'` \| `'flat'` | `'tree'` | Hierarchical or flattened output. |
| `totals` | `PivotTotals` \| `boolean` | all on | `{ grand?, rows?, columns? }`, or `false` to disable all. |
| `showPanel` | `boolean` | `true` | Show the drag-and-drop config panel. |
| `numberFormat` | `NumberFormatOptions` | — | Locale-aware number format for value cells. |
| `cellTemplate` | `PivotCellTemplate` | — | Custom value-cell template `({ value, leaf }) => string`. |
| `conditionalFormat` | `ConditionalFormat` | — | Callback or declarative rules (cell-value / color-scale / data-bar). |
| `collapsedRows` | `string[]` | `[]` | Initial collapsed row-node identity keys. |
| `collapsedColumns` | `string[]` | `[]` | Initial collapsed column-node identity keys. |
| `rowExpandLevel` | `number` | — | Auto-collapse every row node deeper than this depth (0-based). |
| `columnExpandLevel` | `number` | — | Auto-collapse every column node deeper than this depth. |
| `defaultFilterOperator` | `PivotFilterOperator` | — | Operator applied when a field is first dropped on the Filters axis. |
| `freezeRowHeaders` | `boolean` | `true` | Freeze the row-header columns. |
| `rowHeight` | `number` | grid default | Grid row height in px. |
| `aggregators` | `AggregatorRegistry` | fresh w/ built-ins | Custom aggregator registry (seed before construction). |

## Methods

| Method | Description |
| --- | --- |
| `setData(data): this` | Replace the source dataset and recompute. |
| `setAxis(axis, fields): this` | Assign fields to an axis (`'rows'`/`'columns'`/`'values'`/`'filters'`) and recompute. |
| `moveField(field, from, to): void` | Move a field between axes (or `'source'`) — the programmatic equivalent of dragging a chip. |
| `addMathMethod(name, fn): this` | Register a custom aggregator (proxies the engine's registry). |
| `getPivotConfig(): PivotConfig` | The current resolved pivot configuration. |
| `getResult(): PivotResult \| null` | The last computed result. |
| `getEngine(): PivotEngine` | The underlying computation engine. |
| `getGrid(): Grid \| null` | The composed Grid instance (advanced consumers). |
| `refresh(): this` | Force a recompute + repaint. |
| `toggleNode(axis, nodeKey, collapsed?): this` | Collapse/expand a row/column header node by identity key. |
| `getCollapsed(axis): string[]` | Current collapsed node keys for `'rows'` / `'columns'`. |
| `toCsv(): string` | Serialize the current result to CSV. |
| `toXlsx(): Uint8Array` | Serialize to real `.xlsx` (OOXML, zipped) bytes. |
| `toExcelXml(): string` | Serialize to legacy Excel SpreadsheetML XML. |
| `exportCsv(fileName?): void` | Trigger a CSV download. |
| `exportXlsx(fileName?): void` | Trigger a real `.xlsx` (OOXML) download. |
| `exportXls(fileName?): void` | Trigger a legacy `.xls` (SpreadsheetML) download. |
| `update(patch): this` | Merge config and re-pivot (Widget lifecycle). |
| `destroy(): void` | Tear down (Widget lifecycle). |

## Events

Subscribe with `pivot.on(event, payload => …)`.

| Event | Payload | Fires when |
| --- | --- | --- |
| `beforePivot` | `{ config, pivot }` | A recompute is about to run — **vetoable**, return `false` to cancel. |
| `pivot` | `{ result, pivot }` | The pivot recomputed and the grid repainted. |
| `configChange` | `{ axis, pivot }` | The user changed the field assignment via the panel. |
| `toggle` | `{ axis, nodeKey, collapsed, pivot }` | A row/column header node was collapsed or expanded. |

(Plus inherited Widget events.)

## Examples

### A cross-tab with two dimensions and a sum measure

```ts
import { PivotTable } from '@jects/pivot';

const pivot = new PivotTable('#pivot', {
  data: sales,
  rows: ['region', 'product'],   // two row dimensions (nested)
  columns: ['quarter'],          // one column dimension
  values: [{ field: 'amount', aggregator: 'sum', label: 'Revenue' }],
  mode: 'tree',
  totals: { grand: true, rows: true, columns: true },
  numberFormat: { locale: 'en-US', style: 'currency', currency: 'USD', maximumFractionDigits: 0 },
});

// Collapse all top-level (Region) groups from the last result:
const top = (pivot.getResult()?.matrix ?? [])
  .filter(r => r.collapsible && r.depth === 0 && r.nodeKey)
  .map(r => r.nodeKey!);
top.forEach(k => pivot.toggleNode('rows', k, true));
```

### Conditional formatting (data bar + color scale)

```ts
import { PivotTable } from '@jects/pivot';

const pivot = new PivotTable('#pivot', {
  data: sales,
  rows: ['region'],
  columns: ['quarter'],
  values: [{ field: 'amount', aggregator: 'sum', label: 'Revenue' }],
  conditionalFormat: [
    { kind: 'dataBar',    color: 'var(--jects-accent)', field: 'amount' },
    { kind: 'colorScale', min: '#eef2ff', max: '#c7d2fe', field: 'amount' },
    // or a threshold rule:
    // { kind: 'cellValue', op: 'gt', value: 100000, class: 'is-hot', field: 'amount' },
  ],
});
```

### Custom aggregator + XLSX export

```ts
import { PivotTable, AggregatorRegistry } from '@jects/pivot';

// Seed the registry BEFORE construction (the widget pivots in its constructor).
const aggregators = new AggregatorRegistry();
aggregators.add('avgTicket', (values) => {
  const nums = values.map(Number).filter(Number.isFinite);
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
});

const pivot = new PivotTable('#pivot', {
  aggregators,
  data: sales,
  rows: ['region', 'product'],
  columns: ['quarter'],
  values: [
    { field: 'amount', aggregator: 'sum',       label: 'Revenue' },
    { field: 'amount', aggregator: 'avgTicket', label: 'Avg ticket' },
  ],
  filters: [{ field: 'region', operator: 'in', values: ['West', 'East', 'North'] }],
});

document.querySelector('#xlsx')!
  .addEventListener('click', () => pivot.exportXlsx('pivot.xlsx'));
```

### Headless engine (no DOM)

```ts
import { PivotEngine } from '@jects/pivot';

const engine = new PivotEngine(sales);
const result = engine.compute({
  rows: ['region'],
  columns: ['quarter'],
  values: [{ field: 'amount', aggregator: 'sum' }],
  totals: true,
});
console.log(result.matrix, result.columnLeaves);
```

## Theming

The pivot renders into light DOM under the `.jects-pivot` root and styles itself from the
shared `@jects/theme` tokens — override these `--jects-*` custom properties on `:root` (or
any ancestor) to retheme:

- **Surfaces & text:** `--jects-background`, `--jects-foreground`, `--jects-card`,
  `--jects-card-foreground`, `--jects-muted`, `--jects-muted-foreground`,
  `--jects-popover`, `--jects-popover-foreground`.
- **Lines & focus:** `--jects-border`, `--jects-input`, `--jects-ring`.
- **Accent (chips, data bars, selection):** `--jects-primary`,
  `--jects-primary-foreground`, `--jects-accent`, `--jects-accent-foreground`,
  `--jects-secondary`, `--jects-destructive`, `--jects-success`.
- **Typography & rhythm:** `--jects-font-family`, `--jects-font-size-*`,
  `--jects-font-weight-*`, `--jects-space-*`, `--jects-radius`.

Component class hooks you can target/extend include `.jects-pivot`, the panel/zones
(`.jects-pivot__panel`, `.jects-pivot__zone`, `.jects-pivot__zone--over`,
`.jects-pivot__zone--source`), the field chips (`.jects-pivot__chip`,
`.jects-pivot__chip--filter`, `.jects-pivot__chip--picked`, `.jects-pivot__chip-op`,
`.jects-pivot__chip-value`), the cross-tab (`.jects-pivot__grid`,
`.jects-pivot__rowlabel`, `.jects-pivot__toggle`, `.jects-pivot__cell--total`), and the
conditional-format markers (`.jects-pivot__cf--highlight` / `--positive` / `--negative`).
Because the cross-tab is rendered by the composed Grid, the `.jects-grid*` classes and
tokens apply too. Dark mode is provided by the `@jects/theme` base (the pivot inherits it
automatically — no pivot-specific config).
