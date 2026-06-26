/**
 * Scheduler PRO — Resource Histogram + Resource Utilization computations.
 *
 * Both views answer "how much of each resource is allocated over time". This
 * module is the pure data layer: bucket the time axis into uniform slots, sum
 * the assigned units (or event count) per resource per slot, and compare against
 * the resource's capacity. The render widgets (`HistogramView` /
 * `UtilizationView`) paint these series; keeping the math here makes it unit-
 * testable without a DOM.
 *
 * Time is epoch ms (UTC). A slot is `[start, start+slotMs)`; an event
 * contributes its `units` to every slot its span overlaps (proportional overlap
 * is not modelled — a slot the event touches counts the event once, which is the
 * common histogram convention for capacity planning).
 */

import type { DurationMs, TimeSpan } from '@jects/timeline-core';
import type { RecordId } from '@jects/core';
import type { ResourceModel, EventModel, AssignmentModel } from '../contract.js';

/** A single time bucket's allocation for one resource. */
export interface HistogramBucket {
  /** Bucket span. */
  span: TimeSpan;
  /** Summed allocated units in the bucket. */
  allocated: number;
  /** The resource's capacity for the bucket. */
  capacity: number;
  /** `allocated / capacity` (0 when capacity is 0). */
  utilization: number;
  /** Whether the bucket is over capacity. */
  overallocated: boolean;
}

/** The full histogram series for one resource. */
export interface ResourceHistogram {
  resourceId: RecordId;
  resourceName: string;
  buckets: HistogramBucket[];
  /** Peak allocated units across all buckets. */
  peak: number;
}

export interface HistogramInput {
  resources: ReadonlyArray<ResourceModel>;
  events: ReadonlyArray<EventModel>;
  /** Optional explicit assignments; when absent, events map 1:1 via `resourceId`. */
  assignments?: ReadonlyArray<AssignmentModel>;
  /** The covered time range. */
  range: TimeSpan;
  /** Bucket width in ms. Default one day. */
  slotMs?: DurationMs;
  /** Default capacity when a resource omits `capacity`. Default 1. */
  defaultCapacity?: number;
}

const MS_DAY = 86_400_000;

/** Two half-open spans overlap. */
function overlaps(a: TimeSpan, b: TimeSpan): boolean {
  return a.start < b.end && b.start < a.end;
}

/**
 * Compute per-resource histograms over the range. Each resource gets a series of
 * equal-width buckets; every event/assignment adds its units to the buckets its
 * span overlaps.
 */
export function computeHistograms(input: HistogramInput): ResourceHistogram[] {
  const slotMs = input.slotMs ?? MS_DAY;
  const defaultCapacity = input.defaultCapacity ?? 1;
  const { start, end } = input.range;
  const slotCount = Math.max(1, Math.ceil((end - start) / slotMs));

  // Build resource → events map (via assignments when present).
  const byResource = new Map<RecordId, Array<{ span: TimeSpan; units: number }>>();
  const eventById = new Map<RecordId, EventModel>();
  for (const e of input.events) eventById.set(e.id, e);

  const push = (resourceId: RecordId, span: TimeSpan, units: number): void => {
    let list = byResource.get(resourceId);
    if (!list) byResource.set(resourceId, (list = []));
    list.push({ span, units });
  };

  if (input.assignments && input.assignments.length > 0) {
    for (const a of input.assignments) {
      const e = eventById.get(a.eventId);
      if (!e) continue;
      push(a.resourceId, { start: e.startDate, end: e.endDate }, a.units ?? 1);
    }
  } else {
    for (const e of input.events) {
      push(e.resourceId, { start: e.startDate, end: e.endDate }, 1);
    }
  }

  const out: ResourceHistogram[] = [];
  for (const resource of input.resources) {
    const capacity = resource.capacity ?? defaultCapacity;
    const allocations = byResource.get(resource.id) ?? [];
    const buckets: HistogramBucket[] = [];
    let peak = 0;
    for (let i = 0; i < slotCount; i++) {
      const span: TimeSpan = { start: start + i * slotMs, end: start + (i + 1) * slotMs };
      let allocated = 0;
      for (const a of allocations) {
        if (overlaps(a.span, span)) allocated += a.units;
      }
      if (allocated > peak) peak = allocated;
      buckets.push({
        span,
        allocated,
        capacity,
        utilization: capacity > 0 ? allocated / capacity : 0,
        overallocated: allocated > capacity,
      });
    }
    out.push({ resourceId: resource.id, resourceName: resource.name, buckets, peak });
  }
  return out;
}

/** Summary utilization for one resource over the whole range. */
export interface UtilizationSummary {
  resourceId: RecordId;
  resourceName: string;
  /** Mean utilization across buckets (0..1+). */
  mean: number;
  /** Peak utilization across buckets. */
  peak: number;
  /** Fraction of buckets that were over capacity. */
  overallocatedFraction: number;
}

/** Reduce histograms to per-resource utilization summaries. */
export function computeUtilization(histograms: ReadonlyArray<ResourceHistogram>): UtilizationSummary[] {
  return histograms.map((h) => {
    const n = h.buckets.length || 1;
    let sum = 0;
    let peak = 0;
    let over = 0;
    for (const b of h.buckets) {
      sum += b.utilization;
      if (b.utilization > peak) peak = b.utilization;
      if (b.overallocated) over++;
    }
    return {
      resourceId: h.resourceId,
      resourceName: h.resourceName,
      mean: sum / n,
      peak,
      overallocatedFraction: over / n,
    };
  });
}
