/**
 * Stories for the tabbed task editor feature — framework-free usage examples for
 * {@link GanttTabbedTaskEditorFeature}, the seam that wires the multi-tab task
 * editor (General + Resources) into a live `Gantt`. Each story builds a Gantt,
 * installs the feature, and opens the editor so the tabbed dialog + Resources
 * tab are visible. Double-clicking any task bar also opens it (the swap).
 */
import { Gantt } from './gantt.js';
import { GanttTabbedTaskEditorFeature } from './tabbed-task-editor-feature.js';
import { AssignmentStore, type ResourceModel } from './resource-assignment.js';
import type { TaskModel } from '../contract.js';

export interface Story {
  name: string;
  render: (host: HTMLElement) => { destroy(): void };
}

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 5);

const RESOURCES: ResourceModel[] = [
  { id: 'r1', name: 'Ada Lovelace', role: 'Engineer' },
  { id: 'r2', name: 'Grace Hopper', initials: 'GH', role: 'Lead' },
  { id: 'r3', name: 'Alan Turing' },
];

function tasks(): TaskModel[] {
  return [
    { id: 'a', name: 'Design', start: T0, duration: 4 * DAY, end: T0 + 4 * DAY, percentDone: 0.4 },
    { id: 'b', name: 'Build', start: T0 + 4 * DAY, duration: 3 * DAY, end: T0 + 7 * DAY },
  ];
}

export const stories: Story[] = [
  {
    name: 'Tabbed task editor — General + Resources (opened on a task)',
    render: (host) => {
      host.style.height = '320px';
      const store = new AssignmentStore({ resources: RESOURCES });
      store.assign('a', 'r1', 100);
      const gantt = new Gantt(host, { tasks: tasks(), projectStart: T0 });
      const feature = gantt.use(
        new GanttTabbedTaskEditorFeature({ assignmentStore: store }),
      ) as GanttTabbedTaskEditorFeature;
      feature.editTask('a');
      return { destroy: () => gantt.destroy() };
    },
  },
  {
    name: 'Double-click a bar to open the tabbed editor (the swap)',
    render: (host) => {
      host.style.height = '320px';
      const gantt = new Gantt(host, {
        tasks: tasks(),
        projectStart: T0,
        plugins: [new GanttTabbedTaskEditorFeature({ resources: RESOURCES })],
      });
      return { destroy: () => gantt.destroy() };
    },
  },
];
