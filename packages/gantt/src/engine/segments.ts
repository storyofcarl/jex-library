/**
 * @jects/gantt — split / segmented-task model + working-time segment math.
 *
 * A *split task* (Bryntum/DHTMLX "Split tasks" parity feature) is a single task
 * whose work is **interrupted into multiple working segments separated by gaps**
 * (e.g. a task paused over a holiday week, or deliberately split to free a
 * resource). The task keeps ONE identity, one row, one set of dependencies — but
 * its bar is drawn as several sub-bars joined by thin connector lines, and the
 * scheduling math measures the task's effective span from the first segment's
 * start to the last segment's end while only the segment intervals count as
 * working time.
 *
 * This module is the headless, framework-free half of the feature:
 *   - The `TaskSegment` model (a `[start, end)` working interval within a task).
 *   - PURE working-time arithmetic over a task's segment list: total working
 *     duration, the task's outer span, gap intervals, the `split` operation
 *     (cut a contiguous span into two segments around a non-working gap), the
 *     `join` operation (merge adjacent segments back), and per-segment moves
 *     that re-schedule a single piece against the calendar while keeping the
 *     others put.
 *
 * Everything here is a pure function of its inputs (segments + a
 * `WorkingTimeCalculator`); there is NO DOM and NO mutation of engine state, so
 * it is exhaustively unit-testable. The interactive renderer
 * (`ui/segmented-tasks.ts`) and the engine wiring read these helpers.
 *
 * All times are epoch milliseconds (UTC); durations are working milliseconds
 * measured against the task's effective calendar — matching the rest of the
 * Gantt contract.
 */

import type { Model } from '@jects/core';
import type { TimeMs, DurationMs, TimeSpan } from '@jects/timeline-core';
import type {
  TaskModel,
  TaskSegment,
  WorkingTimeCalculator,
} from '../contract.js';

/* ═══════════════════════════════════════════════════════════════════════════
   1. SEGMENT MODEL
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * The segment model is the frozen contract's {@link TaskSegment} (a half-open
 * `[start, end)` working interval). It is re-exported here so the engine/UI
 * segment code can import the model from one place alongside the math that
 * operates on it.
 */
export type { TaskSegment } from '../contract.js';

/**
 * A task model carrying split segments. The contract's `TaskModel` is open
 * (`extends Model`), so we read `segments` as an additive, structurally-typed
 * field WITHOUT editing the frozen contract — mirroring how the Rollup feature
 * reads `task.rollup`. Consumers may put `segments` directly on the task or
 * under `task.data.segments`; {@link readSegments} resolves both.
 */
export interface SegmentedTask<Extra extends Model = Model> extends TaskModel<Extra> {
  /** Working segments; absent/empty = a normal contiguous task. */
  segments?: TaskSegment[];
}

/* ═══════════════════════════════════════════════════════════════════════════
   2. NORMALIZATION / READ
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Read a task's segments from the model (direct `segments` or `data.segments`),
 * returning a normalized, sorted, non-overlapping copy. Invalid pieces
 * (`end <= start`, non-finite) are dropped; touching/overlapping pieces are
 * merged so the result is always a clean ascending list. Returns `[]` when the
 * task carries no usable segments (i.e. it is a normal contiguous task).
 */
export function readSegments(task: Model): TaskSegment[] {
  const direct = (task as { segments?: unknown }).segments;
  const nested = (task as { data?: { segments?: unknown } }).data?.segments;
  const raw = Array.isArray(direct) ? direct : Array.isArray(nested) ? nested : null;
  if (!raw) return [];
  return normalizeSegments(raw as TaskSegment[]);
}

/** Is this task split (has two or more working segments)? */
export function isSplit(task: Model): boolean {
  return readSegments(task).length >= 2;
}

/**
 * Normalize a raw segment list: coerce, drop empties/invalid, sort ascending by
 * start, then merge any overlapping or exactly-adjacent intervals (so the result
 * is a minimal, ordered set). Segment ids/percentDone of the earliest-starting
 * piece in a merged run are preserved.
 */
