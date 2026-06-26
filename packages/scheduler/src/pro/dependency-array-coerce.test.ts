/**
 * Unit test for `toDependencyArray` — the normalizer that lets the PRO
 * auto-reschedule plugin read `SchedulerConfig.dependencies` whether it is a
 * plain array or a reactive `Store<DependencyModel>` (the "dependencies as a
 * Store" feature). Kept in a NEW file (concurrency-safe).
 */
import { describe, it, expect } from 'vitest';
import { toDependencyArray } from './auto-reschedule.js';
import { createDependencyStore } from '../stores/dependency-store.js';
import type { DependencyModel } from '../contract.js';

describe('toDependencyArray', () => {
  it('returns [] for undefined', () => {
    expect(toDependencyArray(undefined)).toEqual([]);
  });

  it('passes a plain array through', () => {
    const arr: DependencyModel[] = [{ id: 'd1', fromId: 'a', toId: 'b' }];
    expect(toDependencyArray(arr)).toBe(arr);
  });

  it('snapshots a live Store via toArray()', () => {
    const store = createDependencyStore([
      { id: 'd1', fromId: 'a', toId: 'b' },
      { id: 'd2', fromId: 'b', toId: 'c' },
    ]);
    const out = toDependencyArray(store);
    expect(Array.isArray(out)).toBe(true);
    expect(out.map((d) => d.id)).toEqual(['d1', 'd2']);
  });

  it('reads the store live (later mutations are reflected on re-read)', () => {
    const store = createDependencyStore([{ id: 'd1', fromId: 'a', toId: 'b' }]);
    expect(toDependencyArray(store)).toHaveLength(1);
    store.add({ id: 'd2', fromId: 'b', toId: 'c' });
    expect(toDependencyArray(store)).toHaveLength(2);
  });
});
