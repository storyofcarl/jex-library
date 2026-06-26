/**
 * Minimal isolated Web Component grid example.
 *
 * The ONLY Jects imports are the grid wrapper subpath and the grid engine styles:
 *
 *   import { registerGrid } from '@jects/elements/grid';  // <- per-component subpath
 *   import '@jects/grid/style.css';                       // <- engine styles
 *
 * Because `@jects/elements/grid` resolves to `dist/grid.js`, which imports only
 * `@jects/grid` (plus the shared factory chunk), a bundler building this app never
 * touches `@jects/gantt`, `@jects/scheduler`, or any other sibling engine — they are
 * not dependencies of this package at all. That is the whole point of the per-component
 * subpath exports: install one component, ship one component.
 */
import { registerGrid, type GridOptions, type JectsElement } from '@jects/elements/grid';
import type { Grid, GridEvents } from '@jects/grid';
import '@jects/grid/style.css';

// Define <jects-grid> once. Idempotent and scoped to this single tag.
registerGrid();

// Row models satisfy the engine's `Model` contract (`Record<string, unknown>`),
// so we use a type alias with an index signature rather than a closed interface.
type Person = {
  id: number;
  name: string;
  role: string;
  [key: string]: unknown;
};

const config: GridOptions<Person> = {
  columns: [
    { field: 'name', header: 'Name' },
    { field: 'role', header: 'Role' },
  ],
  data: [
    { id: 1, name: 'Ada Lovelace', role: 'Engineer' },
    { id: 2, name: 'Grace Hopper', role: 'Admiral' },
    { id: 3, name: 'Katherine Johnson', role: 'Mathematician' },
  ],
};

// `JectsElement<Grid, …>` gives the typed `config` setter and `addEventListener` overloads.
const el = document.createElement('jects-grid') as JectsElement<
  Grid,
  GridOptions<Person>,
  GridEvents<Person>
>;
el.style.height = '320px';
el.config = config;
el.addEventListener('selectionChange', (ev) => {
  // The grid's typed events bridge through to DOM CustomEvents.
  console.log('selection changed', ev.detail);
});

document.body.appendChild(el);
