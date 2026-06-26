/**
 * Scheduler PRO — the scheduling engine.
 *
 * A framework-free constraint solver that recomputes event start/end dates from
 * dependency links, so moving (or re-linking) one event cascades to its
 * successors (forward scheduling) or predecessors (backward scheduling). It is
 * pure data → data: feed it the events + dependencies + a calendar, get back the
 * adjusted spans. The scheduler view wires it to `beforeEventChange`/`eventChange`
 * and writes the recomputed spans into the event store.
 *
 * Honoured rules:
 *   - The four precedence types FS/SS/FF/SF with optional `lag`.
 *   - Per-event constraints (start/finish no-earlier/no-later, must-start/finish).
 *   - A working-time calendar: durations are preserved in *working* time, so a
 *     bar that spans a weekend stretches to keep its working duration.
 *
 * The graph is solved in topological order; cycles are detected and broken
 * (the back-edge is ignored) so a malformed link set can never loop forever.
 */

import type { TimeMs, DurationMs } from '@jects/timeline-core';
import type { WorkingTimeCalendar } from '@jects/timeline-core';
import type { RecordId } from '@jects/core';
import type {
  EventModel,
  DependencyModel,
  DependencyType,
  ConstraintType,
} from '../contract.js';
import { WorkingCalendar } from './calendar.js';

/** Scheduling direction. */
export type ScheduleDirection = 'forward' | 'backward';

export interface ScheduleInput {
  events: ReadonlyArray<EventModel>;
  dependencies: ReadonlyArray<DependencyModel>;
  /** Working-time calendar (defaults to Mon–Fri 9–17). */
  calendar?: WorkingTimeCalendar;
  /** Direction. Default `'forward'`. */
  direction?: ScheduleDirection;
}

/** One adjusted event span. */
export interface ScheduledSpan {
  id: RecordId;
  startDate: TimeMs;
  endDate: TimeMs;
}

const MS_DAY = 86_400_000;

/**
 * Run the scheduler over an event/dependency set and return the adjusted spans
 * (only events whose span actually changed are returned, keyed by id, sorted by
 * start). Pure — does not mutate the inputs.
 */
