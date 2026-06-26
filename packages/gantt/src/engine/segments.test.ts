/**
 * jsdom unit tests for the headless split / segmented-task math
 * (`engine/segments.ts`). Pure functions over a `WorkingTimeCalculator` — no DOM.
 *
 * Covers: model normalization (`readSegments`, `normalizeSegments`, `isSplit`),
 * span/duration/gap math, and the three editing operations (`splitTask`,
 * `joinSegments`/`joinAll`, `moveSegment`) — asserting that total working
 * duration is preserved across a split, that joining closes the gap, and that a
 * per-segment move shifts only the targeted piece.
 */
import { describe, it, expect } from 'vitest';
import { buildCalculator } from './calendar.js';
import type { CalendarModel } from '../contract.js';
import {
  readSegments,
  normalizeSegments,
  isSplit,
  segmentsSpan,
  segmentsWorkingDuration,
  segmentGaps,
  splitTask,
  joinSegments,
  joinAll,
  moveSegment,
  ONE_WORKING_DAY,
  type TaskSegment,
} from './segments.js';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 5); // a Monday

/** A 24/7 calculator so wall-clock == working time (keeps assertions exact). */
function calc24() {
  const cal: CalendarModel = {
    id: 'c',
    week: Array.from({ length: 7 }, (_, weekday) => ({
      weekday,
      intervals: [{ from: 0, to: 1440 }],
    })),
    hoursPerDay: 24,
  };
  return buildCalculator(cal);
}

const seg = (start: number, end: number, extra: Partial<TaskSegment> = {}): TaskSegment => ({
  start,
  end,
  ...extra,
});

/* ── model normalization ─────────────────────────────────────────────────── */

describe('readSegments / normalizeSegments', () => {
  it('reads segments off the model directly', () => {
    const out = readSegments({ id: 't', segments: [seg(T0, T0 + DAY)] });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ start: T0, end: T0 + DAY });
  });

  it('reads segments from task.data.segments', () => {
    const out = readSegments({ id: 't', data: { segments: [seg(T0, T0 + DAY)] } });
    expect(out).toHaveLength(1);
  });

  it('returns [] for a task with no segments', () => {
    expect(readSegments({ id: 't' })).toEqual([]);
  });

  it('drops invalid pieces and sorts ascending', () => {
    const out = normalizeSegments([
      seg(T0 + 3 * DAY, T0 + 4 * DAY),
      seg(T0, T0 + DAY),
      seg(T0 + 5 * DAY, T0 + 5 * DAY), // zero-length → dropped
      { start: NaN, end: 5 } as TaskSegment, // non-finite → dropped
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]!.start).toBe(T0);
    expect(out[1]!.start).toBe(T0 + 3 * DAY);
  });

  it('merges overlapping and exactly-adjacent segments', () => {
    const out = normalizeSegments([
      seg(T0, T0 + 2 * DAY),
      seg(T0 + 2 * DAY, T0 + 3 * DAY), // touches → merge
      seg(T0 + 2.5 * DAY, T0 + 4 * DAY), // overlaps → merge
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ start: T0, end: T0 + 4 * DAY });
  });

  it('isSplit is true only with >= 2 segments', () => {
    expect(isSplit({ id: 't', segments: [seg(T0, T0 + DAY)] })).toBe(false);
    expect(isSplit({ id: 't', segments: [seg(T0, T0 + DAY), seg(T0 + 2 * DAY, T0 + 3 * DAY)] })).toBe(
      true,
    );
  });
});

/* ── span / duration / gaps ──────────────────────────────────────────────── */

describe('span / duration / gaps', () => {
  const segments = [seg(T0, T0 + 2 * DAY), seg(T0 + 4 * DAY, T0 + 6 * DAY)];

  it('outer span is first start → last end', () => {
    expect(segmentsSpan(segments)).toEqual({ start: T0, end: T0 + 6 * DAY });
  });

  it('working duration excludes the gap', () => {
    const c = calc24();
    // Two 2-day pieces = 4 days of work even though the span is 6 days.
    expect(segmentsWorkingDuration(segments, c)).toBe(4 * DAY);
  });

  it('reports the gap intervals between segments', () => {
    const gaps = segmentGaps(segments);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toEqual({ start: T0 + 2 * DAY, end: T0 + 4 * DAY });
  });

  it('a single segment has no gaps', () => {
    expect(segmentGaps([seg(T0, T0 + DAY)])).toEqual([]);
  });
});

/* ── split ───────────────────────────────────────────────────────────────── */

