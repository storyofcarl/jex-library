/**
 * jsdom unit tests for UndoRedoFeature.
 *
 * Exercises the transaction/undo stack against a real @jects/core Store via the
 * feature harness: cell edit, multi-cell paste/fill batches, add/remove rows,
 * row move, merge window, redo invalidation, state events, keyboard bindings,
 * grid-state (sort/filter/group/column) capture, and clean teardown.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type {
  FilterState,
  GroupState,
  GridApi,
  GridFeature,
  SortState,
} from '../contract.js';
import { makeHarness, makeStore, type FeatureHarness } from './test-harness.js';
import { UndoRedoFeature, undoRedoFeature } from './undo-redo.js';

interface Row {
  id: number;
  name: string;
  age: number;
  city: string;
}

function rows(): Row[] {
  return [
    { id: 1, name: 'Ada', age: 36, city: 'London' },
    { id: 2, name: 'Bo', age: 28, city: 'Paris' },
    { id: 3, name: 'Cy', age: 41, city: 'Berlin' },
  ];
}

let h: FeatureHarness<Row>;
let api: GridApi<Row>;

beforeEach(() => {
  h = makeHarness<Row>({
    store: makeStore(rows()),
    columns: [
      { field: 'name', header: 'Name' },
      { field: 'age', header: 'Age', type: 'number' },
      { field: 'city', header: 'City' },
    ],
  });
  api = h.api;
});

afterEach(() => h.destroy());

function install(opts?: ConstructorParameters<typeof UndoRedoFeature>[0]): UndoRedoFeature<Row> {
  const f = new UndoRedoFeature<Row>({ mergeWindow: 0, ...opts });
  api.use(f as unknown as GridFeature<Row>);
  return f;
}

describe('UndoRedoFeature — cell edit', () => {
  it('captures a store update and undoes it to the prior value', () => {
    const f = install();
    api.store.update(1, { age: 99 });
    expect(api.store.getById(1)!.age).toBe(99);
    expect(f.canUndo).toBe(true);
    expect(f.canRedo).toBe(false);

    f.undo();
    expect(api.store.getById(1)!.age).toBe(36);
    expect(f.canUndo).toBe(false);
    expect(f.canRedo).toBe(true);

    f.redo();
    expect(api.store.getById(1)!.age).toBe(99);
  });

  it('editCell helper records an undoable step', () => {
    const f = install();
    f.editCell(2, 'name', 'Bob');
    expect(api.store.getById(2)!.name).toBe('Bob');
    f.undo();
    expect(api.store.getById(2)!.name).toBe('Bo');
  });

  it('ignores no-op updates (same value)', () => {
    const f = install();
    api.store.update(1, { age: 36 });
    expect(f.canUndo).toBe(false);
  });

  it('labels a single edit by column header', () => {
    const f = install();
    api.store.update(1, { age: 50 });
    expect(f.peekUndo()).toBe('Edit Age');
  });
});

describe('UndoRedoFeature — batches (paste / fill)', () => {
  it('coalesces a transact() block into one undo step', () => {
    const f = install();
    f.transact('Paste', () => {
      api.store.update(1, { age: 1 });
      api.store.update(2, { age: 2 });
      api.store.update(3, { age: 3 });
    });
    expect(f.undoLength).toBe(1);
    expect(f.peekUndo()).toBe('Paste');

    f.undo();
    expect(api.store.getById(1)!.age).toBe(36);
    expect(api.store.getById(2)!.age).toBe(28);
    expect(api.store.getById(3)!.age).toBe(41);

    f.redo();
    expect(api.store.getById(1)!.age).toBe(1);
    expect(api.store.getById(3)!.age).toBe(3);
  });

  it('applyEdits writes many cells as one step (fill)', () => {
    const f = install();
    f.applyEdits('Fill', [
      { id: 1, field: 'city', value: 'X' },
      { id: 2, field: 'city', value: 'X' },
      { id: 3, field: 'city', value: 'X' },
    ]);
    expect(api.store.getById(2)!.city).toBe('X');
    expect(f.undoLength).toBe(1);
    f.undo();
    expect(api.store.getById(1)!.city).toBe('London');
    expect(api.store.getById(3)!.city).toBe('Berlin');
  });
});

describe('UndoRedoFeature — add / remove / move', () => {
  it('undoes an add (removes the added row)', () => {
    const f = install();
    api.store.add({ id: 4, name: 'Di', age: 22, city: 'Rome' });
    expect(api.store.count).toBe(4);
    f.undo();
    expect(api.store.count).toBe(3);
    expect(api.store.getById(4)).toBeUndefined();
    f.redo();
    expect(api.store.getById(4)!.name).toBe('Di');
  });

  it('undoes a remove (re-inserts the row)', () => {
    const f = install();
    api.store.remove(2);
    expect(api.store.count).toBe(2);
    f.undo();
    expect(api.store.count).toBe(3);
    expect(api.store.getById(2)!.name).toBe('Bo');
    f.redo();
    expect(api.store.getById(2)).toBeUndefined();
  });

  it('undoes a row move via rowReorder event', () => {
    const f = install();
    // Simulate the engine moving row id=1 from index 0 to index 2.
    api.store.move(0, 2);
    api.emit('rowReorder', {
      row: api.store.getById(1)!,
      recordId: 1,
      fromIndex: 0,
      toIndex: 2,
      position: 'after',
      sourceGrid: api,
      targetGrid: api,
      crossGrid: false,
    });
    expect(api.store.indexOf(1)).toBe(2);
    f.undo();
    expect(api.store.indexOf(1)).toBe(0);
    f.redo();
    expect(api.store.indexOf(1)).toBe(2);
  });

  it('does not capture cross-grid reorders as moves', () => {
    const f = install();
    api.emit('rowReorder', {
      row: api.store.getById(1)!,
      recordId: 1,
      fromIndex: 0,
      toIndex: 1,
      position: 'after',
      sourceGrid: api,
      targetGrid: {} as GridApi<Row>,
      crossGrid: true,
    });
    expect(f.canUndo).toBe(false);
  });
});

describe('UndoRedoFeature — stack semantics', () => {
  it('a new action clears the redo branch', () => {
    const f = install();
    api.store.update(1, { age: 10 });
    f.undo();
    expect(f.canRedo).toBe(true);
    api.store.update(2, { age: 20 });
    expect(f.canRedo).toBe(false);
  });

  it('honors the history limit', () => {
    const f = install({ limit: 3 });
    for (let i = 0; i < 6; i++) api.store.update(1, { age: 100 + i });
    expect(f.undoLength).toBe(3);
  });

  it('merges rapid same-cell edits within the merge window', () => {
    const f = install({ mergeWindow: 10_000 });
    api.store.update(1, { age: 40 });
    api.store.update(1, { age: 41 });
    api.store.update(1, { age: 42 });
    expect(f.undoLength).toBe(1);
    f.undo();
    expect(api.store.getById(1)!.age).toBe(36);
  });

  it('does not merge edits to different cells', () => {
    const f = install({ mergeWindow: 10_000 });
    api.store.update(1, { age: 40 });
    api.store.update(2, { age: 40 });
    expect(f.undoLength).toBe(2);
  });

  it('clear() empties both stacks', () => {
    const f = install();
    api.store.update(1, { age: 10 });
    f.undo();
    f.clear();
    expect(f.canUndo).toBe(false);
    expect(f.canRedo).toBe(false);
  });
});

describe('UndoRedoFeature — state events', () => {
  it('notifies onStateChange listeners', () => {
    const f = install();
    const seen: boolean[] = [];
    f.onStateChange((s) => seen.push(s.canUndo));
    api.store.update(1, { age: 10 });
    f.undo();
    expect(seen).toContain(true);
    expect(seen).toContain(false);
    expect(f.getState()).toMatchObject({ canUndo: false, canRedo: true });
  });
});

describe('UndoRedoFeature — keyboard', () => {
  it('Ctrl+Z undoes and Ctrl+Y redoes from the grid root', () => {
    const f = install();
    api.store.update(1, { age: 77 });

    api.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    expect(api.store.getById(1)!.age).toBe(36);

    api.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'y', ctrlKey: true, bubbles: true }));
    expect(api.store.getById(1)!.age).toBe(77);
    expect(f.canUndo).toBe(true);
  });

  it('Ctrl+Shift+Z also redoes', () => {
    install();
    api.store.update(1, { age: 5 });
    api.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    api.el.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, shiftKey: true, bubbles: true }),
    );
    expect(api.store.getById(1)!.age).toBe(5);
  });

  it('ignores the shortcut while typing in an input', () => {
    install();
    api.store.update(1, { age: 9 });
    const input = document.createElement('input');
    api.el.appendChild(input);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    // value unchanged because the editable-target guard skipped the undo
    expect(api.store.getById(1)!.age).toBe(9);
  });

  it('does not bind keyboard when disabled', () => {
    install({ keyboard: false });
    api.store.update(1, { age: 8 });
    api.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    expect(api.store.getById(1)!.age).toBe(8);
  });
});

/* ── grid-state capture (sort/filter/group/column) ──────────────────────── */

