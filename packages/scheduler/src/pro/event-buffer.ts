/**
 * Scheduler PRO — Event buffer (setup/teardown + minimum gap).
 *
 * A *buffer* is a configurable margin enforced around events: setup time before
 * an event and teardown time after it, and/or a minimum gap that must separate
 * two consecutive events on the same resource. Unlike travel time (which models
 * a property of a single event and is rendered as flanking zones), the buffer is
 * a SCHEDULING RULE — the engine flags a violation when two events sit closer
 * than the buffer allows.
 *
 * Buffer can come from two places, combined additively per event:
 *   - a per-event `setupTime` / `teardownTime` (read off the event when present);
 *   - a config-level default (`setup` / `teardown` / `gap`) applied to every event.
 *
 * The *buffered span* of an event is `[start - leading, end + trailing)` where
 * `leading = setup` and `trailing = teardown`. Two events on a resource VIOLATE
 * the buffer when the actual idle gap between them is smaller than the required
 * gap (`max(a.teardown, b.setup, config.gap)`).
 *
 * This module is pure data + geometry; it never mutates inputs. Time is epoch ms
 * (UTC); spans are half-open `[start, end)`.
 */

import type { TimeMs, DurationMs, TimeSpan } from '@jects/timeline-core';
import type { RecordId } from '@jects/core';
import type { EventModel } from '../contract.js';

/** Minimal time→pixel projector — the slice of `TimeAxis` this module needs. */
export interface BufferAxis {
  spanToBox(span: TimeSpan): { x: number; width: number };
}

/**
 * Per-event buffer fields. These are OPTIONAL extras the buffer logic reads when
 * present; they are not part of the frozen `EventModel` contract, so callers may
 * attach them ad hoc without a contract change.
 */
export interface BufferedEventExtras {
  /** Setup/lead time (ms) required immediately before the event. */
  setupTime?: DurationMs;
  /** Teardown/trail time (ms) required immediately after the event. */
  teardownTime?: DurationMs;
}

/** An event that may also carry per-event buffer extras. */
export type BufferableEvent = EventModel & BufferedEventExtras;

/** Buffer configuration (config-level defaults applied to every event). */
export interface BufferConfig {
  /** Default setup time (ms) before every event. Default 0. */
  setup?: DurationMs;
  /** Default teardown time (ms) after every event. Default 0. */
  teardown?: DurationMs;
  /**
   * Minimum idle gap (ms) required between two consecutive events on a resource,
   * independent of setup/teardown. The effective required gap between a pair is
   * `max(a.teardown, b.setup, gap)`. Default 0.
   */
  gap?: DurationMs;
}

/** The resolved leading/trailing buffer of one event (ms, both >= 0). */
export interface BufferMargins {
  /** Leading buffer (setup) before the event. */
  leading: DurationMs;
  /** Trailing buffer (teardown) after the event. */
  trailing: DurationMs;
}

/**
 * Resolve an event's leading/trailing buffer: the per-event `setupTime` /
 * `teardownTime` if present, else the config defaults. Negative values coerce
 * to 0.
 */
export function bufferMargins(event: BufferableEvent, config: BufferConfig = {}): BufferMargins {
  const leading = event.setupTime ?? config.setup ?? 0;
  const trailing = event.teardownTime ?? config.teardown ?? 0;
  return { leading: Math.max(0, leading), trailing: Math.max(0, trailing) };
}

/**
 * The buffered span of an event: `[start - leading, end + trailing)`. This is
 * the span the resource is effectively reserved for, setup/teardown included.
 */
export function bufferedSpan(event: BufferableEvent, config: BufferConfig = {}): TimeSpan {
  const { leading, trailing } = bufferMargins(event, config);
  return { start: event.startDate - leading, end: event.endDate + trailing };
}

/**
 * The required idle gap between two events `a` (earlier) and `b` (later) on the
 * same resource: the larger of `a`'s teardown, `b`'s setup, and the config gap.
 * (Setup and teardown overlap in the same idle stretch rather than summing — the
 * teardown of A and the setup of B share the gap, so the binding constraint is
 * the max, matching Scheduler Pro.)
 */
export function requiredGap(a: BufferableEvent, b: BufferableEvent, config: BufferConfig = {}): DurationMs {
  const am = bufferMargins(a, config);
  const bm = bufferMargins(b, config);
  return Math.max(am.trailing, bm.leading, config.gap ?? 0);
}

/** A detected buffer violation between two consecutive events on a resource. */
export interface BufferViolation {
  /** The earlier event (by start). */
  before: RecordId;
  /** The later event. */
  after: RecordId;
  /** The actual idle gap (ms) between `before.end` and `after.start`. */
  actualGap: DurationMs;
  /** The gap the buffer requires. */
  requiredGap: DurationMs;
  /** How much the gap is short by (`required - actual`, always > 0). */
  shortfall: DurationMs;
  /** True when the two CORE bars actually overlap (gap is negative). */
  overlapping: boolean;
}

