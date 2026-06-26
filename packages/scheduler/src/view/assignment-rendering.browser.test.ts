/**
 * Real-browser (Chromium) a11y + visual/interaction test for AssignmentStore
 * multi-assignment rendering. Real layout means we can assert that one event is
 * actually painted across multiple resource lanes at distinct vertical offsets
 * (true many-to-many), and run axe-core for zero serious/critical violations.
 */
import { describe, it, afterEach, expect } from 'vitest';
import { WEEK_AND_DAY } from '@jects/timeline-core';
import '@jects/theme/style.css';
import '../styles.css';
import { Scheduler } from './scheduler.js';
import { installAssignmentRendering } from './assignment-rendering.js';
import { createAssignmentStore } from '../stores/stores.js';
import { expectNoA11yViolations } from '../test-utils/a11y.js';
import type { ResourceModel, EventModel } from '../contract.js';

const DAY = 86_400_000;
const start = Date.UTC(2025, 0, 1);

let host: HTMLElement;
const cleanup: Array<{ dispose?(): void; destroy?(): void }> = [];

afterEach(() => {
  for (const c of cleanup.splice(0)) {
    c.dispose?.();
    c.destroy?.();
  }
  host?.remove();
});

function mount(): HTMLElement {
  host = document.createElement('div');
  host.style.width = '1000px';
  host.style.height = '320px';
  document.body.appendChild(host);
  return host;
}

function resources(): ResourceModel[] {
  return [
    { id: 'r1', name: 'Alice' },
    { id: 'r2', name: 'Bob' },
    { id: 'r3', name: 'Carol' },
  ];
}
function events(): EventModel[] {
  return [
    { id: 'e1', resourceId: 'r1', name: 'Workshop', startDate: start, endDate: start + DAY },
  ];
}

describe('Scheduler multi-assignment rendering (browser)', () => {
  it('paints one event across multiple lanes at distinct vertical offsets', () => {
    const h = mount();
    const sched = new Scheduler(h, {
      resources: resources(),
      events: events(),
      preset: WEEK_AND_DAY,
      range: { start, end: start + DAY * 5 },
    });
    const handle = installAssignmentRendering(sched, {
      assignments: [
        { id: 'a1', eventId: 'e1', resourceId: 'r1', units: 1 },
        { id: 'a2', eventId: 'e1', resourceId: 'r2', units: 2 },
        { id: 'a3', eventId: 'e1', resourceId: 'r3', units: 0.5 },
      ],
    });
    cleanup.push(handle, sched);

    const bars = Array.from(
      sched.el.querySelectorAll<HTMLElement>('.jects-scheduler__bar[data-assignment-id]'),
    );
    expect(bars).toHaveLength(3);

    // Each bar sits on a different lane → distinct vertical top with real layout.
    const tops = bars.map((b) => b.getBoundingClientRect().top);
    const uniqueTops = new Set(tops.map((t) => Math.round(t)));
    expect(uniqueTops.size).toBe(3);

    // All three bars share the same horizontal span (the one event's time).
    const lefts = bars.map((b) => Math.round(b.getBoundingClientRect().left));
    expect(new Set(lefts).size).toBe(1);

    // Units reflected on the bars.
    const byId = (id: string) => bars.find((b) => b.dataset.assignmentId === id)!;
    expect(byId('a2').dataset.units).toBe('2');
    expect(byId('a2').querySelector('.jects-scheduler__bar-units')?.textContent).toBe('×2');
    expect(byId('a3').querySelector('.jects-scheduler__bar-units')?.textContent).toBe('50%');
  });

  it('has no serious/critical a11y violations with multi-assignment bars', async () => {
    const h = mount();
    const sched = new Scheduler(h, {
      resources: resources(),
      events: events(),
      preset: WEEK_AND_DAY,
      range: { start, end: start + DAY * 5 },
    });
    const handle = installAssignmentRendering(sched, {
      assignments: createAssignmentStore([
        { id: 'a1', eventId: 'e1', resourceId: 'r1', units: 2 },
        { id: 'a2', eventId: 'e1', resourceId: 'r2', units: 0.5 },
      ]),
    });
    cleanup.push(handle, sched);
    await expectNoA11yViolations(h);

    // Allocation is conveyed in the accessible name (not color/badge alone).
    const a1 = sched.el.querySelector<HTMLElement>('.jects-scheduler__bar[data-assignment-id="a1"]')!;
    expect(a1.getAttribute('aria-label')).toContain('2 units');
    const a2 = sched.el.querySelector<HTMLElement>('.jects-scheduler__bar[data-assignment-id="a2"]')!;
    expect(a2.getAttribute('aria-label')).toContain('50%');
  });
});
