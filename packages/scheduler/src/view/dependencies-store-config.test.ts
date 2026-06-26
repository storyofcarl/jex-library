/**
 * Feature: "Dependencies as a reactive Store".
 *
 * These tests exercise the path where `SchedulerConfig.dependencies` is supplied
 * as a live `Store<DependencyModel>` (not just a plain array) and assert that the
 * scheduler:
 *   1. adopts the exact store instance (no copy) via `getDependencyStore()`,
 *   2. paints one connector per dependency in the store,
 *   3. repaints reactively when the store is mutated at runtime (add / remove /
 *      update) — the same discipline Bryntum/DHTMLX use for their DependencyStore.
 *
 * Lives in a NEW file (concurrency-safe) alongside the existing scheduler tests.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Store } from '@jects/core';
import { HOUR_AND_DAY } from '@jects/timeline-core';
import { Scheduler } from './scheduler.js';
import {
  createDependencyStore,
  coerceDependencyStore,
} from '../stores/dependency-store.js';
import type { ResourceModel, EventModel, DependencyModel } from '../contract.js';

const DAY = 86_400_000;
const start = Date.UTC(2025, 0, 1);

function resources(): ResourceModel[] {
  return [
    { id: 'r1', name: 'Alice' },
    { id: 'r2', name: 'Bob' },
    { id: 'r3', name: 'Carol' },
  ];
}
function events(): EventModel[] {
  return [
    { id: 'e1', resourceId: 'r1', name: 'Task A', startDate: start, endDate: start + DAY },
    { id: 'e2', resourceId: 'r2', name: 'Task B', startDate: start + DAY, endDate: start + DAY * 2 },
    { id: 'e3', resourceId: 'r3', name: 'Task C', startDate: start + DAY * 2, endDate: start + DAY * 3 },
  ];
}

function depLines(s: Scheduler): number {
  return s.el.querySelectorAll('.jects-scheduler__dep-line').length;
}

describe('Scheduler — dependencies as a reactive Store', () => {
  let host: HTMLElement;
  let sched: Scheduler | undefined;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
  });
  afterEach(() => {
    sched?.destroy();
    sched = undefined;
    host.remove();
  });

  function make(dependencies: Store<DependencyModel> | DependencyModel[]): Scheduler {
    sched = new Scheduler(host, {
      resources: resources(),
      events: events(),
      dependencies,
      preset: HOUR_AND_DAY,
      range: { start: start - DAY, end: start + DAY * 6 },
    });
    return sched;
  }

  it('coerceDependencyStore passes a live Store through by identity', () => {
    const live = createDependencyStore([{ id: 'd1', fromId: 'e1', toId: 'e2' }]);
    expect(coerceDependencyStore(live)).toBe(live);
  });

  it('adopts a Store passed as config (no copy) and paints its links', () => {
    const store = createDependencyStore([
      { id: 'd1', fromId: 'e1', toId: 'e2', type: 'FS' },
      { id: 'd2', fromId: 'e2', toId: 'e3', type: 'SS' },
    ]);
    const s = make(store);
    // The scheduler adopts the SAME instance — mutations from either side share it.
    expect(s.getDependencyStore()).toBe(store);
    expect(depLines(s)).toBe(2);
  });

  it('repaints when a dependency is ADDED to the store at runtime', () => {
    const store = createDependencyStore([{ id: 'd1', fromId: 'e1', toId: 'e2' }]);
    const s = make(store);
    expect(depLines(s)).toBe(1);

    store.add({ id: 'd2', fromId: 'e2', toId: 'e3', type: 'FS' });
    expect(depLines(s)).toBe(2);
    expect(s.el.querySelector('[data-dep-id="d2"]')).toBeTruthy();
  });

  it('repaints when a dependency is REMOVED from the store at runtime', () => {
    const store = createDependencyStore([
      { id: 'd1', fromId: 'e1', toId: 'e2' },
      { id: 'd2', fromId: 'e2', toId: 'e3' },
    ]);
    const s = make(store);
    expect(depLines(s)).toBe(2);

    store.remove('d1');
    expect(depLines(s)).toBe(1);
    expect(s.el.querySelector('[data-dep-id="d1"]')).toBeNull();
    expect(s.el.querySelector('[data-dep-id="d2"]')).toBeTruthy();
  });

  it('repaints when a dependency is UPDATED (re-routed) in the store', () => {
    const store = createDependencyStore([{ id: 'd1', fromId: 'e1', toId: 'e2', type: 'FS' }]);
    const s = make(store);
    expect(depLines(s)).toBe(1);
    // Re-target the link to a different successor — still one line, still reactive.
    store.update('d1', { toId: 'e3' });
    expect(depLines(s)).toBe(1);
    expect(s.getDependencyStore().getById('d1')?.toId).toBe('e3');
  });

  it('clears all connectors when the store is emptied', () => {
    const store = createDependencyStore([
      { id: 'd1', fromId: 'e1', toId: 'e2' },
      { id: 'd2', fromId: 'e2', toId: 'e3' },
    ]);
    const s = make(store);
    expect(depLines(s)).toBe(2);
    store.remove(['d1', 'd2']);
    expect(depLines(s)).toBe(0);
  });

  it('still accepts the plain-array form and coerces it into a reactive store', () => {
    const s = make([{ id: 'd1', fromId: 'e1', toId: 'e2', type: 'FS' }]);
    const adopted = s.getDependencyStore();
    expect(adopted).toBeInstanceOf(Store);
    expect(adopted.count).toBe(1);
    // The coerced store is reactive too: mutating it repaints.
    adopted.add({ id: 'd2', fromId: 'e2', toId: 'e3' });
    expect(depLines(s)).toBe(2);
  });

  it('detaches store listeners on destroy (no repaint after teardown)', () => {
    const store = createDependencyStore([{ id: 'd1', fromId: 'e1', toId: 'e2' }]);
    const s = make(store);
    const el = s.el;
    const before = el.querySelectorAll('.jects-scheduler__dep-line').length;
    expect(before).toBe(1);
    s.destroy();
    sched = undefined;
    // Mutating the (still-living) store after destroy must not throw, and must NOT
    // trigger another repaint — the scheduler's `change` listener was disposed, so
    // the (detached) DOM stays exactly as the last pre-destroy paint left it.
    expect(() => store.add({ id: 'd2', fromId: 'e2', toId: 'e3' })).not.toThrow();
    expect(el.querySelectorAll('.jects-scheduler__dep-line').length).toBe(before);
    expect(el.querySelector('[data-dep-id="d2"]')).toBeNull();
  });
});
