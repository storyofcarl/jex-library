/**
 * vue-scheduler-minimal — isolated single-component usage of Jects + Vue.
 *
 * The ONLY Jects imports are:
 *   - `@jects/vue/scheduler` — the per-component Vue wrapper subpath (imports just the scheduler wrapper)
 *   - `@jects/scheduler`     — the scheduler engine it binds to
 *   - `@jects/scheduler/style.css` — the engine's stylesheet
 *
 * There is no import of `@jects/vue` (the root barrel) and no sibling engine
 * (`@jects/gantt`, `@jects/grid`, …). Because `@jects/vue/scheduler` resolves to
 * `dist/scheduler.js`, which imports only `@jects/scheduler` + the shared factory
 * chunk, the bundler never has to resolve any other engine to build this app.
 */
import { createApp, h } from 'vue';
// `SchedulerConfig` is the engine's top-level config — exactly the shape the
// `JectsScheduler` Vue wrapper's props expect.
import { JectsScheduler, type SchedulerConfig } from '@jects/vue/scheduler';
import '@jects/scheduler/style.css';

// One day, anchored so the events fall inside the visible range.
const day = Date.UTC(2026, 5, 26); // 2026-06-26 00:00 UTC
const h0 = 60 * 60 * 1000; // one hour in ms

const resources: SchedulerConfig['resources'] = [
  { id: 1, name: 'Ada Lovelace' },
  { id: 2, name: 'Grace Hopper' },
];

const events: SchedulerConfig['events'] = [
  { id: 1, resourceId: 1, name: 'Design review', startDate: day + 9 * h0, endDate: day + 11 * h0 },
  { id: 2, resourceId: 2, name: 'Pair session', startDate: day + 10 * h0, endDate: day + 13 * h0 },
];

createApp({
  render: () => h(JectsScheduler, { resources, events }),
}).mount('#app');
