/**
 * Scheduler PRO — Travel time (pre/post-travel margins).
 *
 * Scheduler Pro lets an event carry a *travel* margin: time needed to get TO the
 * event (`preTravelTime`) and to leave it AFTER it ends (`postTravelTime`). The
 * event's *core* span is unchanged, but the resource is effectively occupied for
 * the wider **travel span** `[start - preTravel, end + postTravel]`. Two events
 * whose travel spans collide therefore conflict even when the bars themselves do
 * not visually touch.
 *
 * This module is the pure data + geometry layer:
 *   - `travelSpan()` — the effective occupied span for one event.
 *   - `travelOverlaps()` / `findTravelOverlaps()` — overlap honouring travel.
 *   - `packWithTravel()` — assign overlap "lanes" using travel spans, so the view
 *     stacks events whose travel zones (not just bars) collide.
 *   - `travelZoneBoxes()` — px geometry for the lighter pre/post travel zones
 *     flanking a bar, projected through a timeline-core `TimeAxis`.
 *
 * Time is epoch ms (UTC); a span is half-open `[start, end)`, matching the rest
 * of the scheduler. Pure — never mutates its inputs.
 */

import type { TimeMs, DurationMs, TimeSpan } from '@jects/timeline-core';
import type { RecordId } from '@jects/core';
import type { EventModel } from '../contract.js';

/** Minimal time→pixel projector — the slice of `TimeAxis` this module needs. */
export interface TravelAxis {
  spanToBox(span: TimeSpan): { x: number; width: number };
}

/** The travel margins of one event (zero when the event carries none). */
export interface TravelMargins {
  /** Pre-travel margin in ms (>= 0). */
  pre: DurationMs;
  /** Post-travel margin in ms (>= 0). */
  post: DurationMs;
}

/** Read an event's travel margins, coercing absent/negative values to 0. */
export function travelMargins(event: Pick<EventModel, 'preTravelTime' | 'postTravelTime'>): TravelMargins {
  return {
    pre: Math.max(0, event.preTravelTime ?? 0),
    post: Math.max(0, event.postTravelTime ?? 0),
  };
}

/** Whether an event carries any travel margin at all. */
export function hasTravel(event: Pick<EventModel, 'preTravelTime' | 'postTravelTime'>): boolean {
  const { pre, post } = travelMargins(event);
  return pre > 0 || post > 0;
}

/** The event's core span `[start, end)` (travel excluded). */
export function coreSpan(event: Pick<EventModel, 'startDate' | 'endDate'>): TimeSpan {
  return { start: event.startDate, end: event.endDate };
}

/**
 * The effective occupied span of an event including travel:
 * `[start - preTravel, end + postTravel)`. This is the span overlap/packing and
 * capacity logic should treat the event as occupying.
 */
export function travelSpan(
  event: Pick<EventModel, 'startDate' | 'endDate' | 'preTravelTime' | 'postTravelTime'>,
): TimeSpan {
  const { pre, post } = travelMargins(event);
  return { start: event.startDate - pre, end: event.endDate + post };
}

/** Two half-open spans overlap (touching edges do NOT count as overlap). */
function spansOverlap(a: TimeSpan, b: TimeSpan): boolean {
  return a.start < b.end && b.start < a.end;
}

/**
 * Whether two events overlap once travel margins are accounted for. Two events
 * whose *bars* are disjoint still overlap when one's travel zone reaches into the
 * other's travel span — the conflict semantics Scheduler Pro enforces.
 */
export function travelOverlaps(
  a: Pick<EventModel, 'startDate' | 'endDate' | 'preTravelTime' | 'postTravelTime'>,
  b: Pick<EventModel, 'startDate' | 'endDate' | 'preTravelTime' | 'postTravelTime'>,
): boolean {
  return spansOverlap(travelSpan(a), travelSpan(b));
}

