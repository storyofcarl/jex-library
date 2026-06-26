/**
 * axe-core a11y + visual/interaction browser test for the Gantt **Undo/redo
 * (State Tracking Manager)** feature (Quality Gate Q2). Runs in real Chromium via
 * `pnpm --filter @jects/gantt test:browser`.
 *
 * Beyond zero serious/critical axe violations, this exercises the feature end to
 * end on a real `Gantt` + engine: the undo/redo toolbar renders with the right
 * roles + accessible names; the buttons are disabled until an edit, enable after
 * a drag-equivalent span change, and clicking Undo restores the prior schedule
 * (the bar moves back to its original pixel position); Redo re-applies it; and
 * keyboard shortcuts (Ctrl+Z / Ctrl+Shift+Z) drive the same history.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
// Load the shipped, token-pure package stylesheet so the toolbar is styled by
// the real CSS rather than unstyled defaults.
import '../styles.css';
import { Gantt } from './gantt.js';
import { GanttUndoRedo } from './undo.js';
import { ResourceManager } from '../resource/resource-manager.js';
import type { TaskModel } from '../contract.js';
import type { ResourceModel } from '../resource/resource-contract.js';
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

describe('GanttUndoRedo a11y + visual (real Chromium)', () => {
  it('renders an operable toolbar with no serious/critical violations', async () => {
    gantt = new Gantt(host, { tasks: tasks(), projectStart: T0 });
    const feature = new GanttUndoRedo();
    gantt.use(feature);

    await expectNoA11yViolations(host);

    const bar = gantt.el.querySelector('.jects-gantt__stm') as HTMLElement;
    expect(bar).not.toBeNull();
    expect(bar.getAttribute('role')).toBe('toolbar');
    expect(bar.getAttribute('aria-label')).toBe('Undo and redo');

    const undoBtn = bar.querySelector('.jects-gantt__stm__undo') as HTMLButtonElement;
    const redoBtn = bar.querySelector('.jects-gantt__stm__redo') as HTMLButtonElement;
    // Each button has an accessible name + native tooltip.
    expect(undoBtn.getAttribute('aria-label')).toBe('Undo');
    expect(redoBtn.getAttribute('aria-label')).toBe('Redo');
    // Both buttons are inline SVG-bearing and start disabled.
    expect(undoBtn.querySelector('svg')).not.toBeNull();
    expect(undoBtn.disabled).toBe(true);
    expect(redoBtn.disabled).toBe(true);
  });

  it('undo restores the bar to its original position; redo re-applies the move', async () => {
    gantt = new Gantt(host, { tasks: tasks(), projectStart: T0 });
    // coalesceMs:0 commits each discrete edit immediately (no idle window) so the
    // single span change becomes an undoable step right away.
    const feature = new GanttUndoRedo({ coalesceMs: 0 });
    gantt.use(feature);

    const undoBtn = gantt.el.querySelector('.jects-gantt__stm__undo') as HTMLButtonElement;
    const redoBtn = gantt.el.querySelector('.jects-gantt__stm__redo') as HTMLButtonElement;

    const originalLeft = barLeft(gantt, 'a');

    // Move task 'a' one day later (a drag-equivalent span change).
    gantt.updateTaskSpan('a', { start: T0 + DAY, end: T0 + 4 * DAY });
    const movedLeft = barLeft(gantt, 'a');
    expect(movedLeft).toBeGreaterThan(originalLeft);
    expect(undoBtn.disabled).toBe(false);

    // Undo via the toolbar button — the bar returns to its original x.
    undoBtn.click();
    expect(barLeft(gantt, 'a')).toBeCloseTo(originalLeft, 0);
    expect(undoBtn.disabled).toBe(true);
    expect(redoBtn.disabled).toBe(false);

    // Redo re-applies the move.
    redoBtn.click();
    expect(barLeft(gantt, 'a')).toBeCloseTo(movedLeft, 0);

    // Still accessible after the interaction churn.
    await expectNoA11yViolations(host);
  });

  it('keyboard shortcuts drive undo/redo (Ctrl+Z / Ctrl+Shift+Z)', () => {
    gantt = new Gantt(host, { tasks: tasks(), projectStart: T0 });
    gantt.use(new GanttUndoRedo({ coalesceMs: 0 }));

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
});

describe('GanttUndoRedo — resource assignment undo (real Chromium)', () => {
  const RESOURCES: ResourceModel[] = [
    { id: 'r1', name: 'Ada', capacity: 1 },
    { id: 'r2', name: 'Grace', capacity: 1 },
  ];

  it('undo/redo of an assignment keeps the AssignmentStore + task field consistent', async () => {
    gantt = new Gantt(host, { tasks: tasks(), projectStart: T0 });
    const mgr = new ResourceManager({ resources: RESOURCES });
    gantt.use(mgr);
    const stm = new GanttUndoRedo({ coalesceMs: 0 });
    gantt.use(stm);

    const ids = (): string[] => mgr.assignmentStore.resourceIdsOf('a').map(String);

    // Assign through the resource manager (the real assign path).
    mgr.assign('a', 'r1', 100);
    expect(ids()).toEqual(['r1']);
    expect(gantt.getTask('a')!.resourceIds).toEqual(['r1']);
    expect(stm.canUndo).toBe(true);

    // Undo: the store AND the field both drop the resource (the regression was the
    // store staying out of sync with resourceIds — views and field disagreeing).
    stm.undo();
    expect(ids()).toEqual([]);
    expect(gantt.getTask('a')!.resourceIds ?? []).toEqual([]);
    expect(mgr.getAssignmentsFor('a').length).toBe(0);

    // Redo restores both consistently.
    stm.redo();
    expect(ids()).toEqual(['r1']);
    expect(gantt.getTask('a')!.resourceIds).toEqual(['r1']);

    // The toolbar remains accessible through the assignment interaction.
    await expectNoA11yViolations(host);
  });
});
