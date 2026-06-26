/**
 * Multi-assignment resolution — the pure, framework-free core of the
 * AssignmentStore multi-assignment rendering feature.
 *
 * Bryntum / DHTMLX behaviour: an `AssignmentModel` (eventId ⇄ resourceId, units)
 * lets a single event appear on EVERY resource lane it is assigned to
 * (many-to-many), rather than the 1:1 `EventModel.resourceId` mapping. One event
 * record therefore yields one bar per assigned lane, each carrying the
 * assignment `units` (how much of that resource the assignment consumes).
 *
 * This module owns ONLY the data math:
 *   - `buildAssignmentIndex` — group assignments by event id (and by resource id).
 *   - `resolveRowAssignedEvents` — for a given resource lane + visible window,
 *     return the resolved bars (with units), expanding recurrence per occurrence.
 *
 * It is intentionally decoupled from the DOM and from the `Scheduler` widget so
 * it can be unit-tested in isolation (jsdom) and consumed by the rendering plugin
 * (`view/assignment-rendering.ts`). Time is epoch-ms UTC throughout.
 */

import type { RecordId } from '@jects/core';
import type { TimeSpan } from '@jects/timeline-core';
import type { AssignmentModel, EventModel } from '../contract.js';
import { parseRRule, expandOccurrences, type RecurrenceRule } from './recurrence.js';

/** Default units consumed by an assignment when none is specified. */
export const DEFAULT_ASSIGNMENT_UNITS = 1;

/**
 * A single resolved bar for a resource lane under multi-assignment mode.
 *
 * Mirrors the scheduler's internal `ResolvedEvent` shape (id / resourceId / span
 * / record / masterId) but additionally carries the assignment metadata so the
 * renderer can reflect `units` and address the originating assignment record.
 */
export interface ResolvedAssignedEvent {
  /** Bar id. Unique per (assignment, occurrence) so recurrence + multi-lane never collide. */
  id: RecordId;
  /** The lane this bar is painted in. */
  resourceId: RecordId;
  /** Visible span (the occurrence span for recurring events; the record span otherwise). */
  span: TimeSpan;
  /** The source event record (shared across every lane it is assigned to). */
  record: EventModel;
  /** The originating assignment record, when this bar came from an assignment. */
  assignment?: AssignmentModel;
  /** Units the assignment consumes on this lane (defaults to 1). */
  units: number;
  /** Master event id when this bar is a materialized recurrence occurrence. */
  masterId?: RecordId;
}

/**
 * Read-only access to the records this resolver needs. Accepting an iterable
 * (rather than a concrete Store) keeps the math testable with plain arrays while
 * still satisfying the live `Store<T>` (whose `.forEach`/`.getById` match).
 */
export interface EventLookup {
  forEach(fn: (record: EventModel) => void): void;
  getById(id: RecordId): EventModel | undefined;
}
export interface AssignmentLookup {
  forEach(fn: (record: AssignmentModel) => void): void;
  get count(): number;
}

/**
 * Index of assignments grouped by event id and by resource id, plus the set of
 * event ids that have at least one assignment. Built once per repaint so a lane
 * lookup is O(assignments-on-lane) rather than O(all-assignments).
 */
export interface AssignmentIndex {
  /** assignments grouped by their `eventId`. */
  byEvent: Map<RecordId, AssignmentModel[]>;
  /** assignments grouped by their `resourceId`. */
  byResource: Map<RecordId, AssignmentModel[]>;
  /** Event ids that have ≥1 assignment (so their `resourceId` is superseded). */
  assignedEventIds: Set<RecordId>;
  /** True when there are no assignments at all (fall back to 1:1 `resourceId`). */
  empty: boolean;
}

