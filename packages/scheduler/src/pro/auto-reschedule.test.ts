/**
 * jsdom unit tests for the auto-reschedule plugin — the wiring that drives the
 * pure `schedule()` engine from a live scheduler's change events and writes the
 * cascade back into the event store, with veto + re-entrancy guard.
 *
 * These run in the default `pnpm test` (jsdom). The plugin is tested against a
 * fake structural host so the logic is exercised without real layout; the
 * browser/a11y suite mounts a real Scheduler.
 */
import { describe, it, expect, vi } from 'vitest';
import { Store, EventEmitter } from '@jects/core';
import type { EventModel, DependencyModel, SchedulerConfig } from '../contract.js';
import {
  AutoReschedulePlugin,
  installAutoReschedule,
  computeCascade,
  snapshotEvents,
  type AutoRescheduleHost,
} from './auto-reschedule.js';

const HOUR = 3_600_000;
const DAY = 86_400_000;
const MON_9 = Date.UTC(2025, 0, 6, 9); // Monday 09:00 UTC

function evt(id: string, start: number, hours: number, resourceId = 'r'): EventModel {
  return { id, resourceId, startDate: start, endDate: start + hours * HOUR };
}

/**
 * A minimal fake host implementing the structural `AutoRescheduleHost` surface,
 * backed by a real core Store (so write-backs + change events behave for real).
 */
class FakeHost implements AutoRescheduleHost {
  readonly store: Store<EventModel>;
  readonly events = new EventEmitter();
  private cfg: SchedulerConfig;
  isDestroyed = false;
  readonly el: HTMLElement;

  constructor(events: EventModel[], dependencies: DependencyModel[] = []) {
    this.store = new Store<EventModel>({ data: events, idField: 'id' });
    this.cfg = { resources: [], events: this.store, dependencies };
    this.el = document.createElement('div');
  }
  getEventStore(): Store<EventModel> {
    return this.store;
  }
  getConfig(): Readonly<SchedulerConfig> {
    return this.cfg;
  }
  on<E extends string>(event: E, fn: (p: never) => unknown): () => void {
    return this.events.on(event as never, fn as never);
  }
  emit<E extends string>(event: E, payload: unknown): boolean {
    return this.events.emit(event as never, payload as never);
  }
  /** Simulate the scheduler emitting eventChange after a user move. */
  fireEventChange(event: EventModel): void {
    this.emit('eventChange', { event, from: {}, to: {} });
  }
}

describe('computeCascade (pure core)', () => {
  it('returns [] with no dependencies', () => {
    expect(computeCascade({ events: [evt('a', MON_9, 2)], dependencies: [] })).toEqual([]);
  });

  it('pushes an FS successor after its predecessor finishes', () => {
    const a = evt('a', MON_9, 4);
    const b = evt('b', MON_9, 2);
    const deps: DependencyModel[] = [{ id: 'd', fromId: 'a', toId: 'b', type: 'FS' }];
    const changes = computeCascade({ events: [a, b], dependencies: deps });
    const movedB = changes.find((c) => c.id === 'b');
    expect(movedB).toBeDefined();
    expect(movedB!.startDate).toBeGreaterThanOrEqual(a.endDate);
  });
});

describe('snapshotEvents', () => {
  it('copies live store records into a plain array', () => {
    const store = new Store<EventModel>({ data: [evt('a', MON_9, 2)], idField: 'id' });
    const snap = snapshotEvents(store);
    expect(snap).toHaveLength(1);
    expect(snap[0]!.id).toBe('a');
  });
});

