/**
 * @jects/scheduler — dependency drawing / editing UI stories.
 *
 * Living docs for the `dependenciesEditable` feature: hover terminals on bars,
 * drag-from-terminal-to-terminal to draw a link (FS/SS/FF/SF inferred from the
 * grabbed terminals), veto via `beforeDependencyCreate`, and select + delete a
 * dependency line. Plain factory functions returning a mounted widget, mirroring
 * the other `*.stories.ts`.
 */

import { Scheduler } from './scheduler.js';
import { HOUR_AND_DAY } from '@jects/timeline-core';
import type { ResourceModel, EventModel } from '../contract.js';

const HOUR = 3_600_000;
const base = Date.UTC(2025, 0, 6);

const resources: ResourceModel[] = [
  { id: 'r1', name: 'Alice' },
  { id: 'r2', name: 'Bob' },
  { id: 'r3', name: 'Carol' },
];

const events: EventModel[] = [
  { id: 'e1', resourceId: 'r1', name: 'Design', startDate: base + HOUR * 9, endDate: base + HOUR * 12 },
  { id: 'e2', resourceId: 'r2', name: 'Build', startDate: base + HOUR * 13, endDate: base + HOUR * 17, eventColor: 'cyan' },
  { id: 'e3', resourceId: 'r3', name: 'QA', startDate: base + HOUR * 18, endDate: base + HOUR * 21, eventColor: 'magenta' },
];

/**
 * Dependency editing on. Hover a bar to reveal its start/end terminals; drag
 * from one terminal to another bar's terminal to create a typed link. Click a
 * line to select it, then press Delete to remove it.
 */
export function editable(host: HTMLElement): Scheduler {
  const s = new Scheduler(host, {
    resources,
    events,
    dependencies: [{ id: 'd1', fromId: 'e1', toId: 'e2', type: 'FS' }],
    dependenciesEditable: true,
    preset: HOUR_AND_DAY,
    range: { start: base + HOUR * 6, end: base + HOUR * 24 },
  });
  s.on('dependencyCreate', ({ dependency }) => {
    console.log(`created ${dependency.type} ${dependency.fromId}→${dependency.toId}`);
  });
  return s;
}

/**
 * Veto example: every candidate link is rejected via `beforeDependencyCreate`,
 * so terminals + the drag gesture work but no link is ever committed.
 */
export function vetoed(host: HTMLElement): Scheduler {
  const s = new Scheduler(host, {
    resources,
    events,
    dependenciesEditable: true,
    preset: HOUR_AND_DAY,
    range: { start: base + HOUR * 6, end: base + HOUR * 24 },
  });
  s.on('beforeDependencyCreate', () => false);
  return s;
}

/**
 * Programmatic linking by writing straight into the reactive dependency store
 * (the same store the drag-to-link gesture mutates); the view repaints reactively.
 */
export function programmatic(host: HTMLElement): Scheduler {
  const s = editable(host);
  s.getDependencyStore().add({ id: 'd-prog', fromId: 'e2', toId: 'e3', type: 'FS' });
  return s;
}
