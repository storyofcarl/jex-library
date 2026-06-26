/**
 * vue-grid-minimal — isolated single-component usage of Jects + Vue.
 *
 * The ONLY Jects imports are:
 *   - `@jects/vue/grid` — the per-component Vue wrapper subpath (imports just the grid wrapper)
 *   - `@jects/grid`     — the grid engine it binds to
 *
 * There is no import of `@jects/vue` (the root barrel) and no sibling engine
 * (`@jects/gantt`, `@jects/scheduler`, …). Because `@jects/vue/grid` resolves to
 * `dist/grid.js`, which imports only `@jects/grid` + the shared factory chunk, the
 * bundler never has to resolve any other engine to build this app.
 */
import { createApp, h } from 'vue';
// `GridOptions` defaults its row generic to the engine's `Model` (Record<string, unknown>),
// which is exactly the shape the `JectsGrid` Vue wrapper's props expect.
import { JectsGrid, type GridOptions } from '@jects/vue/grid';

const data: GridOptions['data'] = [
  { id: 1, name: 'Ada Lovelace', role: 'Mathematician' },
  { id: 2, name: 'Grace Hopper', role: 'Computer Scientist' },
];

const columns: GridOptions['columns'] = [
  { field: 'name', header: 'Name' },
  { field: 'role', header: 'Role' },
];

createApp({
  render: () => h(JectsGrid, { data, columns }),
}).mount('#app');
