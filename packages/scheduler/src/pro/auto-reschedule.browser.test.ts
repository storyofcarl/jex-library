/**
 * Real-browser (Chromium) test for auto-reschedule wired into a live Scheduler.
 *
 * Unlike the jsdom unit suite (which drives the plugin against a fake host), this
 * mounts an actual `Scheduler`, installs the plugin, drags a predecessor bar, and
 * asserts the dependent event was rescheduled on screen — Scheduler Pro's
 * flagship auto-reschedule behaviour. Also asserts the cascade animation tag and
 * runs axe-core for zero serious/critical a11y violations.
 */
import { describe, it, afterEach, expect } from 'vitest';
import { HOUR_AND_DAY } from '@jects/timeline-core';
import '@jects/theme/style.css';
import '../styles.css';
import { Scheduler } from '../view/scheduler.js';
import { installAutoReschedule } from './auto-reschedule.js';
import { expectNoA11yViolations } from '../test-utils/a11y.js';
import type { DependencyModel } from '../contract.js';

const HOUR = 3_600_000;
const DAY = 86_400_000;
// Monday so the default Mon–Fri 9–17 working calendar has real working time.
const MON = Date.UTC(2025, 0, 6); // 2025-01-06 is a Monday
const MON_9 = MON + HOUR * 9;

let host: HTMLElement;
let sched: Scheduler | undefined;
let plugin: { destroy(): void } | undefined;

