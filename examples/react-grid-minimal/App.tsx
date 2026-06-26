/**
 * Minimal isolated React grid example.
 *
 * The ONLY Jects imports are the grid wrapper subpath and the grid engine:
 *
 *   import { JectsGrid } from '@jects/react/grid';   // <- per-component subpath
 *   import '@jects/grid/style.css';                  // <- engine styles
 *
 * Because `@jects/react/grid` resolves to `dist/grid.js`, which imports only
 * `@jects/grid` (plus the shared factory), a bundler building this app never
 * touches `@jects/gantt`, `@jects/scheduler`, or any other sibling engine — they
 * are not dependencies of this package at all. That is the whole point of the
 * per-component subpath exports: install one component, ship one component.
 */
import { JectsGrid } from '@jects/react/grid';
import '@jects/grid/style.css';

interface Person {
  id: number;
  name: string;
  role: string;
}

const data: Person[] = [
  { id: 1, name: 'Ada Lovelace', role: 'Engineer' },
  { id: 2, name: 'Grace Hopper', role: 'Admiral' },
  { id: 3, name: 'Katherine Johnson', role: 'Mathematician' },
];

export function App(): JSX.Element {
  return (
    <main style={{ padding: 24 }}>
      <h1>Isolated @jects/react/grid</h1>
      <JectsGrid
        data={data}
        columns={[
          { field: 'name', header: 'Name' },
          { field: 'role', header: 'Role' },
        ]}
        style={{ height: 320 }}
        onSelectionChange={(payload) => {
          // The grid's typed events bridge through to React `on<Event>` props.
          console.log('selection changed', payload);
        }}
      />
    </main>
  );
}
