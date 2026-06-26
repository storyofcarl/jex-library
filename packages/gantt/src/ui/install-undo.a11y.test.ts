/**
 * axe-core a11y + visual/interaction browser test for the **auto-installed**
 * Undo/redo (STM) layer (`installUndoRedo`) — Quality Gate Q2. Runs in real
 * Chromium via `pnpm --filter @jects/gantt test:browser`.
 *
 * This verifies the PARITY behaviour: undo/redo (toolbar + Ctrl+Z/Y) works out of
 * the box once the Gantt auto-installs the layer — no manual
 * `gantt.use(new GanttUndoRedo())`. It calls the `installUndoRedo` seam directly
 * (exactly what the Gantt's `setup()` does), then exercises the rendered toolbar
 * end to end on a real engine: roles/names, disabled→enabled on an edit, the bar
 * moving back on Undo, Redo re-applying, and zero serious/critical axe violations.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
// Load the shipped, token-pure package stylesheet so the toolbar is styled by
// the real CSS rather than unstyled defaults.
import '../styles.css';
import { Gantt } from './gantt.js';
import { installUndoRedo, UNDO_REDO_FEATURE } from './install-undo.js';
import { GanttUndoRedo } from './undo.js';
import type { TaskModel } from '../contract.js';
import { expectNoA11yViolations } from '../test-utils/a11y.js';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 5);

let host: HTMLElement;
let gantt: Gantt | null = null;

beforeEach(() => {
  host = document.createElement('div');
  host.style.position = 'relative';
  host.style.height = '320px';
  host.style.width = '960px';
  document.body.appendChild(host);
});

afterEach(() => {
  gantt?.destroy();
  gantt = null;
  host.remove();
});

function tasks(): TaskModel[] {
  return [
    { id: 'a', name: 'Design', start: T0, duration: 3 * DAY, end: T0 + 3 * DAY } as TaskModel,
    { id: 'b', name: 'Build', start: T0 + 3 * DAY, duration: 3 * DAY, end: T0 + 6 * DAY, percentDone: 0.25 } as TaskModel,
  ];
}

/** The bar's content-space left (px) read from the renderer's inline style. */
function barLeft(g: Gantt, taskId: string): number {
  const bar = g.el.querySelector(`.jects-gantt__bar[data-task-id="${taskId}"]`) as HTMLElement;
  return parseFloat(bar.style.left);
}

describe('installUndoRedo a11y + visual — out-of-the-box undo/redo (real Chromium)', () => {
  it('auto-installs an operable toolbar with no serious/critical violations', async () => {
    gantt = new Gantt(host, { tasks: tasks(), projectStart: T0 });
    const feature = installUndoRedo(gantt, undefined);
    expect(feature).toBeInstanceOf(GanttUndoRedo);
    expect(gantt.features.get(UNDO_REDO_FEATURE)).toBe(feature);

    await expectNoA11yViolations(host);

    const bar = gantt.el.querySelector('.jects-gantt__stm') as HTMLElement;
    expect(bar).not.toBeNull();
    expect(bar.getAttribute('role')).toBe('toolbar');
    expect(bar.getAttribute('aria-label')).toBe('Undo and redo');

    const undoBtn = bar.querySelector('.jects-gantt__stm__undo') as HTMLButtonElement;
    const redoBtn = bar.querySelector('.jects-gantt__stm__redo') as HTMLButtonElement;
    expect(undoBtn.getAttribute('aria-label')).toBe('Undo');
    expect(redoBtn.getAttribute('aria-label')).toBe('Redo');
    expect(undoBtn.querySelector('svg')).not.toBeNull();
    expect(undoBtn.disabled).toBe(true);
    expect(redoBtn.disabled).toBe(true);
  });

  it('toolbar undo restores the bar position; redo re-applies (out of the box)', async () => {
    gantt = new Gantt(host, { tasks: tasks(), projectStart: T0 });
    installUndoRedo(gantt, { coalesceMs: 0 });

    const undoBtn = gantt.el.querySelector('.jects-gantt__stm__undo') as HTMLButtonElement;
    const redoBtn = gantt.el.querySelector('.jects-gantt__stm__redo') as HTMLButtonElement;

    const originalLeft = barLeft(gantt, 'a');
    gantt.updateTaskSpan('a', { start: T0 + DAY, end: T0 + 4 * DAY });
    const movedLeft = barLeft(gantt, 'a');
    expect(movedLeft).toBeGreaterThan(originalLeft);
    expect(undoBtn.disabled).toBe(false);

    undoBtn.click();
    expect(barLeft(gantt, 'a')).toBeCloseTo(originalLeft, 0);
    expect(undoBtn.disabled).toBe(true);
    expect(redoBtn.disabled).toBe(false);

    redoBtn.click();
    expect(barLeft(gantt, 'a')).toBeCloseTo(movedLeft, 0);

    await expectNoA11yViolations(host);
  });

  it('Ctrl+Z / Ctrl+Shift+Z drive undo/redo with no manual install', () => {
    gantt = new Gantt(host, { tasks: tasks(), projectStart: T0 });
    installUndoRedo(gantt, { coalesceMs: 0 });

    const originalLeft = barLeft(gantt, 'a');
    gantt.updateTaskSpan('a', { start: T0 + 2 * DAY, end: T0 + 5 * DAY });
    const movedLeft = barLeft(gantt, 'a');
    expect(movedLeft).toBeGreaterThan(originalLeft);

    gantt.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    expect(barLeft(gantt, 'a')).toBeCloseTo(originalLeft, 0);

    gantt.el.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, shiftKey: true, bubbles: true }),
    );
    expect(barLeft(gantt, 'a')).toBeCloseTo(movedLeft, 0);
  });

  it('respects opt-out: no toolbar when undoRedo === false', async () => {
    gantt = new Gantt(host, { tasks: tasks(), projectStart: T0 });
    const feature = installUndoRedo(gantt, false);
    expect(feature).toBeUndefined();
    expect(gantt.el.querySelector('.jects-gantt__stm')).toBeNull();
    await expectNoA11yViolations(host);
  });
});
