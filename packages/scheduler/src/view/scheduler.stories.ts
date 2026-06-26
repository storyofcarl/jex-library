/**
 * @jects/scheduler — usage stories / docs examples.
 *
 * These are plain factory functions returning a mounted widget, mirroring the
 * pattern used across the library's `*.stories.ts`. They double as living docs
 * for the imperative API and as smoke scenes for the customizer preview.
 */

import { Scheduler } from './scheduler.js';
import { HistogramView, UtilizationView } from '../pro/histogram-view.js';
import { HOUR_AND_DAY, WEEK_AND_DAY } from '@jects/timeline-core';
import type { ResourceModel, EventModel, DependencyModel } from '../contract.js';

const DAY = 86_400_000;
const HOUR = 3_600_000;
const base = Date.UTC(2025, 0, 6); // Monday

const resources: ResourceModel[] = [
  { id: 'r1', name: 'Alice', capacity: 1 },
  { id: 'r2', name: 'Bob', capacity: 1 },
  { id: 'r3', name: 'Carol', capacity: 2 },
];

const events: EventModel[] = [
  { id: 'e1', resourceId: 'r1', name: 'Design review', startDate: base + HOUR * 9, endDate: base + HOUR * 12 },
  { id: 'e2', resourceId: 'r1', name: 'Build', startDate: base + HOUR * 13, endDate: base + HOUR * 17, eventColor: 'cyan' },
  { id: 'e3', resourceId: 'r2', name: 'QA pass', startDate: base + DAY + HOUR * 9, endDate: base + DAY + HOUR * 15, eventColor: 'magenta' },
  { id: 'e4', resourceId: 'r3', name: 'Standup', startDate: base + HOUR * 9, endDate: base + HOUR * 10, recurrenceRule: 'FREQ=DAILY;COUNT=5' },
];

const dependencies: DependencyModel[] = [
  { id: 'd1', fromId: 'e1', toId: 'e2', type: 'FS' },
  { id: 'd2', fromId: 'e2', toId: 'e3', type: 'FS', styleKey: 'crit' },
];

/** Default horizontal scheduler with editing, dependencies, recurrence. */
export function basic(host: HTMLElement): Scheduler {
  return new Scheduler(host, {
    resources,
    events,
    dependencies,
    preset: HOUR_AND_DAY,
    range: { start: base - DAY, end: base + DAY * 6 },
    creatable: true,
    eventTooltip: (e) => e.name ?? null,
  });
}

/** A coarser week/day view. */
export function weekView(host: HTMLElement): Scheduler {
  return new Scheduler(host, {
    resources,
    events,
    preset: WEEK_AND_DAY,
    range: { start: base - DAY * 7, end: base + DAY * 28 },
  });
}

/** Vertical orientation (resources as columns). */
export function vertical(host: HTMLElement): Scheduler {
  return new Scheduler(host, {
    resources,
    events,
    orientation: 'vertical',
    preset: HOUR_AND_DAY,
    range: { start: base, end: base + DAY * 2 },
  });
}

/** PRO: resource histogram. */
export function histogram(host: HTMLElement): HistogramView {
  return new HistogramView(host, {
    resources,
    events,
    range: { start: base, end: base + DAY * 5 },
    title: 'Daily allocation',
  });
}

/** PRO: resource utilization meters. */
export function utilization(host: HTMLElement): UtilizationView {
  return new UtilizationView(host, {
    resources,
    events,
    range: { start: base, end: base + DAY * 5 },
    title: 'Utilization',
  });
}

export const stories = { basic, weekView, vertical, histogram, utilization };
