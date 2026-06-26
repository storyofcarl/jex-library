/**
 * jsdom unit tests for RowReorderFeature.
 *
 * jsdom has no real layout (`getBoundingClientRect` → zeros) so these tests
 * exercise the feature's *logic* surface directly: `startDrag`, the same-grid
 * `store.move` commit, the cross-grid remove+add transfer protocol, the
 * vetoable `beforeRowReorder` gate, the `rowReorder` notification, drop-index
 * math, group-based acceptance, and leak-free `destroy`. The pointer/visual
 * pipeline is covered by the browser test.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ColumnDef, RowReorderPayload } from '../contract.js';
import { RowReorderFeature } from './row-reorder.js';
import { makeHarness, makeStore, type FeatureHarness } from './test-harness.js';

interface Row {
  id: number;
  name: string;
}

const ROWS: Row[] = [
  { id: 1, name: 'Alice' },
  { id: 2, name: 'Bob' },
  { id: 3, name: 'Carol' },
  { id: 4, name: 'Dave' },
];

const COLUMNS: ColumnDef<Row>[] = [{ field: 'name', header: 'Name', id: 'name' }];

const ids = (h: FeatureHarness<Row>): number[] =>
  h.api.store.toArray().map((r) => (r as Row).id);

let h: FeatureHarness<Row>;
beforeEach(() => {
  h = makeHarness<Row>({ store: makeStore(ROWS.map((r) => ({ ...r }))), columns: COLUMNS });
});
afterEach(() => h.destroy());

describe('RowReorderFeature — same grid', () => {
  it('starts a drag for a valid row and tracks active-drag metadata', () => {
    const f = h.api.use(new RowReorderFeature<Row>()) as RowReorderFeature<Row>;
    expect(f.isDragging()).toBe(false);
    expect(f.startDrag(1)).toBe(true);
    expect(f.isDragging()).toBe(true);
    const meta = f.getActiveDrag()!;
    expect(meta.recordId).toBe(2); // row at view index 1 is Bob (id 2)
    expect(meta.fromIndex).toBe(1);
    expect(meta.sourceGrid).toBe(h.api);
  });

  it('moves a row down via store.move on drop (after target shifts index)', () => {
    const f = h.api.use(new RowReorderFeature<Row>()) as RowReorderFeature<Row>;
    f.startDrag(0); // drag Alice (index 0)
    // Drop AFTER Carol (index 2) → Alice should land between Carol and Dave.
    const ok = f.drop({ rowIndex: 2, position: 'after' });
    expect(ok).toBe(true);
    expect(ids(h)).toEqual([2, 3, 1, 4]); // Bob, Carol, Alice, Dave
  });

  it('moves a row up via store.move on drop', () => {
    const f = h.api.use(new RowReorderFeature<Row>()) as RowReorderFeature<Row>;
    f.startDrag(3); // drag Dave (index 3)
    const ok = f.drop({ rowIndex: 0, position: 'before' }); // drop above Alice
    expect(ok).toBe(true);
    expect(ids(h)).toEqual([4, 1, 2, 3]); // Dave, Alice, Bob, Carol
  });

  it('dropping a row onto its own position is a no-op success', () => {
    const f = h.api.use(new RowReorderFeature<Row>()) as RowReorderFeature<Row>;
    f.startDrag(1); // Bob
    const ok = f.drop({ rowIndex: 1, position: 'before' });
    expect(ok).toBe(true);
    expect(ids(h)).toEqual([1, 2, 3, 4]); // unchanged
  });

  it('emits a vetoable beforeRowReorder then rowReorder with correct payload', () => {
    const f = h.api.use(new RowReorderFeature<Row>()) as RowReorderFeature<Row>;
    const before = vi.fn<(p: RowReorderPayload<Row>) => void>();
    const after = vi.fn<(p: RowReorderPayload<Row>) => void>();
    h.api.on('beforeRowReorder', before);
    h.api.on('rowReorder', after);

    f.startDrag(0);
    f.drop({ rowIndex: 2, position: 'after' });

    expect(before).toHaveBeenCalledTimes(1);
    expect(after).toHaveBeenCalledTimes(1);
    const p = after.mock.calls[0]![0];
    expect(p.recordId).toBe(1);
    expect(p.crossGrid).toBe(false);
    expect(p.sourceGrid).toBe(h.api);
    expect(p.targetGrid).toBe(h.api);
  });

  it('a beforeRowReorder veto cancels the move', () => {
    const f = h.api.use(new RowReorderFeature<Row>()) as RowReorderFeature<Row>;
    h.api.on('beforeRowReorder', () => false);
    const after = vi.fn();
    h.api.on('rowReorder', after);

    f.startDrag(0);
    const ok = f.drop({ rowIndex: 2, position: 'after' });

    expect(ok).toBe(false);
    expect(after).not.toHaveBeenCalled();
    expect(ids(h)).toEqual([1, 2, 3, 4]); // unchanged
  });

  it('startDrag fails for an out-of-range row and after destroy', () => {
    const f = h.api.use(new RowReorderFeature<Row>()) as RowReorderFeature<Row>;
    expect(f.startDrag(99)).toBe(false);
    f.startDrag(0);
    expect(f.startDrag(1)).toBe(false); // already dragging
  });
});

describe('RowReorderFeature — between grids (cross-grid transfer)', () => {
  let h2: FeatureHarness<Row>;
  beforeEach(() => {
    h2 = makeHarness<Row>({
      store: makeStore<Row>([{ id: 10, name: 'Zoe' }, { id: 11, name: 'Yan' }]),
      columns: COLUMNS,
    });
  });
  afterEach(() => h2.destroy());

  const ids2 = (): number[] => h2.api.store.toArray().map((r) => (r as Row).id);

  it('transfers a row out of the source store and into the target store at the drop index', () => {
    const src = h.api.use(new RowReorderFeature<Row>({ group: 'people' })) as RowReorderFeature<Row>;
    h2.api.use(new RowReorderFeature<Row>({ group: 'people' }));

    // We must commit the drop on the TARGET feature (it is the grid receiving
    // the row), while the active drag was started on the source.
    const target = h2.api.features.get('rowReorder') as RowReorderFeature<Row>;

    src.startDrag(1); // drag Bob (id 2) out of grid 1
    const ok = target.drop({ rowIndex: 0, position: 'before' }); // insert before Zoe

    expect(ok).toBe(true);
    expect(ids(h)).toEqual([1, 3, 4]); // Bob removed from source
    expect(ids2()).toEqual([2, 10, 11]); // Bob inserted at top of target
  });

  it('inserts after the target row when position is after', () => {
    const src = h.api.use(new RowReorderFeature<Row>({ group: 'people' })) as RowReorderFeature<Row>;
    h2.api.use(new RowReorderFeature<Row>({ group: 'people' }));
    const target = h2.api.features.get('rowReorder') as RowReorderFeature<Row>;

    src.startDrag(0); // Alice (id 1)
    target.drop({ rowIndex: 0, position: 'after' }); // after Zoe

    expect(ids2()).toEqual([10, 1, 11]); // Zoe, Alice, Yan
  });

  it('emits rowReorder with crossGrid=true on BOTH grids', () => {
    const src = h.api.use(new RowReorderFeature<Row>({ group: 'people' })) as RowReorderFeature<Row>;
    h2.api.use(new RowReorderFeature<Row>({ group: 'people' }));
    const target = h2.api.features.get('rowReorder') as RowReorderFeature<Row>;

    const onSrc = vi.fn<(p: RowReorderPayload<Row>) => void>();
    const onTgt = vi.fn<(p: RowReorderPayload<Row>) => void>();
    h.api.on('rowReorder', onSrc);
    h2.api.on('rowReorder', onTgt);

    src.startDrag(0);
    target.drop({ rowIndex: 1, position: 'after' });

    expect(onTgt).toHaveBeenCalledTimes(1);
    expect(onSrc).toHaveBeenCalledTimes(1);
    const p = onTgt.mock.calls[0]![0];
    expect(p.crossGrid).toBe(true);
    expect(p.sourceGrid).toBe(h.api);
    expect(p.targetGrid).toBe(h2.api);
  });

  it('the target grid vetoes the transfer via beforeRowReorder', () => {
    const src = h.api.use(new RowReorderFeature<Row>({ group: 'people' })) as RowReorderFeature<Row>;
    h2.api.use(new RowReorderFeature<Row>({ group: 'people' }));
    const target = h2.api.features.get('rowReorder') as RowReorderFeature<Row>;
    h2.api.on('beforeRowReorder', () => false);

    src.startDrag(0);
    const ok = target.drop({ rowIndex: 0, position: 'before' });

    expect(ok).toBe(false);
    expect(ids(h)).toEqual([1, 2, 3, 4]); // source untouched
    expect(ids2()).toEqual([10, 11]); // target untouched
  });

  it('rejects a drop from a DIFFERENT group (accepts returns false)', () => {
    const src = h.api.use(new RowReorderFeature<Row>({ group: 'a' })) as RowReorderFeature<Row>;
    h2.api.use(new RowReorderFeature<Row>({ group: 'b' }));
    const target = h2.api.features.get('rowReorder') as RowReorderFeature<Row>;

    src.startDrag(0);
    expect(target.accepts(src.getActiveDrag()!)).toBe(false);
    expect(target.drop({ rowIndex: 0, position: 'before' })).toBe(false);
    expect(ids2()).toEqual([10, 11]);
  });

  it('honors a custom accepts predicate on the target', () => {
    const src = h.api.use(new RowReorderFeature<Row>({ group: 'people' })) as RowReorderFeature<Row>;
    h2.api.use(
      new RowReorderFeature<Row>({
        group: 'people',
        accepts: (meta) => (meta.row as Row).id !== 2, // refuse Bob specifically
      }),
    );
    const target = h2.api.features.get('rowReorder') as RowReorderFeature<Row>;

    src.startDrag(1); // Bob (id 2)
    expect(target.drop({ rowIndex: 0, position: 'before' })).toBe(false);
    expect(ids2()).toEqual([10, 11]);
  });

  it('blocks transfer OUT when the source set allowDragOut=false', () => {
    const src = h.api.use(
      new RowReorderFeature<Row>({ group: 'people', allowDragOut: false }),
    ) as RowReorderFeature<Row>;
    h2.api.use(new RowReorderFeature<Row>({ group: 'people' }));
    const target = h2.api.features.get('rowReorder') as RowReorderFeature<Row>;

    src.startDrag(0);
    expect(target.drop({ rowIndex: 0, position: 'before' })).toBe(false);
    expect(ids(h)).toEqual([1, 2, 3, 4]);
  });
});

describe('RowReorderFeature — lifecycle', () => {
  it('drop with no active drag returns false', () => {
    const f = h.api.use(new RowReorderFeature<Row>()) as RowReorderFeature<Row>;
    expect(f.drop({ rowIndex: 0, position: 'before' })).toBe(false);
  });

  it('a disabled feature does not start drags', () => {
    const f = h.api.use(new RowReorderFeature<Row>({ enabled: false })) as RowReorderFeature<Row>;
    expect(f.startDrag(0)).toBe(false);
  });

  it('destroy clears active drag and is idempotent', () => {
    const f = h.api.use(new RowReorderFeature<Row>()) as RowReorderFeature<Row>;
    f.startDrag(0);
    expect(f.getActiveDrag()).not.toBeNull();
    h.api.removeFeature('rowReorder');
    // active drag was owned by this feature → cleared on destroy
    expect(f.getActiveDrag()).toBeNull();
    // second destroy must not throw
    expect(() => f.destroy()).not.toThrow();
  });
});
