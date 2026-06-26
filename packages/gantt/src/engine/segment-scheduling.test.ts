/**
 * jsdom unit tests for the SCHEDULER's split/segmented-task awareness — the
 * engine support the "Split/segmented tasks" parity item requires:
 *
 *   - a split task's working duration is the SUM of its segments' working
 *     durations (the inter-segment gaps are non-working and excluded);
 *   - the task's outer span is gap-INCLUSIVE (first segment start → last segment
 *     end), so dependents anchor on the real finish, not start + summed work;
 *   - when a dependency / constraint moves a split task, its split *pattern*
 *     travels with it (gaps preserved) via `rescheduleSegments`.
 *
 * Also covers `rescheduleSegments` directly (the whole-chain move primitive).
 */
import { describe, it, expect } from 'vitest';
import { CpmEngine } from './scheduler.js';
import { buildCalculator } from './calendar.js';
import { rescheduleSegments, readSegments, segmentsWorkingDuration } from './segments.js';
import type { CalendarModel, TaskModel, TaskSegment } from '../contract.js';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 5); // a Monday

/** 24/7 calendar so working time == wall-clock (isolates the segment math). */
const cal247: CalendarModel = {
  id: 'c',
  week: Array.from({ length: 7 }, (_, weekday) => ({ weekday, intervals: [{ from: 0, to: 1440 }] })),
  hoursPerDay: 24,
};

function calc() {
  return buildCalculator(cal247);
}

function engine(): CpmEngine {
  const e = new CpmEngine();
  e.setCalendars([cal247], 'c');
  return e;
}

const seg = (start: number, end: number): TaskSegment => ({ start, end });

/** Two-segment chain: [T0, T0+2d), gap 2d, [T0+4d, T0+6d). 4d work, 6d span. */
function twoSegs(): TaskSegment[] {
  return [seg(T0, T0 + 2 * DAY), seg(T0 + 4 * DAY, T0 + 6 * DAY)];
}

describe('rescheduleSegments', () => {
  it('shifts the whole chain to a new start, preserving work + gaps', () => {
    const c = calc();
    const { segments, span } = rescheduleSegments(twoSegs(), T0 + 10 * DAY, c);
    expect(segments).toHaveLength(2);
    expect(segments[0]).toMatchObject({ start: T0 + 10 * DAY, end: T0 + 12 * DAY }); // 2d work
    // The 2-day gap is preserved → next segment starts at +14d.
    expect(segments[1]).toMatchObject({ start: T0 + 14 * DAY, end: T0 + 16 * DAY }); // 2d work
    expect(span).toEqual({ start: T0 + 10 * DAY, end: T0 + 16 * DAY });
    expect(segmentsWorkingDuration(segments, c)).toBe(4 * DAY);
  });

  it('is a no-op for a <2-segment chain', () => {
    const c = calc();
    const single = [seg(T0, T0 + DAY)];
    expect(rescheduleSegments(single, T0 + 5 * DAY, c).segments).toEqual(single);
  });
});

describe('CpmEngine — duration & span of a split task', () => {
  it('working duration = Σ segments (gap excluded); span is gap-inclusive', () => {
    const e = engine();
    e.setTasks([{ id: 'a', calendarId: 'c', segments: twoSegs() } as unknown as TaskModel]);
    e.setDependencies([]);
    e.schedule({ direction: 'forward', projectStart: T0 });
    const a = e.getTask('a')!;
    expect(a.duration).toBe(4 * DAY); // not the 6-day hull
    expect(a.start).toBe(T0);
    expect(a.end).toBe(T0 + 6 * DAY); // gap-inclusive outer span
    expect(readSegments(a)).toHaveLength(2);
  });
});

