/**
 * jsdom unit tests for RowExpanderFeature.
 *
 * Exercises the feature's model + row-source seam without the full engine:
 *   - expand/collapse/toggle + the expanded set,
 *   - the interleaved master + injected detail row entries (`kind: 'detail'`),
 *   - per-detail height accounting via `heightOf`,
 *   - vetoable `beforeRowExpand` / `beforeRowCollapse` events,
 *   - single (accordion) mode + expandAll/collapseAll,
 *   - the auto-prepended expander column + its toggle affordance,
 *   - clean teardown (listeners + row-source cleared, column restored).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Model } from '@jects/core';
import { makeHarness, makeStore, type FeatureHarness } from './test-harness.js';
import type { ColumnDef, GridApi } from '../contract.js';
import type { RowSource, RowEntry } from '../engine/row-model.js';
import { type RowExpanderFeature, rowExpanderFeature } from './row-expander.js';

interface Row extends Model {
  id: number;
  name: string;
  age: number;
}

const DATA: Row[] = [
  { id: 1, name: 'Ada', age: 36 },
  { id: 2, name: 'Linus', age: 54 },
  { id: 3, name: 'Grace', age: 85 },
];

const COLS: ColumnDef<Row>[] = [
  { field: 'name', header: 'Name', width: 200 },
  { field: 'age', header: 'Age', type: 'number', width: 100 },
];

/** A harness whose GridApi also implements the optional `setRowSource` seam. */
function makeSeamHarness(): {
  h: FeatureHarness<Row>;
  api: GridApi<Row>;
  source(): RowSource<Row> | null;
} {
  const h = makeHarness<Row>({ store: makeStore(DATA.map((r) => ({ ...r }))), columns: COLS });
  let installed: RowSource<Row> | null = null;
  const api = h.api as GridApi<Row> & { setRowSource(s: RowSource<Row> | null): void };
  api.setRowSource = (s) => {
    installed = s;
  };
  return { h, api, source: () => installed };
}

function entriesOf(src: RowSource<Row> | null): RowEntry<Row>[] {
  return src ? src.getRowEntries() : [];
}

let h: FeatureHarness<Row>;
afterEach(() => h?.destroy());