afterEach(() => {
  plugin?.destroy();
  plugin = undefined;
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

describe('auto-reschedule (browser, wired into Scheduler)', () => {
  it('dragging a predecessor cascades to its FS successor and writes it back', () => {
    const h = mount();
    const deps: DependencyModel[] = [{ id: 'd', fromId: 'a', toId: 'b', type: 'FS' }];
    sched = new Scheduler(h, {
      resources: [{ id: 'r1', name: 'Alice' }],
      events: [
        { id: 'a', resourceId: 'r1', name: 'A', startDate: MON_9, endDate: MON_9 + HOUR * 4 },
        { id: 'b', resourceId: 'r1', name: 'B', startDate: MON_9, endDate: MON_9 + HOUR * 2 },
      ],
      dependencies: deps,
      preset: HOUR_AND_DAY,
      range: { start: MON, end: MON + DAY },
      snap: false,
    });
    plugin = installAutoReschedule(sched, { animationMs: 0 });

    let cascaded = false;
    sched.on('autoReschedule' as never, () => {
      cascaded = true;
    });

    const store = sched.getEventStore();
    const bStartBefore = store.getById('b')!.startDate;

    // Drag predecessor "a" to the right (later).
    const barA = sched.el.querySelector('[data-event-id="a"]') as HTMLElement;
    const rect = barA.getBoundingClientRect();
    const midX = rect.left + rect.width / 2;
    const midY = rect.top + rect.height / 2;
    pointer('pointerdown', barA, midX, midY);
    pointer('pointermove', barA, midX + 160, midY);
    pointer('pointerup', barA, midX + 160, midY);

    // The cascade ran and pushed B to start at/after A's (new) finish.
    expect(cascaded).toBe(true);
    const aAfter = store.getById('a')!;
    const bAfter = store.getById('b')!;
    expect(bAfter.startDate).toBeGreaterThan(bStartBefore);
    expect(bAfter.startDate).toBeGreaterThanOrEqual(aAfter.endDate);
  });

  it('a beforeAutoReschedule veto leaves the dependent untouched', () => {
    const h = mount();
    const deps: DependencyModel[] = [{ id: 'd', fromId: 'a', toId: 'b', type: 'FS' }];
    sched = new Scheduler(h, {
      resources: [{ id: 'r1', name: 'Alice' }],
      events: [
        { id: 'a', resourceId: 'r1', name: 'A', startDate: MON_9, endDate: MON_9 + HOUR * 4 },
        { id: 'b', resourceId: 'r1', name: 'B', startDate: MON_9, endDate: MON_9 + HOUR * 2 },
      ],
      dependencies: deps,
      preset: HOUR_AND_DAY,
      range: { start: MON, end: MON + DAY },
      snap: false,
    });
    plugin = installAutoReschedule(sched, { animationMs: 0 });
    sched.on('beforeAutoReschedule' as never, (() => false) as never);

    const store = sched.getEventStore();
    const bStartBefore = store.getById('b')!.startDate;

    const barA = sched.el.querySelector('[data-event-id="a"]') as HTMLElement;
    const rect = barA.getBoundingClientRect();
    pointer('pointerdown', barA, rect.left + rect.width / 2, rect.top + rect.height / 2);
    pointer('pointermove', barA, rect.left + rect.width / 2 + 160, rect.top + rect.height / 2);
    pointer('pointerup', barA, rect.left + rect.width / 2 + 160, rect.top + rect.height / 2);

    // Vetoed: B's stored start is unchanged.
    expect(store.getById('b')!.startDate).toBe(bStartBefore);
  });

  it('flags rescheduled bars with the animation class (then clears it)', async () => {
    const h = mount();
    const deps: DependencyModel[] = [{ id: 'd', fromId: 'a', toId: 'b', type: 'FS' }];
    sched = new Scheduler(h, {
      resources: [{ id: 'r1', name: 'Alice' }],
      events: [
        // A short hour-long predecessor + successor so the cascade (B → after A's
        // finish) stays comfortably inside the multi-day visible range and the
        // viewport, keeping bar "b" painted (and thus taggable).
        { id: 'a', resourceId: 'r1', name: 'A', startDate: MON_9, endDate: MON_9 + HOUR },
        { id: 'b', resourceId: 'r1', name: 'B', startDate: MON_9, endDate: MON_9 + HOUR },
      ],
      dependencies: deps,
      preset: HOUR_AND_DAY,
      range: { start: MON, end: MON + DAY * 3 },
      snap: false,
    });
    plugin = installAutoReschedule(sched, { animationMs: 200 });

    const barA = sched.el.querySelector('[data-event-id="a"]') as HTMLElement;
    const rect = barA.getBoundingClientRect();
    // A small rightward nudge: enough to advance A's start, little enough that the
    // cascaded B stays in-frame.
    pointer('pointerdown', barA, rect.left + rect.width / 2, rect.top + rect.height / 2);
    pointer('pointermove', barA, rect.left + rect.width / 2 + 40, rect.top + rect.height / 2);
    pointer('pointerup', barA, rect.left + rect.width / 2 + 40, rect.top + rect.height / 2);

    // The flag is applied after the post-cascade repaint settles (deferred timer).
    await new Promise((r) => setTimeout(r, 60));
    const barB = () => sched!.el.querySelector('[data-event-id="b"]') as HTMLElement | null;
    expect(barB()).toBeTruthy();
    expect(barB()!.classList.contains('jects-scheduler__bar--rescheduled')).toBe(true);

    // …and cleared after the animation window.
    await new Promise((r) => setTimeout(r, 280));
    expect(barB()?.classList.contains('jects-scheduler__bar--rescheduled')).toBe(false);
  });

  it('has no serious/critical a11y violations with the plugin active', async () => {
    const h = mount();
    const deps: DependencyModel[] = [{ id: 'd', fromId: 'a', toId: 'b', type: 'FS' }];
    sched = new Scheduler(h, {
      resources: [{ id: 'r1', name: 'Alice' }],
      events: [
        { id: 'a', resourceId: 'r1', name: 'A', startDate: MON_9, endDate: MON_9 + HOUR * 4 },
        { id: 'b', resourceId: 'r1', name: 'B', startDate: MON_9, endDate: MON_9 + HOUR * 2 },
      ],
      dependencies: deps,
      preset: HOUR_AND_DAY,
      range: { start: MON, end: MON + DAY },
    });
    plugin = installAutoReschedule(sched, { animationMs: 0 });
    await expectNoA11yViolations(h);
  });
});