export function normalizeSegments(segments: ReadonlyArray<TaskSegment>): TaskSegment[] {
  const cleaned = segments
    .filter(
      (s): s is TaskSegment =>
        s != null &&
        Number.isFinite(s.start) &&
        Number.isFinite(s.end) &&
        s.end > s.start,
    )
    .map((s) => ({ ...s }))
    .sort((a, b) => a.start - b.start);

  const merged: TaskSegment[] = [];
  for (const seg of cleaned) {
    const last = merged[merged.length - 1];
    if (last && seg.start <= last.end) {
      // Overlapping or touching → extend the previous segment.
      if (seg.end > last.end) last.end = seg.end;
    } else {
      merged.push({ ...seg });
    }
  }
  return merged;
}

/* ═══════════════════════════════════════════════════════════════════════════
   3. PURE SPAN / DURATION MATH
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * The task's outer span: first segment start → last segment end. Returns `null`
 * when there are no segments (caller falls back to the task's own `start`/`end`).
 */
export function segmentsSpan(segments: ReadonlyArray<TaskSegment>): TimeSpan | null {
  if (segments.length === 0) return null;
  const norm = normalizeSegments(segments);
  if (norm.length === 0) return null;
  return { start: norm[0]!.start, end: norm[norm.length - 1]!.end };
}

/**
 * Total WORKING duration across all segments, measured against the calendar.
 * (Gaps between segments do not count — only the segment intervals do, and even
 * within a segment, non-working time inside it is excluded by the calculator.)
 */
export function segmentsWorkingDuration(
  segments: ReadonlyArray<TaskSegment>,
  calc: WorkingTimeCalculator,
): DurationMs {
  let total = 0;
  for (const seg of normalizeSegments(segments)) {
    total += calc.workingDurationBetween(seg.start, seg.end);
  }
  return total;
}

/**
 * The gap intervals between consecutive segments (the interruptions), in order.
 * A single-segment (or empty) task has no gaps.
 */
export function segmentGaps(segments: ReadonlyArray<TaskSegment>): TimeSpan[] {
  const norm = normalizeSegments(segments);
  const gaps: TimeSpan[] = [];
  for (let i = 1; i < norm.length; i++) {
    const prev = norm[i - 1]!;
    const cur = norm[i]!;
    if (cur.start > prev.end) gaps.push({ start: prev.end, end: cur.start });
  }
  return gaps;
}

/* ═══════════════════════════════════════════════════════════════════════════
   4. SPLIT
   ═══════════════════════════════════════════════════════════════════════════ */

/** Result of a split/join/move: the new segment list + the task's new span. */
export interface SegmentEditResult {
  /** The normalized new segment list (≥ 1 segment). */
  segments: TaskSegment[];
  /** The task's resulting outer span (first start → last end). */
  span: TimeSpan;
}

/**
 * Split a task into two working segments around a non-working GAP.
 *
 * `at` is the instant the cut is made (where the user dropped the split handle).
 * The piece BEFORE `at` keeps `[origin.start, at)` of working time; the piece
 * AFTER resumes for the REMAINING working duration starting `gap` working-ms
 * later. The calendar guarantees both pieces land on working time and that the
 * post-gap piece carries exactly the work that was to the right of the cut, so
 * NO work is lost — the task's total working duration is preserved, only
 * interrupted.
 *
 * If the task is already split, the segment containing `at` is the one that gets
 * cut (the others are untouched). A cut at or outside a segment's working bounds
 * is a no-op (returns the existing segments). `gap` defaults to one working day.
 *
 * @param existing  Current segments (empty ⇒ treat the contiguous task as one).
 * @param origin    The task's contiguous span when `existing` is empty.
 * @param at        The cut instant (epoch ms).
 * @param calc      The task's working-time calculator.
 * @param gap       Working gap inserted after the cut (default 1 working day).
 */
