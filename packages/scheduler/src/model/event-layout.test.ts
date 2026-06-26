import { describe, it, expect } from 'vitest';
import type { TimeAxis, TimeSpan, TimelineEvent } from '@jects/timeline-core';
import { layoutLane } from './event-layout.js';

/** A trivial linear axis: 1ms = 1px, range [0, 1000). */
function linearAxis(): TimeAxis {
  return {
    range: { start: 0, end: 1000 },
    preset: { id: 'test', headers: [], tickUnit: 'millisecond', pxPerUnit: 1 },
    zoom: 1,
    contentWidth: 1000,
    toX: (t) => t,
    toTime: (x) => x,
    spanToBox: (span: TimeSpan) => ({ x: span.start, width: span.end - span.start }),
    durationToWidth: (d) => d,
    ticksInRange: () => [],
    snap: (t) => t,
    setView: () => {},
    setRange: () => {},
  };
}

function ev(id: string, start: number, end: number): TimelineEvent {
  return { id, rowId: 'r', span: { start, end }, record: { id } };
}

describe('layoutLane', () => {
  const axis = linearAxis();

  it('returns lane height for an empty lane', () => {
    const res = layoutLane({ rowId: 'r', events: [], axis, rowHeight: 50, strategy: 'stack' });
    expect(res.bars).toHaveLength(0);
    expect(res.contentHeight).toBe(50);
    expect(res.laneCount).toBe(1);
  });

  it('stacks overlapping events onto separate sub-lanes', () => {
    const res = layoutLane({
      rowId: 'r',
      events: [ev('a', 0, 100), ev('b', 50, 150), ev('c', 200, 300)],
      axis,
      rowHeight: 60,
      strategy: 'stack',
    });
    const lane = new Map(res.bars.map((b) => [b.event.id, b.lane]));
    // a and b overlap → different sub-lanes; c is disjoint → reuses lane 0.
    expect(lane.get('a')).not.toBe(lane.get('b'));
    expect(lane.get('c')).toBe(0);
    expect(res.laneCount).toBe(2);
  });

  it('packs minimize sub-lane count for chained overlaps', () => {
    const res = layoutLane({
      rowId: 'r',
      events: [ev('a', 0, 100), ev('b', 100, 200), ev('c', 200, 300)],
      axis,
      rowHeight: 60,
      strategy: 'pack',
    });
    // Non-overlapping back-to-back events all fit in one sub-lane.
    expect(res.laneCount).toBe(1);
  });

  it('overlap strategy keeps a single sub-lane', () => {
    const res = layoutLane({
      rowId: 'r',
      events: [ev('a', 0, 100), ev('b', 10, 90)],
      axis,
      rowHeight: 60,
      strategy: 'overlap',
    });
    expect(res.laneCount).toBe(1);
    expect(res.bars).toHaveLength(2);
  });

  it('projects spans to pixel boxes via the axis', () => {
    const res = layoutLane({
      rowId: 'r',
      events: [ev('a', 100, 300)],
      axis,
      rowHeight: 50,
      strategy: 'stack',
    });
    expect(res.bars[0]!.x).toBe(100);
    expect(res.bars[0]!.width).toBe(200);
  });
});
