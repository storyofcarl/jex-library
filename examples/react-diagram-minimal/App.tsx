/**
 * Minimal isolated React diagram example.
 *
 * The ONLY Jects imports are the diagram wrapper subpath and the diagram engine:
 *
 *   import { JectsDiagram } from '@jects/react/diagram'; // <- per-component subpath
 *   import '@jects/diagram/style.css';                   // <- engine styles
 *
 * Because `@jects/react/diagram` resolves to `dist/diagram.js`, which imports only
 * `@jects/diagram` (plus the shared factory), a bundler building this app never
 * touches `@jects/gantt`, `@jects/scheduler`, or any other sibling engine — they
 * are not dependencies of this package at all. That is the whole point of the
 * per-component subpath exports: install one component, ship one component.
 */
import { JectsDiagram } from '@jects/react/diagram';
import '@jects/diagram/style.css';

const shapes = [
  { id: 'start', type: 'start' as const, x: 40, y: 40, w: 120, h: 60, text: 'Start' },
  { id: 'work', type: 'process' as const, x: 40, y: 160, w: 120, h: 60, text: 'Do Work' },
  { id: 'done', type: 'end' as const, x: 40, y: 280, w: 120, h: 60, text: 'Done' },
];

const connectors = [
  { id: 'e1', from: { shape: 'start' }, to: { shape: 'work' }, kind: 'orthogonal' as const },
  { id: 'e2', from: { shape: 'work' }, to: { shape: 'done' }, kind: 'orthogonal' as const },
];

export function App(): JSX.Element {
  return (
    <main style={{ padding: 24 }}>
      <h1>Isolated @jects/react/diagram</h1>
      <JectsDiagram
        shapes={shapes}
        connectors={connectors}
        grid
        style={{ height: 420 }}
        onSelect={(payload) => {
          // The diagram's typed events bridge through to React `on<Event>` props.
          console.log('selection changed', payload);
        }}
      />
    </main>
  );
}
