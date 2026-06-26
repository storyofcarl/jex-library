/**
 * Resource stories — framework-free usage examples for the Gantt resource data
 * layer (`ResourceStore` + `AssignmentStore` + `ResourceManager`). Each story
 * installs the `ResourceManager` into a `Gantt` and mounts a
 * `ResourceAssignmentView` so the assignments are visible.
 */
import { Gantt } from '../ui/gantt.js';
import { ResourceManager } from './resource-manager.js';
import { ResourceAssignmentView } from './resource-assignment-view.js';
import type { TaskModel } from '../contract.js';
import type { ResourceModel, AssignmentModel } from './resource-contract.js';

export interface Story {
  name: string;
  render: (host: HTMLElement) => Gantt;
}

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 5);

function plan(): TaskModel[] {
  return [
    { id: 'p', name: 'Release 1.0' },
    { id: 'a', name: 'Design', parentId: 'p', start: T0, duration: 4 * DAY, end: T0 + 4 * DAY, effort: 32 * 3_600_000 },
    { id: 'b', name: 'Build', parentId: 'p', start: T0 + 4 * DAY, duration: 5 * DAY, end: T0 + 9 * DAY, effort: 40 * 3_600_000 },
    { id: 'c', name: 'QA', parentId: 'p', start: T0 + 9 * DAY, duration: 3 * DAY, end: T0 + 12 * DAY, effort: 24 * 3_600_000 },
  ];
}

const resources: ResourceModel[] = [
  { id: 'ada', name: 'Ada Lovelace', hourlyCost: 120, capacity: 1, group: 'Engineering' },
  { id: 'boris', name: 'Boris Becker', hourlyCost: 90, capacity: 1, group: 'Engineering' },
  { id: 'qa', name: 'QA Pool', hourlyCost: 70, capacity: 2, group: 'Quality' },
];

const assignments: AssignmentModel[] = [
  { id: 'as1', taskId: 'a', resourceId: 'ada', units: 100 },
  { id: 'as2', taskId: 'b', resourceId: 'ada', units: 100 },
  { id: 'as3', taskId: 'b', resourceId: 'boris', units: 50 },
  { id: 'as4', taskId: 'c', resourceId: 'qa', units: 100 },
];

function withChips(gantt: Gantt, mgr: ResourceManager, host: HTMLElement, taskIds: string[]): void {
  const panel = document.createElement('div');
  panel.style.padding = '8px';
  for (const id of taskIds) {
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.gap = '8px';
    row.style.alignItems = 'center';
    const label = document.createElement('strong');
    label.textContent = `${id}: `;
    row.append(label);
    const view = new ResourceAssignmentView(row, { api: mgr, taskId: id });
    gantt.track(() => view.destroy());
    panel.append(row);
  }
  host.append(panel);
}

export const stories: Story[] = [
  {
    name: 'Resources + assignments (chips per task)',
    render: (host) => {
      const gantt = new Gantt(host, { tasks: plan(), projectStart: T0 });
      const mgr = new ResourceManager({ resources, assignments });
      gantt.use(mgr);
      withChips(gantt, mgr, host, ['a', 'b', 'c']);
      return gantt;
    },
  },
  {
    name: 'Over-allocation flagged (Ada on two concurrent tasks)',
    render: (host) => {
      const gantt = new Gantt(host, { tasks: plan(), projectStart: T0 });
      const mgr = new ResourceManager({ resources });
      gantt.use(mgr);
      // Ada full-time on two overlapping tasks ⇒ 200 units > capacity 100.
      mgr.assign('a', 'ada', 100);
      mgr.assign('b', 'ada', 100);
      withChips(gantt, mgr, host, ['a', 'b']);
      return gantt;
    },
  },
];
