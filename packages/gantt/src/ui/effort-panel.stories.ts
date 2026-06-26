/**
 * Effort-driven scheduling stories — framework-free usage examples for the
 * `EffortDrivenEngine` + `EffortPanel`. Each story wires the effort-driven
 * engine over the package CPM scheduler and mounts an `EffortPanel` so the
 * effort↔duration↔units reflow is visible and interactive.
 */
import { EffortDrivenEngine, type ResourceModel } from '../engine/effort.js';
import { CpmEngine } from '../engine/scheduler.js';
import { EffortPanel } from './effort-panel.js';
import type { CalendarModel, TaskModel } from '../contract.js';

export interface Story {
  name: string;
  render: (host: HTMLElement) => { destroy(): void };
}

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 5);

const cal: CalendarModel = {
  id: 'std',
  name: 'Standard 5×8',
  hoursPerDay: 8,
  week: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, intervals: [{ from: 9 * 60, to: 17 * 60 }] })),
};

const resources: ResourceModel[] = [
  { id: 'ada', name: 'Ada Lovelace', capacity: 1 },
  { id: 'boris', name: 'Boris Becker', capacity: 1 },
  { id: 'team', name: 'QA Pool (×2)', capacity: 2 },
];

function engine(task: TaskModel): EffortDrivenEngine {
  const e = new EffortDrivenEngine(new CpmEngine());
  e.setCalendars([cal], 'std');
  e.setResources(resources);
  e.setTasks([{ calendarId: 'std', start: T0, ...task }]);
  e.setDependencies([]);
  e.schedule({ projectStart: T0 });
  return e;
}

export const stories: Story[] = [
  {
    name: 'Effort-driven task — add resources to shorten it',
    render: (host) => {
      const e = engine({ id: 'a', name: 'Build feature', effortDriven: true, duration: 8 * DAY });
      e.assignResource('a', 'ada'); // one FTE → 8d
      const panel = new EffortPanel(host, { engine: e, taskId: 'a' });
      return panel;
    },
  },
  {
    name: 'Fixed-duration task — effort tracks staffing instead',
    render: (host) => {
      const e = engine({ id: 'f', name: 'Fixed review', duration: 4 * DAY });
      e.assignResource('f', 'ada');
      e.assignResource('f', 'boris'); // 2 FTE → effort 8d, duration stays 4d
      const panel = new EffortPanel(host, { engine: e, taskId: 'f' });
      return panel;
    },
  },
];
