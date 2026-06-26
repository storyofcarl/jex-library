/**
 * jsdom unit tests for the headless `GanttStm` (State Tracking Manager).
 *
 * These exercise the pure transaction/coalescing/undo-redo logic against a
 * stub {@link StmApplier} that records the calls made to it — so we assert both
 * the STM's stack bookkeeping (canUndo/canRedo/counts/events) AND that undo/redo
 * route the correct inverse/forward calls through the engine-routed seam.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  GanttStm,
  canCoalesce,
  coalesce,
  defaultTitle,
  type StmApplier,
  type StmAction,
} from './stm.js';
import type { DependencyModel } from '../contract.js';

/** A spy applier that logs every reverse/forward call. */
function spyApplier(): StmApplier & { calls: Array<[string, ...unknown[]]> } {
  const calls: Array<[string, ...unknown[]]> = [];
  return {
    calls,
    setTaskSpan: (id, span) => calls.push(['setTaskSpan', id, span]),
    updateTask: (id, patch) => calls.push(['updateTask', id, patch]),
    applyConstraint: (id, ct, date) => calls.push(['applyConstraint', id, ct, date]),
    addDependency: (dep) => calls.push(['addDependency', dep]),
    removeDependency: (depId) => calls.push(['removeDependency', depId]),
    assignResource: (id, rid, units) => calls.push(['assignResource', id, rid, units]),
    unassignResource: (id, rid) => calls.push(['unassignResource', id, rid]),
  };
}

let stm: GanttStm;
let applier: ReturnType<typeof spyApplier>;

beforeEach(() => {
  stm = new GanttStm({ coalesceMs: 0 }); // commit each auto-tx immediately
  applier = spyApplier();
  stm.setApplier(applier);
});

describe('GanttStm — basic stack semantics', () => {
  it('records, reports availability, and undoes/redoes a span change', () => {
    expect(stm.canUndo).toBe(false);
    expect(stm.canRedo).toBe(false);

    stm.record({
      kind: 'taskSpan',
      taskId: 't1',
      before: { start: 0, end: 100 },
      after: { start: 50, end: 150 },
    });

    expect(stm.canUndo).toBe(true);
    expect(stm.undoCount).toBe(1);
    expect(stm.canRedo).toBe(false);

    expect(stm.undo()).toBe(true);
    // Undo re-applies the BEFORE span via the engine-routed applier.
    expect(applier.calls).toEqual([['setTaskSpan', 't1', { start: 0, end: 100 }]]);
    expect(stm.canUndo).toBe(false);
    expect(stm.canRedo).toBe(true);

    applier.calls.length = 0;
    expect(stm.redo()).toBe(true);
    // Redo re-applies the AFTER span.
    expect(applier.calls).toEqual([['setTaskSpan', 't1', { start: 50, end: 150 }]]);
    expect(stm.canUndo).toBe(true);
    expect(stm.canRedo).toBe(false);
  });

  it('undo/redo return false when the stacks are empty', () => {
    expect(stm.undo()).toBe(false);
    expect(stm.redo()).toBe(false);
  });

  it('a fresh edit clears the redo future (linear history)', () => {
    stm.record({ kind: 'taskSpan', taskId: 't1', before: { start: 0, end: 1 }, after: { start: 1, end: 2 } });
    stm.undo();
    expect(stm.canRedo).toBe(true);

    stm.record({ kind: 'taskSpan', taskId: 't2', before: { start: 0, end: 1 }, after: { start: 5, end: 6 } });
    expect(stm.canRedo).toBe(false);
    expect(stm.undoCount).toBe(1);
  });

  it('does not record while disabled or suspended', () => {
    stm.disable();
    stm.record({ kind: 'taskSpan', taskId: 't', before: { start: 0, end: 1 }, after: { start: 1, end: 2 } });
    expect(stm.canUndo).toBe(false);

    stm.enable();
    stm.suspend(() => {
      stm.record({ kind: 'taskSpan', taskId: 't', before: { start: 0, end: 1 }, after: { start: 1, end: 2 } });
    });
    expect(stm.canUndo).toBe(false);
  });
});

