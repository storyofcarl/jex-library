/**
 * vue-gantt-minimal — isolated single-component usage of Jects + Vue.
 *
 * The ONLY Jects imports are:
 *   - `@jects/vue/gantt` — the per-component Vue wrapper subpath (imports just the gantt wrapper)
 *   - `@jects/gantt`      — the gantt engine it binds to
 *   - `@jects/gantt/style.css` — the gantt engine's stylesheet
 *
 * There is no import of `@jects/vue` (the root barrel) and no sibling engine
 * (`@jects/grid`, `@jects/scheduler`, …). Because `@jects/vue/gantt` resolves to
 * `dist/gantt.js`, which imports only `@jects/gantt` + the shared factory chunk, the
 * bundler never has to resolve any other engine to build this app.
 */
import { createApp, h } from 'vue';
// `GanttOptions` defaults its generics to the engine's `Model` (Record<string, unknown>),
// which is exactly the shape the `JectsGantt` Vue wrapper's props expect.
import { JectsGantt, type GanttOptions } from '@jects/vue/gantt';
import '@jects/gantt/style.css';

const DAY = 24 * 60 * 60 * 1000;
const projectStart = Date.UTC(2026, 0, 5); // Mon 2026-01-05

// A tiny task tree: one summary parent with two child tasks.
const tasks: GanttOptions['tasks'] = [
  { id: 1, name: 'Launch plan', start: projectStart, duration: 5 * DAY },
  { id: 2, name: 'Design', parentId: 1, start: projectStart, duration: 2 * DAY, percentDone: 1 },
  { id: 3, name: 'Build', parentId: 1, start: projectStart + 2 * DAY, duration: 3 * DAY, percentDone: 0.4 },
];

// One finish-to-start dependency: Build starts after Design finishes.
const dependencies: GanttOptions['dependencies'] = [
  { id: 1, fromId: 2, toId: 3, type: 'FS' },
];

const columns: GanttOptions['columns'] = [
  { field: 'name', header: 'Task' },
];

createApp({
  render: () => h(JectsGantt, { tasks, dependencies, columns, projectStart }),
}).mount('#app');
