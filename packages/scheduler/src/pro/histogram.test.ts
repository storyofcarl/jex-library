import { describe, it, expect } from 'vitest';
import { computeHistograms, computeUtilization } from './histogram.js';
import type { ResourceModel, EventModel, AssignmentModel } from '../contract.js';

const DAY = 86_400_000;
const start = Date.UTC(2025, 0, 1);

const resources: ResourceModel[] = [
  { id: 'r1', name: 'Alice', capacity: 1 },
  { id: 'r2', name: 'Bob', capacity: 2 },
];

describe('computeHistograms', () => {
  it('buckets allocation per resource per day', () => {
    const events: EventModel[] = [
      { id: 'e1', resourceId: 'r1', startDate: start, endDate: start + DAY }, // day 0
      { id: 'e2', resourceId: 'r1', startDate: start, endDate: start + DAY }, // day 0 overlap
    ];
    const hist = computeHistograms({
      resources,
      events,
      range: { start, end: start + DAY * 3 },
      slotMs: DAY,
    });
    const alice = hist.find((h) => h.resourceId === 'r1')!;
    expect(alice.buckets).toHaveLength(3);
    expect(alice.buckets[0]!.allocated).toBe(2);
    expect(alice.buckets[0]!.overallocated).toBe(true); // capacity 1, allocated 2
    expect(alice.buckets[1]!.allocated).toBe(0);
    expect(alice.peak).toBe(2);
  });

  it('uses assignments + units when supplied', () => {
    const events: EventModel[] = [
      { id: 'e1', resourceId: 'r1', startDate: start, endDate: start + DAY },
    ];
    const assignments: AssignmentModel[] = [
      { id: 'a1', eventId: 'e1', resourceId: 'r2', units: 1.5 },
    ];
    const hist = computeHistograms({
      resources,
      events,
      assignments,
      range: { start, end: start + DAY },
      slotMs: DAY,
    });
    const bob = hist.find((h) => h.resourceId === 'r2')!;
    expect(bob.buckets[0]!.allocated).toBe(1.5);
    expect(bob.buckets[0]!.overallocated).toBe(false); // capacity 2
  });

  it('computes utilization summaries', () => {
    const events: EventModel[] = [
      { id: 'e1', resourceId: 'r2', startDate: start, endDate: start + DAY * 2 },
    ];
    const hist = computeHistograms({
      resources,
      events,
      range: { start, end: start + DAY * 2 },
      slotMs: DAY,
    });
    const summary = computeUtilization(hist);
    const bob = summary.find((s) => s.resourceId === 'r2')!;
    // 1 unit / capacity 2 = 0.5 every bucket.
    expect(bob.mean).toBeCloseTo(0.5, 5);
    expect(bob.peak).toBeCloseTo(0.5, 5);
    expect(bob.overallocatedFraction).toBe(0);
  });
});