describe('GanttStm — events', () => {
  it('emits change/commit/undo/redo with correct payloads', () => {
    const change = vi.fn();
    const commit = vi.fn();
    const undo = vi.fn();
    const redo = vi.fn();
    stm.events.on('change', change);
    stm.events.on('commit', commit);
    stm.events.on('undo', undo);
    stm.events.on('redo', redo);

    stm.record({ kind: 'taskUpdate', taskId: 't', before: { name: 'A' }, after: { name: 'B' } });
    expect(commit).toHaveBeenCalledOnce();
    expect(change).toHaveBeenLastCalledWith(
      expect.objectContaining({ canUndo: true, canRedo: false, undoCount: 1 }),
    );

    stm.undo();
    expect(undo).toHaveBeenCalledOnce();
    expect(change).toHaveBeenLastCalledWith(
      expect.objectContaining({ canUndo: false, canRedo: true }),
    );

    stm.redo();
    expect(redo).toHaveBeenCalledOnce();
  });
});

describe('GanttStm — explicit transactions', () => {
  it('groups several edits into one atomic undo unit', () => {
    stm.startTransaction('Save task');
    stm.record({ kind: 'taskUpdate', taskId: 't', before: { name: 'A' }, after: { name: 'B' } });
    stm.record({ kind: 'taskSpan', taskId: 't', before: { start: 0, end: 1 }, after: { start: 2, end: 3 } });
    expect(stm.canUndo).toBe(false); // not committed until endTransaction
    stm.endTransaction();

    expect(stm.undoCount).toBe(1);
    expect(stm.nextUndoTitle).toBe('Save task');

    stm.undo();
    // Both actions reversed in REVERSE order: span first, then update.
    expect(applier.calls).toEqual([
      ['setTaskSpan', 't', { start: 0, end: 1 }],
      ['updateTask', 't', { name: 'A' }],
    ]);
  });

  it('ref-counts nested start/end so only the outermost commits', () => {
    stm.startTransaction('Outer');
    stm.startTransaction('Inner');
    stm.record({ kind: 'taskUpdate', taskId: 't', before: { name: 'A' }, after: { name: 'B' } });
    stm.endTransaction();
    expect(stm.canUndo).toBe(false);
    stm.endTransaction();
    expect(stm.undoCount).toBe(1);
    expect(stm.nextUndoTitle).toBe('Outer');
  });

  it('discards an empty explicit transaction', () => {
    stm.transact('Nothing', () => {
      /* no edits */
    });
    expect(stm.canUndo).toBe(false);
  });
});

describe('GanttStm — drag coalescing', () => {
  it('collapses a stream of same-task span ticks into one undo step', () => {
    // coalesceMs > 0 keeps the auto-transaction open across rapid ticks.
    const s = new GanttStm({ coalesceMs: 1000 });
    const ap = spyApplier();
    s.setApplier(ap);

    s.record({ kind: 'taskSpan', taskId: 't', before: { start: 0, end: 10 }, after: { start: 1, end: 11 } });
    s.record({ kind: 'taskSpan', taskId: 't', before: { start: 1, end: 11 }, after: { start: 2, end: 12 } });
    s.record({ kind: 'taskSpan', taskId: 't', before: { start: 2, end: 12 }, after: { start: 3, end: 13 } });

    // undo() flushes the open auto-transaction then reverses it — one step.
    expect(s.undo()).toBe(true);
    expect(s.undoCount).toBe(0);
    // The coalesced action keeps the FIRST before and LATEST after.
    expect(ap.calls).toEqual([['setTaskSpan', 't', { start: 0, end: 10 }]]);
  });

  it('does not coalesce across different tasks', () => {
    const s = new GanttStm({ coalesceMs: 1000 });
    const ap = spyApplier();
    s.setApplier(ap);
    s.record({ kind: 'taskSpan', taskId: 't1', before: { start: 0, end: 1 }, after: { start: 1, end: 2 } });
    s.record({ kind: 'taskSpan', taskId: 't2', before: { start: 0, end: 1 }, after: { start: 5, end: 6 } });
    s.undo(); // flush → one transaction with two distinct actions
    expect(ap.calls).toEqual([
      ['setTaskSpan', 't2', { start: 0, end: 1 }],
      ['setTaskSpan', 't1', { start: 0, end: 1 }],
    ]);
  });

  it('merges touched fields when coalescing field patches', () => {
    const merged = coalesce(
      { kind: 'taskUpdate', taskId: 't', before: { name: 'A' }, after: { name: 'B' } },
      { kind: 'taskUpdate', taskId: 't', before: { percentDone: 0.1 }, after: { percentDone: 0.5 } },
    );
    expect(merged).toEqual({
      kind: 'taskUpdate',
      taskId: 't',
      before: { name: 'A', percentDone: 0.1 },
      after: { name: 'B', percentDone: 0.5 },
    });
  });
});

