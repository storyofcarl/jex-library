/**
 * Successors-column stories — framework-free usage examples for the read-only
 * **Successors** task-tree column (the symmetric twin of the Predecessors
 * column). Each story mounts a configured `Gantt` whose left grid shows both the
 * Predecessors AND Successors columns, so the two read as a matched pair.
 */
import { Gantt } from './gantt.js';
import { DEFAULT_GANTT_COLUMNS_WITH_SUCCESSORS } from './task-tree.js';
import { successorsLabel } from './successors-column.js';
import type { DependencyModel, TaskModel } from '../contract.js';

export interface Story {
  name: string;
  render: (host: HTMLElement) => Gantt;
}

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 5);

/** A short linear plan: Design → Build → Test, with one SS+lag side link. */
function plan(): TaskModel[] {
  return [
    { id: 'p', name: 'Release 1.0' },
    { id: 'a', name: 'Design', parentId: 'p', start: T0, duration: 3 * DAY, end: T0 + 3 * DAY } as TaskModel,
    { id: 'b', name: 'Build', parentId: 'p', start: T0 + 3 * DAY, duration: 4 * DAY, end: T0 + 7 * DAY } as TaskModel,
    { id: 'c', name: 'Test', parentId: 'p', start: T0 + 7 * DAY, duration: 2 * DAY, end: T0 + 9 * DAY } as TaskModel,
  ];
}

function links(): DependencyModel[] {
  return [
    { id: 'd1', fromId: 'a', toId: 'b' }, // Design → Build (FS)
    { id: 'd2', fromId: 'b', toId: 'c' }, // Build → Test (FS)
    { id: 'd3', fromId: 'a', toId: 'c', type: 'SS', lag: 2 * DAY }, // Design ⇒ Test (SS+2d)
  ];
}

export const stories: Story[] = [
  {
    name: 'Predecessors + Successors columns side by side',
    render: (host) =>
      new Gantt(host, {
        tasks: plan(),
        dependencies: links(),
        projectStart: T0,
        // Swap in the column set that includes the read-only Successors column.
        columns: DEFAULT_GANTT_COLUMNS_WITH_SUCCESSORS,
      }),
  },
  {
    name: 'Successors column with a name-token renderer',
    render: (host) => {
      const tasks = plan();
      const byId = new Map(tasks.map((t) => [t.id, t.name ?? String(t.id)]));
      const ls = links();
      const gantt = new Gantt(host, {
        tasks,
        dependencies: ls,
        projectStart: T0,
        columns: [
          { field: 'name', header: 'Task name', width: 200 },
          {
            field: 'successors',
            header: 'Then',
            width: 200,
          },
        ],
      });
      // NOTE: this story illustrates the pure resolver with a friendly token map
      // (the widget wires the default id-based resolver; a consumer who wants
      // name tokens can read `successorsLabel(links, id, { refToToken })` directly).
      void successorsLabel(ls, 'a', { refToToken: (id) => byId.get(id) ?? String(id) });
      return gantt;
    },
  },
];
