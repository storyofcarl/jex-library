/**
 * Stories / usage examples for undo/redo (the State Tracking Manager).
 *
 * Every event move/resize/create/delete and dependency/assignment edit is
 * captured as a reversible transaction; `undo()`/`redo()` walk the stack, and
 * Ctrl/⌘+Z / Ctrl/⌘+Y are bound on the scheduler root.
 *
 * Framework-free, copy-pasteable snippets (no story-framework runtime), matching
 * the package's other `*.stories.ts`.
 */

import { Scheduler } from './scheduler.js';
import {
  installUndoRedo,
  type UndoRedoController,
  type UndoRedoHost,
} from './undo-redo.js';
import { createAssignmentStore } from '../stores/stores.js';

/**
 * A `Scheduler` structurally satisfies `UndoRedoHost`. Its `on` is typed over the
 * closed `SchedulerEvents` map, so we widen once at the call site (the same
 * localized cast the package uses elsewhere) when handing it to the plugin.
 */
const asHost = (s: Scheduler): UndoRedoHost => s as unknown as UndoRedoHost;

const HOUR = 3_600_000;
const MON_9 = Date.UTC(2025, 0, 6, 9); // Monday 09:00 UTC

/**
 * Basic wiring: install undo/redo on a scheduler. Now every gesture is undoable
 * with Ctrl/⌘+Z and redoable with Ctrl/⌘+Y, and programmatically via the returned
 * controller.
 */
export function undoRedoBasic(host: HTMLElement): {
  scheduler: Scheduler;
  undo: UndoRedoController;
} {
  const scheduler = new Scheduler(host, {
    resources: [{ id: 'r1', name: 'Alice' }],
    events: [
      { id: 'a', resourceId: 'r1', name: 'Design', startDate: MON_9, endDate: MON_9 + HOUR * 4 },
      { id: 'b', resourceId: 'r1', name: 'Build', startDate: MON_9 + HOUR * 5, endDate: MON_9 + HOUR * 8 },
    ],
    dependencies: [{ id: 'd1', fromId: 'a', toId: 'b', type: 'FS' }],
    dependenciesEditable: true,
    creatable: true,
  });
  const undo = installUndoRedo(asHost(scheduler));
  return { scheduler, undo };
}

/**
 * Toolbar buttons: drive undo/redo from app chrome, keeping the buttons' disabled
 * state in sync with the stacks via the `change` event.
 */
export function undoRedoToolbar(
  host: HTMLElement,
  undoBtn: HTMLButtonElement,
  redoBtn: HTMLButtonElement,
): UndoRedoController {
  const { undo } = undoRedoBasic(host);
  const sync = (): void => {
    undoBtn.disabled = !undo.canUndo;
    redoBtn.disabled = !undo.canRedo;
  };
  undo.on('change', sync);
  undoBtn.addEventListener('click', () => undo.undo());
  redoBtn.addEventListener('click', () => undo.redo());
  sync();
  return undo;
}

/**
 * Coalesced gesture: wrap several store writes in one named transaction so a
 * single undo reverts the whole batch (e.g. a multi-field editor save, or a
 * scripted bulk shift).
 */
export function undoRedoBatch(host: HTMLElement): UndoRedoController {
  const { scheduler, undo } = undoRedoBasic(host);
  const store = scheduler.getEventStore();
  undo.transact('Shift all by 1h', () => {
    store.forEach((e) => {
      store.update(e.id, { startDate: e.startDate + HOUR, endDate: e.endDate + HOUR });
    });
  });
  // One Ctrl+Z (or undo.undo()) now reverts every shift at once.
  return undo;
}

/**
 * Tracking an external assignment store: pass it in `extraStores` so multi-
 * assignment edits are undoable alongside event/dependency changes.
 */
export function undoRedoWithAssignments(host: HTMLElement): UndoRedoController {
  const assignments = createAssignmentStore([]);
  const scheduler = new Scheduler(host, {
    resources: [{ id: 'r1', name: 'Alice' }],
    events: [{ id: 'a', resourceId: 'r1', name: 'A', startDate: MON_9, endDate: MON_9 + HOUR * 2 }],
    assignments,
  });
  return installUndoRedo(asHost(scheduler), {
    extraStores: [{ name: 'assignments', store: assignments }],
  });
}

export const stories = {
  undoRedoBasic,
  undoRedoToolbar,
  undoRedoBatch,
  undoRedoWithAssignments,
};