/** Build the grouped assignment index from an assignment lookup. */
export function buildAssignmentIndex(assignments: AssignmentLookup | undefined): AssignmentIndex {
  const byEvent = new Map<RecordId, AssignmentModel[]>();
  const byResource = new Map<RecordId, AssignmentModel[]>();
  const assignedEventIds = new Set<RecordId>();
  let count = 0;
  assignments?.forEach((a) => {
    count++;
    assignedEventIds.add(a.eventId);
    push(byEvent, a.eventId, a);
    push(byResource, a.resourceId, a);
  });
  return { byEvent, byResource, assignedEventIds, empty: count === 0 };
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/** Clamp an assignment's units to a sane, non-negative number (default 1). */
export function resolveUnits(assignment: AssignmentModel | undefined): number {
  const u = assignment?.units;
  if (u == null || !Number.isFinite(u) || u < 0) return DEFAULT_ASSIGNMENT_UNITS;
  return u;
}

/**
 * Resolve the bars for one resource lane under multi-assignment mode.
 *
 * Semantics (Bryntum/DHTMLX parity):
 *  - If the event has ≥1 assignment, it is rendered on every lane an assignment
 *    targets — including this lane only when an assignment names it. The event's
 *    own `resourceId` is IGNORED once it is assigned (the AssignmentStore is the
 *    source of truth), so an assigned event never "double-paints" on its legacy
 *    home lane unless an assignment also points there.
 *  - If the event has NO assignment, it falls back to the legacy 1:1
 *    `resourceId` mapping (units = 1), so single-assignment schedulers are
 *    unaffected.
 *  - Recurrence is expanded per occurrence within the window, per assignment, so
 *    every (lane, occurrence) pair gets a distinct, stable bar id.
 *
 * The returned bars are window-culled (only those intersecting `window`).
 */
export function resolveRowAssignedEvents(
  resourceId: RecordId,
  window: TimeSpan,
  events: EventLookup,
  index: AssignmentIndex,
): ResolvedAssignedEvent[] {
  const out: ResolvedAssignedEvent[] = [];

  // Assigned events for THIS lane (fast path off the by-resource bucket).
  const laneAssignments = index.byResource.get(resourceId);
  if (laneAssignments) {
    for (const a of laneAssignments) {
      const record = events.getById(a.eventId);
      if (!record) continue;
      emit(out, record, resourceId, window, a);
    }
  }

  // Legacy 1:1 events with NO assignment whose `resourceId` is this lane.
  events.forEach((record) => {
    if (index.assignedEventIds.has(record.id)) return; // superseded by assignments
    if (record.resourceId !== resourceId) return;
    emit(out, record, resourceId, window, undefined);
  });

  return out;
}

/**
 * Emit one or more resolved bars for `record` on `resourceId`, expanding
 * recurrence within the window. `assignment` is present only for assignment-
 * sourced bars (legacy events pass `undefined`).
 */
function emit(
  out: ResolvedAssignedEvent[],
  record: EventModel,
  resourceId: RecordId,
  window: TimeSpan,
  assignment: AssignmentModel | undefined,
): void {
  const units = resolveUnits(assignment);
  const masterSpan: TimeSpan = { start: record.startDate, end: record.endDate };
  const keyBase = assignment ? assignment.id : record.id;

  if (record.recurrenceRule) {
    const rule: RecurrenceRule | null = parseRRule(record.recurrenceRule);
    if (rule) {
      const occs = expandOccurrences(masterSpan, rule, window);
      occs.forEach((span, idx) => {
        out.push({
          id: idx === 0 ? keyBase : `${keyBase}::${span.start}`,
          resourceId,
          span,
          record,
          ...(assignment ? { assignment } : {}),
          units,
          masterId: record.id,
        });
      });
      return;
    }
  }

  // Non-recurring: include only if it intersects the visible window.
  if (masterSpan.end > window.start && masterSpan.start < window.end) {
    out.push({
      id: keyBase,
      resourceId,
      span: masterSpan,
      record,
      ...(assignment ? { assignment } : {}),
      units,
    });
  }
}
