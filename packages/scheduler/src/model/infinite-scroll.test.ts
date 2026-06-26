import { describe, it, expect } from 'vitest';
import type { TimeAxis, TimeSpan } from '@jects/timeline-core';
import { planInfiniteScroll } from './infinite-scroll.js';

/** Linear axis: 1ms = 1px over `range`, contentWidth = range duration. */
function linearAxis(range: TimeSpan): TimeAxis {
  return {
    range,
    preset: { id: 'test', headers: [], tickUnit: 'millisecond', pxPerUnit: 1 },
    zoom: 1,
    contentWidth: range.end - range.start,
    toX: (t) => t - range.start,
    toTime: (x) => x + range.start,
    spanToBox: (span: TimeSpan) => ({ x: span.start - range.start, width: span.end - span.start }),
    durationToWidth: (d) => d, // 1ms = 1px
    ticksInRange: () => [],
    snap: (t) => t,
    setView: () => {},
    setRange: () => {},
  };
}

describe('planInfiniteScroll', () => {
  it('returns null when both edges are far from the viewport', () => {
    const axis = linearAxis({ start: 0, end: 10_000 });
    const plan = planInfiniteScroll({
      axis,
      scrollLeft: 4000,
      viewportWidth: 1000,
      threshold: 200,
    });
    expect(plan).toBeNull();
  });

  it('extends the start (earlier) when near the left edge, with scroll compensation', () => {
    const axis = linearAxis({ start: 0, end: 10_000 });
    const plan = planInfiniteScroll({
      axis,
      scrollLeft: 100, // within threshold 200 of the left edge
      viewportWidth: 1000,
      threshold: 200,
      extendBy: 5000,
    });
    expect(plan).not.toBeNull();
    expect(plan!.extendedStart).toBe(true);
    expect(plan!.extendedEnd).toBe(false);
    expect(plan!.range.start).toBe(-5000);
    expect(plan!.range.end).toBe(10_000);
    // Prepended 5000ms = 5000px at 1px/ms → scroll must shift right by that much.
    expect(plan!.scrollLeftDelta).toBe(5000);
  });

  it('extends the end (later) when near the right edge, no compensation', () => {
    const axis = linearAxis({ start: 0, end: 10_000 });
    const plan = planInfiniteScroll({
      axis,
      scrollLeft: 8900, // 8900 + 1000 = 9900 ≥ 10000 - 200
      viewportWidth: 1000,
      threshold: 200,
      extendBy: 5000,
    });
    expect(plan).not.toBeNull();
    expect(plan!.extendedEnd).toBe(true);
    expect(plan!.extendedStart).toBe(false);
    expect(plan!.range.end).toBe(15_000);
    expect(plan!.range.start).toBe(0);
    expect(plan!.scrollLeftDelta).toBe(0); // appending does not move existing pixels
  });

  it('extends BOTH edges when the viewport spans the whole content', () => {
    const axis = linearAxis({ start: 0, end: 500 });
    const plan = planInfiniteScroll({
      axis,
      scrollLeft: 0,
      viewportWidth: 500, // covers entire content; both edges near
      threshold: 200,
      extendBy: 1000,
    });
    expect(plan).not.toBeNull();
    expect(plan!.extendedStart).toBe(true);
    expect(plan!.extendedEnd).toBe(true);
    expect(plan!.range.start).toBe(-1000);
    expect(plan!.range.end).toBe(1500);
    expect(plan!.scrollLeftDelta).toBe(1000);
  });

  it('defaults extendBy to one viewport-width of time', () => {
    const axis = linearAxis({ start: 0, end: 10_000 });
    const plan = planInfiniteScroll({
      axis,
      scrollLeft: 50,
      viewportWidth: 800,
      threshold: 200,
    });
    expect(plan).not.toBeNull();
    // viewportMs = toTime(800) - toTime(0) = 800; start extended by 800ms.
    expect(plan!.range.start).toBe(-800);
    expect(plan!.scrollLeftDelta).toBe(800);
  });
});