/** A minimal stateful sort feature exposing getState/setState. */
function fakeSort(): GridFeature<Row> & { state: SortState[] } {
  const state: SortState[] = [];
  return {
    name: 'sort',
    state,
    init() {},
    destroy() {},
    getState() {
      return [...this.state];
    },
    setState(s: SortState[]) {
      this.state.length = 0;
      this.state.push(...s);
    },
  } as unknown as GridFeature<Row> & { state: SortState[] };
}

describe('UndoRedoFeature — grid state', () => {
  it('captures and reverses a sort change', () => {
    const sort = fakeSort();
    api.use(sort);
    const f = install();

    const newSort: SortState[] = [{ columnId: 'age', direction: 'asc' }];
    (sort as unknown as { setState(s: SortState[]): void }).setState(newSort);
    api.emit('sortChange', { sort: newSort });

    expect(f.peekUndo()).toBe('Sort');
    f.undo();
    expect((sort as unknown as { getState(): SortState[] }).getState()).toEqual([]);
    f.redo();
    expect((sort as unknown as { getState(): SortState[] }).getState()).toEqual(newSort);
  });

  it('captures filter changes', () => {
    const filterState: FilterState[] = [];
    const filter = {
      name: 'filter',
      init() {},
      destroy() {},
      getState: () => [...filterState],
      setState: (s: FilterState[]) => {
        filterState.length = 0;
        filterState.push(...s);
      },
    } as unknown as GridFeature<Row>;
    api.use(filter);
    const f = install();

    const next: FilterState[] = [{ columnId: 'city', operator: 'eq', value: 'Paris' }];
    (filter as unknown as { setState(s: FilterState[]): void }).setState(next);
    api.emit('filterChange', { filter: next });
    f.undo();
    expect(filterState).toEqual([]);
  });

  it('captures group changes', () => {
    let group: GroupState = { columnIds: [] };
    const groupFeat = {
      name: 'group',
      init() {},
      destroy() {},
      getState: () => group,
      setState: (s: GroupState) => {
        group = s;
      },
    } as unknown as GridFeature<Row>;
    api.use(groupFeat);
    const f = install();

    group = { columnIds: ['city'] };
    api.emit('groupChange', { group });
    f.undo();
    expect(group.columnIds).toEqual([]);
  });

  it('captures column reorder/resize state', () => {
    const f = install();
    api.updateColumn('age', { width: 222 });
    api.emit('columnResize', { columnId: 'age', width: 222 });
    expect(f.peekUndo()).toBe('Column change');
    f.undo();
    expect(api.getColumn('age')!.width).toBeUndefined();
    f.redo();
    expect(api.getColumn('age')!.width).toBe(222);
  });

  it('does not track state when trackState is false', () => {
    const f = install({ trackState: false });
    api.emit('columnResize', { columnId: 'age', width: 10 });
    expect(f.canUndo).toBe(false);
  });
});

describe('UndoRedoFeature — lifecycle', () => {
  it('factory builds a feature', () => {
    expect(undoRedoFeature<Row>()).toBeInstanceOf(UndoRedoFeature);
  });

  it('destroy() releases listeners and empties stacks', () => {
    const f = install();
    api.store.update(1, { age: 10 });
    const spy = vi.fn();
    f.onStateChange(spy);
    api.removeFeature('undoRedo');
    // After destroy the store listener is gone: a mutation must not be captured.
    api.store.update(1, { age: 20 });
    expect(f.canUndo).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it('clears history when the store reloads', () => {
    const f = install();
    api.store.update(1, { age: 10 });
    expect(f.canUndo).toBe(true);
    api.store.parse(rows());
    expect(f.canUndo).toBe(false);
  });
});
