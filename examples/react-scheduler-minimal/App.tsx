/**
 * Minimal isolated React scheduler example.
 *
 * The ONLY Jects imports are the scheduler wrapper subpath and the scheduler engine:
 *
 *   import { JectsScheduler } from '@jects/react/scheduler';   // <- per-component subpath
 *   import '@jects/scheduler/style.css';                       // <- engine styles
 *
 * Because `@jects/react/scheduler` resolves to `dist/scheduler.js`, which imports
 * only `@jects/scheduler` (plus the shared factory), a bundler building this app
 * never touches `@jects/grid`, `@jects/gantt`, or any other sibling engine — they
 * are not dependencies of this package at all. That is the whole point of the
 * per-component subpath exports: install one component, ship one component.
 */
import { JectsScheduler } from '@jects/react/scheduler';
import '@jects/scheduler/style.css';

// A tiny, valid scheduler config: two resource lanes and three events placed on
// them. Times are epoch ms (TimeMs); `endDate` is exclusive.
const DAY = '2026-06-25T00:00:00Z';
const at = (hour: number): number => new Date(DAY).getTime() + hour * 60 * 60 * 1000;

const resources = [
  { id: 1, name: 'Room A' },
  { id: 2, name: 'Room B' },
];

const events = [
  { id: 1, resourceId: 1, name: 'Standup', startDate: at(9), endDate: at(10) },
  { id: 2, resourceId: 1, name: 'Design review', startDate: at(11), endDate: at(13) },
  { id: 3, resourceId: 2, name: 'Client call', startDate: at(10), endDate: at(11) },
];

export function App(): JSX.Element {
  return (
    <main style={{ padding: 24 }}>
      <h1>Isolated @jects/react/scheduler</h1>
      <JectsScheduler
        resources={resources}
        events={events}
        style={{ height: 320 }}
        onEventClick={(payload) => {
          // The scheduler's typed events bridge through to React `on<Event>` props.
          console.log('event clicked', payload);
        }}
      />
    </main>
  );
}