export function splitTask(
  existing: ReadonlyArray<TaskSegment>,
  origin: TimeSpan,
  at: TimeMs,
  calc: WorkingTimeCalculator,
  gap: DurationMs = ONE_WORKING_DAY,
): SegmentEditResult {
  const segments =
    existing.length > 0
      ? normalizeSegments(existing)
      : [{ start: origin.start, end: origin.end }];

  // Locate the segment the cut falls inside (strictly between its bounds).
  const idx = segments.findIndex((s) => at > s.start && at < s.end);
  if (idx === -1) {
    // Cut not inside any segment → nothing to split.
    return { segments, span: spanOf(segments, origin) };
  }

  const target = segments[idx]!;
  // Remaining working duration to the right of the cut, measured on the calendar.
  const rightWork = calc.workingDurationBetween(at, target.end);
  if (rightWork <= 0) {
    return { segments, span: spanOf(segments, origin) };
  }

  const before: TaskSegment = { ...target, start: target.start, end: calc.floorToWorkingTime(at) };
  // Resume `gap` working-ms after the cut, then run for the remaining work.
  const resumeStart = calc.ceilToWorkingTime(calc.addWorkingTime(at, Math.max(0, gap)));
  const after: TaskSegment = {
    start: resumeStart,
    end: calc.addWorkingTime(resumeStart, rightWork),
  };
  if (target.percentDone !== undefined) {
    before.percentDone = target.percentDone;
    after.percentDone = target.percentDone;
  }

  const next = [...segments.slice(0, idx), before, after, ...segments.slice(idx + 1)];
  const norm = normalizeSegments(next);
  return { segments: norm, span: spanOf(norm, origin) };
}

/* ═══════════════════════════════════════════════════════════════════════════
   5. JOIN
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Join the gap AFTER segment index `gapIndex` (i.e. merge segment `gapIndex`
 * with `gapIndex + 1`), pulling the later segment LEFT so it resumes
 * immediately when the earlier one ends — closing the interruption while
 * preserving each piece's working duration. The merged task may collapse back to
 * a single contiguous segment (when only two segments remain).
 *
 * Out-of-range `gapIndex` is a no-op.
 */
export function joinSegments(
  existing: ReadonlyArray<TaskSegment>,
  gapIndex: number,
  calc: WorkingTimeCalculator,
  origin?: TimeSpan,
): SegmentEditResult {
  const segments = normalizeSegments(existing);
  if (gapIndex < 0 || gapIndex >= segments.length - 1) {
    return { segments, span: spanOf(segments, origin) };
  }
  const left = segments[gapIndex]!;
  const right = segments[gapIndex + 1]!;
  const rightWork = calc.workingDurationBetween(right.start, right.end);
  // Resume the right piece's work the instant the left piece ends.
  const merged: TaskSegment = {
    start: left.start,
    end: calc.addWorkingTime(calc.ceilToWorkingTime(left.end), rightWork),
  };
  if (left.id !== undefined) merged.id = left.id;
  if (left.percentDone !== undefined) merged.percentDone = left.percentDone;
  const next = [...segments.slice(0, gapIndex), merged, ...segments.slice(gapIndex + 2)];
  const norm = normalizeSegments(next);
  return { segments: norm, span: spanOf(norm, origin) };
}

/** Join EVERY gap, collapsing a split task back to a single contiguous segment. */
export function joinAll(
  existing: ReadonlyArray<TaskSegment>,
  calc: WorkingTimeCalculator,
  origin?: TimeSpan,
): SegmentEditResult {
  let segments = normalizeSegments(existing);
  while (segments.length > 1) {
    segments = joinSegments(segments, 0, calc, origin).segments;
  }
  return { segments, span: spanOf(segments, origin) };
}

/* ═══════════════════════════════════════════════════════════════════════════
   6. PER-SEGMENT MOVE / RESIZE
   ═══════════════════════════════════════════════════════════════════════════ */

/** Which edit a per-segment drag performs. */
export type SegmentDragMode = 'move' | 'resize-start' | 'resize-end';

/**
 * Apply a per-segment drag: move OR resize the single segment at `index`,
 * leaving the others put, then re-normalize (which merges any pieces the drag
 * pushed into contact, so dragging one segment onto its neighbour rejoins them).
 *
 * - `move`        shifts the segment by `delta` working-ms (preserving its work).
 * - `resize-start` moves its start by `delta` (clamped so it stays before end).
 * - `resize-end`   moves its end by `delta` (clamped so it stays after start).
 *
 * The drag never reorders segments past the list bounds; the result is always a
 * valid, ordered, non-overlapping segment set with the task span recomputed.
 */
