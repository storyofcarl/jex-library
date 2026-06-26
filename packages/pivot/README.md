# @jects/pivot — drag-and-drop pivot table with aggregations, conditional formatting, and OOXML export

## What it is

`@jects/pivot` cross-tabulates a flat array of rows into a row × column matrix of aggregated measures, with a drag-and-drop field-assignment panel, multiple value measures, custom aggregators, conditional formatting, collapsible header trees, and CSV / `.xls` / real OOXML `.xlsx` export. It ships a framework-free, light-DOM `PivotTable` widget (built on `@jects/grid` for rendering) plus a pure, DOM-free computation engine (`PivotEngine`) you can use headlessly. Theming is via `--jects-*` CSS custom properties — no Shadow DOM.

## Install

```bash
pnpm add @jects/pivot @jects/core @jects/grid @jects/widgets @jects/theme
```

`@jects/core`, `@jects/grid`, `@jects/widgets`, and `@jects/theme` are peer dependencies.

## CSS

The package ships a stylesheet. Import it alongside the Grid styles it composes and the `@jects/theme` token base so `--jects-*` variables resolve:

```ts
import '@jects/theme/style.css';   // token base
import '@jects/grid/style.css';    // composed Grid styles
import '@jects/pivot/style.css';   // pivot panel + cross-tab styles
```

## Minimal example

```ts
import { PivotTable } from '@jects/pivot';
import '@jects/theme/style.css';
import '@jects/grid/style.css';
import '@jects/pivot/style.css';

const sales = [
  { region: 'West', product: 'A', quarter: 'Q1', amount: 1200 },
  { region: 'East', product: 'A', quarter: 'Q1', amount: 1500 },
  { region: 'East', product: 'B', quarter: 'Q2', amount: 700 },
];

const host = document.getElementById('pivot')!;
const pivot = new PivotTable(host, {
  data: sales,
  rows: ['region', 'product'],
  columns: ['quarter'],
  values: [{ field: 'amount', aggregator: 'sum', label: 'Revenue' }],
});

// later…
pivot.destroy();
```

`new PivotTable(host, config)` accepts an `HTMLElement` or a selector string. The widget **pivots in its constructor**, so any custom aggregator registry must be seeded *before* construction and passed via the `aggregators` config.

## Subpath exports

- `@jects/pivot/style.css` — the pivot panel + cross-tab stylesheet (side-effect CSS).

The package otherwise exposes a single main entry (`@jects/pivot`); no other code subpaths.

## Common recipes

### Cross-tab with totals and currency formatting

```ts
const pivot = new PivotTable('#pivot', {
  data: sales,
  rows: ['region', 'product'],
  columns: ['quarter'],
  values: [{ field: 'amount', aggregator: 'sum', label: 'Revenue' }],
  mode: 'tree',
  totals: { grand: true, rows: true, columns: true },
  numberFormat: { locale: 'en-US', style: 'currency', currency: 'USD', maximumFractionDigits: 0 },
});
```

### Conditional formatting (data bar + color scale)

```ts
const pivot = new PivotTable('#pivot', {
  data: sales,
  rows: ['region'],
  columns: ['quarter'],
  values: [{ field: 'amount', aggregator: 'sum', label: 'Revenue' }],
  conditionalFormat: [
    { kind: 'dataBar', color: 'var(--jects-accent)', field: 'amount' },
    { kind: 'colorScale', min: '#eef2ff', max: '#c7d2fe', field: 'amount' },
  ],
});
```

### Custom aggregator + XLSX export

```ts
import { PivotTable, AggregatorRegistry } from '@jects/pivot';

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
    { field: 'amount', aggregator: 'sum', label: 'Revenue' },
    { field: 'amount', aggregator: 'avgTicket', label: 'Avg ticket' },
  ],
});

pivot.exportXlsx('pivot.xlsx'); // also: exportCsv(), exportXls()
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

Built-in aggregators: `sum`, `count`, `counta`, `countunique`, `min`, `max`, `average`, `median`, `product`, `stddev`, `variance`. Register more via `addMathMethod` or an `AggregatorRegistry`.

## Events

Subscribe with `pivot.on(event, payload => …)`.

| Event | Payload | Fires when |
| --- | --- | --- |
| `beforePivot` | `{ config, pivot }` | A recompute is about to run — vetoable, return `false` to cancel. |
| `pivot` | `{ result, pivot }` | The pivot recomputed and the grid repainted. |
| `configChange` | `{ axis, pivot }` | The user changed a field assignment via the panel. |
| `toggle` | `{ axis, nodeKey, collapsed, pivot }` | A row/column header node was collapsed or expanded. |

(Plus inherited Widget events.)

## Theming

The pivot renders into light DOM under `.jects-pivot` and styles itself from `--jects-*` CSS custom properties; override them on `:root` or any ancestor, and include `@jects/theme`'s token base. Because the cross-tab is rendered by the composed Grid, the `.jects-grid*` classes and tokens apply too. Dark mode comes from the `@jects/theme` base and is inherited automatically. See [docs/modules/theme.md](../../docs/modules/theme.md).

## Accessibility

The drag-and-drop field panel is keyboard-accessible (pick up / move / drop) with announcements via a live region; the cross-tab inherits the Grid's keyboard navigation and ARIA semantics.

## Stability & support

**Beta.** The engine, aggregators, conditional formatting, and export paths are covered by unit and browser tests (including axe checks), and the public API is stable, but the surface may still evolve.

Part of the Jects UI suite — [repo](https://github.com/storyofcarl/jex-library) · [live demo](https://jexlibrary.vercel.app). Commercial terms: see LICENSE.md.