describe('GanttStm — structural actions', () => {
  it('reverses a dependency add by removing it (and redo re-adds)', () => {
    const dep: DependencyModel = { id: 'd1', fromId: 'a', toId: 'b', type: 'FS' };
    stm.record({ kind: 'dependencyAdd', dependency: dep });
    stm.undo();
    expect(applier.calls).toEqual([['removeDependency', 'd1']]);
    applier.calls.length = 0;
    stm.redo();
    expect(applier.calls).toEqual([['addDependency', dep]]);
  });

  it('reverses a dependency remove by re-adding it', () => {
    const dep: DependencyModel = { id: 'd2', fromId: 'a', toId: 'b', type: 'SS', lag: 1000 };
    stm.record({ kind: 'dependencyRemove', dependency: dep });
    stm.undo();
    expect(applier.calls).toEqual([['addDependency', dep]]);
  });

  it('reverses assignment add/remove via the resource applier', () => {
    stm.record({ kind: 'assignmentAdd', taskId: 't', resourceId: 'r1', units: 1 });
    stm.undo();
    expect(applier.calls).toEqual([['unassignResource', 't', 'r1']]);
    applier.calls.length = 0;
    stm.redo();
    expect(applier.calls).toEqual([['assignResource', 't', 'r1', 1]]);
  });

  it('does not coalesce structural actions', () => {
    expect(
      canCoalesce(
        { kind: 'dependencyAdd', dependency: { id: 'd1', fromId: 'a', toId: 'b' } },
        { kind: 'dependencyAdd', dependency: { id: 'd2', fromId: 'a', toId: 'c' } },
      ),
    ).toBe(false);
  });
});

describe('GanttStm — bounds + clear', () => {
  it('bounds the undo depth to maxStack (drops oldest)', () => {
    const s = new GanttStm({ coalesceMs: 0, maxStack: 2 });
    s.setApplier(spyApplier());
    for (let i = 0; i < 5; i++) {
      s.record({ kind: 'taskSpan', taskId: `t${i}`, before: { start: 0, end: 1 }, after: { start: 1, end: 2 } });
    }
    expect(s.undoCount).toBe(2);
  });

  it('clear() empties both stacks and emits clear', () => {
    const cleared = vi.fn();
    stm.events.on('clear', cleared);
    stm.record({ kind: 'taskSpan', taskId: 't', before: { start: 0, end: 1 }, after: { start: 1, end: 2 } });
    stm.undo();
    stm.clear();
    expect(cleared).toHaveBeenCalledOnce();
    expect(stm.canUndo).toBe(false);
    expect(stm.canRedo).toBe(false);
  });
});

describe('GanttStm — pure helpers', () => {
  it('defaultTitle maps each action kind to a label', () => {
    const kinds: Array<StmAction['kind']> = [
      'taskSpan',
      'taskUpdate',
      'constraint',
      'dependencyAdd',
      'dependencyRemove',
      'assignmentAdd',
      'assignmentRemove',
    ];
    for (const kind of kinds) {
      const action = { kind } as unknown as StmAction;
      expect(defaultTitle(action).length).toBeGreaterThan(0);
    }
  });
});
