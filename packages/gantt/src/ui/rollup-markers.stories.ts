/**
 * Rollup-markers stories — framework-free usage examples for the Gantt
 * **child-task rollup markers** feature, used by the docs app and as a canonical
 * reference. Each story returns a function that mounts a configured `Gantt` (with
 * the rollup feature installed) into a host element, then collapses the summary so
 * the rolled-up child markers are visible.
 */
import { type TreeStore, type RecordId } from '@jects/core';
import { Gantt } from './gantt.js';
import { GanttRollupFeature } from './rollup-markers.js';
import type { TaskModel } from '../contract.js';

export interface Story {
  name: string;
  render: (host: HTMLElement) => Gantt;
}

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 5);

/** A two-phase plan (flat `parentId` array) with leaf tasks + a milestone. */
function plan(opts: { rollup?: boolean } = {}): TaskModel[] {
  const flag = opts.rollup ? { rollup: true } : {};
  return [
    { id: 'phase1', name: 'Phase 1 — Design', ...flag } as TaskModel,
    { id: 'a', name: 'Research', parentId: 'phase1', start: T0, duration: 2 * DAY, end: T0 + 2 * DAY, ...flag } as TaskModel,
    { id: 'b', name: 'Wireframes', parentId: 'phase1', start: T0 + 2 * DAY, duration: 3 * DAY, end: T0 + 5 * DAY, ...flag } as TaskModel,
    { id: 'm1', name: 'Design sign-off', parentId: 'phase1', start: T0 + 5 * DAY, milestone: true, ...flag } as TaskModel,
    { id: 'phase2', name: 'Phase 2 — Build', ...flag } as TaskModel,
    { id: 'c', name: 'Implement', parentId: 'phase2', start: T0 + 5 * DAY, duration: 4 * DAY, end: T0 + 9 * DAY, ...flag } as TaskModel,
    { id: 'd', name: 'QA', parentId: 'phase2', start: T0 + 9 * DAY, duration: 2 * DAY, end: T0 + 11 * DAY, ...flag } as TaskModel,
  ];
}

/** Collapse the given summary ids so their children roll up onto the summary bar. */
function collapse(gantt: Gantt, ids: RecordId[]): void {
  const store = (gantt as unknown as { _store: TreeStore<TaskModel> })._store;
  for (const id of ids) store.collapse(id);
  (gantt as unknown as { refreshPanes(): void }).refreshPanes();
}

export const stories: Story[] = [
  {
    name: 'Rollups on collapsed summaries (per-task flag)',
    render: (host) => {
      const gantt = new Gantt(host, { tasks: plan({ rollup: true }), projectStart: T0 });
      gantt.use(new GanttRollupFeature());
      collapse(gantt, ['phase1', 'phase2']);
      return gantt;
    },
  },
  {
    name: 'Roll up every summary (allSummaries)',
    render: (host) => {
      const gantt = new Gantt(host, { tasks: plan(), projectStart: T0 });
      gantt.use(new GanttRollupFeature({ allSummaries: true }));
      collapse(gantt, ['phase1', 'phase2']);
      return gantt;
    },
  },
  {
    name: 'Always show rollups (even when expanded)',
    render: (host) => {
      const gantt = new Gantt(host, { tasks: plan({ rollup: true }), projectStart: T0 });
      gantt.use(new GanttRollupFeature({ mode: 'always' }));
      // Left expanded on purpose to show the markers riding the summary bars.
      return gantt;
    },
  },
];