describe('RowExpanderFeature — model', () => {
  it('requires a renderer', () => {
    expect(() => rowExpanderFeature<Row>({} as never)).toThrow(/renderer/);
  });

  it('starts with no expanded rows and no active source', () => {
    const seam = makeSeamHarness();
    h = seam.h;
    seam.h.api.use(rowExpanderFeature<Row>({ renderer: () => 'detail' }));
    const f = seam.h.api.features.get('rowExpander') as RowExpanderFeature<Row>;
    expect(f.getExpanded()).toEqual([]);
    expect(seam.source()).toBeNull();
  });

  it('expand() injects a detail row beneath the master and activates the source', () => {
    const seam = makeSeamHarness();
    h = seam.h;
    seam.h.api.use(rowExpanderFeature<Row>({ renderer: () => 'D', detailHeight: 200 }));
    const f = seam.h.api.features.get('rowExpander') as RowExpanderFeature<Row>;

    expect(f.expand(2)).toBe(true);
    expect(f.isExpanded(2)).toBe(true);

    const entries = entriesOf(seam.source());
    // 3 masters + 1 injected detail.
    expect(entries).toHaveLength(4);
    // The detail row immediately follows master id 2 (index 1 → detail at 2).
    expect(entries[1]!.kind).toBe('row');
    expect(entries[1]!.id).toBe(2);
    expect(entries[2]!.kind).toBe('detail');
    expect(entries[2]!.detail!.masterId).toBe(2);
    expect(entries[2]!.detail!.height).toBe(200);
  });

  it('heightOf reports the detail height only for the detail index', () => {
    const seam = makeSeamHarness();
    h = seam.h;
    seam.h.api.use(rowExpanderFeature<Row>({ renderer: () => 'D', detailHeight: 240 }));
    const f = seam.h.api.features.get('rowExpander') as RowExpanderFeature<Row>;
    f.expand(1);
    const src = seam.source()!;
    expect(src.heightOf!(0)).toBeUndefined(); // master row 1
    expect(src.heightOf!(1)).toBe(240); // its detail
    expect(src.heightOf!(2)).toBeUndefined(); // master row 2
  });

  it('supports a per-row detailHeight function', () => {
    const seam = makeSeamHarness();
    h = seam.h;
    seam.h.api.use(
      rowExpanderFeature<Row>({ renderer: () => 'D', detailHeight: (row) => 100 + row.age }),
    );
    const f = seam.h.api.features.get('rowExpander') as RowExpanderFeature<Row>;
    f.expand(3); // age 85 → 185
    const detail = entriesOf(seam.source()).find((e) => e.kind === 'detail');
    expect(detail!.detail!.height).toBe(185);
  });

  it('collapse() removes the detail row and clears the source when none remain', () => {
    const seam = makeSeamHarness();
    h = seam.h;
    seam.h.api.use(rowExpanderFeature<Row>({ renderer: () => 'D' }));
    const f = seam.h.api.features.get('rowExpander') as RowExpanderFeature<Row>;
    f.expand(1);
    expect(seam.source()).not.toBeNull();
    f.collapse(1);
    expect(f.isExpanded(1)).toBe(false);
    expect(seam.source()).toBeNull();
  });

  it('toggle() flips expansion', () => {
    const seam = makeSeamHarness();
    h = seam.h;
    seam.h.api.use(rowExpanderFeature<Row>({ renderer: () => 'D' }));
    const f = seam.h.api.features.get('rowExpander') as RowExpanderFeature<Row>;
    f.toggle(2);
    expect(f.isExpanded(2)).toBe(true);
    f.toggle(2);
    expect(f.isExpanded(2)).toBe(false);
  });

  it('honors initial expanded ids', () => {
    const seam = makeSeamHarness();
    h = seam.h;
    seam.h.api.use(rowExpanderFeature<Row>({ renderer: () => 'D', expanded: [1, 3] }));
    const f = seam.h.api.features.get('rowExpander') as RowExpanderFeature<Row>;
    expect(f.getExpanded()).toEqual([1, 3]);
    const details = entriesOf(seam.source()).filter((e) => e.kind === 'detail');
    expect(details.map((d) => d.detail!.masterId)).toEqual([1, 3]);
  });

  it('single (accordion) mode keeps at most one row expanded', () => {
    const seam = makeSeamHarness();
    h = seam.h;
    seam.h.api.use(rowExpanderFeature<Row>({ renderer: () => 'D', single: true }));
    const f = seam.h.api.features.get('rowExpander') as RowExpanderFeature<Row>;
    f.expand(1);
    f.expand(2);
    expect(f.getExpanded()).toEqual([2]);
    expect(f.isExpanded(1)).toBe(false);
  });

  it('expandAll / collapseAll cover every store row', () => {
    const seam = makeSeamHarness();
    h = seam.h;
    seam.h.api.use(rowExpanderFeature<Row>({ renderer: () => 'D' }));
    const f = seam.h.api.features.get('rowExpander') as RowExpanderFeature<Row>;
    f.expandAll();
    expect(f.getExpanded().sort()).toEqual([1, 2, 3]);
    expect(entriesOf(seam.source()).filter((e) => e.kind === 'detail')).toHaveLength(3);
    f.collapseAll();
    expect(f.getExpanded()).toEqual([]);
    expect(seam.source()).toBeNull();
  });

  it('expandAll is a no-op in single mode', () => {
    const seam = makeSeamHarness();
    h = seam.h;
    seam.h.api.use(rowExpanderFeature<Row>({ renderer: () => 'D', single: true }));
    const f = seam.h.api.features.get('rowExpander') as RowExpanderFeature<Row>;
    f.expandAll();
    expect(f.getExpanded()).toEqual([]);
  });
});

describe('RowExpanderFeature — events', () => {
  it('emits rowExpand on expand and collapse', () => {
    const seam = makeSeamHarness();
    h = seam.h;
    const events: Array<{ id: unknown; expanded: boolean }> = [];
    seam.h.api.on('rowExpand' as never, ((e: { id: unknown; expanded: boolean }) =>
      events.push({ id: e.id, expanded: e.expanded })) as never);
    seam.h.api.use(rowExpanderFeature<Row>({ renderer: () => 'D' }));
    const f = seam.h.api.features.get('rowExpander') as RowExpanderFeature<Row>;
    f.expand(1);
    f.collapse(1);
    expect(events).toEqual([
      { id: 1, expanded: true },
      { id: 1, expanded: false },
    ]);
  });

  it('beforeRowExpand veto cancels the expansion', () => {
    const seam = makeSeamHarness();
    h = seam.h;
    seam.h.api.on('beforeRowExpand' as never, (() => false) as never);
    seam.h.api.use(rowExpanderFeature<Row>({ renderer: () => 'D' }));
    const f = seam.h.api.features.get('rowExpander') as RowExpanderFeature<Row>;
    expect(f.expand(1)).toBe(false);
    expect(f.isExpanded(1)).toBe(false);
    expect(seam.source()).toBeNull();
  });

  it('beforeRowCollapse veto keeps the row expanded', () => {
    const seam = makeSeamHarness();
    h = seam.h;
    seam.h.api.use(rowExpanderFeature<Row>({ renderer: () => 'D' }));
    const f = seam.h.api.features.get('rowExpander') as RowExpanderFeature<Row>;
    f.expand(1);
    seam.h.api.on('beforeRowCollapse' as never, (() => false) as never);
    expect(f.collapse(1)).toBe(false);
    expect(f.isExpanded(1)).toBe(true);
  });
});

