import { describe, it, expect } from 'vitest';
import type { TimeSpan } from '@jects/timeline-core';
import {
  bufferMargins,
  bufferedSpan,
  requiredGap,
  findBufferViolations,
  isBufferSatisfied,
  clearBufferStart,
  bufferZoneBoxes,
  type BufferableEvent,
  type BufferAxis,
} from './event-buffer.js';

const HOUR = 3_600_000;
const start = Date.UTC(2025, 0, 1, 9);

const axis: BufferAxis = {
  spanToBox(span: TimeSpan) {
    const x = (span.start - start) / 60_000;
    const width = (span.end - span.start) / 60_000;
    return { x, width };
  },
};

function ev(over: Partial<BufferableEvent> & Pick<BufferableEvent, 'id' | 'startDate' | 'endDate'>): BufferableEvent {
  return { resourceId: 'r1', ...over };
}

describe('bufferMargins', () => {
  it('prefers per-event setup/teardown over config defaults', () => {
    const e = ev({ id: 'e1', startDate: start, endDate: start + HOUR, setupTime: HOUR / 2 });
    expect(bufferMargins(e, { setup: HOUR, teardown: HOUR })).toEqual({ leading: HOUR / 2, trailing: HOUR });
  });

  it('coerces negatives to 0', () => {
    const e = ev({ id: 'e1', startDate: start, endDate: start + HOUR, setupTime: -5 });
    expect(bufferMargins(e).leading).toBe(0);
  });
});

describe('bufferedSpan', () => {
  it('widens the span by leading + trailing', () => {
    const e = ev({ id: 'e1', startDate: start, endDate: start + HOUR });
    expect(bufferedSpan(e, { setup: HOUR / 2, teardown: HOUR })).toEqual({
      start: start - HOUR / 2,
      end: start + 2 * HOUR,
    });
  });
});

describe('requiredGap', () => {
  it('is the max of a.teardown, b.setup, and config.gap (not the sum)', () => {
    const a = ev({ id: 'a', startDate: start, endDate: start + HOUR, teardownTime: HOUR / 2 });
    const b = ev({ id: 'b', startDate: start + 2 * HOUR, endDate: start + 3 * HOUR, setupTime: HOUR / 4 });
    expect(requiredGap(a, b, { gap: HOUR / 3 })).toBe(HOUR / 2);
  });
});

describe('findBufferViolations', () => {
  it('flags consecutive events closer than the required gap', () => {
    const events: BufferableEvent[] = [
      ev({ id: 'a', startDate: start, endDate: start + HOUR }),
      // 30-min gap, but config requires a 1h gap → violation.
      ev({ id: 'b', startDate: start + HOUR + HOUR / 2, endDate: start + 3 * HOUR }),
    ];
    const v = findBufferViolations(events, { gap: HOUR });
    expect(v).toHaveLength(1);
    expect(v[0]!.before).toBe('a');
    expect(v[0]!.after).toBe('b');
    expect(v[0]!.actualGap).toBe(HOUR / 2);
    expect(v[0]!.requiredGap).toBe(HOUR);
    expect(v[0]!.shortfall).toBe(HOUR / 2);
    expect(v[0]!.overlapping).toBe(false);
  });

  it('marks overlapping bars (negative gap) as overlapping violations', () => {
    const events: BufferableEvent[] = [
      ev({ id: 'a', startDate: start, endDate: start + 2 * HOUR }),
      ev({ id: 'b', startDate: start + HOUR, endDate: start + 3 * HOUR }),
    ];
    const v = findBufferViolations(events, { gap: 0 });
    expect(v).toHaveLength(1);
    expect(v[0]!.actualGap).toBe(-HOUR);
    expect(v[0]!.overlapping).toBe(true);
  });

  it('does not report when the gap is satisfied, and scopes per resource', () => {
    const events: BufferableEvent[] = [
      ev({ id: 'a', startDate: start, endDate: start + HOUR }),
      ev({ id: 'b', startDate: start + 3 * HOUR, endDate: start + 4 * HOUR }),
      // Other resource, tightly packed — must NOT cross-conflict with a/b.
      ev({ id: 'c', resourceId: 'r2', startDate: start, endDate: start + HOUR }),
      ev({ id: 'd', resourceId: 'r2', startDate: start + 3 * HOUR, endDate: start + 4 * HOUR }),
    ];
    expect(findBufferViolations(events, { gap: HOUR })).toHaveLength(0);
  });

  it('honours per-event teardown over config gap', () => {
    const events: BufferableEvent[] = [
      ev({ id: 'a', startDate: start, endDate: start + HOUR, teardownTime: 2 * HOUR }),
      ev({ id: 'b', startDate: start + 2 * HOUR, endDate: start + 3 * HOUR }),
    ];
    const v = findBufferViolations(events, { gap: 0 });
    expect(v).toHaveLength(1);
    expect(v[0]!.requiredGap).toBe(2 * HOUR);
  });
});

describe('isBufferSatisfied', () => {
  it('returns false when an event sits too close to a neighbour', () => {
    const a = ev({ id: 'a', startDate: start, endDate: start + HOUR });
    const b = ev({ id: 'b', startDate: start + HOUR + HOUR / 2, endDate: start + 3 * HOUR });
    expect(isBufferSatisfied(b, [a, b], { gap: HOUR })).toBe(false);
    expect(isBufferSatisfied(b, [a, b], { gap: HOUR / 4 })).toBe(true);
  });
});

describe('clearBufferStart', () => {
  it('pushes the start to clear the predecessor buffer', () => {
    const pred = ev({ id: 'a', startDate: start, endDate: start + HOUR });
    const e = ev({ id: 'b', startDate: start + HOUR, endDate: start + 2 * HOUR });
    expect(clearBufferStart(e, pred, { gap: HOUR })).toBe(start + 2 * HOUR);
  });

  it('leaves an already-clear start untouched', () => {
    const pred = ev({ id: 'a', startDate: start, endDate: start + HOUR });
    const e = ev({ id: 'b', startDate: start + 5 * HOUR, endDate: start + 6 * HOUR });
    expect(clearBufferStart(e, pred, { gap: HOUR })).toBe(start + 5 * HOUR);
  });
});

describe('bufferZoneBoxes', () => {
  it('projects leading and trailing zones flanking the bar', () => {
    const e = ev({ id: 'e1', startDate: start, endDate: start + 2 * HOUR });
    const boxes = bufferZoneBoxes(e, axis, { setup: HOUR, teardown: HOUR / 2 });
    expect(boxes.leading).toEqual({ x: -60, width: 60 });
    expect(boxes.trailing).toEqual({ x: 120, width: 30 });
  });
});
