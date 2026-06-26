/**
 * Progress-line stories — framework-free usage examples for the Gantt
 * **Progress line / status line** feature, used by the docs app and as a
 * canonical reference. Each story returns a function that mounts a configured
 * `Gantt` (with the progress-line feature installed) into a host element.
 */
import { Gantt } from './gantt.js';
import { GanttProgressLineFeature } from './progress-line.js';
import type { TaskModel } from '../contract.js';

export interface Story {
  name: string;
  render: (host: HTMLElement) => Gantt;
}

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 5);

/** A plan with a mix of behind / on-track / ahead tasks to bow the line both ways. */
function planWithProgress(): TaskModel[] {
  return [
    { id: 'p', name: 'Release 1.0' },
    // Behind: only 15% done well into its window.
    { id: 'a', name: 'Design', parentId: 'p', start: T0, duration: 6 * DAY, end: T0 + 6 * DAY, percentDone: 0.15 } as TaskModel,
    // On track: roughly half done at the half-way mark.
    { id: 'b', name: 'Build', parentId: 'p', start: T0, duration: 6 * DAY, end: T0 + 6 * DAY, percentDone: 0.5 } as TaskModel,
    // Ahead: nearly complete early.
    { id: 'c', name: 'QA', parentId: 'p', start: T0, duration: 6 * DAY, end: T0 + 6 * DAY, percentDone: 0.85 } as TaskModel,
  ];
}

export const stories: Story[] = [
  {
    name: 'Status line at a fixed status date',
    render: (host) => {
      const gantt = new Gantt(host, { tasks: planWithProgress(), projectStart: T0 });
      gantt.use(new GanttProgressLineFeature({ statusDate: T0 + 3 * DAY, label: 'Status' }));
      return gantt;
    },
  },
  {
    name: 'Status line tracking "today"',
    render: (host) => {
      const gantt = new Gantt(host, { tasks: planWithProgress(), projectStart: T0 });
      gantt.use(new GanttProgressLineFeature({ anchor: 'today' }));
      return gantt;
    },
  },
  {
    name: 'Full line (every leaf task, not only in-progress)',
    render: (host) => {
      const gantt = new Gantt(host, { tasks: planWithProgress(), projectStart: T0 });
      gantt.use(
        new GanttProgressLineFeature({ statusDate: T0 + 3 * DAY, inProgressOnly: false }),
      );
      return gantt;
    },
  },
  {
    name: 'Earned-value driven (custom getProgress)',
    render: (host) => {
      const gantt = new Gantt(host, { tasks: planWithProgress(), projectStart: T0 });
      gantt.use(
        new GanttProgressLineFeature({
          statusDate: T0 + 3 * DAY,
          // Drive the line from a custom field instead of percentDone.
          getProgress: (task) => {
            const ev = (task.data as { earnedValue?: number } | undefined)?.earnedValue;
            return ev != null ? ev : task.percentDone;
          },
        }),
      );
      return gantt;
    },
  },
];