describe('AutoReschedulePlugin', () => {
  it('cascades on eventChange: moving a writes b back into the store', () => {
    const a = evt('a', MON_9, 4);
    const b = evt('b', MON_9, 2); // overlaps a
    const deps: DependencyModel[] = [{ id: 'd', fromId: 'a', toId: 'b', type: 'FS' }];
    const host = new FakeHost([a, b], deps);
    const plugin = installAutoReschedule(host, { animationMs: 0 });

    host.fireEventChange(host.store.getById('a')!);

    const newB = host.store.getById('b')!;
    expect(newB.startDate).toBeGreaterThanOrEqual(a.endDate);
    plugin.destroy();
  });

  it('emits autoReschedule with the applied changes', () => {
    const deps: DependencyModel[] = [{ id: 'd', fromId: 'a', toId: 'b', type: 'FS' }];
    const host = new FakeHost([evt('a', MON_9, 4), evt('b', MON_9, 2)], deps);
    const plugin = installAutoReschedule(host, { animationMs: 0 });
    const onReschedule = vi.fn();
    plugin.on('autoReschedule', onReschedule);

    host.fireEventChange(host.store.getById('a')!);

    expect(onReschedule).toHaveBeenCalledTimes(1);
    const payload = onReschedule.mock.calls[0]![0];
    expect(payload.changes.some((c: { id: string }) => c.id === 'b')).toBe(true);
    plugin.destroy();
  });

  it('beforeAutoReschedule veto cancels the write-back', () => {
    const a = evt('a', MON_9, 4);
    const b = evt('b', MON_9, 2);
    const deps: DependencyModel[] = [{ id: 'd', fromId: 'a', toId: 'b', type: 'FS' }];
    const host = new FakeHost([a, b], deps);
    const plugin = installAutoReschedule(host, { animationMs: 0 });
    plugin.on('beforeAutoReschedule', () => false);

    const startBefore = host.store.getById('b')!.startDate;
    host.fireEventChange(host.store.getById('a')!);

    expect(host.store.getById('b')!.startDate).toBe(startBefore);
    plugin.destroy();
  });

  it('host-level beforeAutoReschedule veto also cancels', () => {
    const deps: DependencyModel[] = [{ id: 'd', fromId: 'a', toId: 'b', type: 'FS' }];
    const host = new FakeHost([evt('a', MON_9, 4), evt('b', MON_9, 2)], deps);
    const plugin = installAutoReschedule(host, { animationMs: 0 });
    host.on('beforeAutoReschedule', () => false);

    const startBefore = host.store.getById('b')!.startDate;
    host.fireEventChange(host.store.getById('a')!);

    expect(host.store.getById('b')!.startDate).toBe(startBefore);
    plugin.destroy();
  });

  it('does not recurse: the write-back re-fires eventChange but cascades once', () => {
    const deps: DependencyModel[] = [{ id: 'd', fromId: 'a', toId: 'b', type: 'FS' }];
    const host = new FakeHost([evt('a', MON_9, 4), evt('b', MON_9, 2)], deps);
    const plugin = installAutoReschedule(host, { animationMs: 0 });
    // Re-fire eventChange whenever the store changes (mimics the view wiring).
    host.store.events.on('change', () => {
      const rec = host.store.getById('b');
      if (rec) host.fireEventChange(rec);
    });
    const onReschedule = vi.fn();
    plugin.on('autoReschedule', onReschedule);

    host.fireEventChange(host.store.getById('a')!);

    // Exactly one cascade despite the store-change re-entry.
    expect(onReschedule).toHaveBeenCalledTimes(1);
    plugin.destroy();
  });

  it('is a no-op when disabled, and resumes when re-enabled', () => {
    const a = evt('a', MON_9, 4);
    const b = evt('b', MON_9, 2);
    const deps: DependencyModel[] = [{ id: 'd', fromId: 'a', toId: 'b', type: 'FS' }];
    const host = new FakeHost([a, b], deps);
    const plugin = new AutoReschedulePlugin(host, { enabled: false, animationMs: 0 });

    const startBefore = host.store.getById('b')!.startDate;
    host.fireEventChange(host.store.getById('a')!);
    expect(host.store.getById('b')!.startDate).toBe(startBefore);

    plugin.setEnabled(true);
    host.fireEventChange(host.store.getById('a')!);
    expect(host.store.getById('b')!.startDate).toBeGreaterThanOrEqual(a.endDate);
    plugin.destroy();
  });

  it('cascades on dependencyCreate (a new link reschedules)', () => {
    const a = evt('a', MON_9, 4);
    const b = evt('b', MON_9, 2);
    const deps: DependencyModel[] = []; // start with none on the config…
    const host = new FakeHost([a, b], deps);
    // …but feed the plugin an explicit (growing) dependency set.
    const linked: DependencyModel[] = [];
    const plugin = installAutoReschedule(host, { animationMs: 0, dependencies: linked });

    linked.push({ id: 'd', fromId: 'a', toId: 'b', type: 'FS' });
    host.emit('dependencyCreate', { dependency: linked[0] });

    expect(host.store.getById('b')!.startDate).toBeGreaterThanOrEqual(a.endDate);
    plugin.destroy();
  });

  it('reschedule() can be triggered imperatively', () => {
    const a = evt('a', MON_9, 4);
    const b = evt('b', MON_9, 2);
    const deps: DependencyModel[] = [{ id: 'd', fromId: 'a', toId: 'b', type: 'FS' }];
    const host = new FakeHost([a, b], deps);
    const plugin = installAutoReschedule(host, { animationMs: 0 });

    const applied = plugin.reschedule();
    expect(applied.some((c) => c.id === 'b')).toBe(true);
    expect(host.store.getById('b')!.startDate).toBeGreaterThanOrEqual(a.endDate);
    plugin.destroy();
  });

  it('honours the SS link type via the engine', () => {
    const a = evt('a', MON_9, 4);
    const b = evt('b', MON_9 - DAY, 2); // b starts before a
    const deps: DependencyModel[] = [{ id: 'd', fromId: 'a', toId: 'b', type: 'SS' }];
    const host = new FakeHost([a, b], deps);
    const plugin = installAutoReschedule(host, { animationMs: 0 });

    host.fireEventChange(host.store.getById('a')!);
    // SS: b.start must be >= a.start.
    expect(host.store.getById('b')!.startDate).toBeGreaterThanOrEqual(a.startDate);
    plugin.destroy();
  });

  it('destroy() removes listeners (no further cascades) and is idempotent', () => {
    const a = evt('a', MON_9, 4);
    const b = evt('b', MON_9, 2);
    const deps: DependencyModel[] = [{ id: 'd', fromId: 'a', toId: 'b', type: 'FS' }];
    const host = new FakeHost([a, b], deps);
    const plugin = installAutoReschedule(host, { animationMs: 0 });

    plugin.destroy();
    plugin.destroy(); // idempotent

    const startBefore = host.store.getById('b')!.startDate;
    host.fireEventChange(host.store.getById('a')!);
    expect(host.store.getById('b')!.startDate).toBe(startBefore);
  });

  it('auto-disposes when the host scheduler emits destroy', () => {
    const a = evt('a', MON_9, 4);
    const b = evt('b', MON_9, 2);
    const deps: DependencyModel[] = [{ id: 'd', fromId: 'a', toId: 'b', type: 'FS' }];
    const host = new FakeHost([a, b], deps);
    installAutoReschedule(host, { animationMs: 0 });

    host.emit('destroy', { widget: host });
    host.isDestroyed = true;

    const startBefore = host.store.getById('b')!.startDate;
    host.fireEventChange(host.store.getById('a')!);
    expect(host.store.getById('b')!.startDate).toBe(startBefore);
  });

  it('drops engine changes that target the trigger itself', () => {
    const a = evt('a', MON_9, 4);
    const b = evt('b', MON_9, 2);
    const deps: DependencyModel[] = [{ id: 'd', fromId: 'a', toId: 'b', type: 'FS' }];
    const host = new FakeHost([a, b], deps);
    const plugin = installAutoReschedule(host, { animationMs: 0 });
    const onReschedule = vi.fn();
    plugin.on('autoReschedule', onReschedule);

    host.fireEventChange(host.store.getById('a')!);
    if (onReschedule.mock.calls.length > 0) {
      const changes = onReschedule.mock.calls[0]![0].changes as Array<{ id: string }>;
      expect(changes.every((c) => c.id !== 'a')).toBe(true);
    }
    plugin.destroy();
  });
});