describe('CpmEngine — dependencies respect segment gaps', () => {
  it('an FS dependent starts at the split predecessor’s gap-inclusive finish', () => {
    const e = engine();
    e.setTasks([
      { id: 'a', calendarId: 'c', segments: twoSegs() } as unknown as TaskModel,
      { id: 'b', calendarId: 'c', duration: DAY } as TaskModel,
    ]);
    e.setDependencies([{ id: 'l', fromId: 'a', toId: 'b', type: 'FS' }]);
    e.schedule({ direction: 'forward', projectStart: T0 });
    const b = e.getTask('b')!;
    // a's real finish is T0+6d (NOT T0 + 4d-of-work) → b follows there.
    expect(b.start).toBe(T0 + 6 * DAY);
    expect(b.end).toBe(T0 + 7 * DAY);
  });

  it('the split chain travels (gaps preserved) when a predecessor pushes it later', () => {
    const e = engine();
    e.setTasks([
      { id: 'p', calendarId: 'c', duration: 3 * DAY } as TaskModel,
      { id: 'a', calendarId: 'c', segments: twoSegs() } as unknown as TaskModel,
    ]);
    e.setDependencies([{ id: 'l', fromId: 'p', toId: 'a', type: 'FS' }]);
    e.schedule({ direction: 'forward', projectStart: T0 });
    const a = e.getTask('a')!;
    const segs = readSegments(a);
    expect(a.start).toBe(T0 + 3 * DAY);
    expect(segs[0]).toMatchObject({ start: T0 + 3 * DAY, end: T0 + 5 * DAY }); // 2d work
    expect(segs[1]).toMatchObject({ start: T0 + 7 * DAY, end: T0 + 9 * DAY }); // 2d gap preserved
    expect(a.end).toBe(T0 + 9 * DAY);
    expect(segmentsWorkingDuration(segs, calc())).toBe(4 * DAY);
  });

  it('backward (ALAP): an FS dependent never overlaps the split predecessor’s gap', () => {
    const e = engine();
    e.setTasks([
      { id: 'a', calendarId: 'c', segments: twoSegs() } as unknown as TaskModel,
      { id: 'b', calendarId: 'c', duration: DAY } as TaskModel,
    ]);
    e.setDependencies([{ id: 'l', fromId: 'a', toId: 'b', type: 'FS' }]);
    e.schedule({ direction: 'backward', projectStart: T0, projectEnd: T0 + 20 * DAY });
    const a = e.getTask('a')!;
    const b = e.getTask('b')!;
    const segs = readSegments(a);
    // a's true (gap-inclusive) finish == its last segment end …
    expect(a.end).toBe(segs[segs.length - 1]!.end);
    // … and the FS successor starts there or later — never inside the interruption.
    expect(b.start!).toBeGreaterThanOrEqual(a.end!);
    expect(b.start).toBe(a.end);
    // Work is preserved (4 working days) and the gap (2d) is intact.
    expect(segmentsWorkingDuration(segs, calc())).toBe(4 * DAY);
    expect(segs[1]!.start - segs[0]!.end).toBe(2 * DAY);
  });

  it('an FF successor that is itself split is placed by its hull, not summed work', () => {
    const e = engine();
    // p: ordinary 10d task; a: split (4d work, 6d hull) FF-linked to p so the FF
    // (a.finish ≥ p.finish) is the binding constraint, not the project floor.
    e.setTasks([
      { id: 'p', calendarId: 'c', duration: 10 * DAY } as TaskModel,
      { id: 'a', calendarId: 'c', segments: twoSegs() } as unknown as TaskModel,
    ]);
    e.setDependencies([{ id: 'l', fromId: 'p', toId: 'a', type: 'FF' }]);
    e.schedule({ direction: 'forward', projectStart: T0 });
    const p = e.getTask('p')!;
    const a = e.getTask('a')!;
    const segs = readSegments(a);
    expect(a.end).toBe(segs[segs.length - 1]!.end);
    // a finishes exactly at p's finish (FF, zero lag) — proving start was pulled
    // back by the full 6-day hull (a.start == p.end − 6d), not only the 4 days of
    // work. With the old (summed-duration) math a would have started 2 days late
    // and overrun p's finish.
    expect(a.end).toBe(p.end);
    expect(a.start).toBe(p.end! - 6 * DAY);
    expect(segmentsWorkingDuration(segs, calc())).toBe(4 * DAY);
  });

  it('late dates of a split critical task span its hull (zero total slack)', () => {
    const e = engine();
    e.setTasks([
      { id: 'a', calendarId: 'c', segments: twoSegs() } as unknown as TaskModel,
      { id: 'b', calendarId: 'c', duration: DAY } as TaskModel,
    ]);
    e.setDependencies([{ id: 'l', fromId: 'a', toId: 'b', type: 'FS' }]);
    const res = e.schedule({ direction: 'forward', projectStart: T0 });
    const sa = res.schedules.get('a')!;
    // The split task drives the chain — it is critical with no slack, and its
    // late finish equals its (gap-inclusive) early finish.
    expect(sa.lateFinish).toBe(sa.earlyFinish);
    expect(sa.lateStart).toBe(sa.earlyStart);
    expect(sa.totalSlack).toBe(0);
    expect(sa.critical).toBe(true);
  });

  it('incremental setTaskSpan move re-propagates split dependents', () => {
    const e = engine();
    e.setTasks([
      { id: 'a', calendarId: 'c', segments: twoSegs() } as unknown as TaskModel,
      { id: 'b', calendarId: 'c', duration: DAY } as TaskModel,
    ]);
    e.setDependencies([{ id: 'l', fromId: 'a', toId: 'b', type: 'FS' }]);
    e.schedule({ direction: 'forward', projectStart: T0 });
    // Move the whole split task 5 days later via the public span edit.
    const a0 = e.getTask('a')!;
    const changes = e.setTaskSpan('a', { start: a0.start! + 5 * DAY, end: a0.end! + 5 * DAY });
    expect(changes.some((c) => c.taskId === 'b')).toBe(true);
    const b = e.getTask('b')!;
    // b still follows a's gap-inclusive finish.
    const a = e.getTask('a')!;
    expect(b.start).toBe(a.end);
  });
});
