/**
 * jsdom unit tests for the Scheduler STM (state tracking manager) — the
 * framework-free undo/redo core. Exercises capture of add/remove/update from
 * live `@jects/core` stores, transaction coalescing, undo/redo replay (including
 * exact `before` restoration via the update wrapper), the redo-clear-on-mutate
 * rule, capacity trimming, enable/disable, re-entrancy, and disposal.
 */
import { describe, it, expect, vi } from 'vitest';
import { Store } from '@jects/core';
import type { EventModel, DependencyModel } from '../contract.js';
import { SchedulerStm, type TrackedStoreEntry } from './undo.js';

const HOUR = 3_600_000;
const T0 = Date.UTC(2025, 0, 6, 9);

function evt(id: string, start: number, hours: number, resourceId = 'r'): EventModel {
  return { id, resourceId, name: id.toUpperCase(), startDate: start, endDate: start + hours * HOUR };
}

function makeEventStore(data: EventModel[] = []): Store<EventModel> {
  return new Store<EventModel>({ data, idField: 'id' });
}

function stmFor(store: Store<EventModel>, extra: TrackedStoreEntry[] = []): SchedulerStm {
  return new SchedulerStm({ stores: [{ name: 'events', store }, ...extra] });
}

/** Flush the microtask queue so auto-committed transactions land. */
async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('SchedulerStm — update capture + undo/redo', () => {
  it('captures an event move and undo restores the prior span', async () => {
    const store = makeEventStore([evt('a', T0, 4)]);
    const stm = stmFor(store);

    store.update('a', { startDate: T0 + HOUR, endDate: T0 + HOUR * 5 });
    await flush();

    expect(stm.canUndo).toBe(true);
    expect(store.getById('a')!.startDate).toBe(T0 + HOUR);

    stm.undo();
    expect(store.getById('a')!.startDate).toBe(T0);
    expect(store.getById('a')!.endDate).toBe(T0 + HOUR * 4);
    expect(stm.canRedo).toBe(true);

    stm.redo();
    expect(store.getById('a')!.startDate).toBe(T0 + HOUR);
    stm.destroy();
  });

  it('restores only the changed fields on undo (name + start)', async () => {
    const store = makeEventStore([evt('a', T0, 4)]);
    const stm = stmFor(store);

    store.update('a', { name: 'Renamed', startDate: T0 + HOUR });
    await flush();
    stm.undo();

    const rec = store.getById('a')!;
    expect(rec.name).toBe('A');
    expect(rec.startDate).toBe(T0);
    expect(rec.endDate).toBe(T0 + HOUR * 4); // untouched
    stm.destroy();
  });

  it('captures create (add) and undo removes it; redo re-adds', async () => {
    const store = makeEventStore([]);
    const stm = stmFor(store);

    store.add(evt('new', T0, 2));
    await flush();
    expect(store.getById('new')).toBeDefined();

    stm.undo();
    expect(store.getById('new')).toBeUndefined();

    stm.redo();
    expect(store.getById('new')).toBeDefined();
    expect(store.getById('new')!.startDate).toBe(T0);
    stm.destroy();
  });

  it('captures delete (remove) and undo re-adds the full record', async () => {
    const store = makeEventStore([evt('a', T0, 4)]);
    const stm = stmFor(store);

    store.remove('a');
    await flush();
    expect(store.getById('a')).toBeUndefined();

    stm.undo();
    const restored = store.getById('a');
    expect(restored).toBeDefined();
    expect(restored!.name).toBe('A');
    expect(restored!.endDate).toBe(T0 + HOUR * 4);
    stm.destroy();
  });
});

describe('SchedulerStm — transactions', () => {
  it('coalesces several writes inside transact() into ONE undo step', () => {
    const store = makeEventStore([evt('a', T0, 4)]);
    const stm = stmFor(store);

    stm.transact('Editor save', () => {
      store.update('a', { name: 'X' });
      store.update('a', { startDate: T0 + HOUR });
      store.update('a', { endDate: T0 + HOUR * 6 });
    });

    expect(stm.undoLength).toBe(1);
    stm.undo();
    const rec = store.getById('a')!;
    expect(rec.name).toBe('A');
    expect(rec.startDate).toBe(T0);
    expect(rec.endDate).toBe(T0 + HOUR * 4);
    expect(stm.undoLength).toBe(0);
    stm.destroy();
  });

  it('nested transactions only commit on the outermost end', () => {
    const store = makeEventStore([evt('a', T0, 4)]);
    const stm = stmFor(store);

    stm.startTransaction('outer');
    store.update('a', { name: 'X' });
    stm.startTransaction('inner');
    store.update('a', { startDate: T0 + HOUR });
    stm.commit(); // inner — does not flush
    expect(stm.undoLength).toBe(0);
    stm.commit(); // outer — flushes
    expect(stm.undoLength).toBe(1);

    stm.undo();
    expect(store.getById('a')!.name).toBe('A');
    expect(store.getById('a')!.startDate).toBe(T0);
    stm.destroy();
  });

  it('discards an empty transaction', () => {
    const store = makeEventStore([evt('a', T0, 4)]);
    const stm = stmFor(store);
    stm.transact('noop', () => {
      /* no store writes */
    });
    expect(stm.undoLength).toBe(0);
    stm.destroy();
  });
});

