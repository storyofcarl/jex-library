import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { HOUR_AND_DAY } from '@jects/timeline-core';
import { Scheduler } from './scheduler.js';
import { installAssignmentRendering } from './assignment-rendering.js';
import { createAssignmentStore } from '../stores/stores.js';
import type { ResourceModel, EventModel } from '../contract.js';

const DAY = 86_400_000;
const start = Date.UTC(2025, 0, 1);

function resources(): ResourceModel[] {
  return [
    { id: 'r1', name: 'Alice' },
    { id: 'r2', name: 'Bob' },
    { id: 'r3', name: 'Carol' },
  ];
}
function events(): EventModel[] {
  return [
    { id: 'e1', resourceId: 'r1', name: 'Shared', startDate: start, endDate: start + DAY },
    { id: 'e2', resourceId: 'r2', name: 'Solo', startDate: start + DAY, endDate: start + DAY * 2 },
  ];
}

function barsFor(sched: Scheduler, eventId: string): HTMLElement[] {
  return Array.from(
    sched.el.querySelectorAll<HTMLElement>(`.jects-scheduler__bar[data-event-id^="${eventId}"]`),
  ).filter((el) => el.dataset.eventId === eventId || el.dataset.eventId?.startsWith(`${eventId}`));
}

function allBars(sched: Scheduler): HTMLElement[] {
  return Array.from(sched.el.querySelectorAll<HTMLElement>('.jects-scheduler__bar'));
}

describe('Scheduler multi-assignment rendering', () => {
  let host: HTMLElement;
  let sched: Scheduler;
  let handle: ReturnType<typeof installAssignmentRendering> | undefined;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    sched = new Scheduler(host, {
      resources: resources(),
      events: events(),
      preset: HOUR_AND_DAY,
      range: { start: start - DAY, end: start + DAY * 5 },
    });
  });
  afterEach(() => {
    handle?.dispose();
    handle = undefined;
    sched.destroy();
    host.remove();
  });

  it('renders one event across EVERY assigned lane (many-to-many)', () => {
    handle = installAssignmentRendering(sched, {
      assignments: [
        { id: 'a1', eventId: 'e1', resourceId: 'r1' },
        { id: 'a2', eventId: 'e1', resourceId: 'r2' },
        { id: 'a3', eventId: 'e1', resourceId: 'r3' },
      ],
    });
    // e1 should now appear on r1, r2, r3 → three bars carrying record e1.
    const bars = allBars(sched).filter((el) => el.dataset.assignmentId);
    expect(bars.length).toBe(3);
    const assignmentIds = bars.map((b) => b.dataset.assignmentId).sort();
    expect(assignmentIds).toEqual(['a1', 'a2', 'a3']);
  });

  it('reflects assignment units via data-units + aria + a badge', () => {
    handle = installAssignmentRendering(sched, {
      assignments: [
        { id: 'a1', eventId: 'e1', resourceId: 'r1', units: 2 },
        { id: 'a2', eventId: 'e1', resourceId: 'r2', units: 0.5 },
      ],
    });
    const byAssignment = (id: string): HTMLElement =>
      allBars(sched).find((el) => el.dataset.assignmentId === id)!;

    const a1 = byAssignment('a1');
    expect(a1.dataset.units).toBe('2');
    expect(a1.style.getPropertyValue('--_assign-units')).toBe('2');
    expect(a1.getAttribute('aria-label')).toContain('2 units');
    expect(a1.querySelector('.jects-scheduler__bar-units')?.textContent).toBe('×2');

    const a2 = byAssignment('a2');
    expect(a2.dataset.units).toBe('0.5');
    expect(a2.getAttribute('aria-label')).toContain('50%');
    expect(a2.querySelector('.jects-scheduler__bar-units')?.textContent).toBe('50%');
  });

  it('leaves unassigned events on their 1:1 resourceId lane', () => {
    handle = installAssignmentRendering(sched, {
      assignments: [{ id: 'a1', eventId: 'e1', resourceId: 'r3' }],
    });
    // e2 has no assignment → stays on r2 with units 1, no badge.
    const e2 = allBars(sched).find((el) => el.dataset.eventId === 'e2')!;
    expect(e2).toBeTruthy();
    expect(e2.dataset.units).toBe('1');
    expect(e2.dataset.assignmentId).toBeUndefined();
    expect(e2.querySelector('.jects-scheduler__bar-units')).toBeNull();
    // e1 moved off its legacy lane r1 → r1 carries no e1 bar.
    expect(allBars(sched).some((el) => el.dataset.assignmentId === 'a1')).toBe(true);
  });

  it('repaints when the AssignmentStore changes', () => {
    const store = createAssignmentStore([{ id: 'a1', eventId: 'e1', resourceId: 'r1' }]);
    handle = installAssignmentRendering(sched, { assignments: store });
    expect(allBars(sched).filter((el) => el.dataset.assignmentId).length).toBe(1);

    // Add a second assignment → event now spans two lanes after auto-repaint.
    store.add({ id: 'a2', eventId: 'e1', resourceId: 'r2' });
    expect(allBars(sched).filter((el) => el.dataset.assignmentId).length).toBe(2);

    // Remove one → back to a single lane.
    store.remove('a1');
    const remaining = allBars(sched).filter((el) => el.dataset.assignmentId);
    expect(remaining.length).toBe(1);
    expect(remaining[0]!.dataset.assignmentId).toBe('a2');
  });

  it('setAssignments swaps the store and rewires change events', () => {
    handle = installAssignmentRendering(sched, {
      assignments: [{ id: 'a1', eventId: 'e1', resourceId: 'r1' }],
    });
    const next = createAssignmentStore([
      { id: 'b1', eventId: 'e1', resourceId: 'r2' },
      { id: 'b2', eventId: 'e1', resourceId: 'r3' },
    ]);
    handle.setAssignments(next);
    expect(handle.store).toBe(next);
    expect(allBars(sched).filter((el) => el.dataset.assignmentId).length).toBe(2);
    // The new store drives repaints.
    next.add({ id: 'b3', eventId: 'e1', resourceId: 'r1' });
    expect(allBars(sched).filter((el) => el.dataset.assignmentId).length).toBe(3);
  });

  it('dispose() restores the stock 1:1 behaviour', () => {
    handle = installAssignmentRendering(sched, {
      assignments: [
        { id: 'a1', eventId: 'e1', resourceId: 'r1' },
        { id: 'a2', eventId: 'e1', resourceId: 'r2' },
      ],
    });
    expect(allBars(sched).filter((el) => el.dataset.assignmentId).length).toBe(2);
    handle.dispose();
    handle = undefined;
    // Back to one bar per event on its own resourceId; no assignment metadata.
    const bars = allBars(sched);
    expect(bars.some((el) => el.dataset.assignmentId)).toBe(false);
    expect(bars.filter((el) => el.dataset.eventId === 'e1').length).toBe(1);
  });

  it('with no assignments, behaves exactly like the stock scheduler', () => {
    handle = installAssignmentRendering(sched, { assignments: [] });
    const bars = allBars(sched);
    expect(bars.length).toBe(2); // e1 on r1, e2 on r2
    expect(bars.every((el) => !el.dataset.assignmentId)).toBe(true);
  });
});
