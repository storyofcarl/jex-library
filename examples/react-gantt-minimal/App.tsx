/**
 * Minimal isolated React gantt example.
 *
 * The ONLY Jects imports are the gantt wrapper subpath and the gantt engine:
 *
 *   import { JectsGantt } from '@jects/react/gantt'; // <- per-component subpath
 *   import '@jects/gantt/style.css';                 // <- engine styles
 *
 * Because `@jects/react/gantt` resolves to `dist/gantt.js`, which imports only
 * `@jects/gantt` (plus the shared factory), a bundler building this app never
 * touches `@jects/grid`, `@jects/scheduler`, or any other sibling engine — they
 * are not dependencies of this package at all. That is the whole point of the
 * per-component subpath exports: install one component, ship one component.
 */
import { JectsGantt } from '@jects/react/gantt';
import '@jects/gantt/style.css';

// Epoch-ms helper so the tiny task list reads as real dates.
const day = (iso: string): number => new Date(iso).getTime();

interface TaskExtra {
  owner: string;
}

const tasks = [
  {
    id: 1,
    name: 'Design',
    start: day('2026-07-01'),
    end: day('2026-07-04'),
    percentDone: 1,
    data: { owner: 'Ada Lovelace' },
  },
  {
    id: 2,
    name: 'Build',
    start: day('2026-07-04'),
    end: day('2026-07-10'),
    percentDone: 0.4,
    data: { owner: 'Grace Hopper' },
  },
  {
    id: 3,
    name: 'Ship',
    start: day('2026-07-10'),
    milestone: true,
    data: { owner: 'Katherine Johnson' },
  },
];

const dependencies = [
  { id: 1, fromId: 1, toId: 2, type: 'FS' as const },
  { id: 2, fromId: 2, toId: 3, type: 'FS' as const },
];

export function App(): JSX.Element {
  return (
    <main style={{ padding: 24 }}>
      <h1>Isolated @jects/react/gantt</h1>
      <JectsGantt
        tasks={tasks}
        dependencies={dependencies}
        columns={[
          { field: 'name', header: 'Task' },
          { field: 'percentDone', header: '% Done' },
        ]}
        style={{ height: 320 }}
        onTaskClick={(payload) => {
          // The gantt's typed events bridge through to React `on<Event>` props.
          console.log('task clicked', payload);
        }}
      />
    </main>
  );
}
