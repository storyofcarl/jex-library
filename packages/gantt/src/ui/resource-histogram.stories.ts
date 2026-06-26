/**
 * Resource Histogram stories — framework-free usage examples for the Gantt
 * **Resource Histogram** view, used by the docs app and as a canonical
 * reference. Each story mounts a `Gantt` (which owns the shared time axis) plus
 * a `ResourceManager` and a `ResourceHistogram` pane underneath it, so the
 * histogram columns line up with the task bars above.
 *
 * The histogram is a standalone view: it reads a `ResourceApi` (the
 * `ResourceManager`) + the Gantt's `timeline.axis`, and resolves task spans via
 * `getTaskSpan`. Call `histogram.refresh()` from the integrator on
 * `scheduleChange` / `assign` / axis changes (wired below for the demo).
 */
import { Gantt } from './gantt.js';
import { ResourceHistogram } from './resource-histogram.js';
import { ResourceManager } from '../resource/resource-manager.js';
import type { TaskModel } from '../contract.js';
import type { ResourceModel } from '../resource/resource-contract.js';

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
  { id: 'ada', name: 'Ada Lovelace', capacity: 1 },
  { id: 'boris', name: 'Boris', capacity: 1 },
  { id: 'team', name: 'QA Team', capacity: 3 },
];

/**
 * Mount a Gantt + a resource histogram beneath it into `host`, with the given
 * assignments applied. Returns the Gantt (the story contract value); the
 * histogram is kept alive as a child pane and refreshed on schedule changes.
 */
function mount(
  host: HTMLElement,
  assignments: Array<[task: string, resource: string, units?: number]>,
  bucketMs = DAY,
): Gantt {
  host.style.display = 'flex';
  host.style.flexDirection = 'column';
  const ganttHost = document.createElement('div');
  ganttHost.style.flex = '1 1 auto';
  ganttHost.style.minHeight = '220px';
  const histHost = document.createElement('div');
  histHost.style.flex = '0 0 auto';
  histHost.style.borderTop = '1px solid transparent';
  host.append(ganttHost, histHost);

  const gantt = new Gantt(ganttHost, { tasks: plan(), projectStart: T0 });
  const mgr = new ResourceManager({ resources });
  gantt.use(mgr);
  for (const [task, resource, units] of assignments) mgr.assign(task, resource, units);

  const hist = new ResourceHistogram(histHost, {
    api: mgr,
    axis: gantt.timeline.axis,
    getTaskSpan: (id) => gantt.getTask(id),
    bucketMs,
  });
  // Keep the histogram in lockstep with the schedule for the demo.
  gantt.on('scheduleChange', () => hist.refresh());
  gantt.on('taskChange', () => hist.refresh());
  return gantt;
}

export const stories: Story[] = [
  {
    name: 'Balanced allocation (no over-allocation)',
    render: (host) => mount(host, [['t1', 'ada', 100], ['t2', 'boris', 100], ['t3', 'team', 100]]),
  },
  {
    name: 'Over-allocated resource (Ada on two concurrent tasks)',
    render: (host) =>
      mount(host, [['t1', 'ada', 100], ['t2', 'ada', 100], ['t3', 'boris', 100]]),
  },
  {
    name: 'High-capacity team (capacity 3) absorbing 250% load',
    render: (host) =>
      mount(host, [['t1', 'team', 150], ['t2', 'team', 100], ['t3', 'boris', 100]]),
  },
  {
    name: 'Weekly buckets (coarse time phasing)',
    render: (host) =>
      mount(host, [['t1', 'ada', 100], ['t2', 'ada', 100], ['t3', 'boris', 100]], 7 * DAY),
  },
];