describe('splitTask', () => {
  const c = calc24();
  const origin = { start: T0, end: T0 + 4 * DAY };

  it('cuts a contiguous task into two segments around a working gap', () => {
    const at = T0 + 2 * DAY;
    // In a 24/7 calendar a full calendar-day gap == DAY of working time.
    const { segments, span } = splitTask([], origin, at, c, DAY);
    expect(segments).toHaveLength(2);
    // First piece keeps [start, cut).
    expect(segments[0]).toMatchObject({ start: T0, end: T0 + 2 * DAY });
    // Second piece resumes one (working) day after the cut.
    expect(segments[1]!.start).toBe(T0 + 3 * DAY);
    // Remaining 2 days of work resume after the gap → ends at T0 + 5*DAY.
    expect(segments[1]!.end).toBe(T0 + 5 * DAY);
    // Span now stretches to include the inserted gap.
    expect(span.start).toBe(T0);
    expect(span.end).toBe(T0 + 5 * DAY);
  });

  it('preserves total working duration across the split', () => {
    const before = c.workingDurationBetween(origin.start, origin.end);
    const { segments } = splitTask([], origin, T0 + 2 * DAY, c, ONE_WORKING_DAY);
    expect(segmentsWorkingDuration(segments, c)).toBe(before);
  });

  it('is a no-op when the cut falls outside any segment', () => {
    const { segments } = splitTask([], origin, origin.end + DAY, c);
    expect(segments).toHaveLength(1);
  });

  it('splits the correct piece of an already-split task', () => {
    const existing = [seg(T0, T0 + 2 * DAY), seg(T0 + 4 * DAY, T0 + 8 * DAY)];
    const at = T0 + 6 * DAY; // inside the SECOND segment
    const { segments } = splitTask(existing, origin, at, c, ONE_WORKING_DAY);
    expect(segments).toHaveLength(3);
    expect(segments[0]).toMatchObject({ start: T0, end: T0 + 2 * DAY });
  });
});

/* ── join ────────────────────────────────────────────────────────────────── */

describe('joinSegments / joinAll', () => {
  const c = calc24();

  it('closes the gap, pulling the later piece left', () => {
    const existing = [seg(T0, T0 + 2 * DAY), seg(T0 + 4 * DAY, T0 + 6 * DAY)];
    const { segments, span } = joinSegments(existing, 0, c);
    expect(segments).toHaveLength(1);
    // Merged piece carries both pieces' work (2 + 2 = 4 days) contiguously.
    expect(segments[0]).toMatchObject({ start: T0, end: T0 + 4 * DAY });
    expect(span).toEqual({ start: T0, end: T0 + 4 * DAY });
  });

  it('preserves total working duration when joining', () => {
    const existing = [seg(T0, T0 + 2 * DAY), seg(T0 + 5 * DAY, T0 + 8 * DAY)];
    const before = segmentsWorkingDuration(existing, c);
    const { segments } = joinSegments(existing, 0, c);
    expect(segmentsWorkingDuration(segments, c)).toBe(before);
  });

  it('joinAll collapses a multi-segment task to one piece', () => {
    const existing = [
      seg(T0, T0 + DAY),
      seg(T0 + 3 * DAY, T0 + 4 * DAY),
      seg(T0 + 7 * DAY, T0 + 8 * DAY),
    ];
    const { segments } = joinAll(existing, c);
    expect(segments).toHaveLength(1);
    expect(segmentsWorkingDuration(segments, c)).toBe(3 * DAY);
  });

  it('out-of-range gapIndex is a no-op', () => {
    const existing = [seg(T0, T0 + DAY), seg(T0 + 2 * DAY, T0 + 3 * DAY)];
    const { segments } = joinSegments(existing, 5, c);
    expect(segments).toHaveLength(2);
  });
});

/* ── per-segment move / resize ───────────────────────────────────────────── */

describe('moveSegment', () => {
  const c = calc24();
  const existing = [seg(T0, T0 + 2 * DAY), seg(T0 + 4 * DAY, T0 + 6 * DAY)];

  it('moves only the targeted segment by the delta', () => {
    const { segments } = moveSegment(existing, 1, DAY, 'move', c);
    expect(segments[0]).toMatchObject({ start: T0, end: T0 + 2 * DAY }); // untouched
    expect(segments[1]).toMatchObject({ start: T0 + 5 * DAY, end: T0 + 7 * DAY });
  });

  it('resize-end grows a segment, preserving its start', () => {
    const { segments } = moveSegment(existing, 0, DAY, 'resize-end', c);
    expect(segments[0]!.start).toBe(T0);
    expect(segments[0]!.end).toBe(T0 + 3 * DAY);
  });

  it('resize-start shrinks from the left, clamped above a floor', () => {
    const { segments } = moveSegment(existing, 0, DAY, 'resize-start', c);
    expect(segments[0]!.start).toBe(T0 + DAY);
    expect(segments[0]!.end).toBe(T0 + 2 * DAY);
  });

  it('re-merges when a segment is dragged onto its neighbour', () => {
    // Pull segment 1 left so it touches segment 0 → normalize merges them.
    const { segments } = moveSegment(existing, 1, -2 * DAY, 'move', c);
    expect(segments).toHaveLength(1);
  });

  it('out-of-range index is a no-op', () => {
    const { segments } = moveSegment(existing, 9, DAY, 'move', c);
    expect(segments).toHaveLength(2);
  });

  it('a resize-end never inverts the segment under a large negative delta', () => {
    const { segments } = moveSegment(existing, 0, -10 * DAY, 'resize-end', c);
    expect(segments[0]!.end).toBeGreaterThan(segments[0]!.start);
  });
});
