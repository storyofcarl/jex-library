import { describe, it, expect } from 'vitest';
import { AssignmentStore, normalizeUnits, DEFAULT_ASSIGNMENT_UNITS } from './assignment-store.js';
import type { AssignmentModel } from './resource-contract.js';

describe('normalizeUnits', () => {
  it('defaults missing units to full time', () => {
    expect(normalizeUnits(undefined)).toBe(DEFAULT_ASSIGNMENT_UNITS);
  });
  it('clamps negative/NaN to 0', () => {
    expect(normalizeUnits(-5)).toBe(0);
    expect(normalizeUnits(Number.NaN)).toBe(0);
  });
  it('passes through valid values', () => {
    expect(normalizeUnits(0)).toBe(0);
    expect(normalizeUnits(50)).toBe(50);
    expect(normalizeUnits(200)).toBe(200);
  });
});

describe('AssignmentStore', () => {
  function make(data?: AssignmentModel[]): AssignmentStore {
    let n = 0;
    return new AssignmentStore({
      ...(data ? { data } : {}),
      generateId: () => `gen-${++n}`,
    });
  }

  it('normalizes units and fills an id on parse', () => {
    const store = make([{ taskId: 't1', resourceId: 'r1' } as AssignmentModel]);
    const a = store.toArray()[0]!;
    expect(a.id).toBeDefined();
    expect(a.units).toBe(100);
  });

  it('assign() creates a single edge and indexes it', () => {
    const store = make();
    const a = store.assign('t1', 'r1', 50);
    expect(a.units).toBe(50);
    expect(store.getByTask('t1').map((x) => x.resourceId)).toEqual(['r1']);
    expect(store.getByResource('r1').map((x) => x.taskId)).toEqual(['t1']);
    expect(store.getFor('t1', 'r1')?.id).toBe(a.id);
  });

  it('assign() enforces (task,resource) uniqueness — updates units in place', () => {
    const store = make();
    const first = store.assign('t1', 'r1', 50);
    const second = store.assign('t1', 'r1', 80);
    expect(store.count).toBe(1);
    expect(second.id).toBe(first.id);
    expect(store.getFor('t1', 'r1')?.units).toBe(80);
  });

  it('unassign() removes the edge and de-indexes', () => {
    const store = make();
    store.assign('t1', 'r1');
    expect(store.unassign('t1', 'r1')).toBe(true);
    expect(store.unassign('t1', 'r1')).toBe(false);
    expect(store.getByTask('t1')).toEqual([]);
    expect(store.getByResource('r1')).toEqual([]);
    expect(store.getFor('t1', 'r1')).toBeUndefined();
  });

  it('resourceIdsOf() mirrors task assignments', () => {
    const store = make();
    store.assign('t1', 'r1');
    store.assign('t1', 'r2', 40);
    expect(store.resourceIdsOf('t1').sort()).toEqual(['r1', 'r2']);
  });

  it('totalUnitsOf() sums a resource across tasks', () => {
    const store = make();
    store.assign('t1', 'r1', 100);
    store.assign('t2', 'r1', 75);
    expect(store.totalUnitsOf('r1')).toBe(175);
  });

  it('removeByTask / removeByResource clear all edges', () => {
    const store = make();
    store.assign('t1', 'r1');
    store.assign('t1', 'r2');
    store.assign('t2', 'r1');
    store.removeByTask('t1');
    expect(store.getByTask('t1')).toEqual([]);
    expect(store.getByResource('r1').map((a) => a.taskId)).toEqual(['t2']);
    store.removeByResource('r1');
    expect(store.getByResource('r1')).toEqual([]);
    expect(store.count).toBe(0);
  });

  it('emits assignmentsChange on assign/unassign', () => {
    const store = make();
    const events: Array<{ taskId?: unknown; resourceId?: unknown }> = [];
    store.assignmentEvents.on('assignmentsChange', (p) => events.push(p));
    store.assign('t1', 'r1');
    store.unassign('t1', 'r1');
    expect(events).toEqual([
      { taskId: 't1', resourceId: 'r1' },
      { taskId: 't1', resourceId: 'r1' },
    ]);
  });
});
