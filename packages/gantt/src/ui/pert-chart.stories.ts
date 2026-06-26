/**
 * PERT / network-diagram chart stories — framework-free usage examples for the
 * `GanttPertChart` view, used by the docs app and as a canonical reference. Each
 * story builds a REAL CPM schedule with the headless engine, projects it into a
 * PERT snapshot, and mounts a configured `GanttPertChart` into a host element.
 */
import { CpmEngine } from '../engine/scheduler.js';
import {
  GanttPertChart,
  fromScheduleResult,
  type PertChartSnapshot,
} from './pert-chart.js';
import type { CalendarModel, DependencyModel, TaskModel } from '../contract.js';

export interface Story {
  name: string;
  render: (host: HTMLElement) => GanttPertChart;
}

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 5);

const cal247: CalendarModel = {
  id: 'c',
  week: Array.from({ length: 7 }, (_, weekday) => ({
    weekday,
    intervals: [{ from: 0, to: 1440 }],
  })),
};

/** A diamond network (a→b→d / a→c→d) scheduled by the real CPM engine. */
function diamondSnapshot(): PertChartSnapshot {
  const tasks: TaskModel[] = [
    { id: 'a', name: 'Analyse requirements', calendarId: 'c', duration: 2 * DAY },
    { id: 'b', name: 'Build core', calendarId: 'c', duration: 4 * DAY },
    { id: 'c', name: 'Check designs', calendarId: 'c', duration: DAY },
    { id: 'd', name: 'Deliver release', calendarId: 'c', duration: 2 * DAY },
    { id: 'm', name: 'Go-live', calendarId: 'c', milestone: true },
  ];
  const deps: DependencyModel[] = [
    { id: 'ab', fromId: 'a', toId: 'b', type: 'FS' },
    { id: 'ac', fromId: 'a', toId: 'c', type: 'FS' },
    { id: 'bd', fromId: 'b', toId: 'd', type: 'FS' },
    { id: 'cd', fromId: 'c', toId: 'd', type: 'FS' },
    { id: 'dm', fromId: 'd', toId: 'm', type: 'FS' },
  ];
  const engine = new CpmEngine();
  engine.setCalendars([cal247], 'c');
  engine.setTasks(tasks);
  engine.setDependencies(deps);
  return fromScheduleResult(tasks, deps, engine.schedule({ projectStart: T0 }));
}

function sizedHost(host: HTMLElement): HTMLElement {
  host.style.position = 'relative';
  if (!host.style.height) host.style.height = '420px';
  return host;
}

/** Default horizontal network with critical-path highlighting + pan/zoom. */
export const basic: Story = {
  name: 'PERT chart — horizontal critical path',
  render(host) {
    const snap = diamondSnapshot();
    return new GanttPertChart(sizedHost(host), {
      nodes: snap.nodes,
      edges: snap.edges,
    });
  },
};

/** Top-to-bottom flow direction. */
export const vertical: Story = {
  name: 'PERT chart — vertical flow',
  render(host) {
    const snap = diamondSnapshot();
    return new GanttPertChart(sizedHost(host), {
      nodes: snap.nodes,
      edges: snap.edges,
      direction: 'vertical',
    });
  },
};

/** Critical-path highlighting disabled (plain network). */
export const noCriticalPath: Story = {
  name: 'PERT chart — no critical-path highlight',
  render(host) {
    const snap = diamondSnapshot();
    return new GanttPertChart(sizedHost(host), {
      nodes: snap.nodes,
      edges: snap.edges,
      showCriticalPath: false,
    });
  },
};

export const stories: Story[] = [basic, vertical, noCriticalPath];
