/**
 * Real-browser (Chromium) interaction tests for the Scheduler. Unlike the jsdom
 * suite these have real layout, so the pointer-driven drag / resize / drag-create
 * gestures and hit-testing run against actual geometry.
 */
import { describe, it, afterEach, expect } from 'vitest';
import { HOUR_AND_DAY, WEEK_AND_DAY } from '@jects/timeline-core';
import '@jects/theme/style.css';
import '../styles.css';
import { Scheduler } from './scheduler.js';
import { schedule } from '../pro/scheduling-engine.js';
import type { DependencyModel, EventModel } from '../contract.js';

const DAY = 86_400_000;
const HOUR = 3_600_000;
const start = Date.UTC(2025, 0, 1);

let host: HTMLElement;
let sched: Scheduler | undefined;

afterEach(() => {
  sched?.destroy();
  sched = undefined;
  host?.remove();
});

function mount(): HTMLElement {
  host = document.createElement('div');
  host.style.width = '1000px';
  host.style.height = '300px';
  document.body.appendChild(host);
  return host;
}

function pointer(type: string, target: Element, x: number, y: number): void {
  target.dispatchEvent(
    new PointerEvent(type, { clientX: x, clientY: y, bubbles: true, pointerId: 1, button: 0 }),
  );
}

describe('Scheduler interactions (browser)', () => {
  it('moves an event by dragging its body and emits eventChange', async () => {
    const h = mount();
    sched = new Scheduler(h, {
      resources: [{ id: 'r1', name: 'Alice' }],
      events: [
        { id: 'e1', resourceId: 'r1', name: 'Task A', startDate: start + HOUR * 4, endDate: start + HOUR * 8 },
      ],
      preset: HOUR_AND_DAY,
      range: { start, end: start + DAY },
      snap: false,
    });

    let changed = false;
    sched.on('eventChange', () => {
      changed = true;
    });

    const bar = sched.el.querySelector('[data-event-id="e1"]') as HTMLElement;
    expect(bar).toBeTruthy();
    const rect = bar.getBoundingClientRect();
    const midX = rect.left + rect.width / 2;
    const midY = rect.top + rect.height / 2;

    pointer('pointerdown', bar, midX, midY);
    pointer('pointermove', bar, midX + 80, midY);
    pointer('pointerup', bar, midX + 80, midY);

    expect(changed).toBe(true);
    // The store record's start should have advanced.
    const rec = sched.getEventStore().getById('e1')!;
    expect(rec.startDate).toBeGreaterThan(start + HOUR * 4);
  });

  it('drag-creates a new event on empty lane space', async () => {
    const h = mount();
    sched = new Scheduler(h, {
      resources: [{ id: 'r1', name: 'Alice' }],
      events: [],
      preset: HOUR_AND_DAY,
      range: { start, end: start + DAY },
      creatable: true,
      snap: false,
    });

    let created = false;
    sched.on('eventCreate', () => {
      created = true;
    });

    const content = sched.el.querySelector('.jects-scheduler__content') as HTMLElement;
    const rect = content.getBoundingClientRect();
    const y = rect.top + 20;
    pointer('pointerdown', content, rect.left + 100, y);
    pointer('pointermove', content, rect.left + 260, y);
    pointer('pointerup', content, rect.left + 260, y);

    expect(created).toBe(true);
    expect(sched.getEventStore().count).toBe(1);
  });

  it('resizes an event from its end edge', async () => {
    const h = mount();
    sched = new Scheduler(h, {
      resources: [{ id: 'r1', name: 'Alice' }],
      events: [
        { id: 'e1', resourceId: 'r1', name: 'Task A', startDate: start + HOUR * 4, endDate: start + HOUR * 8 },
      ],
      preset: HOUR_AND_DAY,
      range: { start, end: start + DAY },
      snap: false,
    });

    const bar = sched.el.querySelector('[data-event-id="e1"]') as HTMLElement;
    const rect = bar.getBoundingClientRect();
    const edgeX = rect.right - 2;
    const midY = rect.top + rect.height / 2;
    const originalEnd = sched.getEventStore().getById('e1')!.endDate;

    pointer('pointerdown', bar, edgeX, midY);
    pointer('pointermove', bar, edgeX + 60, midY);
    pointer('pointerup', bar, edgeX + 60, midY);

    const rec = sched.getEventStore().getById('e1')!;
    expect(rec.endDate).toBeGreaterThan(originalEnd);
  });

  // ── visual / interaction smoke ─────────────────────────────────────────────

  it('SMOKE: dragging a bar updates its time AND its on-screen position', async () => {
    const h = mount();
    sched = new Scheduler(h, {
      resources: [{ id: 'r1', name: 'Alice' }],
      events: [
        { id: 'e1', resourceId: 'r1', name: 'Task A', startDate: start + HOUR * 4, endDate: start + HOUR * 8 },
      ],
      preset: HOUR_AND_DAY,
      range: { start, end: start + DAY },
      snap: false,
    });

    const bar = sched.el.querySelector('[data-event-id="e1"]') as HTMLElement;
    const before = bar.getBoundingClientRect();
    const startDateBefore = sched.getEventStore().getById('e1')!.startDate;
    const midX = before.left + before.width / 2;
    const midY = before.top + before.height / 2;

    pointer('pointerdown', bar, midX, midY);
    pointer('pointermove', bar, midX + 120, midY);
    pointer('pointerup', bar, midX + 120, midY);

    // Time advanced…
    const rec = sched.getEventStore().getById('e1')!;
    expect(rec.startDate).toBeGreaterThan(startDateBefore);
    // …and the repainted bar moved right on screen (position reflects the time).
    const after = (sched.el.querySelector('[data-event-id="e1"]') as HTMLElement).getBoundingClientRect();
    expect(after.left).toBeGreaterThan(before.left);
  });

  it('SMOKE: a dependency change reschedules the dependent (engine wiring)', () => {
    // The scheduler view wires the scheduling engine on dependency/constraint
    // change. Here we drive the engine the same way: moving a's finish later via
    // an FS link must push successor b to start at/after a's finish. Use a Monday
    // 09:00 anchor so the default Mon–Fri 9–17 working calendar has real working
    // time (a midnight anchor would yield a zero working duration).
    const MON_9 = Date.UTC(2025, 0, 6, 9); // Monday
    const a: EventModel = { id: 'a', resourceId: 'r', startDate: MON_9, endDate: MON_9 + HOUR * 4 };
    const b: EventModel = { id: 'b', resourceId: 'r', startDate: MON_9, endDate: MON_9 + HOUR * 2 };
    const deps: DependencyModel[] = [{ id: 'd', fromId: 'a', toId: 'b', type: 'FS' }];
    const result = schedule({ events: [a, b], dependencies: deps });
    const movedB = result.find((r) => r.id === 'b');
    expect(movedB).toBeDefined();
    expect(movedB!.startDate).toBeGreaterThanOrEqual(a.endDate);
    // Duration preserved (minute resolution).
    expect(movedB!.endDate - movedB!.startDate).toBeGreaterThanOrEqual(2 * HOUR - 60_000);
  });

  it('SMOKE: a recurrence occurrence bar is NOT draggable (master untouched)', () => {
    const h = mount();
    sched = new Scheduler(h, {
      resources: [{ id: 'r1', name: 'Alice' }],
      events: [
        {
          id: 'rec',
          resourceId: 'r1',
          name: 'Standup',
          startDate: start + HOUR,
          endDate: start + HOUR * 2,
          recurrenceRule: 'FREQ=DAILY;COUNT=4',
        },
      ],
      // WEEK_AND_DAY keeps the whole 5-day range inside the 1000px viewport so the
      // day-2+ occurrence bars are actually laid out (HOUR_AND_DAY would push them
      // off-screen / outside the visible window).
      preset: WEEK_AND_DAY,
      range: { start, end: start + DAY * 5 },
      snap: false,
    });
    const occ = sched.el.querySelector('.jects-scheduler__bar[data-occurrence="true"]') as HTMLElement;
    expect(occ).toBeTruthy();
    expect(occ.getAttribute('aria-readonly')).toBe('true');
    const masterBefore = sched.getEventStore().getById('rec')!;
    const startBefore = masterBefore.startDate;
    const endBefore = masterBefore.endDate;

    const rect = occ.getBoundingClientRect();
    const midX = rect.left + rect.width / 2;
    const midY = rect.top + rect.height / 2;
    pointer('pointerdown', occ, midX, midY);
    pointer('pointermove', occ, midX + 150, midY);
    pointer('pointerup', occ, midX + 150, midY);

    // The shared master span must be unchanged (no series-wide shift).
    const masterAfter = sched.getEventStore().getById('rec')!;
    expect(masterAfter.startDate).toBe(startBefore);
    expect(masterAfter.endDate).toBe(endBefore);
  });

  it('SMOKE: arrow keys move focus between bars (roving tabindex)', () => {
    const h = mount();
    sched = new Scheduler(h, {
      resources: [{ id: 'r1', name: 'Alice' }],
      events: [
        { id: 'e1', resourceId: 'r1', name: 'A', startDate: start + HOUR, endDate: start + HOUR * 2 },
        { id: 'e2', resourceId: 'r1', name: 'B', startDate: start + HOUR * 5, endDate: start + HOUR * 6 },
      ],
      preset: HOUR_AND_DAY,
      range: { start, end: start + DAY },
    });
    const bars = Array.from(sched.el.querySelectorAll<HTMLElement>('.jects-scheduler__bar'));
    expect(bars.length).toBe(2);
    expect(bars.filter((b) => b.tabIndex === 0).length).toBe(1);

    const first = bars[0]!;
    first.focus();
    expect(document.activeElement).toBe(first);
    first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(document.activeElement).toBe(bars[1]);
    expect(bars[1]!.tabIndex).toBe(0);
    expect(bars[0]!.tabIndex).toBe(-1);
  });

  it('SMOKE: Enter on a focused bar opens the editor at body level (un-clipped)', () => {
    const h = mount();
    sched = new Scheduler(h, {
      resources: [{ id: 'r1', name: 'Alice' }],
      events: [
        { id: 'e1', resourceId: 'r1', name: 'A', startDate: start + HOUR, endDate: start + HOUR * 2 },
      ],
      preset: HOUR_AND_DAY,
      range: { start, end: start + DAY },
    });
    const bar = sched.el.querySelector('[data-event-id="e1"]') as HTMLElement;
    bar.focus();
    bar.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    const win = document.querySelector('.jects-window') as HTMLElement;
    expect(win).toBeTruthy();
    // The editor Window mounts at body level, NOT inside the overflow:hidden root.
    expect(win.parentElement).toBe(document.body);
    expect(sched.el.contains(win)).toBe(false);
    // It is visible (not clipped to a zero box).
    const r = win.getBoundingClientRect();
    expect(r.width).toBeGreaterThan(0);
    expect(r.height).toBeGreaterThan(0);
    win.remove();
  });

  it('SMOKE: destroying mid-drag cancels the gesture without writing to the store', () => {
    const h = mount();
    sched = new Scheduler(h, {
      resources: [{ id: 'r1', name: 'Alice' }],
      events: [
        { id: 'e1', resourceId: 'r1', name: 'A', startDate: start + HOUR * 4, endDate: start + HOUR * 8 },
      ],
      preset: HOUR_AND_DAY,
      range: { start, end: start + DAY },
      snap: false,
    });
    const store = sched.getEventStore();
    let changedAfterDestroy = false;

    const bar = sched.el.querySelector('[data-event-id="e1"]') as HTMLElement;
    const rect = bar.getBoundingClientRect();
    const midX = rect.left + rect.width / 2;
    const midY = rect.top + rect.height / 2;
    const startBefore = store.getById('e1')!.startDate;

    pointer('pointerdown', bar, midX, midY);
    pointer('pointermove', bar, midX + 80, midY);

    // Destroy mid-gesture (e.g. route change). The tracked controller is torn
    // down; any later pointerup must NOT write to the (now destroyed) store.
    store.events.on('change', () => {
      changedAfterDestroy = true;
    });
    sched.destroy();

    // A stray pointerup after destroy: must be a no-op (no leaked window listener
    // committing onto the torn-down store).
    window.dispatchEvent(new PointerEvent('pointerup', { clientX: midX + 80, clientY: midY, pointerId: 1 }));

    expect(changedAfterDestroy).toBe(false);
    expect(store.getById('e1')!.startDate).toBe(startBefore);
    sched = undefined; // already destroyed
  });
});
