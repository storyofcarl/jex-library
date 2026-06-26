/**
 * jsdom unit tests for SelectionColumnFeature (gap 1: built-in row-selector
 * column) + the `type:'select'` renderer.
 *
 * Exercises the feature over a fake GridApi backed by a real DefaultSelectionModel
 * (multi mode), so header "select all", per-row toggles, indeterminate state, the
 * auto-prepended column, the delegated click wiring, and teardown all run against
 * the same selection model the engine drives.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import '@jects/widgets';
import { EventEmitter, Store, type Model } from '@jects/core';
import { DefaultSelectionModel } from '../engine/selection.js';
import {
  SelectionColumnFeature,
  selectionColumnFeature,
  SELECT_INPUT_CLASS,
} from './selection-column.js';
import { selectRenderer } from '../columns/extra-renderers.js';
import type {
  ColumnDef,
  GridApi,
  GridEvents,
  GridFeature,
  Renderer,
  SelectionMode,
  Viewport,
  EditSession,
} from '../contract.js';

interface Row extends Model {
  id: number;
  name: string;
}

const DATA = (): Row[] => [
  { id: 1, name: 'Ada' },
  { id: 2, name: 'Linus' },
  { id: 3, name: 'Grace' },
];

const COLS: ColumnDef<Row>[] = [
  { field: 'name', header: 'Name', width: 200 },
];

/** A fake GridApi with a REAL multi-mode selection model wired to events. */
function makeApi(mode: SelectionMode = 'multi'): {
  api: GridApi<Row>;
  el: HTMLElement;
  selection: DefaultSelectionModel<Row>;
} {
  const store = new Store<Row>({ data: DATA(), idField: 'id' });
  const emitter = new EventEmitter<GridEvents<Row>>();
  const el = document.createElement('div');
  document.body.appendChild(el);
  let columns: ColumnDef<Row>[] = COLS.map((c) => ({ ...c }));
  const features = new Map<string, GridFeature<Row>>();

  const selection = new DefaultSelectionModel<Row>(mode, {
    getRowById: (id) => store.getById(id),
    onChange: () =>
      emitter.emit('selectionChange', {
        selectedIds: selection.getSelectedIds(),
        cells: selection.getSelectedCells(),
      }),
  });

  const noop = { mount() {}, renderViewport() {}, updateCell() {}, destroy() {} } as unknown as Renderer<Row>;
  const viewport = { scrollToRow() {}, scrollToColumn() {}, scrollTo() {} } as unknown as Viewport;
  const editing = {} as EditSession<Row>;

  const colId = (c: ColumnDef<Row>): string => c.id ?? c.field ?? '';

  const api: GridApi<Row> = {
    store,
    get columns() {
      return columns;
    },
    viewport,
    selection,
    editing,
    renderer: noop,
    el,
    features,
    getRow: (i) => store.getAt(i),
    getRowById: (id) => store.getById(id),
    getRowIndex: (id) => {
      const row = store.getById(id);
      return row ? store.indexOf(row) : -1;
    },
    getRowCount: () => store.count,
    getColumn: (id) => columns.find((c) => colId(c) === id || c.field === id),
    setColumns: (cols) => {
      columns = cols.map((c) => ({ ...c }));
    },
    updateColumn: (id, patch) => {
      columns = columns.map((c) => (colId(c) === id || c.field === id ? { ...c, ...patch } : c));
    },
    refresh: () => {},
    refreshRow: () => {},
    refreshCell: () => {},
    invalidateLayout: () => {},
    use: (feature) => {
      features.set(feature.name, feature);
      feature.init(api);
      return feature;
    },
    removeFeature: (name) => {
      const f = features.get(name);
      if (f) {
        f.destroy();
        features.delete(name);
      }
    },
    on: (event, fn) => emitter.on(event, fn),
    once: (event, fn) => emitter.once(event, fn),
    off: (event, fn) => emitter.off(event, fn),
    emit: (event, payload) => emitter.emit(event, payload),
    track: () => {},
  };

  return { api, el, selection };
}

let cleanup: HTMLElement | null = null;
afterEach(() => {
  cleanup?.remove();
  cleanup = null;
});

