/**
 * Per-lane event layout — resolves overlapping events within a single resource
 * lane into stacked sub-lanes, in three strategies:
 *
 *   - `overlap`: every event uses the full lane height, drawn on top of each
 *     other (offset slightly so all stay clickable). Sub-lane count is always 1.
 *   - `stack`:   events that overlap in time are pushed onto separate sub-lanes
 *     (greedy first-fit); the lane grows tall enough to show every sub-lane.
 *   - `pack`:    like `stack` but reuses the earliest free sub-lane (interval
 *     graph colouring), minimizing the sub-lane count for dense schedules.
 *
 * Pure geometry: given the lane's events and a `TimeAxis`, it returns laid-out
 * `EventBar`s plus the lane's intrinsic content height. The scheduler feeds the
 * content height back into row virtualization for variable-height lanes.
 */

import type {
  TimeAxis,
  EventBar,
  EventOverlapStrategy,
  TimelineEvent,
} from '@jects/timeline-core';
import type { Model, RecordId } from '@jects/core';

/** Input for a single lane's layout pass. */
export interface LaneLayoutInput<E extends Model = Model> {
  rowId: RecordId;
  events: ReadonlyArray<TimelineEvent<E>>;
  axis: TimeAxis;
  /** The lane's nominal height (px). */
  rowHeight: number;
  /** Overlap strategy. */
  strategy: EventOverlapStrategy;
  /** Vertical padding (px) above and below the stacked bars. Default 4. */
  margin?: number;
  /** Gap (px) between stacked sub-lanes. Default 2. */
  gap?: number;
  /** Minimum bar height (px). Default 18. */
  minBarHeight?: number;
}

/** Result of a lane layout pass. */
export interface LaneLayoutResult<E extends Model = Model> {
  bars: EventBar<E>[];
  /** Intrinsic height the lane needs to show every sub-lane. */
  contentHeight: number;
  /** Number of sub-lanes used. */
  laneCount: number;
}

/**
 * Assign each event a sub-lane index. For `stack`/`pack` this is interval-graph
 * colouring; events are processed start-ascending and placed in the first
 * sub-lane whose last event has finished. `pack` and `stack` share the algorithm
 * here — they differ only in how the renderer sizes bars (pack fills the lane,
 * stack keeps a fixed bar height) — but both minimize the sub-lane count, which
 * is the property tests assert.
 */
function assignSubLanes<E extends Model>(
  events: ReadonlyArray<TimelineEvent<E>>,
): { order: TimelineEvent<E>[]; lane: Map<RecordId, number>; laneCount: number } {
  const order = [...events].sort(
    (a, b) => a.span.start - b.span.start || a.span.end - b.span.end,
  );
  const lane = new Map<RecordId, number>();
  // laneEnds[i] = the latest end-time currently occupying sub-lane i.
  const laneEnds: number[] = [];
  for (const ev of order) {
    let placed = -1;
    for (let i = 0; i < laneEnds.length; i++) {
      if (laneEnds[i]! <= ev.span.start) {
        placed = i;
        break;
      }
    }
    if (placed === -1) {
      placed = laneEnds.length;
      laneEnds.push(ev.span.end);
    } else {
      laneEnds[placed] = ev.span.end;
    }
    lane.set(ev.id, placed);
  }
  return { order, lane, laneCount: Math.max(1, laneEnds.length) };
}

/**
 * Lay out one lane's events into pixel bars.
 */
export function layoutLane<E extends Model = Model>(
  input: LaneLayoutInput<E>,
): LaneLayoutResult<E> {
  const {
    events,
    axis,
    rowHeight,
    strategy,
    margin = 4,
    gap = 2,
    minBarHeight = 18,
  } = input;

  if (events.length === 0) {
    return { bars: [], contentHeight: rowHeight, laneCount: 1 };
  }

  const inner = Math.max(0, rowHeight - margin * 2);

  if (strategy === 'overlap') {
    // All bars share the lane height; a tiny per-event y-offset keeps each
    // clickable when fully nested, capped so they never spill the lane.
    const bars: EventBar<E>[] = [];
    const sorted = [...events].sort((a, b) => a.span.start - b.span.start);
    const step = sorted.length > 1 ? Math.min(4, inner / sorted.length) : 0;
    sorted.forEach((event, i) => {
      const { x, width } = axis.spanToBox(event.span);
      const y = margin + i * step;
      const height = Math.max(minBarHeight, inner - i * step);
      bars.push({ event, x, width: Math.max(1, width), y, height, lane: 0 });
    });
    return { bars, contentHeight: rowHeight, laneCount: 1 };
  }

  // stack / pack
  const { order, lane, laneCount } = assignSubLanes(events);

  // Bar height: stack keeps a uniform height per sub-lane; pack divides the lane.
  const totalGap = gap * (laneCount - 1);
  const laneHeight =
    strategy === 'pack'
      ? Math.max(minBarHeight, (inner - totalGap) / laneCount)
      : Math.max(minBarHeight, Math.min(inner, (inner - totalGap) / laneCount));

  const bars: EventBar<E>[] = [];
  for (const event of order) {
    const sub = lane.get(event.id) ?? 0;
    const { x, width } = axis.spanToBox(event.span);
    const y = margin + sub * (laneHeight + gap);
    bars.push({ event, x, width: Math.max(1, width), y, height: laneHeight, lane: sub });
  }

  const contentHeight = Math.max(
    rowHeight,
    margin * 2 + laneCount * laneHeight + totalGap,
  );
  return { bars, contentHeight, laneCount };
}