/** A travel-aware overlap between two events on the same resource. */
export interface TravelOverlap {
  a: RecordId;
  b: RecordId;
  /** The overlapping portion of the two travel spans. */
  span: TimeSpan;
  /**
   * True when the bars' CORE spans are disjoint and the conflict exists ONLY
   * because of the travel margins — i.e. a pure "travel collision".
   */
  travelOnly: boolean;
}

/**
 * Find every travel-aware overlapping pair among `events`. When `groupBy` is
 * supplied, only events sharing a group key (typically `resourceId`) are
 * compared, so cross-resource events never false-conflict. Sweep-line over
 * travel-span starts for O(n log n + k) rather than O(n²).
 */
export function findTravelOverlaps(
  events: ReadonlyArray<EventModel>,
  groupBy?: (event: EventModel) => RecordId,
): TravelOverlap[] {
  const key = groupBy ?? ((e: EventModel): RecordId => e.resourceId);
  // Bucket by group, then sweep each bucket.
  const buckets = new Map<RecordId, EventModel[]>();
  for (const e of events) {
    const g = key(e);
    (buckets.get(g) ?? buckets.set(g, []).get(g)!).push(e);
  }

  const out: TravelOverlap[] = [];
  for (const bucket of buckets.values()) {
    const sorted = bucket
      .map((e) => ({ e, span: travelSpan(e) }))
      .sort((x, y) => x.span.start - y.span.start);
    // Active set: events whose travel span has not yet ended at the cursor.
    const active: Array<{ e: EventModel; span: TimeSpan }> = [];
    for (const cur of sorted) {
      // Drop active events that end at/before this one's travel start.
      for (let i = active.length - 1; i >= 0; i--) {
        if (active[i]!.span.end <= cur.span.start) active.splice(i, 1);
      }
      for (const other of active) {
        if (!spansOverlap(other.span, cur.span)) continue;
        const span: TimeSpan = {
          start: Math.max(other.span.start, cur.span.start),
          end: Math.min(other.span.end, cur.span.end),
        };
        out.push({
          a: other.e.id,
          b: cur.e.id,
          span,
          travelOnly: !spansOverlap(coreSpan(other.e), coreSpan(cur.e)),
        });
      }
      active.push(cur);
    }
  }
  return out;
}

/** One event placed into an overlap lane (travel-aware packing result). */
export interface TravelPlacement {
  id: RecordId;
  /** 0-based lane within the resource (events that travel-collide differ). */
  lane: number;
  /** Total lanes in the event's overlap cluster (for height division). */
  lanes: number;
}

/**
 * Pack events into overlap lanes using their TRAVEL spans, so two events whose
 * travel zones collide are placed on distinct lanes even when their bars do not
 * touch. Greedy first-fit by travel-start; the `lanes` count is the max
 * concurrency within each event's contiguous overlap cluster (matching the
 * timeline-core `pack` overlap strategy, but travel-aware).
 */
