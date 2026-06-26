import { describe, it, expect } from 'vitest';
import type { AssignmentModel, EventModel } from '../contract.js';
import {
  buildAssignmentIndex,
  resolveRowAssignedEvents,
  resolveUnits,
  DEFAULT_ASSIGNMENT_UNITS,
  type AssignmentLookup,
  type EventLookup,
} from './assignments.js';

const DAY = 86_400_000;
const start = Date.UTC(2025, 0, 1);
const WIN = { start: start - DAY, end: start + DAY * 30 };

function eventLookup(events: EventModel[]): EventLookup {
  const byId = new Map(events.map((e) => [e.id, e]));
  return {
    forEach: (fn) => events.forEach(fn),
    getById: (id) => byId.get(id),
  };
}
function assignmentLookup(assignments: AssignmentModel[]): AssignmentLookup {
  return {
    forEach: (fn) => assignments.forEach(fn),
    get count() {
      return assignments.length;
    },
  };
}

describe('resolveUnits', () => {
  it('defaults missing/invalid units to 1', () => {
    expect(resolveUnits(undefined)).toBe(DEFAULT_ASSIGNMENT_UNITS);
    expect(resolveUnits({ id: 'a', eventId: 'e', resourceId: 'r' })).toBe(1);
    expect(resolveUnits({ id: 'a', eventId: 'e', resourceId: 'r', units: NaN })).toBe(1);
    expect(resolveUnits({ id: 'a', eventId: 'e', resourceId: 'r', units: -2 })).toBe(1);
  });
  it('passes through valid units', () => {
    expect(resolveUnits({ id: 'a', eventId: 'e', resourceId: 'r', units: 0.5 })).toBe(0.5);
    expect(resolveUnits({ id: 'a', eventId: 'e', resourceId: 'r', units: 2 })).toBe(2);
    expect(resolveUnits({ id: 'a', eventId: 'e', resourceId: 'r', units: 0 })).toBe(0);
  });
});

describe('buildAssignmentIndex', () => {
  it('reports empty for no/undefined assignments', () => {
    expect(buildAssignmentIndex(undefined).empty).toBe(true);
    expect(buildAssignmentIndex(assignmentLookup([])).empty).toBe(true);
  });
  it('groups by event and resource and tracks assigned event ids', () => {
    const idx = buildAssignmentIndex(
      assignmentLookup([
        { id: 'a1', eventId: 'e1', resourceId: 'r1' },
        { id: 'a2', eventId: 'e1', resourceId: 'r2' },
        { id: 'a3', eventId: 'e2', resourceId: 'r1' },
      ]),
    );
    expect(idx.empty).toBe(false);
    expect(idx.byEvent.get('e1')).toHaveLength(2);
    expect(idx.byResource.get('r1')).toHaveLength(2);
    expect(idx.assignedEventIds.has('e1')).toBe(true);
    expect(idx.assignedEventIds.has('e2')).toBe(true);
  });
});