describe('SchedulerStm — history rules', () => {
  it('a fresh mutation clears the redo stack', async () => {
    const store = makeEventStore([evt('a', T0, 4)]);
    const stm = stmFor(store);

    store.update('a', { startDate: T0 + HOUR });
    await flush();
    stm.undo();
    expect(stm.canRedo).toBe(true);

    // A new edit invalidates redo.
    store.update('a', { name: 'Z' });
    await flush();
    expect(stm.canRedo).toBe(false);
    stm.destroy();
  });

  it('trims to maxTransactions (ring buffer)', async () => {
    const store = makeEventStore([evt('a', T0, 4)]);
    const stm = new SchedulerStm({ stores: [{ name: 'events', store }], maxTransactions: 2 });

    for (let i = 0; i < 5; i++) {
      stm.transact(`edit ${i}`, () => store.update('a', { startDate: T0 + HOUR * (i + 1) }));
    }
    expect(stm.undoLength).toBe(2);
    stm.destroy();
  });

  it('undo() flushes an un-committed pending auto transaction', () => {
    const store = makeEventStore([evt('a', T0, 4)]);
    const stm = stmFor(store);

    // Synchronously update then immediately undo (no microtask flush yet).
    store.update('a', { startDate: T0 + HOUR });
    expect(stm.canUndo).toBe(true);
    stm.undo();
    expect(store.getById('a')!.startDate).toBe(T0);
    stm.destroy();
  });
});

describe('SchedulerStm — enable/disable + re-entrancy + events', () => {
  it('does not capture while disabled, resumes when enabled', () => {
    const store = makeEventStore([evt('a', T0, 4)]);
    const stm = new SchedulerStm({ stores: [{ name: 'events', store }], enabled: false });

    store.update('a', { startDate: T0 + HOUR });
    expect(stm.canUndo).toBe(false);

    stm.enable();
    stm.transact('edit', () => store.update('a', { startDate: T0 + HOUR * 2 }));
    expect(stm.canUndo).toBe(true);
    stm.destroy();
  });

  it('does not record new transactions while applying undo/redo', async () => {
    const store = makeEventStore([evt('a', T0, 4)]);
    const stm = stmFor(store);
    store.update('a', { startDate: T0 + HOUR });
    await flush();

    const before = stm.undoLength;
    stm.undo(); // the restore write must NOT create a new transaction
    expect(stm.undoLength).toBe(before - 1);
    stm.destroy();
  });

  it('emits transaction / undo / redo / change events', async () => {
    const store = makeEventStore([evt('a', T0, 4)]);
    const stm = stmFor(store);
    const onTx = vi.fn();
    const onUndo = vi.fn();
    const onRedo = vi.fn();
    const onChange = vi.fn();
    stm.on('transaction', onTx);
    stm.on('undo', onUndo);
    stm.on('redo', onRedo);
    stm.on('change', onChange);

    store.update('a', { startDate: T0 + HOUR });
    await flush();
    expect(onTx).toHaveBeenCalledTimes(1);

    stm.undo();
    expect(onUndo).toHaveBeenCalledTimes(1);
    stm.redo();
    expect(onRedo).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalled();
    expect(onChange.mock.calls.at(-1)![0]).toMatchObject({ canUndo: true, canRedo: false });
    stm.destroy();
  });
});

describe('SchedulerStm — multi-store (dependencies)', () => {
  it('captures dependency add/remove across a second store', async () => {
    const events = makeEventStore([evt('a', T0, 2), evt('b', T0, 2)]);
    const deps = new Store<DependencyModel>({ idField: 'id' });
    const stm = new SchedulerStm({
      stores: [
        { name: 'events', store: events },
        { name: 'dependencies', store: deps },
      ],
    });

    deps.add({ id: 'd1', fromId: 'a', toId: 'b', type: 'FS' });
    await flush();
    expect(deps.getById('d1')).toBeDefined();

    stm.undo();
    expect(deps.getById('d1')).toBeUndefined();
    stm.redo();
    expect(deps.getById('d1')).toBeDefined();
    stm.destroy();
  });
});

describe('SchedulerStm — disposal', () => {
  it('destroy() restores the wrapped update method and stops capturing', () => {
    const store = makeEventStore([evt('a', T0, 4)]);
    const stm = stmFor(store);
    stm.destroy();

    // After destroy, mutations are not captured and update works normally.
    const result = store.update('a', { startDate: T0 + HOUR });
    expect(result!.startDate).toBe(T0 + HOUR);
    expect(stm.canUndo).toBe(false);
  });

  it('destroy() is idempotent', () => {
    const store = makeEventStore([evt('a', T0, 4)]);
    const stm = stmFor(store);
    expect(() => {
      stm.destroy();
      stm.destroy();
    }).not.toThrow();
  });

  it('rejects a duplicate store name', () => {
    const store = makeEventStore([]);
    expect(
      () =>
        new SchedulerStm({
          stores: [
            { name: 'events', store },
            { name: 'events', store },
          ],
        }),
    ).toThrow(/already tracked/);
  });
});