describe('SelectionColumnFeature — column + model', () => {
  it('auto-prepends a type:select column', () => {
    const { api, el } = makeApi();
    cleanup = el;
    api.use(selectionColumnFeature<Row>());
    expect(api.columns[0]!.id).toBe('__select');
    expect(api.columns[0]!.type).toBe('select');
    expect(api.columns[0]!.sortable).toBe(false);
    // Original column preserved after the selector.
    expect(api.columns[1]!.field).toBe('name');
  });

  it('column:false does not inject a selector column', () => {
    const { api, el } = makeApi();
    cleanup = el;
    api.use(selectionColumnFeature<Row>({ column: false }));
    expect(api.columns[0]!.field).toBe('name');
  });

  it('toggleRow adds/removes a row in multi mode', () => {
    const { api, el, selection } = makeApi('multi');
    cleanup = el;
    const f = api.use(selectionColumnFeature<Row>()) as SelectionColumnFeature<Row>;
    f.toggleRow(2);
    expect(selection.isSelected(2)).toBe(true);
    f.toggleRow(2);
    expect(selection.isSelected(2)).toBe(false);
  });

  it('toggleRow replaces selection in single mode', () => {
    const { api, el, selection } = makeApi('single');
    cleanup = el;
    const f = api.use(selectionColumnFeature<Row>()) as SelectionColumnFeature<Row>;
    f.toggleRow(1);
    f.toggleRow(2);
    expect(selection.getSelectedIds()).toEqual([2]);
  });

  it('selectAll selects every view row; isAllSelected reflects it', () => {
    const { api, el, selection } = makeApi('multi');
    cleanup = el;
    const f = api.use(selectionColumnFeature<Row>()) as SelectionColumnFeature<Row>;
    expect(f.isAllSelected()).toBe(false);
    f.selectAll();
    expect(selection.getSelectedIds().sort()).toEqual([1, 2, 3]);
    expect(f.isAllSelected()).toBe(true);
    expect(f.isIndeterminate()).toBe(false);
  });

  it('indeterminate is true when some but not all rows are selected', () => {
    const { api, el } = makeApi('multi');
    cleanup = el;
    const f = api.use(selectionColumnFeature<Row>()) as SelectionColumnFeature<Row>;
    f.toggleRow(1);
    expect(f.isIndeterminate()).toBe(true);
    expect(f.isAllSelected()).toBe(false);
  });

  it('deselectAll clears the selection', () => {
    const { api, el, selection } = makeApi('multi');
    cleanup = el;
    const f = api.use(selectionColumnFeature<Row>()) as SelectionColumnFeature<Row>;
    f.selectAll();
    f.deselectAll();
    expect(selection.getSelectedIds()).toEqual([]);
  });
});

describe('SelectionColumnFeature — checkbox affordance + delegated wiring', () => {
  it('a delegated click on a per-row checkbox toggles that row', () => {
    const { api, el, selection } = makeApi('multi');
    cleanup = el;
    const f = api.use(selectionColumnFeature<Row>()) as SelectionColumnFeature<Row>;
    // Render the cell via the feature's column renderer through the shared markup.
    const cell = document.createElement('div');
    (api.columns[0]!.renderer as (ctx: { row: Row; el: HTMLElement; api: GridApi<Row> }) => void)({
      row: api.getRow(1)!,
      el: cell,
      api,
    } as never);
    el.appendChild(cell);
    const input = cell.querySelector<HTMLInputElement>(`.${SELECT_INPUT_CLASS}`)!;
    expect(input.dataset['selectRow']).toBe('2');
    input.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(selection.isSelected(2)).toBe(true);
    void f;
  });

  it('clicking the header "select all" checkbox toggles every row', () => {
    const { api, el, selection } = makeApi('multi');
    cleanup = el;
    const f = api.use(selectionColumnFeature<Row>()) as SelectionColumnFeature<Row>;
    const header = f.renderHeaderCheckbox();
    el.appendChild(header);
    const input = header.querySelector<HTMLInputElement>(`.${SELECT_INPUT_CLASS}`)!;
    expect(input.dataset['selectAll']).toBe('true');
    input.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(selection.getSelectedIds().sort()).toEqual([1, 2, 3]);
  });

  it('header checkbox reflects indeterminate after a partial selection', () => {
    const { api, el } = makeApi('multi');
    cleanup = el;
    const f = api.use(selectionColumnFeature<Row>()) as SelectionColumnFeature<Row>;
    f.toggleRow(3);
    const header = f.renderHeaderCheckbox();
    const input = header.querySelector<HTMLInputElement>(`.${SELECT_INPUT_CLASS}`)!;
    expect(input.indeterminate).toBe(true);
    expect(input.checked).toBe(false);
  });
});

describe('select renderer (type:select, standalone)', () => {
  it('paints a checked checkbox when the row is selected', () => {
    const { api, el, selection } = makeApi('multi');
    cleanup = el;
    selection.select(1);
    const cell = document.createElement('div');
    selectRenderer({ row: api.getRow(0)!, el: cell, api } as never);
    const input = cell.querySelector<HTMLInputElement>(`.${SELECT_INPUT_CLASS}`)!;
    expect(input.checked).toBe(true);
    expect(input.dataset['selectRow']).toBe('1');
  });
});

describe('SelectionColumnFeature — teardown', () => {
  it('removeFeature restores the original columns', () => {
    const { api, el } = makeApi('multi');
    cleanup = el;
    api.use(selectionColumnFeature<Row>());
    expect(api.columns[0]!.id).toBe('__select');
    api.removeFeature('selectionColumn');
    expect(api.columns[0]!.field).toBe('name');
  });

  it('selectionChange repaints (no throw) and syncs header checkbox', () => {
    const { api, el, selection } = makeApi('multi');
    cleanup = el;
    const f = api.use(selectionColumnFeature<Row>()) as SelectionColumnFeature<Row>;
    const header = f.renderHeaderCheckbox();
    el.appendChild(header);
    selection.select([1, 2, 3]);
    const input = header.querySelector<HTMLInputElement>(`.${SELECT_INPUT_CLASS}`)!;
    expect(input.checked).toBe(true);
    expect(input.indeterminate).toBe(false);
  });
});
