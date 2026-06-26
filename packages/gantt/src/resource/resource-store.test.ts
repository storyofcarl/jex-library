import { describe, it, expect } from 'vitest';
import { ResourceStore, normalizeResource, DEFAULT_RESOURCE_CAPACITY } from './resource-store.js';
import type { ResourceModel } from './resource-contract.js';

describe('normalizeResource', () => {
  it('fills type + capacity defaults', () => {
    const r = normalizeResource({ id: 'r1' });
    expect(r.type).toBe('work');
    expect(r.capacity).toBe(DEFAULT_RESOURCE_CAPACITY);
  });

  it('clamps a negative/NaN capacity to the default', () => {
    expect(normalizeResource({ id: 'r', capacity: -3 }).capacity).toBe(1);
    expect(normalizeResource({ id: 'r', capacity: Number.NaN }).capacity).toBe(1);
    expect(normalizeResource({ id: 'r', capacity: 0 }).capacity).toBe(0);
    expect(normalizeResource({ id: 'r', capacity: 3 }).capacity).toBe(3);
  });

  it('preserves consumer fields', () => {
    const r = normalizeResource<{ skill: string }>({ id: 'r', data: { skill: 'qa' } });
    expect(r.data).toEqual({ skill: 'qa' });
  });
});

describe('ResourceStore', () => {
  const sample = (): ResourceModel[] => [
    { id: 'p1', name: 'Ada', type: 'work', capacity: 1, hourlyCost: 100, group: 'eng' },
    { id: 'p2', name: 'Boris', type: 'work', capacity: 2, group: 'eng' },
    { id: 'eq1', name: 'Crane', type: 'equipment' },
    { id: 'c1', name: 'License', type: 'cost', hourlyCost: 0 },
  ];

  it('normalizes records on load', () => {
    const store = new ResourceStore({ data: [{ id: 'x' } as ResourceModel] });
    const r = store.getById('x')!;
    expect(r.type).toBe('work');
    expect(r.capacity).toBe(1);
  });

  it('exposes capacity + hourly cost lookups', () => {
    const store = new ResourceStore({ data: sample() });
    expect(store.capacityOf('p2')).toBe(2);
    expect(store.hourlyCostOf('p1')).toBe(100);
    expect(store.hourlyCostOf('p2')).toBe(0); // unset
    expect(store.capacityOf('missing')).toBe(1);
  });

  it('groups by group field (ungrouped under empty key)', () => {
    const store = new ResourceStore({ data: sample() });
    const groups = store.byGroup();
    expect(groups.get('eng')?.map((r) => r.id)).toEqual(['p1', 'p2']);
    expect(groups.get('')?.map((r) => r.id)).toEqual(['eq1', 'c1']);
  });

  it('filters by type', () => {
    const store = new ResourceStore({ data: sample() });
    expect(store.ofType('equipment').map((r) => r.id)).toEqual(['eq1']);
    expect(store.ofType('work').map((r) => r.id)).toEqual(['p1', 'p2']);
  });

  it('emits store events on add/remove/update', () => {
    const store = new ResourceStore();
    const actions: string[] = [];
    store.events.on('change', ({ action }) => actions.push(action));
    store.add({ id: 'r1', name: 'New' });
    store.update('r1', { name: 'Renamed' });
    store.remove('r1');
    expect(actions).toEqual(['add', 'update', 'remove']);
  });
});
