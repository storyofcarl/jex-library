/**
 * Dependency task-editor-tab stories — framework-free usage examples for the
 * Predecessors / Successors editable grids, the Advanced (constraint / calendar
 * / scheduling-mode) form, and the Notes textarea, plus the `GanttDependencyTabs`
 * orchestrator that routes every edit through a `GanttApi`.
 *
 * Each story mounts the panels in a bare host so the controls are visible and
 * interactive without the full Gantt widget. A tiny in-memory fake `GanttApi`
 * records the mutations the Save would route through.
 */
import {
  DependencyGridField,
  AdvancedFields,
  NotesField,
  GanttDependencyTabs,
  type TaskOption,
} from './task-editor-dependency-tabs.js';
import type { TaskModel, DependencyModel, GanttApi } from '../contract.js';

export interface Story {
  name: string;
  render: (host: HTMLElement) => { destroy(): void };
}

const DAY = 86_400_000;

const TASKS: TaskModel[] = [
  { id: 'a', name: 'Design' },
  { id: 'b', name: 'Build' },
  { id: 'c', name: 'Test' },
  { id: 'd', name: 'Ship' },
];
const OPTIONS: TaskOption[] = TASKS.map((t) => ({ id: t.id, name: t.name! }));

function fakeApi(deps: DependencyModel[]): GanttApi {
  let seq = 0;
  const taskById = new Map(TASKS.map((t) => [t.id, t]));
  return {
    engine: { getTasks: () => TASKS },
    getTask: (id: unknown) => taskById.get(id as never),
    getDependenciesFor: (taskId: unknown) =>
      deps.filter((d) => d.fromId === taskId || d.toId === taskId),
    addDependency: (dep: Omit<DependencyModel, 'id'>) => {
      const created = { id: `new-${++seq}`, ...dep } as DependencyModel;
      deps.push(created);
      return created;
    },
    removeDependency: () => {},
    applyConstraint: () => true,
    updateTask: () => true,
  } as unknown as GanttApi;
}

export const stories: Story[] = [
  {
    name: 'Predecessors grid (editable: target / type / lag)',
    render: (host) => {
      const field = new DependencyGridField({
        taskId: 'a',
        direction: 'predecessors',
        links: [{ id: 'l1', fromId: 'b', toId: 'a', type: 'FS', lag: DAY }],
        taskOptions: OPTIONS,
      });
      host.append(field.el);
      return field;
    },
  },
  {
    name: 'Advanced (constraint + calendar + scheduling mode)',
    render: (host) => {
      const adv = new AdvancedFields({
        task: { id: 'a', name: 'Design', constraintType: 'startNoEarlierThan', constraintDate: Date.UTC(2026, 0, 5) },
        calendars: [
          { id: 'std', name: 'Standard 5×8' },
          { id: 'night', name: 'Night shift' },
        ],
      });
      host.append(adv.el);
      return adv;
    },
  },
  {
    name: 'Notes',
    render: (host) => {
      const notes = new NotesField({ value: 'Coordinate with the design system team before Build.' });
      host.append(notes.el);
      return notes;
    },
  },
  {
    name: 'All four tabs wired through GanttApi',
    render: (host) => {
      const api = fakeApi([{ id: 'l1', fromId: 'b', toId: 'a', type: 'FS', lag: DAY }]);
      const tabs = new GanttDependencyTabs({
        api,
        task: { id: 'a', name: 'Design', constraintType: 'asSoonAsPossible' },
        extras: { calendars: [{ id: 'std', name: 'Standard 5×8' }] },
      });
      for (const p of tabs.panels()) {
        const section = document.createElement('section');
        const h = document.createElement('h3');
        h.textContent = p.label;
        section.append(h, p.content);
        host.append(section);
      }
      return tabs;
    },
  },
];