describe('resolveRowAssignedEvents — many-to-many', () => {
  const events: EventModel[] = [
    { id: 'e1', resourceId: 'r1', name: 'Shared', startDate: start, endDate: start + DAY },
  ];

  it('renders one event on EVERY assigned lane', () => {
    const idx = buildAssignmentIndex(
      assignmentLookup([
        { id: 'a1', eventId: 'e1', resourceId: 'r1' },
        { id: 'a2', eventId: 'e1', resourceId: 'r2' },
        { id: 'a3', eventId: 'e1', resourceId: 'r3', units: 0.5 },
      ]),
    );
    const lk = eventLookup(events);
    const r1 = resolveRowAssignedEvents('r1', WIN, lk, idx);
    const r2 = resolveRowAssignedEvents('r2', WIN, lk, idx);
    const r3 = resolveRowAssignedEvents('r3', WIN, lk, idx);

    expect(r1).toHaveLength(1);
    expect(r2).toHaveLength(1);
    expect(r3).toHaveLength(1);
    // Same underlying record, different lanes.
    expect(r1[0]!.record.id).toBe('e1');
    expect(r2[0]!.record.id).toBe('e1');
    expect(r1[0]!.resourceId).toBe('r1');
    expect(r2[0]!.resourceId).toBe('r2');
    // Distinct, stable bar ids per assignment so they never collide.
    expect(r1[0]!.id).not.toBe(r2[0]!.id);
    // Units reflected.
    expect(r1[0]!.units).toBe(1);
    expect(r3[0]!.units).toBe(0.5);
    expect(r1[0]!.assignment?.id).toBe('a1');
  });

  it("ignores the event's own resourceId once assigned (no double-paint)", () => {
    // e1.resourceId = r1, but assignments only target r2/r3 → r1 stays empty.
    const idx = buildAssignmentIndex(
      assignmentLookup([
        { id: 'a2', eventId: 'e1', resourceId: 'r2' },
        { id: 'a3', eventId: 'e1', resourceId: 'r3' },
      ]),
    );
    const lk = eventLookup(events);
    expect(resolveRowAssignedEvents('r1', WIN, lk, idx)).toHaveLength(0);
    expect(resolveRowAssignedEvents('r2', WIN, lk, idx)).toHaveLength(1);
    expect(resolveRowAssignedEvents('r3', WIN, lk, idx)).toHaveLength(1);
  });

  it('falls back to 1:1 resourceId for unassigned events', () => {
    const evs: EventModel[] = [
      ...events,
      { id: 'e2', resourceId: 'r9', name: 'Solo', startDate: start, endDate: start + DAY },
    ];
    const idx = buildAssignmentIndex(
      assignmentLookup([{ id: 'a1', eventId: 'e1', resourceId: 'r1' }]),
    );
    const lk = eventLookup(evs);
    const r9 = resolveRowAssignedEvents('r9', WIN, lk, idx);
    expect(r9).toHaveLength(1);
    expect(r9[0]!.record.id).toBe('e2');
    expect(r9[0]!.units).toBe(1);
    expect(r9[0]!.assignment).toBeUndefined();
  });

  it('culls bars outside the visible window', () => {
    const idx = buildAssignmentIndex(
      assignmentLookup([{ id: 'a1', eventId: 'e1', resourceId: 'r1' }]),
    );
    const lk = eventLookup(events);
    const far = { start: start + DAY * 100, end: start + DAY * 200 };
    expect(resolveRowAssignedEvents('r1', far, lk, idx)).toHaveLength(0);
  });

  it('expands recurrence per occurrence per assigned lane', () => {
    const recurring: EventModel[] = [
      {
        id: 'e1',
        resourceId: 'r1',
        name: 'Daily standup',
        startDate: start,
        endDate: start + 3_600_000,
        recurrenceRule: 'FREQ=DAILY;COUNT=3',
      },
    ];
    const idx = buildAssignmentIndex(
      assignmentLookup([
        { id: 'a1', eventId: 'e1', resourceId: 'r1' },
        { id: 'a2', eventId: 'e1', resourceId: 'r2' },
      ]),
    );
    const lk = eventLookup(recurring);
    const r1 = resolveRowAssignedEvents('r1', WIN, lk, idx);
    const r2 = resolveRowAssignedEvents('r2', WIN, lk, idx);
    expect(r1).toHaveLength(3);
    expect(r2).toHaveLength(3);
    // First occurrence keeps the assignment id; later ones get unique suffixes.
    expect(r1[0]!.id).toBe('a1');
    expect(new Set(r1.map((x) => x.id)).size).toBe(3);
    expect(r1.every((x) => x.masterId === 'e1')).toBe(true);
    // Lanes never share occurrence ids.
    const ids = new Set([...r1, ...r2].map((x) => x.id));
    expect(ids.size).toBe(6);
  });
});
