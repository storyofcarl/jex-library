/**
 * Dependency-columns stories — framework-free usage examples for the editable
 * **Predecessors / Successors** columns + the inline notation editor. Each story
 * returns a function that mounts a configured `Gantt` (with the
 * `GanttDependencyColumns` feature installed) and opens an inline editor over a
 * demo cell so the notation round-trip + validation reads at a glance.
 */
import { Gantt } from './gantt.js';
import {
  GanttDependencyColumns,
  type DependencySide,
} from './dependency-editor.js';
import type { TaskModel } from '../contract.js';

export interface Story {
  name: string;
  render: (host: HTMLElement) => Gantt;
}

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 5);

function chain(): TaskModel[] {
  return [
    { id: 1, name: 'Design', start: T0, duration: 3 * DAY, end: T0 + 3 * DAY } as TaskModel,
    { id: 2, name: 'Build', start: T0 + 3 * DAY, duration: 4 * DAY, end: T0 + 7 * DAY } as TaskModel,
    { id: 3, name: 'Test', start: T0 + 7 * DAY, duration: 2 * DAY, end: T0 + 9 * DAY } as TaskModel,
  ];
}

/** Mount a Gantt + feature and drop an inline editor for a cell into the host. */
function mountWithEditor(
  host: HTMLElement,
  taskId: TaskModel['id'],
  side: DependencySide,
): Gantt {
  const gantt = new Gantt(host, {
    tasks: chain(),
    dependencies: [
      { id: 'l1', fromId: 1, toId: 2, type: 'FS' },
      { id: 'l2', fromId: 2, toId: 3, type: 'FS', lag: DAY },
    ],
    projectStart: T0,
  });
  const feature = new GanttDependencyColumns();
  gantt.use(feature);

  const demo = document.createElement('div');
  demo.style.maxWidth = '240px';
  demo.style.margin = '8px';
  const editor = feature.openEditor(taskId, side);
  demo.appendChild(editor.el);
  host.appendChild(demo);
  editor.focus();
  return gantt;
}

export const stories: Story[] = [
  {
    name: 'Edit predecessors by typing notation (2 → start as 2FS, etc.)',
    render: (host) => mountWithEditor(host, 2, 'predecessors'),
  },
  {
    name: 'Edit successors (oriented the other way)',
    render: (host) => mountWithEditor(host, 2, 'successors'),
  },
  {
    name: 'Cycle rejection feedback (type "2" into task 1 predecessors)',
    render: (host) => mountWithEditor(host, 1, 'predecessors'),
  },
];

export default stories;
