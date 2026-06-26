/**
 * Minimal isolated Web Component gantt example.
 *
 * The ONLY Jects imports are the gantt wrapper subpath and the gantt engine styles:
 *
 *   import { registerGantt } from '@jects/elements/gantt';  // <- per-component subpath
 *   import '@jects/gantt/style.css';                        // <- engine styles
 *
 * Because `@jects/elements/gantt` resolves to `dist/gantt.js`, which imports only
 * `@jects/gantt` (plus the shared factory chunk), a bundler building this app never
 * touches `@jects/grid`, `@jects/scheduler`, or any other sibling engine — they are
 * not dependencies of this package at all. That is the whole point of the per-component
 * subpath exports: install one component, ship one component.
 */
import { registerGantt, type GanttOptions, type JectsElement } from '@jects/elements/gantt';
import type { Gantt, GanttEvents } from '@jects/gantt';
import '@jects/gantt/style.css';

// Define <jects-gantt> once. Idempotent and scoped to this single tag.
registerGantt();

// Task models satisfy the engine's `Model` contract (`Record<string, unknown>`),
// so we use a type alias with an index signature rather than a closed interface.
type Task = {
  id: number;
  name: string;
  start: number;
  duration: number;
  percentDone?: number;
  parentId?: number | null;
  [key: string]: unknown;
};

const DAY = 24 * 60 * 60 * 1000;
const PROJECT_START = Date.UTC(2026, 0, 5); // Mon 2026-01-05

const config: GanttOptions<Task> = {
  projectStart: PROJECT_START,
  columns: [
    { field: 'name', header: 'Task' },
    { field: 'percentDone', header: '% Done' },
  ],
  tasks: [
    { id: 1, name: 'Phase 1', start: PROJECT_START, duration: 5 * DAY },
    { id: 2, name: 'Design', start: PROJECT_START, duration: 2 * DAY, percentDone: 1, parentId: 1 },
    { id: 3, name: 'Build', start: PROJECT_START + 2 * DAY, duration: 3 * DAY, percentDone: 0.4, parentId: 1 },
  ],
  dependencies: [{ id: 1, fromId: 2, toId: 3, type: 'FS' }],
};

// `JectsElement<Gantt, …>` gives the typed `config` setter and `addEventListener` overloads.
const el = document.createElement('jects-gantt') as JectsElement<
  Gantt,
  GanttOptions<Task>,
  GanttEvents<Task>
>;
el.style.height = '320px';
el.config = config;
el.addEventListener('taskClick', (ev) => {
  // The gantt's typed events bridge through to DOM CustomEvents.
  console.log('task clicked', ev.detail);
});

document.body.appendChild(el);