export function schedule(input: ScheduleInput): ScheduledSpan[] {
  const direction = input.direction ?? 'forward';
  const calendar = new WorkingCalendar(input.calendar);

  // Build adjacency in the resolution direction. Forward: predecessor → successor.
  const byId = new Map<RecordId, EventModel>();
  for (const e of input.events) byId.set(e.id, e);

  // Working-duration of each event (preserved across the move).
  const durationWork = new Map<RecordId, DurationMs>();
  for (const e of input.events) {
    durationWork.set(e.id, calendar.workingDuration(e.startDate, e.endDate));
  }

  // Mutable working copy of spans.
  const span = new Map<RecordId, { start: TimeMs; end: TimeMs }>();
  for (const e of input.events) span.set(e.id, { start: e.startDate, end: e.endDate });

  const order = topoOrder(input.events, input.dependencies, direction);

  // Successors of each event (for forward) / predecessors (for backward).
  const incoming = new Map<RecordId, DependencyModel[]>();
  for (const dep of input.dependencies) {
    const key = direction === 'forward' ? dep.toId : dep.fromId;
    (incoming.get(key) ?? incoming.set(key, []).get(key)!).push(dep);
  }

  for (const id of order) {
    const ev = byId.get(id);
    if (!ev) continue;
    const links = incoming.get(id) ?? [];
    const dur = durationWork.get(id) ?? 0;
    // Forward: accumulate the earliest START the event may take. A finish-anchored
    // link (FF/SF) is translated to an equivalent start bound by walking the
    // event's own working duration back from the required finish, so FF/SF
    // genuinely constrain the FINISH rather than (incorrectly) the start.
    // Backward: accumulate the latest FINISH.
    let bound: TimeMs | null = null;

    for (const dep of links) {
      const otherId = direction === 'forward' ? dep.fromId : dep.toId;
      const other = span.get(otherId);
      if (!other) continue;
      const lag = dep.lag ?? 0;
      const c = constraintTime(dep.type ?? 'FS', direction, other, lag);
      if (c == null) continue;

      let candidate: TimeMs;
      if (direction === 'forward') {
        // Convert a finish bound into the start that yields that finish.
        candidate = c.anchor === 'finish'
          ? calendar.subtractWorking(calendar.skipNonWorking(c.time), dur)
          : c.time;
        bound = bound == null ? candidate : Math.max(bound, candidate);
      } else {
        // Backward: convert a start bound into the finish that yields that start.
        candidate = c.anchor === 'start'
          ? calendar.addWorking(c.time, dur)
          : c.time;
        bound = bound == null ? candidate : Math.min(bound, candidate);
      }
    }

    // The dependency floor (forward) / ceiling (backward), kept so an explicit
    // constraint cannot silently violate precedence.
    const dependencyBound = bound;

    let next = span.get(id)!;
    if (bound != null) {
      if (direction === 'forward') {
        const start = calendar.skipNonWorking(bound);
        next = { start, end: calendar.addWorking(start, dur) };
      } else {
        const end = bound;
        next = { start: calendar.subtractWorking(end, dur), end };
      }
    }

    // Apply explicit constraints (override / clamp the dependency result), then
    // re-clamp against the dependency bound so a must-constraint that would start
    // a successor before its predecessor finishes cannot win.
    next = applyConstraint(ev, next, dur, calendar);
    next = reconcileWithDependency(next, dependencyBound, dur, direction, calendar);
    span.set(id, next);
  }

  const out: ScheduledSpan[] = [];
  for (const e of input.events) {
    const s = span.get(e.id)!;
    if (s.start !== e.startDate || s.end !== e.endDate) {
      out.push({ id: e.id, startDate: s.start, endDate: s.end });
    }
  }
  out.sort((a, b) => a.startDate - b.startDate);
  return out;
}

/** A directional bound for the dependent event, tagged with which terminal it
 *  constrains (`start` lower/upper bound vs `finish` lower/upper bound). */
interface LinkBound {
  time: TimeMs;
  /** Whether `time` constrains the dependent's START or FINISH terminal. */
  anchor: 'start' | 'finish';
}

/**
 * The bound the dependent terminal of a link must respect, given the driving
 * event's span. Forward returns the successor's earliest start/finish; backward
 * returns the predecessor's latest start/finish. The `anchor` tells the caller
 * which terminal is constrained so FF/SF map to the FINISH, not the start.
 */
function constraintTime(
  type: DependencyType,
  direction: ScheduleDirection,
  driver: { start: TimeMs; end: TimeMs },
  lag: DurationMs,
): LinkBound | null {
  if (direction === 'forward') {
    switch (type) {
      case 'FS':
        // successor.start >= driver.finish + lag
        return { time: driver.end + lag, anchor: 'start' };
      case 'SS':
        // successor.start >= driver.start + lag
        return { time: driver.start + lag, anchor: 'start' };
      case 'FF':
        // successor.finish >= driver.finish + lag
        return { time: driver.end + lag, anchor: 'finish' };
      case 'SF':
        // successor.finish >= driver.start + lag
        return { time: driver.start + lag, anchor: 'finish' };
    }
  } else {
    switch (type) {
      case 'FS':
        // predecessor.finish <= successor.start - lag
        return { time: driver.start - lag, anchor: 'finish' };
      case 'SS':
        // predecessor.start <= successor.start - lag
        return { time: driver.start - lag, anchor: 'start' };
      case 'FF':
        // predecessor.finish <= successor.finish - lag
        return { time: driver.end - lag, anchor: 'finish' };
      case 'SF':
        // predecessor.start <= successor.finish - lag
        return { time: driver.end - lag, anchor: 'start' };
    }
  }
  return null;
}

/**
 * After an explicit constraint has been applied, re-clamp the span against the
 * dependency bound so a constraint can never silently violate precedence:
 *   - forward: the start may not fall before the dependency floor;
 *   - backward: the finish may not fall after the dependency ceiling.
 * The working duration is preserved as the span is shifted.
 */
