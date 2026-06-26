/**
 * Rollups stories — framework-free usage examples for the Gantt **child-rollup
 * glyphs + tooltip** feature, used by the docs app and as a canonical reference.
 * Each story returns a function that mounts a configured `Gantt` (with the
 * `GanttRollups` feature installed, and the demo summary collapsed so the rollup
 * glyphs are visible) into a host element.
 */
import { Gantt } from './gantt.js';
import { GanttRollups } from './rollups.js';
import type { TaskModel } from '../contract.js';
import type { TreeStore, RecordId } from '@jects/core';

export interface Story {
  name: string;
  render: (host: HTMLElement) => Gantt;
}

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 5);

/** A phase with two work tasks + a sign-off milestone, flagged for rollup. */
function phasePlan(opts: { rollup?: boolean } = {}): TaskModel[] {
  const flag = opts.rollup === false ? {} : { rollup: true };
  return [
    { id: 'phase', name: 'Phase 1', ...flag } as TaskModel,
    { id: 'a', name: 'Design', parentId: 'phase', start: T0, duration: 2 * DAY, end: T0 + 2 * DAY, percentDone: 0.6, ...flag } as TaskModel,
    { id: 'b', name: 'Build', parentId: 'phase', start: T0 + 2 * DAY, duration: 3 * DAY, end: T0 + 5 * DAY, percentDone: 0.25, ...flag } as TaskModel,
    { id: 'm', name: 'Sign-off', parentId: 'phase', start: T0 + 5 * DAY, milestone: true, ...flag } as TaskModel,
  ];
}

/** Collapse the demo summary so the rollup glyphs surface on the parent bar. */
function collapse(gantt: Gantt, id: RecordId): Gantt {
  const store = (gantt as unknown as { _store: TreeStore<TaskModel> })._store;
  store.collapse(id);
  (gantt as unknown as { refreshPanes(): void }).refreshPanes();
  return gantt;
}

export const stories: Story[] = [
  {
    name: 'Rollup glyphs on a collapsed summary (hover/focus for tooltips)',
    render: (host) => {
      const gantt = new Gantt(host, { tasks: phasePlan(), projectStart: T0 });
      gantt.use(new GanttRollups());
      return collapse(gantt, 'phase');
    },
  },
  {
    name: 'All summaries roll up (no per-task flag needed)',
    render: (host) => {
      const gantt = new Gantt(host, { tasks: phasePlan({ rollup: false }), projectStart: T0 });
      gantt.use(new GanttRollups({ allSummaries: true }));
      return collapse(gantt, 'phase');
    },
  },
  {
    name: "Always mode (glyphs even while expanded)",
    render: (host) => {
      const gantt = new Gantt(host, { tasks: phasePlan(), projectStart: T0 });
      gantt.use(new GanttRollups({ mode: 'always' }));
      return gantt;
    },
  },
  {
    name: 'Custom tooltip text',
    render: (host) => {
      const gantt = new Gantt(host, { tasks: phasePlan(), projectStart: T0 });
      gantt.use(
        new GanttRollups({
          tooltipText: (task, span) =>
            `${task.name}: ${new Date(span.start).toUTCString()}`,
        }),
      );
      return collapse(gantt, 'phase');
    },
  },
];
