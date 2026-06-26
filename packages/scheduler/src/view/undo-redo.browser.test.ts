/**
 * Real-browser (Chromium) test for undo/redo wired into a live Scheduler.
 *
 * Mounts an actual `Scheduler`, installs the undo/redo controller, drags an event
 * bar (a real move gesture), then exercises undo()/redo() + the Ctrl+Z / Ctrl+Y
 * keyboard path and asserts the event store + on-screen bar revert and re-apply.
 * Also flags the reverted bar with the highlight class and runs axe-core for zero
 * serious/critical a11y violations with the feature active.
 */
import { describe, it, afterEach, expect } from 'vitest';
import { HOUR_AND_DAY } from '@jects/timeline-core';
import '@jects/theme/style.css';
import '../styles.css';
import { Scheduler } from './scheduler.js';
import { installUndoRedo, type UndoRedoController } from './undo-redo.js';
import { expectNoA11yViolations } from '../test-utils/a11y.js';

const HOUR = 3_600_000;
const DAY = 86_400_000;
const MON = Date.UTC(2025, 0, 6); // Monday
const MON_9 = MON + HOUR * 9;

let host: HTMLElement;
let sched: Scheduler | undefined;
let undo: UndoRedoController | undefined;

afterEach(() => {
  undo?.destroy();
  undo = undefined;
  sched?.destroy();
  sched = undefined;
  host?.remove();
});

function mount(): HTMLElement {
  host = document.createElement('div');
  host.style.width = '1100px';
  host.style.height = '300px';
  document.body.appendChild(host);
  return host;
}

function pointer(type: string, target: Element, x: number, y: number): void {
  target.dispatchEvent(
    new PointerEvent(type, { clientX: x, clientY: y, bubbles: true, pointerId: 1, button: 0 }),
  );
}

function makeScheduler(): Scheduler {
  return new Scheduler(mount(), {
    resources: [{ id: 'r1', name: 'Alice' }],
    events: [{ id: 'a', resourceId: 'r1', name: 'A', startDate: MON_9, endDate: MON_9 + HOUR * 4 }],
    preset: HOUR_AND_DAY,
    range: { start: MON, end: MON + DAY },
    snap: false,
  });
}

describe('undo/redo (browser, wired into Scheduler)', () => {
  it('undo reverts a drag-move; redo re-applies it', () => {
    sched = makeScheduler();
    undo = installUndoRedo(sched);
    const store = sched.getEventStore();
    const before = store.getById('a')!.startDate;

    const bar = sched.el.querySelector('[data-event-id="a"]') as HTMLElement;
    const rect = bar.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    pointer('pointerdown', bar, rect.left + rect.width / 2, midY);
    pointer('pointermove', bar, rect.left + rect.width / 2 + 120, midY);
    pointer('pointerup', bar, rect.left + rect.width / 2 + 120, midY);

    const moved = store.getById('a')!.startDate;
    expect(moved).toBeGreaterThan(before);
    expect(undo.canUndo).toBe(true);

    undo.undo();
    expect(store.getById('a')!.startDate).toBe(before);

    undo.redo();
    expect(store.getById('a')!.startDate).toBe(moved);
  });

  it('Ctrl+Z / Ctrl+Y on the root drive undo + redo', () => {
    sched = makeScheduler();
    undo = installUndoRedo(sched);
    const store = sched.getEventStore();
    const before = store.getById('a')!.startDate;

    // A programmatic move so the test is deterministic regardless of geometry.
    store.update('a', { startDate: MON_9 + HOUR * 2, endDate: MON_9 + HOUR * 6 });
    const moved = store.getById('a')!.startDate;

    sched.el.focus();
    sched.el.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }),
    );
    expect(store.getById('a')!.startDate).toBe(before);

    sched.el.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'y', ctrlKey: true, bubbles: true, cancelable: true }),
    );
    expect(store.getById('a')!.startDate).toBe(moved);
  });

  it('flags the reverted bar with the highlight class', async () => {
    sched = makeScheduler();
    undo = installUndoRedo(sched);
    const store = sched.getEventStore();
    store.update('a', { startDate: MON_9 + HOUR, endDate: MON_9 + HOUR * 5 });

    undo.undo();
    await new Promise((r) => setTimeout(r, 10));
    const bar = sched.el.querySelector('[data-event-id="a"]') as HTMLElement | null;
    expect(bar).toBeTruthy();
    expect(bar!.classList.contains('jects-scheduler__bar--reverted')).toBe(true);
  });

  it('deleting then undoing restores the event bar', () => {
    sched = makeScheduler();
    undo = installUndoRedo(sched);
    const store = sched.getEventStore();

    sched.deleteEvent(store.getById('a')!);
    expect(store.getById('a')).toBeUndefined();
    expect(sched.el.querySelector('[data-event-id="a"]')).toBeNull();

    undo.undo();
    expect(store.getById('a')).toBeDefined();
    expect(sched.el.querySelector('[data-event-id="a"]')).toBeTruthy();
  });

  it('has no serious/critical a11y violations with undo/redo active', async () => {
    sched = makeScheduler();
    undo = installUndoRedo(sched);
    await expectNoA11yViolations(sched.el);
  });
});
