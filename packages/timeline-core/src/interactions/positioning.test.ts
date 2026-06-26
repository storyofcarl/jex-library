/** jsdom unit tests for the positioning / hit-testing helpers. */
import { describe, it, expect } from 'vitest';
import {
  spanBox,
  barBox,
  terminalPoint,
  zoneAtX,
  barContains,
  barAtPoint,
  timeAtX,
  sweepSpan,
} from './positioning.js';
import { TestAxis, makeBar } from './test-harness.js';

// 0.01 px/ms, 1000ms snap → 1000ms == 10px.
const axis = new TestAxis(0.01, 1000, 0);

describe('positioning: spanBox / barBox', () => {
  it('projects a span to x/width', () => {
    expect(spanBox(axis, { start: 0, end: 1000 })).toEqual({ x: 0, width: 10 });
    expect(spanBox(axis, { start: 2000, end: 5000 })).toEqual({ x: 20, width: 30 });
  });

  it('barBox combines axis x/width with row y/height', () => {
    const bar = makeBar(axis, 'e1', 'r1', { start: 1000, end: 3000 }, 4, 18);
    expect(barBox(axis, bar)).toEqual({ x: 10, y: 4, width: 20, height: 18 });
  });

  it('floors negative widths at 0', () => {
    const bar = makeBar(axis, 'e1', 'r1', { start: 3000, end: 1000 });
    expect(barBox(axis, bar).width).toBe(0);
  });
});

describe('positioning: terminalPoint', () => {
  const bar = makeBar(axis, 'e1', 'r1', { start: 1000, end: 3000 }, 0, 20);

  it("anchors 'start' at left-center and 'end' at right-center", () => {
    expect(terminalPoint(axis, bar, 'start')).toEqual({ x: 10, y: 10 });
    expect(terminalPoint(axis, bar, 'end')).toEqual({ x: 30, y: 10 });
  });

  it('adds the row offset to y', () => {
    expect(terminalPoint(axis, bar, 'start', 100)).toEqual({ x: 10, y: 110 });
  });
});

describe('positioning: zoneAtX', () => {
  // span 1000..6000 → x 10..60, width 50.
  const bar = makeBar(axis, 'e1', 'r1', { start: 1000, end: 6000 });

  it('returns null outside the bar', () => {
    expect(zoneAtX(axis, bar, 5)).toBeNull();
    expect(zoneAtX(axis, bar, 65)).toBeNull();
  });

  it('detects start / body / end zones', () => {
    expect(zoneAtX(axis, bar, 12, 6)).toBe('start');
    expect(zoneAtX(axis, bar, 35, 6)).toBe('body');
    expect(zoneAtX(axis, bar, 58, 6)).toBe('end');
  });

  it('shrinks edges so a tiny bar still splits three ways', () => {
    const tiny = makeBar(axis, 'e2', 'r1', { start: 1000, end: 1400 }); // width 4
    expect(zoneAtX(axis, tiny, 10, 6)).toBe('start');
    expect(zoneAtX(axis, tiny, 14, 6)).toBe('end');
  });
});

describe('positioning: barContains / barAtPoint', () => {
  const a = makeBar(axis, 'a', 'r1', { start: 0, end: 2000 }, 0, 20); // x0..20
  const b = makeBar(axis, 'b', 'r1', { start: 1000, end: 3000 }, 0, 20); // x10..30

  it('barContains respects box + row offset', () => {
    expect(barContains(axis, a, { x: 5, y: 10 })).toBe(true);
    expect(barContains(axis, a, { x: 5, y: 30 })).toBe(false);
    expect(barContains(axis, a, { x: 5, y: 110 }, 100)).toBe(true);
  });

  it('barAtPoint picks the topmost (last) overlapping bar', () => {
    const hit = barAtPoint(axis, [a, b], { x: 15, y: 10 });
    expect(hit?.event.id).toBe('b');
  });

  it('barAtPoint returns undefined when nothing is hit', () => {
    expect(barAtPoint(axis, [a, b], { x: 100, y: 10 })).toBeUndefined();
  });
});

describe('positioning: timeAtX / sweepSpan', () => {
  it('timeAtX maps and optionally snaps', () => {
    expect(timeAtX(axis, 13)).toBe(1300);
    expect(timeAtX(axis, 13, true)).toBe(1000);
  });

  it('sweepSpan orders the span regardless of direction', () => {
    expect(sweepSpan(axis, 30, 10, true)).toEqual({ start: 1000, end: 3000 });
    expect(sweepSpan(axis, 10, 30, true)).toEqual({ start: 1000, end: 3000 });
  });
});
