/**
 * @jects/scheduler — multi-assignment rendering stories / docs examples.
 *
 * Demonstrates the AssignmentStore many-to-many feature: one event painted on
 * every resource lane it is assigned to, with per-assignment units. Plain factory
 * functions returning a mounted widget, mirroring the package story pattern.
 */

import { Scheduler } from './scheduler.js';
import {
  installAssignmentRendering,
  type AssignmentRenderingHandle,
} from './assignment-rendering.js';
import { createAssignmentStore } from '../stores/stores.js';
import { WEEK_AND_DAY } from '@jects/timeline-core';
import type { ResourceModel, EventModel } from '../contract.js';

const DAY = 86_400_000;
const base = Date.UTC(2025, 0, 6); // Monday

const resources: ResourceModel[] = [
  { id: 'r1', name: 'Alice' },
  { id: 'r2', name: 'Bob' },
  { id: 'r3', name: 'Carol' },
];

const events: EventModel[] = [
  // A single workshop event, assigned to all three people below.
  { id: 'e1', resourceId: 'r1', name: 'Team workshop', startDate: base, endDate: base + DAY * 2 },
  // An unassigned event keeps the legacy 1:1 mapping.
  { id: 'e2', resourceId: 'r2', name: 'Solo task', startDate: base + DAY * 3, endDate: base + DAY * 4, eventColor: 'cyan' },
];

/**
 * One event spanning three lanes via the AssignmentStore, with mixed units
 * (full, double, and half allocation), plus a live store you can mutate.
 */
export function multiAssignment(host: HTMLElement): {
  scheduler: Scheduler;
  assignments: AssignmentRenderingHandle;
} {
  const scheduler = new Scheduler(host, {
    resources,
    events,
    preset: WEEK_AND_DAY,
    range: { start: base, end: base + DAY * 7 },
  });

  const store = createAssignmentStore([
    { id: 'a1', eventId: 'e1', resourceId: 'r1', units: 1 },
    { id: 'a2', eventId: 'e1', resourceId: 'r2', units: 2 },
    { id: 'a3', eventId: 'e1', resourceId: 'r3', units: 0.5 },
  ]);
  const assignments = installAssignmentRendering(scheduler, { assignments: store });

  return { scheduler, assignments };
}
