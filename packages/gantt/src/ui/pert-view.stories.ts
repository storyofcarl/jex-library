/**
 * PERT-view stories — framework-free usage examples for the Gantt **PERT /
 * network-diagram view**, used by the docs app and as a canonical reference.
 *
 * Each story returns a function that mounts a configured {@link PertView} into a
 * host element. The first two render the view standalone from plain task +
 * dependency arrays; the last wires it to a live `Gantt` via
 * {@link PertView.fromGantt} so the diagram tracks the engine's slack + critical
 * path.
 */
import { Gantt } from './gantt.js';
import {
  PertView,
  createPertView,
  type PertTaskInput,
  type PertDependencyInput,
} from './pert-view.js';
import type { TaskModel } from '../contract.js';

export interface Story {
  name: string;
  render: (host: HTMLElement) => PertView | Gantt;
}

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 5);

/** A small diamond network with one slack branch (so a critical path exists). */
function network(): {
  tasks: PertTaskInput[];
  dependencies: PertDependencyInput[];
} {
  return {
    tasks: [
      { id: 'A', name: 'Kickoff', start: T0, end: T0 + DAY, duration: DAY, totalSlack: 0 },
      { id: 'B', name: 'Build core', start: T0 + DAY, end: T0 + 4 * DAY, duration: 3 * DAY, totalSlack: 0 },
      { id: 'C', name: 'Docs', start: T0 + DAY, end: T0 + 2 * DAY, duration: DAY, totalSlack: 2 * DAY },
      { id: 'D', name: 'Integrate', start: T0 + 4 * DAY, end: T0 + 6 * DAY, duration: 2 * DAY, totalSlack: 0 },
      { id: 'E', name: 'Release', start: T0 + 6 * DAY, end: T0 + 6 * DAY, milestone: true, totalSlack: 0 },
    ],
    dependencies: [
      { id: 'ab', fromId: 'A', toId: 'B' },
      { id: 'ac', fromId: 'A', toId: 'C' },
      { id: 'bd', fromId: 'B', toId: 'D' },
      { id: 'cd', fromId: 'C', toId: 'D' },
      { id: 'de', fromId: 'D', toId: 'E' },
    ],
  };
}

export const stories: Story[] = [
  {
    name: 'PERT network diagram (critical path emphasised)',
    render: (host) => {
      host.style.height = '420px';
      const { tasks, dependencies } = network();
      return createPertView(host, { tasks, dependencies });
    },
  },
  {
    name: 'PERT view without critical emphasis',
    render: (host) => {
      host.style.height = '420px';
      const { tasks, dependencies } = network();
      return createPertView(host, { tasks, dependencies, showCriticalPath: false });
    },
  },
  {
    name: 'PERT view driven by a live Gantt (fromGantt)',
    render: (host) => {
      host.style.height = '420px';
      const { tasks, dependencies } = network();
      // A hidden Gantt drives the engine; the PERT view reads its live schedule.
      const ganttHost = document.createElement('div');
      ganttHost.style.display = 'none';
      host.appendChild(ganttHost);
      const gantt = new Gantt(ganttHost, {
        tasks: tasks as unknown as TaskModel[],
        dependencies: dependencies.map((d) => ({ ...d })),
        projectStart: T0,
      });
      const pertHost = document.createElement('div');
      pertHost.style.height = '100%';
      host.appendChild(pertHost);
      PertView.fromGantt(pertHost, gantt, { tasks, dependencies });
      return gantt;
    },
  },
];
