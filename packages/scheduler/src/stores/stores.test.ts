import { describe, it, expect } from 'vitest';
import { Store } from '@jects/core';
import {
  createResourceStore,
  createEventStore,
  createAssignmentStore,
  coerceResourceStore,
  coerceEventStore,
  coerceAssignmentStore,
  normalizeEvent,
} from './stores.js';

describe('scheduler stores', () => {
  it('builds typed stores from arrays', () => {
    const r = createResourceStore([{ id: 'r1', name: 'Alice' }]);
    expect(r).toBeInstanceOf(Store);
    expect(r.count).toBe(1);
    expect(r.getById('r1')?.name).toBe('Alice');
  });

  it('coerces arrays and passes through existing stores', () => {
    const arr = coerceEventStore([
      { id: 'e1', resourceId: 'r1', startDate: 0, endDate: 1000 },
    ]);
    expect(arr).toBeInstanceOf(Store);
    expect(coerceResourceStore(arr as never)).toBe(arr);
    const passthrough = createResourceStore([]);
    expect(coerceResourceStore(passthrough)).toBe(passthrough);
  });

  it('returns an empty assignment store when none supplied', () => {
    expect(coerceAssignmentStore(undefined).count).toBe(0);
    expect(createAssignmentStore([{ id: 'a', eventId: 'e', resourceId: 'r' }]).count).toBe(1);
  });

  it('normalizes endDate from duration', () => {
    const e = normalizeEvent({ id: 'e', resourceId: 'r', startDate: 100, duration: 400 });
    expect(e.endDate).toBe(500);
  });

  it('clamps a degenerate span to a minimum width', () => {
    const e = normalizeEvent({ id: 'e', resourceId: 'r', startDate: 100, endDate: 100 });
    expect(e.endDate).toBe(101);
  });

  it('event store coerces models on add', () => {
    const store = createEventStore();
    store.add({ id: 'e', resourceId: 'r', startDate: 0, duration: 250 } as never);
    expect(store.getById('e')?.endDate).toBe(250);
  });
});
