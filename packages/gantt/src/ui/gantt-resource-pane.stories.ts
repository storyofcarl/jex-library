/**
 * GanttResourcePane stories — framework-free usage examples for the integrated,
 * axis-synced docked resource pane. Each story mounts a `Gantt` with a resource
 * layer (`resources` + `assignments`, which auto-installs the `ResourceManager`)
 * and installs `GanttResourcePane`, which docks a tabbed pane (histogram /
 * utilization / resources) under the chart, sharing the Gantt time axis and
 * refreshing live as the schedule / staffing change.
 *
 * Install pattern:
 *   const gantt = new Gantt(host, { tasks, resources, assignments });
 *   gantt.use(new GanttResourcePane());           // or installResourcePane(gantt)
 *   // or, declaratively:
 *   new Gantt(host, { tasks, resources, assignments, plugins: [new GanttResourcePane()] });
 */
import { Gantt } from './gantt.js';
import { GanttResourcePane } from './gantt-resource-pane.js';
import type { TaskModel } from '../contract.js';
import type { ResourceModel, AssignmentModel } from '../resource/resource-contract.js';

export interface Story {
  name: string;
  render: (host: HTMLElement) => Gantt;
}

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 5);

function plan(): TaskModel[] {
  return [
    { id: 't1', name: 'Design', start: T0, duration: 3 * DAY, end: T0 + 3 * DAY } as TaskModel,
    { id: 't2', name: 'Build', start: T0, duration: 3 * DAY, end: T0 + 3 * DAY } as TaskModel,
    { id: 't3', name: 'Test', start: T0 + 3 * DAY, duration: 3 * DAY, end: T0 + 6 * DAY } as TaskModel,
  ];
}

const resources: ResourceModel[] = [
  { id: 'ada', name: 'Ada Lovelace', capacity: 1, hourlyCost: 120, group: 'Engineering' },
  { id: 'boris', name: 'Boris', capacity: 1, hourlyCost: 90, group: 'Engineering' },
  { id: 'team', name: 'QA Team', capacity: 3, hourlyCost: 70, group: 'Quality' },
];

const assignments: AssignmentModel[] = [
  // Ada over-allocated: full time on both t1 and t2 over the same window.
  { id: 'as1', taskId: 't1', resourceId: 'ada', units: 100 },
  { id: 'as2', taskId: 't2', resourceId: 'ada', units: 100 },
  { id: 'as3', taskId: 't3', resourceId: 'team', units: 200 },
];

function mount(host: HTMLElement, config?: ConstructorParameters<typeof GanttResourcePane>[0]): Gantt {
  const gantt = new Gantt(host, { tasks: plan(), projectStart: T0, resources, assignments });
  gantt.use(new GanttResourcePane(config));
  return gantt;
}

export const stories: Story[] = [
  {
    name: 'Default docked pane (histogram + utilization + resources)',
    render: (host) => mount(host),
  },
  {
    name: 'Utilization view first',
    render: (host) => mount(host, { initialView: 'utilization' }),
  },
  {
    name: 'Histogram-only pane',
    render: (host) => mount(host, { views: ['histogram'] }),
  },
  {
    name: 'Starts collapsed',
    render: (host) => mount(host, { collapsed: true }),
  },
  {
    name: 'Weekly histogram buckets',
    render: (host) => mount(host, { histogramBucketMs: 7 * DAY }),
  },
];

export default stories;
