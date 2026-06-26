/**
 * Segmented-tasks stories — framework-free usage examples for the Gantt **split /
 * segmented tasks** feature, used by the docs app and as a canonical reference.
 * Each story returns a function that mounts a configured `Gantt` (with the
 * segmented-tasks feature installed) into a host element so the split bars,
 * connectors, and split/join + per-segment drag interactions are visible.
 */
import { Gantt } from './gantt.js';
import { GanttSegmentedTasksFeature } from './segmented-tasks.js';
import type { TaskModel } from '../contract.js';

export interface Story {
  name: string;
  render: (host: HTMLElement) => Gantt;
}

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 5);

/** A plan with one pre-split task and one contiguous task to split interactively. */
function plan(): TaskModel[] {
  return [
    {
      id: 'pour',
      name: 'Pour foundations (interrupted by frost)',
      start: T0,
      end: T0 + 6 * DAY,
      duration: 4 * DAY,
      // Two working pieces with a 2-day weather pause.
      segments: [
        { start: T0, end: T0 + 2 * DAY },
        { start: T0 + 4 * DAY, end: T0 + 6 * DAY },
      ],
    } as TaskModel,
    { id: 'frame', name: 'Frame walls', start: T0 + 7 * DAY, end: T0 + 11 * DAY, duration: 4 * DAY } as TaskModel,
    { id: 'roof', name: 'Roof', start: T0 + 12 * DAY, end: T0 + 15 * DAY, duration: 3 * DAY } as TaskModel,
  ];
}

/** A pre-split task: foundations interrupted by a frost pause. */
export const splitTask: Story = {
  name: 'Split task (pre-segmented)',
  render(host) {
    const gantt = new Gantt(host, { tasks: plan(), projectStart: T0 });
    gantt.use(new GanttSegmentedTasksFeature());
    return gantt;
  },
};

/**
 * Interactive split/join: double-click a bar piece to cut it around a gap, click
 * a connector to rejoin, drag a segment (or its edge handles) to reschedule just
 * that piece. Keyboard: `S` splits the focused bar, `J` joins its first gap.
 */
export const interactiveSplitJoin: Story = {
  name: 'Interactive split / join / per-segment drag',
  render(host) {
    const gantt = new Gantt(host, { tasks: plan(), projectStart: T0 });
    const feature = new GanttSegmentedTasksFeature({ splitGap: DAY });
    gantt.use(feature);
    // Demonstrate the programmatic API by splitting the framing task once.
    feature.split('frame', T0 + 9 * DAY);
    return gantt;
  },
};

/** A read-only render (no split/join/drag) for print / export contexts. */
export const readOnlySegments: Story = {
  name: 'Read-only segments (non-interactive)',
  render(host) {
    const gantt = new Gantt(host, { tasks: plan(), projectStart: T0 });
    gantt.use(new GanttSegmentedTasksFeature({ interactive: false }));
    return gantt;
  },
};

export const stories: Story[] = [splitTask, interactiveSplitJoin, readOnlySegments];