function reconcileWithDependency(
  span: { start: TimeMs; end: TimeMs },
  dependencyBound: TimeMs | null,
  durWork: DurationMs,
  direction: ScheduleDirection,
  cal: WorkingCalendar,
): { start: TimeMs; end: TimeMs } {
  if (dependencyBound == null) return span;
  if (direction === 'forward') {
    const floor = cal.skipNonWorking(dependencyBound);
    if (span.start < floor) {
      return { start: floor, end: cal.addWorking(floor, durWork) };
    }
    return span;
  }
  // backward
  if (span.end > dependencyBound) {
    return { start: cal.subtractWorking(dependencyBound, durWork), end: dependencyBound };
  }
  return span;
}

/** Clamp/override a span by the event's constraint, preserving its duration. */
function applyConstraint(
  ev: EventModel,
  span: { start: TimeMs; end: TimeMs },
  durWork: DurationMs,
  cal: WorkingCalendar,
): { start: TimeMs; end: TimeMs } {
  const ct = ev.constraintType;
  const cd = ev.constraintDate;
  if (!ct || cd == null) return span;
  return clampByConstraint(ct, cd, span, durWork, cal);
}

function clampByConstraint(
  type: ConstraintType,
  date: TimeMs,
  span: { start: TimeMs; end: TimeMs },
  durWork: DurationMs,
  cal: WorkingCalendar,
): { start: TimeMs; end: TimeMs } {
  switch (type) {
    case 'muststarton':
      return { start: date, end: cal.addWorking(date, durWork) };
    case 'mustfinishon':
      return { start: cal.subtractWorking(date, durWork), end: date };
    case 'startnoearlierthan':
      if (span.start < date) return { start: date, end: cal.addWorking(date, durWork) };
      return span;
    case 'startnolaterthan':
      if (span.start > date) return { start: date, end: cal.addWorking(date, durWork) };
      return span;
    case 'finishnoearlierthan':
      if (span.end < date) return { start: cal.subtractWorking(date, durWork), end: date };
      return span;
    case 'finishnolaterthan':
      if (span.end > date) return { start: cal.subtractWorking(date, durWork), end: date };
      return span;
  }
}

/**
 * Topological order of events by dependency. For forward scheduling, an edge
 * `fromId → toId` means `from` must be resolved before `to`. Cycles are broken by
 * skipping back-edges (events still appear once, in discovery order).
 */
function topoOrder(
  events: ReadonlyArray<EventModel>,
  deps: ReadonlyArray<DependencyModel>,
  direction: ScheduleDirection,
): RecordId[] {
  const ids = events.map((e) => e.id);
  const idSet = new Set(ids);
  const adj = new Map<RecordId, RecordId[]>();
  const indeg = new Map<RecordId, number>();
  for (const id of ids) {
    adj.set(id, []);
    indeg.set(id, 0);
  }
  for (const dep of deps) {
    const from = direction === 'forward' ? dep.fromId : dep.toId;
    const to = direction === 'forward' ? dep.toId : dep.fromId;
    if (!idSet.has(from) || !idSet.has(to) || from === to) continue;
    adj.get(from)!.push(to);
    indeg.set(to, (indeg.get(to) ?? 0) + 1);
  }

  // Kahn's algorithm.
  const queue: RecordId[] = ids.filter((id) => (indeg.get(id) ?? 0) === 0);
  const out: RecordId[] = [];
  const seen = new Set<RecordId>();
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    for (const next of adj.get(id) ?? []) {
      const d = (indeg.get(next) ?? 0) - 1;
      indeg.set(next, d);
      if (d <= 0 && !seen.has(next)) queue.push(next);
    }
  }
  // Any remaining (in a cycle) get appended in their original order.
  for (const id of ids) if (!seen.has(id)) out.push(id);
  return out;
}

/** Convenience: a day in ms (exported for callers building constraints). */
export const DAY_MS = MS_DAY;
