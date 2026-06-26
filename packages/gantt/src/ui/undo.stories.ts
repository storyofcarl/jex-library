/**
 * Undo/redo (STM) stories — framework-free usage examples for the Gantt
 * **State Tracking Manager** feature, used by the docs app and as a canonical
 * reference. Each story returns a function that mounts a configured `Gantt`
 * (with the undo/redo feature installed) into a host element.
 */
import { Gantt } from './gantt.js';
import { GanttUndoRedo, createUndoRedo } from './undo.js';
import type { TaskModel, DependencyModel } from '../contract.js';

export interface Story {
  name: string;
  render: (host: HTMLElement) => Gantt;
}

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 5);

function plan(): TaskModel[] {
  return [
    { id: 'p', name: 'Release 1.0' },
    { id: 'a', name: 'Design', parentId: 'p', start: T0, duration: 3 * DAY, end: T0 + 3 * DAY } as TaskModel,
    { id: 'b', name: 'Build', parentId: 'p', start: T0 + 3 * DAY, duration: 4 * DAY, end: T0 + 7 * DAY, percentDone: 0.4 } as TaskModel,
    { id: 'm', name: 'Ship', parentId: 'p', start: T0 + 7 * DAY, milestone: true } as TaskModel,
  ];
}

export const stories: Story[] = [
  {
    // The default: a floating undo/redo toolbar + Ctrl/Cmd+Z shortcuts. Edit a
    // bar (drag/resize), then undo/redo to step through history.
    name: 'Undo/redo toolbar (default)',
    render: (host) => {
      const gantt = new Gantt(host, { tasks: plan(), projectStart: T0 });
      gantt.use(new GanttUndoRedo());
      return gantt;
    },
  },
  {
    // Group several edits into ONE atomic undo step via explicit transaction
    // boundaries — e.g. an editor "Save" that touches name + dates at once.
    name: 'Atomic transaction (grouped edit = one undo step)',
    render: (host) => {
      const gantt = new Gantt(host, { tasks: plan(), projectStart: T0 });
      const stm = createUndoRedo();
      gantt.use(stm);

      stm.startTransaction('Save Design');
      gantt.updateTask('a', { name: 'Design spec', percentDone: 0.2 });
      gantt.updateTaskSpan('a', { start: T0 + DAY, end: T0 + 4 * DAY });
      stm.endTransaction(); // one undo step reverses both edits

      return gantt;
    },
  },
  {
    // Drag coalescing: a longer idle window collapses a rapid stream of span
    // ticks (a live drag) into a single undo step.
    name: 'Drag coalescing (one undo per gesture)',
    render: (host) => {
      const gantt = new Gantt(host, {
        tasks: plan(),
        dependencies: [{ id: 'l1', fromId: 'a', toId: 'b', type: 'FS' } as DependencyModel],
        projectStart: T0,
      });
      gantt.use(new GanttUndoRedo({ coalesceMs: 600 }));
      return gantt;
    },
  },
  {
    // History without the built-in toolbar — drive undo/redo from your own UI
    // or keyboard only.
    name: 'Programmatic (no toolbar, keyboard only)',
    render: (host) => {
      const gantt = new Gantt(host, { tasks: plan(), projectStart: T0 });
      gantt.use(new GanttUndoRedo({ toolbar: false, maxStack: 50 }));
      return gantt;
    },
  },
];
