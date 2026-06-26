import { describe, it, expect } from 'vitest';
import type { TimeSpan } from '@jects/timeline-core';
import type { EventModel } from '../contract.js';
import {
  travelMargins,
  hasTravel,
  travelSpan,
  travelOverlaps,
  findTravelOverlaps,
  packWithTravel,
  travelZoneBoxes,
  type TravelAxis,
} from './travel-time.js';

const HOUR = 3_600_000;
const start = Date.UTC(2025, 0, 1, 9); // 09:00

/** A linear time→px axis (1px per minute) for geometry assertions. */
const axis: TravelAxis = {
  spanToBox(span: TimeSpan) {
    const x = (span.start - start) / 60_000;
    const width = (span.end - span.start) / 60_000;
    return { x, width };
  },
};

function ev(over: Partial<EventModel> & Pick<EventModel, 'id' | 'startDate' | 'endDate'>): EventModel {
  return { resourceId: 'r1', ...over };
}

describe('travelMargins / hasTravel', () => {
  it('coerces absent and negative margins to 0', () => {
    expect(travelMargins({ preTravelTime: -5, postTravelTime: undefined })).toEqual({ pre: 0, post: 0 });
    expect(hasTravel({ preTravelTime: 0, postTravelTime: 0 })).toBe(false);
    expect(hasTravel({ preTravelTime: HOUR })).toBe(true);
  });
});

describe('travelSpan', () => {
  it('widens the core span by pre and post margins', () => {
    const e = ev({ id: 'e1', startDate: start, endDate: start + 2 * HOUR, preTravelTime: HOUR, postTravelTime: HOUR / 2 });
    expect(travelSpan(e)).toEqual({ start: start - HOUR, end: start + 2 * HOUR + HOUR / 2 });
  });

  it('equals the core span when there is no travel', () => {
    const e = ev({ id: 'e1', startDate: start, endDate: start + HOUR });
    expect(travelSpan(e)).toEqual({ start, end: start + HOUR });
  });
});

describe('travelOverlaps', () => {
  it('treats two events whose travel zones touch as overlapping', () => {
    // Bars are disjoint (a ends 11:00, b starts 12:00) but a's post-travel (1h)
    // and b's pre-travel (1h) collide in the 11:00–12:00 gap.
    const a = ev({ id: 'a', startDate: start, endDate: start + 2 * HOUR, postTravelTime: HOUR });
    const b = ev({ id: 'b', startDate: start + 3 * HOUR, endDate: start + 4 * HOUR, preTravelTime: HOUR });
    expect(travelOverlaps(a, b)).toBe(true);
  });

  it('does not over-report when travel zones leave a real gap', () => {
    const a = ev({ id: 'a', startDate: start, endDate: start + HOUR, postTravelTime: HOUR / 4 });
    const b = ev({ id: 'b', startDate: start + 3 * HOUR, endDate: start + 4 * HOUR, preTravelTime: HOUR / 4 });
    expect(travelOverlaps(a, b)).toBe(false);
  });
});

describe('findTravelOverlaps', () => {
  it('reports travel-only overlaps and tags them, scoped per resource', () => {
    const events: EventModel[] = [
      ev({ id: 'a', startDate: start, endDate: start + 2 * HOUR, postTravelTime: HOUR }),
      ev({ id: 'b', startDate: start + 3 * HOUR, endDate: start + 4 * HOUR, preTravelTime: HOUR }),
      // Different resource — must never conflict with the above.
      ev({ id: 'c', resourceId: 'r2', startDate: start, endDate: start + 5 * HOUR, preTravelTime: HOUR }),
    ];
    const overlaps = findTravelOverlaps(events);
    expect(overlaps).toHaveLength(1);
    const [o] = overlaps;
    expect(new Set([o!.a, o!.b])).toEqual(new Set(['a', 'b']));
    expect(o!.travelOnly).toBe(true); // bars themselves don't overlap
    expect(o!.span).toEqual({ start: start + 2 * HOUR, end: start + 3 * HOUR });
  });

  it('flags a non-travel overlap as travelOnly=false', () => {
    const events: EventModel[] = [
      ev({ id: 'a', startDate: start, endDate: start + 3 * HOUR }),
      ev({ id: 'b', startDate: start + HOUR, endDate: start + 4 * HOUR }),
    ];
    const [o] = findTravelOverlaps(events);
    expect(o!.travelOnly).toBe(false);
  });
});

describe('packWithTravel', () => {
  it('stacks events whose travel zones collide onto separate lanes', () => {
    const events: EventModel[] = [
      ev({ id: 'a', startDate: start, endDate: start + 2 * HOUR, postTravelTime: HOUR }),
      ev({ id: 'b', startDate: start + 3 * HOUR, endDate: start + 4 * HOUR, preTravelTime: HOUR }),
    ];
    const placed = packWithTravel(events);
    expect(placed.get('a')!.lane).not.toBe(placed.get('b')!.lane);
    expect(placed.get('a')!.lanes).toBe(2);
    expect(placed.get('b')!.lanes).toBe(2);
  });

  it('keeps cleanly separated events on the same lane', () => {
    const events: EventModel[] = [
      ev({ id: 'a', startDate: start, endDate: start + HOUR }),
      ev({ id: 'b', startDate: start + 5 * HOUR, endDate: start + 6 * HOUR }),
    ];
    const placed = packWithTravel(events);
    expect(placed.get('a')!.lane).toBe(0);
    expect(placed.get('b')!.lane).toBe(0);
    expect(placed.get('a')!.lanes).toBe(1);
  });
});

describe('travelZoneBoxes', () => {
  it('projects pre and post zones flanking the bar (no overlap with core)', () => {
    const e = ev({ id: 'e1', startDate: start, endDate: start + 2 * HOUR, preTravelTime: HOUR, postTravelTime: HOUR / 2 });
    const boxes = travelZoneBoxes(e, axis);
    // pre zone: [start-1h, start) → x=-60, width=60 (minutes)
    expect(boxes.pre).toEqual({ x: -60, width: 60 });
    // post zone: [end, end+30m) → x=120, width=30
    expect(boxes.post).toEqual({ x: 120, width: 30 });
  });

  it('returns null for a side with no margin', () => {
    const e = ev({ id: 'e1', startDate: start, endDate: start + HOUR, preTravelTime: HOUR });
    const boxes = travelZoneBoxes(e, axis);
    expect(boxes.pre).not.toBeNull();
    expect(boxes.post).toBeNull();
  });
});
