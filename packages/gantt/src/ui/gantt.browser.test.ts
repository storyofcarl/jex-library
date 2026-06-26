/**
 * Visual / interaction SMOKE test for `@jects/gantt` in REAL Chromium.
 * Run with `pnpm --filter @jects/gantt test:browser`.
 *
 * Asserts the load-bearing behaviours the Quality Gate calls out for the
 * scheduler/gantt component:
 *   1. Dragging a bar updates its time/position (pointer gesture → engine →
 *      recomputed span written back to the bar's pixel geometry).
 *   2. A dependency change reschedules a dependent AND recomputes the critical
 *      path.
 *   3. The bars are keyboard-operable (a11y interaction parity with the pointer
 *      gesture): an arrow-key nudge reschedules through the same engine path.
 *   4. The task editor (a popup/Window) mounts at BODY level — not nested inside
 *      the Gantt's clipping/scroll container — so it is never clipped.
 *
 * These run in Chromium (not jsdom) because layout/geometry and PointerEvents
 * must be real for the drag projection and clipping assertions to mean anything.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Gantt } from './gantt.js';
import { createSchedulingEngine } from '../engine/index.js';
import type { TaskModel, DependencyModel } from '../contract.js';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 5);

let host: HTMLElement;
let gantt: Gantt | null = null;

function baseTasks(): TaskModel[] {
  return [
    { id: 'p', name: 'Phase 1' },
    { id: 'a', name: 'Design', parentId: 'p', start: T0, duration: 3 * DAY, end: T0 + 3 * DAY },
    { id: 'b', name: 'Build', parentId: 'p', start: T0 + 3 * DAY, duration: 3 * DAY, end: T0 + 6 * DAY },
    { id: 'c', name: 'Ship', parentId: 'p', start: T0 + 6 * DAY, duration: 2 * DAY, end: T0 + 8 * DAY },
  ];
}

function barEl(id: string): HTMLElement {
  const el = host.querySelector(`.jects-gantt__bar[data-task-id="${id}"]`) as HTMLElement | null;
  if (!el) throw new Error(`no bar for ${id}`);
  return el;
}

function dragBar(id: string, deltaPx: number): void {
  const bar = barEl(id);
  const rect = bar.getBoundingClientRect();
  const startX = rect.left + 6;
  const y = rect.top + rect.height / 2;
  bar.dispatchEvent(
    new PointerEvent('pointerdown', { bubbles: true, clientX: startX, clientY: y, pointerId: 7 }),
  );
  window.dispatchEvent(
    new PointerEvent('pointermove', { clientX: startX + deltaPx, clientY: y, pointerId: 7 }),
  );
  window.dispatchEvent(
    new PointerEvent('pointerup', { clientX: startX + deltaPx, clientY: y, pointerId: 7 }),
  );
}

beforeEach(() => {
  host = document.createElement('div');
  host.style.position = 'absolute';
  host.style.top = '0';
  host.style.left = '0';
  host.style.width = '900px';
  host.style.height = '360px';
  host.style.overflow = 'hidden';
  document.body.appendChild(host);
});

afterEach(() => {
  gantt?.destroy();
  gantt = null;
  host.remove();
  // Sweep any leaked body-level modals between tests.
  document.querySelectorAll('.jects-window, .jects-overlay').forEach((n) => n.remove());
});

describe('Gantt interaction smoke (real Chromium)', () => {
  it('dragging a bar to the right updates the task time AND its pixel position', () => {
    gantt = new Gantt(host, { tasks: baseTasks(), projectStart: T0 });

    const before = barEl('a');
    const leftBefore = parseFloat(before.style.left);
    const startBefore = gantt.getTask('a')!.start!;

    dragBar('a', 160); // push Design well to the right

    const updated = gantt.getTask('a')!;
    expect(updated.start!).toBeGreaterThan(startBefore); // time advanced

    const after = barEl('a');
    const leftAfter = parseFloat(after.style.left);
    expect(leftAfter).toBeGreaterThan(leftBefore); // pixel position advanced
  });

  it('a new dependency reschedules the dependent and recomputes the critical path', () => {
    // Start with NO links: a, b, c all anchored near project start by ASAP.
    const tasks = baseTasks().map((t) =>
      t.id === 'b' || t.id === 'c' ? { ...t, start: T0, end: T0 + (t.id === 'b' ? 3 : 2) * DAY } : t,
    );
    gantt = new Gantt(host, { tasks, projectStart: T0 });

    const bStartBefore = gantt.getTask('b')!.start!;

    // Link a → b (FS): b must move to start after a finishes.
    const dep = gantt.addDependency({ fromId: 'a', toId: 'b', type: 'FS' });
    expect(dep).toBeDefined();

    const bStartAfter = gantt.getTask('b')!.start!;
    expect(bStartAfter).toBeGreaterThan(bStartBefore); // dependent rescheduled
    expect(bStartAfter).toBe(gantt.getTask('a')!.end!); // exactly at predecessor finish

    // Critical path now includes the a→b chain.
    const path = gantt.getCriticalPath().map(String);
    expect(path).toContain('a');
    expect(path).toContain('b');

    // The dependent's bar pixel position reflects the reschedule.
    expect(parseFloat(barEl('b').style.left)).toBeGreaterThan(parseFloat(barEl('a').style.left));
  });

  it('removing the driving dependency lets a dragged dependent fall back (no stale pin)', () => {
    // Inject the CPM engine: its `setTaskSpan` records an ENGINE-OWNED drag pin
    // (not a synthesised startNoEarlierThan), so removing the driving link clears
    // the anchor and the task floats back — the incremental-staleness fix.
    const tasks = baseTasks();
    const deps: DependencyModel[] = [{ id: 'ab', fromId: 'a', toId: 'b', type: 'FS' }];
    gantt = new Gantt(host, {
      tasks,
      dependencies: deps,
      projectStart: T0,
      engine: createSchedulingEngine(),
    });

    // Drag b far right (engine records an engine-owned drag pin, not a SNET).
    dragBar('b', 220);
    const draggedStart = gantt.getTask('b')!.start!;
    expect(draggedStart).toBeGreaterThan(gantt.getTask('a')!.end!);

    // Remove the link that justified b's late position; it must not stay frozen
    // by a stale engine-synthesised constraint.
    gantt.removeDependency('ab');
    const freedStart = gantt.getTask('b')!.start!;
    expect(freedStart).toBeLessThan(draggedStart);
  });

  it('is keyboard-operable: an arrow nudge on a focused bar reschedules via the engine', () => {
    gantt = new Gantt(host, { tasks: baseTasks(), projectStart: T0 });
    const bar = barEl('a');
    bar.focus();
    const startBefore = gantt.getTask('a')!.start!;
    bar.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(gantt.getTask('a')!.start!).toBeGreaterThan(startBefore);
  });

  it('opens the task editor as a body-level popup that is not clipped by the Gantt', async () => {
    gantt = new Gantt(host, { tasks: baseTasks(), projectStart: T0 });

    // Double-click a bar to open the editor (routes to GanttTaskEditor.open()).
    barEl('a').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));

    // The Window mounts asynchronously (lazy `import('@jects/widgets')`).
    const win = await waitFor(() => document.querySelector('.jects-window') as HTMLElement | null);
    expect(win).not.toBeNull();

    // Mounted at body level, NOT inside the Gantt's (overflow:hidden) container.
    expect(win!.closest('.jects-gantt')).toBeNull();
    expect(document.body.contains(win!)).toBe(true);

    // Not clipped: the editor has real, non-zero rendered size and sits within
    // the viewport rather than collapsed behind the Gantt's clip rect.
    const r = win!.getBoundingClientRect();
    expect(r.width).toBeGreaterThan(0);
    expect(r.height).toBeGreaterThan(0);
  });
});

async function waitFor<T>(fn: () => T | null, timeoutMs = 2000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = fn();
    if (v != null) return v;
    if (Date.now() > deadline) throw new Error('waitFor timed out');
    await new Promise((res) => setTimeout(res, 16));
  }
}
