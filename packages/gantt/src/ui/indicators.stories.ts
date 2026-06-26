/**
 * Indicators stories — framework-free usage examples for the Gantt
 * **Indicators** feature, used by the docs app and as a canonical reference.
 * Each story returns a function that mounts a configured `Gantt` (with the
 * Indicators feature installed) into a host element.
 */
import { Gantt } from './gantt.js';
import { GanttIndicatorsFeature, type GanttIndicator } from './indicators.js';
import type { TaskModel } from '../contract.js';

export interface Story {
  name: string;
  render: (host: HTMLElement) => Gantt;
}

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 5);

/** A small plan exercising constraints, deadlines, a late finish, and milestones. */
function planWithIndicators(): TaskModel[] {
  return [
    { id: 'p', name: 'Release 1.0' },
    {
      id: 'a',
      name: 'Design',
      parentId: 'p',
      start: T0,
      duration: 4 * DAY,
      end: T0 + 4 * DAY,
      constraintType: 'mustStartOn',
      constraintDate: T0,
      // finishes T0+4d, deadline T0+3d ⇒ shows a "late" indicator
      deadline: T0 + 3 * DAY,
    } as TaskModel,
    {
      id: 'b',
      name: 'Build',
      parentId: 'p',
      start: T0 + 4 * DAY,
      duration: 5 * DAY,
      end: T0 + 9 * DAY,
      deadline: T0 + 14 * DAY, // comfortably on time
    } as TaskModel,
    {
      id: 'c',
      name: 'QA',
      parentId: 'p',
      start: T0 + 9 * DAY,
      duration: 3 * DAY,
      end: T0 + 12 * DAY,
      constraintType: 'finishNoLaterThan',
      constraintDate: T0 + 13 * DAY,
    } as TaskModel,
    { id: 'm', name: 'Ship', parentId: 'p', start: T0 + 12 * DAY, milestone: true },
  ];
}

export const stories: Story[] = [
  {
    name: 'Default indicators (constraint / deadline / late)',
    render: (host) => {
      const gantt = new Gantt(host, { tasks: planWithIndicators(), projectStart: T0 });
      gantt.use(new GanttIndicatorsFeature());
      return gantt;
    },
  },
  {
    name: 'Deadlines only',
    render: (host) => {
      const gantt = new Gantt(host, { tasks: planWithIndicators(), projectStart: T0 });
      gantt.use(
        new GanttIndicatorsFeature({
          constraintIndicators: false,
          conflictIndicators: false,
        }),
      );
      return gantt;
    },
  },
  {
    name: 'Custom indicators (flag overdue tasks)',
    render: (host) => {
      const gantt = new Gantt(host, { tasks: planWithIndicators(), projectStart: T0 });
      gantt.use(
        new GanttIndicatorsFeature({
          getIndicators: (task): GanttIndicator[] => {
            if (task.percentDone != null && task.percentDone < 0.5 && task.end && task.end < Date.now()) {
              return [
                {
                  id: 'overdue',
                  kind: 'custom',
                  icon: 'alert-triangle',
                  side: 'end',
                  tooltip: 'Overdue and under 50% complete',
                },
              ];
            }
            return [];
          },
          onIndicatorClick: ({ indicator, task }) => {
            host.dispatchEvent(
              new CustomEvent('gantt-indicator-click', { detail: { indicator, task } }),
            );
          },
        }),
      );
      return gantt;
    },
  },
];
