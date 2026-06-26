/**
 * vue-pivot-minimal — isolated single-component usage of Jects + Vue.
 *
 * The ONLY Jects imports are:
 *   - `@jects/vue/pivot` — the per-component Vue wrapper subpath (imports just the pivot wrapper)
 *   - `@jects/pivot`     — the pivot engine it binds to (here only its stylesheet)
 *
 * There is no import of `@jects/vue` (the root barrel) and no sibling engine
 * (`@jects/gantt`, `@jects/scheduler`, …). Because `@jects/vue/pivot` resolves to
 * `dist/pivot.js`, which imports only `@jects/pivot` + the shared factory chunk, the
 * bundler never has to resolve any other engine to build this app.
 */
import { createApp, h } from 'vue';
// The pivot engine's stylesheet — required for the rendered table to look right.
import '@jects/pivot/style.css';
// `PivotTableConfig` defaults its row generic to the engine's `Model` (Record<string, unknown>),
// which is exactly the shape the `JectsPivot` Vue wrapper's props expect.
import { JectsPivot, type PivotTableConfig } from '@jects/vue/pivot';

// A tiny but realistic flat dataset — regional sales rows to pivot over.
const data: PivotTableConfig['data'] = [
  { region: 'West', category: 'Hardware', amount: 1200 },
  { region: 'West', category: 'Software', amount: 800 },
  { region: 'East', category: 'Hardware', amount: 1500 },
  { region: 'East', category: 'Software', amount: 950 },
];

const rows: PivotTableConfig['rows'] = ['region'];
const columns: PivotTableConfig['columns'] = ['category'];
const values: PivotTableConfig['values'] = [{ field: 'amount', aggregator: 'sum' }];

createApp({
  render: () => h(JectsPivot, { data, rows, columns, values }),
}).mount('#app');
