/**
 * Unit tests for the reactive dependency Store + its guards.
 */
import { describe, it, expect } from 'vitest';
import { Store } from '@jects/core';
import {
  createDependencyStore,
  coerceDependencyStore,
  hasDependency,
  wouldCreateCycle,
} from './dependency-store.js';

describe('dependency store', () => {
  it('creates a Store from raw data keyed by id', () => {
    const store = createDependencyStore([{ id: 'd1', fromId: 'a', toId: 'b', type: 'FS' }]);
    expect(store).toBeInstanceOf(Store);
    expect(store.count).toBe(1);
    expect(store.getById('d1')?.fromId).toBe('a');
  });

  it('coerces an array or passes a live Store through', () => {
    const arr = coerceDependencyStore([{ id: 'd1', fromId: 'a', toId: 'b' }]);
    expect(arr.count).toBe(1);
    const live = createDependencyStore();
    expect(coerceDependencyStore(live)).toBe(live);
    expect(coerceDependencyStore(undefined).count).toBe(0);
  });

  it('is reactive: add/remove emit change', () => {
    const store = createDependencyStore();
    let changes = 0;
    store.events.on('change', () => {
      changes++;
    });
    store.add({ id: 'd1', fromId: 'a', toId: 'b' });
    store.remove('d1');
    expect(changes).toBeGreaterThanOrEqual(2);
    expect(store.count).toBe(0);
  });

  it('hasDependency is order + type sensitive', () => {
    const store = createDependencyStore([{ id: 'd1', fromId: 'a', toId: 'b', type: 'FS' }]);
    expect(hasDependency(store, 'a', 'b', 'FS')).toBe(true);
    expect(hasDependency(store, 'a', 'b', 'FF')).toBe(false);
    expect(hasDependency(store, 'b', 'a', 'FS')).toBe(false);
    // default type is FS
    const store2 = createDependencyStore([{ id: 'd2', fromId: 'x', toId: 'y' }]);
    expect(hasDependency(store2, 'x', 'y', 'FS')).toBe(true);
  });

  it('wouldCreateCycle detects self + transitive cycles', () => {
    const store = createDependencyStore([
      { id: 'd1', fromId: 'a', toId: 'b' },
      { id: 'd2', fromId: 'b', toId: 'c' },
    ]);
    expect(wouldCreateCycle(store, 'a', 'a')).toBe(true);
    expect(wouldCreateCycle(store, 'c', 'a')).toBe(true);
    expect(wouldCreateCycle(store, 'c', 'b')).toBe(true);
    expect(wouldCreateCycle(store, 'a', 'c')).toBe(false);
    expect(wouldCreateCycle(store, 'a', 'd')).toBe(false);
  });
});