describe('RowExpanderFeature — expander column + affordance', () => {
  beforeEach(() => {
    h = makeHarness<Row>({ store: makeStore(DATA.map((r) => ({ ...r }))), columns: COLS });
  });

  it('auto-prepends an expander column', () => {
    h.api.use(rowExpanderFeature<Row>({ renderer: () => 'D' }));
    expect(h.api.columns[0]!.id).toBe('__expander');
    expect(h.api.columns).toHaveLength(3);
    // Original columns are preserved after the expander column.
    expect(h.api.columns[1]!.field).toBe('name');
  });

  it('column:false does not inject an expander column', () => {
    h.api.use(rowExpanderFeature<Row>({ renderer: () => 'D', column: false }));
    expect(h.api.columns[0]!.field).toBe('name');
  });

  it('renderExpanderCell builds a wired, accessible toggle', () => {
    const f = h.api.use(rowExpanderFeature<Row>({ renderer: () => 'D' })) as RowExpanderFeature<Row>;
    const btn = f.renderExpanderCell(2);
    expect(btn.tagName).toBe('BUTTON');
    expect(btn.dataset['expanderToggle']).toBe('2');
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(btn.getAttribute('aria-label')).toMatch(/expand/i);
    f.expand(2);
    const btn2 = f.renderExpanderCell(2);
    expect(btn2.getAttribute('aria-expanded')).toBe('true');
    expect(btn2.getAttribute('aria-label')).toMatch(/collapse/i);
  });

  it('a delegated click on the toggle toggles the row', () => {
    const f = h.api.use(rowExpanderFeature<Row>({ renderer: () => 'D' })) as RowExpanderFeature<Row>;
    const btn = f.renderExpanderCell(3);
    h.el.appendChild(btn);
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(f.isExpanded(3)).toBe(true);
  });

  it('Enter/Space on a focused toggle toggles the row', () => {
    const f = h.api.use(rowExpanderFeature<Row>({ renderer: () => 'D' })) as RowExpanderFeature<Row>;
    const btn = f.renderExpanderCell(1);
    h.el.appendChild(btn);
    btn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(f.isExpanded(1)).toBe(true);
    btn.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    expect(f.isExpanded(1)).toBe(false);
  });
});

describe('RowExpanderFeature — renderer + teardown', () => {
  it('the detail render() delegates to the consumer renderer', () => {
    const seam = makeSeamHarness();
    h = seam.h;
    const seen: Array<number> = [];
    seam.h.api.use(
      rowExpanderFeature<Row>({
        renderer: (ctx) => {
          seen.push(ctx.id as number);
          const div = document.createElement('div');
          div.className = 'consumer-detail';
          div.textContent = `Detail of ${ctx.row.name}`;
          return div;
        },
      }),
    );
    const f = seam.h.api.features.get('rowExpander') as RowExpanderFeature<Row>;
    f.expand(2);
    const detail = entriesOf(seam.source()).find((e) => e.kind === 'detail')!;
    const host = document.createElement('div');
    const out = detail.detail!.render(host);
    expect(seen).toEqual([2]);
    expect((out as HTMLElement).className).toBe('consumer-detail');
    expect((out as HTMLElement).textContent).toBe('Detail of Linus');
  });

  it('a string renderer result sets the detail body text', () => {
    const seam = makeSeamHarness();
    h = seam.h;
    seam.h.api.use(rowExpanderFeature<Row>({ renderer: (ctx) => `Age: ${ctx.row.age}` }));
    const f = seam.h.api.features.get('rowExpander') as RowExpanderFeature<Row>;
    f.expand(1);
    const detail = entriesOf(seam.source()).find((e) => e.kind === 'detail')!;
    const host = document.createElement('div');
    const out = detail.detail!.render(host);
    expect(out).toBeUndefined();
    expect(host.textContent).toBe('Age: 36');
  });

  it('destroy() clears state and removes the row source + expander column', () => {
    const seam = makeSeamHarness();
    h = seam.h;
    const f = seam.h.api.use(
      rowExpanderFeature<Row>({ renderer: () => 'D' }),
    ) as RowExpanderFeature<Row>;
    f.expand(1);
    expect(seam.api.columns[0]!.id).toBe('__expander');
    seam.h.api.removeFeature('rowExpander');
    expect(f.getExpanded()).toEqual([]);
    expect(seam.source()).toBeNull();
    // Expander column restored away.
    expect(seam.api.columns[0]!.field).toBe('name');
  });
});
