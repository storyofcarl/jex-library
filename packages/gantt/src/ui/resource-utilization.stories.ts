/**
 * Resource Utilization stories — framework-free usage examples for the Gantt
 * **Resource Utilization** view, used by the docs app and as a canonical
 * reference. Each story mounts a standalone `ResourceUtilizationView` driven by
 * a real `ResourceManager` (resource + assignment stores) over a small plan.
 *
 * The view is additive: it reads the resource `ResourceApi` plus a task-span
 * source (the host `Gantt`/`GanttApi`, or any `{ getTask }`), so it can run on
 * its own as shown here or be docked next to a live Gantt.
 */
import { ResourceUtilizationView, type TaskSpanSource } from './resource-utilization.js';
import { ResourceManager } from '../resource/resource-manager.js';
import type { GanttApi, TaskModel } from '../contract.js';
import type { ResourceModel } from '../resource/resource-contract.js';
import type { RecordId } from '@jects/core';

export interface Story {
  name: string;
  render: (host: HTMLElement) => ResourceUtilizationView;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const JAN1 = Date.UTC(2026, 0, 5); // a Monday

const RESOURCES: ResourceModel[] = [
  { id: 'r1', name: 'Ada Lovelace', capacity: 1, hourlyCost: 120, group: 'Engineering' },
  { id: 'r2', name: 'Boris Becker', capacity: 2, hourlyCost: 90, group: 'Engineering' },
  { id: 'r3', name: 'Crane', type: 'equipment', capacity: 1 },
];

const TASKS: TaskModel[] = [
  { id: 't1', name: 'Design', start: JAN1, end: JAN1 + 5 * DAY, effort: 40 * HOUR } as TaskModel,
  { id: 't2', name: 'Build', start: JAN1, end: JAN1 + 5 * DAY, effort: 40 * HOUR } as TaskModel,
  { id: 't3', name: 'QA', start: JAN1 + WEEK, end: JAN1 + WEEK + 5 * DAY, effort: 40 * HOUR } as TaskModel,
  { id: 't4', name: 'Deploy', start: JAN1 + WEEK, end: JAN1 + WEEK + 2 * DAY, effort: 16 * HOUR } as TaskModel,
];

/** Build a ResourceManager + task-span source seeded with assignments. */
function makeModel(): { mgr: ResourceManager; src: TaskSpanSource; range: { start: number; end: number } } {
  const byId = new Map(TASKS.map((t) => [t.id, { ...t }]));
  const gApi = {
    getTask: (id: RecordId) => byId.get(id),
    updateTask: (id: RecordId, patch: Partial<TaskModel>) => {
      const t = byId.get(id);
      if (t) Object.assign(t, patch);
      return !!t;
    },
    emit: () => true,
    track: () => {},
  } as unknown as GanttApi;
  const mgr = new ResourceManager({ resources: RESOURCES });
  mgr.init(gApi);
  // Ada is over-allocated in week 1 (two full-time tasks at once).
  mgr.assign('t1', 'r1', 100);
  mgr.assign('t2', 'r1', 100);
  // Boris (capacity 2) splits across tasks comfortably.
  mgr.assign('t1', 'r2', 50);
  mgr.assign('t3', 'r2', 100);
  mgr.assign('t4', 'r2', 100);
  return { mgr, src: { getTask: (id) => byId.get(id) }, range: { start: JAN1, end: JAN1 + 2 * WEEK } };
}

export const stories: Story[] = [
  {
    name: 'Weekly utilization (percent allocation)',
    render: (host) => {
      const { mgr, src, range } = makeModel();
      return new ResourceUtilizationView(host, { api: mgr, tasks: src, unit: 'week', range });
    },
  },
  {
    name: 'Expanded drill-down to tasks',
    render: (host) => {
      const { mgr, src, range } = makeModel();
      return new ResourceUtilizationView(host, {
        api: mgr, tasks: src, unit: 'week', range, expanded: ['r1', 'r2'],
      });
    },
  },
  {
    name: 'Daily buckets showing effort hours',
    render: (host) => {
      const { mgr, src } = makeModel();
      return new ResourceUtilizationView(host, {
        api: mgr, tasks: src, unit: 'day', cellMode: 'effort',
        range: { start: JAN1, end: JAN1 + 5 * DAY },
      });
    },
  },
  {
    name: 'All resources incl. idle ones',
    render: (host) => {
      const { mgr, src, range } = makeModel();
      return new ResourceUtilizationView(host, {
        api: mgr, tasks: src, unit: 'week', range, includeUnassigned: true,
      });
    },
  },
];
