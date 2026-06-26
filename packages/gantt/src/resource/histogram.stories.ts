/**
 * Resource Histogram stories — framework-free usage examples for the Gantt
 * **Resource Histogram** feature, used by the docs app and as a canonical
 * reference. Each story mounts a `Gantt` with a `ResourceManager` + the
 * `GanttResourceHistogramFeature` installed, so the per-resource allocation
 * chart paints below the timeline against the shared axis.
 */
import { Gantt } from '../ui/gantt.js';
import { ResourceManager } from './resource-manager.js';
import {
  GanttResourceHistogramFeature,
  createResourceHistogram,
} from './histogram.js';
import type { TaskModel } from '../contract.js';
import type { ResourceModel, AssignmentModel } from './resource-contract.js';

export interface Story {
  name: string;
  render: (host: HTMLElement) => Gantt;
}

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 5);

function tasks(): TaskModel[] {
  return [
    { id: 't1', name: 'Design', start: T0, duration: 4 * DAY, end: T0 + 4 * DAY } as TaskModel,
    { id: 't2', name: 'Build', start: T0 + 2 * DAY, duration: 4 * DAY, end: T0 + 6 * DAY } as TaskModel,
    { id: 't3', name: 'Document', start: T0, duration: 6 * DAY, end: T0 + 6 * DAY } as TaskModel,
  ];
}

function resources(): ResourceModel[] {
  return [
    { id: 'ada', name: 'Ada Lovelace', type: 'work', capacity: 1 },
    { id: 'grace', name: 'Grace Hopper', type: 'work', capacity: 1 },
    { id: 'team', name: 'QA Team', type: 'work', capacity: 3 },
  ];
}

/** Ada is over-booked: full-time on two overlapping tasks (t1 + t2). */
function assignments(): AssignmentModel[] {
  return [
    { id: 'a1', taskId: 't1', resourceId: 'ada', units: 100 },
    { id: 'a2', taskId: 't2', resourceId: 'ada', units: 100 },
    { id: 'a3', taskId: 't3', resourceId: 'grace', units: 50 },
    { id: 'a4', taskId: 't1', resourceId: 'team', units: 100 },
    { id: 'a5', taskId: 't3', resourceId: 'team', units: 100 },
  ];
}

/** Day-bucketed histogram with an over-allocation band on Ada's row. */
export const dayHistogram: Story = {
  name: 'Resource histogram (day buckets, over-allocation)',
  render(host) {
    const gantt = new Gantt(host, { tasks: tasks(), projectStart: T0 });
    gantt.use(new ResourceManager({ resources: resources(), assignments: assignments() }));
    gantt.use(createResourceHistogram({ bucketUnit: 'day', rowHeight: 48 }));
    return gantt;
  },
};

/** The same plan aggregated into week buckets. */
export const weekHistogram: Story = {
  name: 'Resource histogram (week buckets)',
  render(host) {
    const gantt = new Gantt(host, { tasks: tasks(), projectStart: T0 });
    gantt.use(new ResourceManager({ resources: resources(), assignments: assignments() }));
    gantt.use(new GanttResourceHistogramFeature({ bucketUnit: 'week', rowHeight: 56 }));
    return gantt;
  },
};

export const stories: Story[] = [dayHistogram, weekHistogram];
