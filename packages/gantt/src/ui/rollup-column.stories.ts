/**
 * Rollup-column stories — framework-free usage examples for the task-tree
 * **'rollup' DATA column** (Bryntum/DHTMLX column-type parity). Each story mounts
 * a standalone `GanttTaskTree` (the left pane's accessible-fallback treegrid) with
 * a rollup column configured, so the docs app shows both modes:
 *
 *   - flag/check mode (editable checkbox toggling `task.rollup`), and
 *   - summary mode (an aggregate rolled up from descendant leaves).
 */
import { TreeStore } from '@jects/core';
import { GanttTaskTree, DEFAULT_GANTT_COLUMNS } from './task-tree.js';
import { rollupColumn } from './rollup-column.js';
import type { TaskModel } from '../contract.js';

export interface Story {
  name: string;
  render: (host: HTMLElement) => GanttTaskTree;
}

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 5);

function plan(): TreeStore<TaskModel & { children?: TaskModel[] }> {
  return new TreeStore<TaskModel & { children?: TaskModel[] }>({
    data: [
      {
        id: 'phase',
        name: 'Phase 1',
        children: [
          { id: 'a', name: 'Design', start: T0, duration: 2 * DAY, end: T0 + 2 * DAY, percentDone: 0.6, effort: 2 * DAY, rollup: true },
          { id: 'b', name: 'Build', start: T0 + 2 * DAY, duration: 3 * DAY, end: T0 + 5 * DAY, percentDone: 0.25, effort: 4 * DAY },
          { id: 'm', name: 'Sign-off', start: T0 + 5 * DAY, milestone: true, rollup: true },
        ],
      },
    ],
    expanded: ['phase'],
  });
}

export const stories: Story[] = [
  {
    name: 'Rollup column — flag / check (editable)',
    render(host) {
      const tree = new GanttTaskTree({
        store: plan(),
        columns: [...DEFAULT_GANTT_COLUMNS, rollupColumn({ kind: 'flag' })],
        rowHeight: 32,
        headerHeight: 40,
        width: 720,
        predecessorsOf: () => '',
      });
      host.append(tree.el);
      return tree;
    },
  },
  {
    name: 'Rollup column — summary (avg % done over leaves)',
    render(host) {
      const tree = new GanttTaskTree({
        store: plan(),
        columns: [
          ...DEFAULT_GANTT_COLUMNS,
          rollupColumn({ kind: 'summary', field: 'percentDone', aggregation: 'avg', header: 'Avg %' }),
        ],
        rollupColumnConfig: { kind: 'summary', field: 'percentDone', aggregation: 'avg' },
        rowHeight: 32,
        headerHeight: 40,
        width: 720,
        predecessorsOf: () => '',
      });
      host.append(tree.el);
      return tree;
    },
  },
  {
    name: 'Rollup column — summary (Σ effort, person-days)',
    render(host) {
      const tree = new GanttTaskTree({
        store: plan(),
        columns: [
          ...DEFAULT_GANTT_COLUMNS,
          rollupColumn({ kind: 'summary', field: 'effort', aggregation: 'sum', header: 'Σ Effort' }),
        ],
        rollupColumnConfig: { kind: 'summary', field: 'effort', aggregation: 'sum' },
        rowHeight: 32,
        headerHeight: 40,
        width: 720,
        predecessorsOf: () => '',
      });
      host.append(tree.el);
      return tree;
    },
  },
];
