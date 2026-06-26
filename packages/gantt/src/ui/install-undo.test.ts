/**
 * jsdom unit tests for the `installUndoRedo` auto-install seam — the additive hook
 * the `Gantt` widget calls in `setup()` to wire Undo/redo (STM) out of the box
 * (Bryntum/DHTMLX parity). Exercises the three branches: auto-install by default,
 * explicit opt-out, and adoption of a consumer-provided `GanttUndoRedo` plugin.
 *
 * These call the seam directly against a real `Gantt` (exactly what `setup()`
 * does), so the test is valid regardless of whether the in-tree `setup()` wiring
 * has landed yet — keeping this feature self-contained while the integrator wires
 * the single additive call described in the wire notes.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Gantt } from './gantt.js';
import { GanttUndoRedo } from './undo.js';
import { installUndoRedo, UNDO_REDO_FEATURE } from './install-undo.js';
import type { TaskModel } from '../contract.js';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 5);

let host: HTMLElement;
let gantt: Gantt | null = null;

function tasks(): TaskModel[] {
  return [
    { id: 'a', name: 'Design', start: T0, duration: 3 * DAY, end: T0 + 3 * DAY },
    { id: 'b', name: 'Build', start: T0 + 3 * DAY, duration: 3 * DAY, end: T0 + 6 * DAY },
  ];
}

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});

afterEach(() => {
  gantt?.destroy();
  gantt = null;
  host.remove();
});

describe('installUndoRedo — auto-install (default on)', () => {
  it('installs a GanttUndoRedo when undoRedo is undefined (default true)', () => {
    gantt = new Gantt(host, { tasks: tasks(), projectStart: T0 });
    const feature = installUndoRedo(gantt, undefined);

    expect(feature).toBeInstanceOf(GanttUndoRedo);
    expect(gantt.features.get(UNDO_REDO_FEATURE)).toBe(feature);
  });

  it('installs when undoRedo === true', () => {
    gantt = new Gantt(host, { tasks: tasks(), projectStart: T0 });
    const feature = installUndoRedo(gantt, true);
    expect(feature).toBeInstanceOf(GanttUndoRedo);
  });

  it('the auto-installed feature records edits + undo works out of the box', () => {
    gantt = new Gantt(host, { tasks: tasks(), projectStart: T0 });
    // coalesceMs:0 so the single edit commits immediately (no idle window).
    const feature = installUndoRedo(gantt, { coalesceMs: 0 })!;
    expect(feature.canUndo).toBe(false);

    gantt.updateTaskSpan('a', { start: T0 + DAY, end: T0 + 4 * DAY });
    expect(gantt.getTask('a')!.start).toBe(T0 + DAY);
    expect(feature.canUndo).toBe(true);

    expect(feature.undo()).toBe(true);
    expect(gantt.getTask('a')!.start).toBe(T0);
    expect(feature.canRedo).toBe(true);
  });

  it('renders the token-pure undo/redo toolbar into the Gantt root by default', () => {
    gantt = new Gantt(host, { tasks: tasks(), projectStart: T0 });
    installUndoRedo(gantt, undefined);
    const bar = gantt.el.querySelector('.jects-gantt__stm');
    expect(bar).not.toBeNull();
    expect(bar!.getAttribute('role')).toBe('toolbar');
  });

  it('Ctrl+Z works out of the box via the auto-installed shortcuts', () => {
    gantt = new Gantt(host, { tasks: tasks(), projectStart: T0 });
    installUndoRedo(gantt, { coalesceMs: 0 });
    gantt.updateTaskSpan('a', { start: T0 + DAY, end: T0 + 4 * DAY });
    expect(gantt.getTask('a')!.start).toBe(T0 + DAY);

    gantt.el.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }),
    );
    expect(gantt.getTask('a')!.start).toBe(T0);
  });
});

describe('installUndoRedo — config forwarding', () => {
  it('forwards an object config (toolbar:false suppresses the toolbar)', () => {
    gantt = new Gantt(host, { tasks: tasks(), projectStart: T0 });
    const feature = installUndoRedo(gantt, { toolbar: false });
    expect(feature).toBeInstanceOf(GanttUndoRedo);
    expect(gantt.el.querySelector('.jects-gantt__stm')).toBeNull();
  });
});

describe('installUndoRedo — explicit opt-out', () => {
  it('does NOT install when undoRedo === false', () => {
    gantt = new Gantt(host, { tasks: tasks(), projectStart: T0 });
    const feature = installUndoRedo(gantt, false);
    expect(feature).toBeUndefined();
    expect(gantt.features.get(UNDO_REDO_FEATURE)).toBeUndefined();
    expect(gantt.el.querySelector('.jects-gantt__stm')).toBeNull();
  });
});

describe('installUndoRedo — adopt consumer-provided plugin', () => {
  it('adopts an already-installed GanttUndoRedo instead of double-installing', () => {
    const provided = new GanttUndoRedo({ coalesceMs: 0, toolbar: false });
    gantt = new Gantt(host, { tasks: tasks(), projectStart: T0, plugins: [provided] });

    // The plugin is already installed by setup()'s plugin loop. The seam adopts it.
    const resolved = installUndoRedo(gantt, undefined);
    expect(resolved).toBe(provided);
    // No second toolbar got rendered (the provided one had toolbar:false).
    expect(gantt.el.querySelector('.jects-gantt__stm')).toBeNull();
    // Still exactly one feature under the key.
    expect(gantt.features.get(UNDO_REDO_FEATURE)).toBe(provided);
  });

  it('adopts the provided plugin even when undoRedo === false (consumer wins)', () => {
    const provided = new GanttUndoRedo({ coalesceMs: 0, toolbar: false });
    gantt = new Gantt(host, { tasks: tasks(), projectStart: T0, plugins: [provided] });
    const resolved = installUndoRedo(gantt, false);
    expect(resolved).toBe(provided);
  });
});

describe('installUndoRedo — disposal', () => {
  it('the auto-installed feature is disposed with the Gantt', () => {
    gantt = new Gantt(host, { tasks: tasks(), projectStart: T0 });
    const feature = installUndoRedo(gantt, undefined)!;
    gantt.destroy();
    gantt = null;
    // After Gantt destroy(), the feature's wrappers/toolbar are gone — re-using it
    // would have to be re-init'd; canUndo is false on a fresh/destroyed STM.
    expect(feature.canUndo).toBe(false);
    expect(host.querySelector('.jects-gantt__stm')).toBeNull();
  });
});