export function packWithTravel(
  events: ReadonlyArray<EventModel>,
  groupBy?: (event: EventModel) => RecordId,
): Map<RecordId, TravelPlacement> {
  const key = groupBy ?? ((e: EventModel): RecordId => e.resourceId);
  const result = new Map<RecordId, TravelPlacement>();

  const buckets = new Map<RecordId, EventModel[]>();
  for (const e of events) {
    const g = key(e);
    (buckets.get(g) ?? buckets.set(g, []).get(g)!).push(e);
  }

  for (const bucket of buckets.values()) {
    const sorted = bucket
      .map((e) => ({ e, span: travelSpan(e) }))
      .sort((x, y) => x.span.start - y.span.start || x.span.end - y.span.end);

    // Lane end-times: laneEnd[i] is the travel-end of the last event in lane i.
    const laneEnd: TimeMs[] = [];
    const placedLane = new Map<RecordId, number>();

    // Cluster boundary: events sharing any transitive travel-overlap form a
    // cluster that must agree on its `lanes` total. We grow a cluster while the
    // next event starts before the running max travel-end.
    let clusterStart = 0;
    let clusterMaxEnd = -Infinity;
    const clusters: Array<{ from: number; to: number; lanes: number }> = [];
    let clusterLanes = 0;

    sorted.forEach((cur, idx) => {
      if (cur.span.start >= clusterMaxEnd && idx > clusterStart) {
        // Previous cluster closed before this event begins.
        clusters.push({ from: clusterStart, to: idx, lanes: clusterLanes });
        clusterStart = idx;
        clusterLanes = 0;
        laneEnd.length = 0;
      }
      // First-fit a lane whose last event ended at/before this travel start.
      let lane = -1;
      for (let i = 0; i < laneEnd.length; i++) {
        if (laneEnd[i]! <= cur.span.start) {
          lane = i;
          break;
        }
      }
      if (lane === -1) {
        lane = laneEnd.length;
        laneEnd.push(cur.span.end);
      } else {
        laneEnd[lane] = cur.span.end;
      }
      placedLane.set(cur.e.id, lane);
      clusterLanes = Math.max(clusterLanes, lane + 1);
      clusterMaxEnd = Math.max(clusterMaxEnd, cur.span.end);
    });
    clusters.push({ from: clusterStart, to: sorted.length, lanes: Math.max(1, clusterLanes) });

    for (const c of clusters) {
      for (let i = c.from; i < c.to; i++) {
        const entry = sorted[i];
        if (!entry) continue;
        result.set(entry.e.id, {
          id: entry.e.id,
          lane: placedLane.get(entry.e.id) ?? 0,
          lanes: Math.max(1, c.lanes),
        });
      }
    }
  }
  return result;
}

/** Px geometry for the travel zones flanking an event bar. */
export interface TravelZoneBoxes {
  /** Pre-travel zone `{ x, width }`, or null when there is no pre-travel. */
  pre: { x: number; width: number } | null;
  /** Post-travel zone `{ x, width }`, or null when there is no post-travel. */
  post: { x: number; width: number } | null;
}

/**
 * Project an event's pre/post travel zones to pixel boxes via a `TimeAxis`. The
 * pre zone is `[start - pre, start)` and the post zone is `[end, end + post)`,
 * so the zones flank the core bar without overlapping it. Returns `null` for a
 * side with no margin.
 */
export function travelZoneBoxes(
  event: Pick<EventModel, 'startDate' | 'endDate' | 'preTravelTime' | 'postTravelTime'>,
  axis: TravelAxis,
): TravelZoneBoxes {
  const { pre, post } = travelMargins(event);
  return {
    pre: pre > 0 ? axis.spanToBox({ start: event.startDate - pre, end: event.startDate }) : null,
    post: post > 0 ? axis.spanToBox({ start: event.endDate, end: event.endDate + post }) : null,
  };
}

/**
 * Render the travel zones for one event as `<div>`s ready to drop into a bar's
 * container. Token-pure: only `.jects-scheduler__travel*` classes (styled in
 * `pro.css`). Returns an empty array when the event carries no travel.
 *
 * Geometry is absolute (left/width) so callers position the zones in the same
 * coordinate space as the bar. The post zone is also tagged so CSS can mirror
 * its gradient direction.
 */
export function renderTravelZones(
  event: Pick<EventModel, 'startDate' | 'endDate' | 'preTravelTime' | 'postTravelTime'>,
  axis: TravelAxis,
): HTMLElement[] {
  const boxes = travelZoneBoxes(event, axis);
  const out: HTMLElement[] = [];
  const make = (box: { x: number; width: number }, side: 'pre' | 'post'): HTMLElement => {
    const el = document.createElement('div');
    el.className = `jects-scheduler__travel jects-scheduler__travel--${side}`;
    el.style.position = 'absolute';
    el.style.left = `${box.x}px`;
    el.style.width = `${Math.max(0, box.width)}px`;
    el.setAttribute('aria-hidden', 'true');
    return el;
  };
  if (boxes.pre) out.push(make(boxes.pre, 'pre'));
  if (boxes.post) out.push(make(boxes.post, 'post'));
  return out;
}