/**
 * Detect every buffer violation among `events`. Events are grouped (by
 * `resourceId` unless `groupBy` overrides) and, within each resource, every
 * consecutive pair (by start) whose idle gap is smaller than the required gap is
 * reported. A negative actual gap (bars overlap) is always a violation.
 *
 * Note: comparing CONSECUTIVE pairs is sufficient — if A and C are too close but
 * B sits between them, B is itself too close to one of them, so the binding
 * violations are all between neighbours.
 */
export function findBufferViolations(
  events: ReadonlyArray<BufferableEvent>,
  config: BufferConfig = {},
  groupBy?: (event: BufferableEvent) => RecordId,
): BufferViolation[] {
  const key = groupBy ?? ((e: BufferableEvent): RecordId => e.resourceId);
  const buckets = new Map<RecordId, BufferableEvent[]>();
  for (const e of events) {
    const g = key(e);
    (buckets.get(g) ?? buckets.set(g, []).get(g)!).push(e);
  }

  const out: BufferViolation[] = [];
  for (const bucket of buckets.values()) {
    const sorted = [...bucket].sort((a, b) => a.startDate - b.startDate || a.endDate - b.endDate);
    for (let i = 0; i < sorted.length - 1; i++) {
      const before = sorted[i]!;
      const after = sorted[i + 1]!;
      const actualGap = after.startDate - before.endDate;
      const required = requiredGap(before, after, config);
      if (actualGap < required) {
        out.push({
          before: before.id,
          after: after.id,
          actualGap,
          requiredGap: required,
          shortfall: required - actualGap,
          overlapping: actualGap < 0,
        });
      }
    }
  }
  return out;
}

/** Whether an event satisfies the buffer against every other event on its resource. */
export function isBufferSatisfied(
  event: BufferableEvent,
  events: ReadonlyArray<BufferableEvent>,
  config: BufferConfig = {},
  groupBy?: (event: BufferableEvent) => RecordId,
): boolean {
  const key = groupBy ?? ((e: BufferableEvent): RecordId => e.resourceId);
  const target = key(event);
  for (const other of events) {
    if (other.id === event.id) continue;
    if (key(other) !== target) continue;
    const earlier = event.startDate <= other.startDate ? event : other;
    const later = earlier === event ? other : event;
    const actualGap = later.startDate - earlier.endDate;
    if (actualGap < requiredGap(earlier, later, config)) return false;
  }
  return true;
}

/**
 * Suggest the earliest start for `event` (keeping its duration) that clears the
 * buffer against `predecessor`. Returns the unchanged start when already clear.
 * Useful for snapping/auto-place when a drag would violate the buffer.
 */
export function clearBufferStart(
  event: BufferableEvent,
  predecessor: BufferableEvent,
  config: BufferConfig = {},
): TimeMs {
  const required = requiredGap(predecessor, event, config);
  const earliest = predecessor.endDate + required;
  return Math.max(event.startDate, earliest);
}

/** Px geometry for the buffer zones flanking an event bar. */
export interface BufferZoneBoxes {
  /** Leading (setup) zone `{ x, width }`, or null when none. */
  leading: { x: number; width: number } | null;
  /** Trailing (teardown) zone `{ x, width }`, or null when none. */
  trailing: { x: number; width: number } | null;
}

/**
 * Project an event's leading/trailing buffer zones to pixel boxes via a
 * `TimeAxis`. Leading is `[start - leading, start)`, trailing is `[end, end +
 * trailing)`, so the zones flank the bar without overlapping it.
 */
export function bufferZoneBoxes(
  event: BufferableEvent,
  axis: BufferAxis,
  config: BufferConfig = {},
): BufferZoneBoxes {
  const { leading, trailing } = bufferMargins(event, config);
  return {
    leading: leading > 0 ? axis.spanToBox({ start: event.startDate - leading, end: event.startDate }) : null,
    trailing: trailing > 0 ? axis.spanToBox({ start: event.endDate, end: event.endDate + trailing }) : null,
  };
}

/**
 * Render the buffer zones for one event as positioned `<div>`s. Token-pure: only
 * `.jects-scheduler__buffer*` classes (styled in `pro.css`). The `violated` flag
 * tags the zone so CSS can render an at-risk buffer distinctly (not color-only —
 * a striped pattern). Returns an empty array when the event carries no buffer.
 */
export function renderBufferZones(
  event: BufferableEvent,
  axis: BufferAxis,
  config: BufferConfig = {},
  violated = false,
): HTMLElement[] {
  const boxes = bufferZoneBoxes(event, axis, config);
  const out: HTMLElement[] = [];
  const make = (box: { x: number; width: number }, side: 'leading' | 'trailing'): HTMLElement => {
    const el = document.createElement('div');
    el.className =
      `jects-scheduler__buffer jects-scheduler__buffer--${side}` +
      (violated ? ' jects-scheduler__buffer--violated' : '');
    el.style.position = 'absolute';
    el.style.left = `${box.x}px`;
    el.style.width = `${Math.max(0, box.width)}px`;
    el.setAttribute('aria-hidden', 'true');
    return el;
  };
  if (boxes.leading) out.push(make(boxes.leading, 'leading'));
  if (boxes.trailing) out.push(make(boxes.trailing, 'trailing'));
  return out;
}