export function moveSegment(
  existing: ReadonlyArray<TaskSegment>,
  index: number,
  delta: DurationMs,
  mode: SegmentDragMode,
  calc: WorkingTimeCalculator,
  origin?: TimeSpan,
): SegmentEditResult {
  const segments = normalizeSegments(existing).map((s) => ({ ...s }));
  if (index < 0 || index >= segments.length) {
    return { segments, span: spanOf(segments, origin) };
  }
  const seg = segments[index]!;
  const work = calc.workingDurationBetween(seg.start, seg.end);

  if (mode === 'move') {
    const start = calc.ceilToWorkingTime(calc.addWorkingTime(seg.start, delta));
    seg.start = start;
    seg.end = calc.addWorkingTime(start, work);
  } else if (mode === 'resize-start') {
    let start = calc.addWorkingTime(seg.start, delta);
    if (start >= seg.end) start = calc.addWorkingTime(seg.end, -MIN_SEGMENT_WORK);
    seg.start = calc.ceilToWorkingTime(start);
  } else {
    let end = calc.addWorkingTime(seg.end, delta);
    if (end <= seg.start) end = calc.addWorkingTime(seg.start, MIN_SEGMENT_WORK);
    seg.end = calc.floorToWorkingTime(end);
    if (seg.end <= seg.start) seg.end = calc.addWorkingTime(seg.start, MIN_SEGMENT_WORK);
  }

  const norm = normalizeSegments(segments);
  return { segments: norm, span: spanOf(norm, origin) };
}

/* ═══════════════════════════════════════════════════════════════════════════
   6b. WHOLE-CHAIN RESCHEDULE (engine: dependency / constraint driven moves)
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Shift a whole segment chain so the FIRST segment starts at `newStart`,
 * PRESERVING each segment's working duration AND the working-time gaps between
 * consecutive segments. This is the engine's hook: when a dependency, constraint,
 * or drag moves a split task, its split *pattern* travels with it rather than
 * collapsing into a contiguous bar.
 *
 * The gaps are captured (in working ms) from the input chain BEFORE moving, so a
 * task that pauses "3 working days after segment 1" keeps that 3-day pause at its
 * new position. Pure — returns a fresh, normalized chain (and its span).
 *
 * Returns the input unchanged when there are fewer than 2 segments (a contiguous
 * task is rescheduled by the ordinary engine span math, not here).
 */
export function rescheduleSegments(
  existing: ReadonlyArray<TaskSegment>,
  newStart: TimeMs,
  calc: WorkingTimeCalculator,
  origin?: TimeSpan,
): SegmentEditResult {
  const segments = normalizeSegments(existing);
  if (segments.length < 2) {
    return { segments, span: spanOf(segments, origin) };
  }

  // Capture per-segment working durations and the working-time gaps between them
  // BEFORE we move anything.
  const works: DurationMs[] = segments.map((s) => calc.workingDurationBetween(s.start, s.end));
  const gaps: DurationMs[] = [];
  for (let i = 1; i < segments.length; i++) {
    gaps.push(Math.max(0, calc.workingDurationBetween(segments[i - 1]!.end, segments[i]!.start)));
  }

  const out: TaskSegment[] = [];
  let cursor = calc.ceilToWorkingTime(newStart);
  for (let i = 0; i < segments.length; i++) {
    if (i > 0) cursor = calc.ceilToWorkingTime(calc.addWorkingTime(cursor, gaps[i - 1]!));
    const start = cursor;
    const end = calc.addWorkingTime(start, works[i]!);
    const seg: TaskSegment = { start, end };
    const src = segments[i]!;
    if (src.id !== undefined) seg.id = src.id;
    if (src.percentDone !== undefined) seg.percentDone = src.percentDone;
    out.push(seg);
    cursor = end;
  }
  const norm = normalizeSegments(out);
  return { segments: norm, span: spanOf(norm, origin) };
}

/* ═══════════════════════════════════════════════════════════════════════════
   7. HELPERS / CONSTANTS
   ═══════════════════════════════════════════════════════════════════════════ */

/** One working day in ms — the default split gap and resize floor basis. */
export const ONE_WORKING_DAY: DurationMs = 8 * 60 * 60 * 1000;
/** Smallest working duration a segment may be resized down to (1 hour). */
export const MIN_SEGMENT_WORK: DurationMs = 60 * 60 * 1000;

/** Resolve a span from a segment list, falling back to a supplied origin span. */
function spanOf(segments: ReadonlyArray<TaskSegment>, origin?: TimeSpan): TimeSpan {
  return segmentsSpan(segments) ?? origin ?? { start: 0, end: 0 };
}
