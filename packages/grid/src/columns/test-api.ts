/**
 * Test-only fake `GridApi` over a real @jects/core `Store`. Implements just
 * enough of the contract surface for the columns modules' jsdom unit tests:
 * data access, columns, events (via a real EventEmitter), and no-op rendering.
 *
 * NOT exported from the package barrel — imported only by *.test.ts files.
 */

import { Store, EventEmitter, type Model, type RecordId } from '@jects/core';
import type {
  CellAddress,
  ColumnDef,
  GridApi,
  GridEvents,
  GridFeature,
  Renderer,
  SelectionModel,
  EditSession,
  Viewport,
} from '../contract.js';

export interface FakeApiOptions<Row extends Model> {
  rows: Row[];
  columns: ColumnDef<Row>[];
  idField?: string;
}

/** A minimal GridApi backed by a real Store + EventEmitter. */
export function makeFakeApi<Row extends Model>(opts: FakeApiOptions<Row>): {
  api: GridApi<Row>;
  store: Store<Row>;
  emitter: EventEmitter<GridEvents<Row>>;
  el: HTMLElement;
  refreshCount: () => number;
} {
  const idField = opts.idField ?? 'id';
  const store = new Store<Row>({ data: opts.rows, idField });
  const emitter = new EventEmitter<GridEvents<Row>>();
  const el = document.createElement('div');
  let columns: ColumnDef<Row>[] = [...opts.columns];
  let refreshes = 0;

  const noopRenderer: Renderer<Row> = {
    mount: () => {},
    renderViewport: () => {},
    updateCell: () => {},
    destroy: () => {},
  };

  const viewport = {
    scrollTop: 0,
    scrollLeft: 0,
    height: 400,
    width: 600,
    window: {
      startIndex: 0,
      endIndex: store.count,
      offset: 0,
      totalSize: store.count * 32,
      columns,
      scrollTop: 0,
      scrollLeft: 0,
    },
    scrollToRow: () => {},
    scrollToColumn: () => {},
    scrollTo: () => {},
  } as unknown as Viewport;

  // Placeholder selection/editing — features install their own; tests that need
  // them use the feature's model directly.
  const selection = {} as SelectionModel<Row>;
  const editing = {} as EditSession<Row>;
  const features = new Map<string, GridFeature<Row>>();

  const api: GridApi<Row> = {
    store,
    get columns() {
      return columns;
    },
    viewport,
    selection,
    editing,
    renderer: noopRenderer,
    el,
    features,

    getRow: (i) => store.getAt(i),
    getRowById: (id) => store.getById(id),
    getRowIndex: (id) => {
      const row = store.getById(id);
      return row ? store.indexOf(row) : -1;
    },
    getRowCount: () => store.count,

    getColumn: (id) =>
      columns.find((c, i) => (c.id ?? (c.field as string) ?? `col-${i}`) === id),
    setColumns: (cols) => {
      columns = [...cols];
    },
    updateColumn: (id, patch) => {
      const i = columns.findIndex(
        (c, idx) => (c.id ?? (c.field as string) ?? `col-${idx}`) === id,
      );
      if (i >= 0) columns[i] = { ...columns[i]!, ...patch };
    },

    refresh: () => {
      refreshes++;
    },
    refreshRow: () => {
      refreshes++;
    },
    refreshCell: () => {
      refreshes++;
    },
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

  return { api, store, emitter, el, refreshCount: () => refreshes };
}

/**
 * Build a cell DOM element matching the production `DomRenderer` contract: a
 * `.jects-grid__row[data-row-index]` wrapper containing a
 * `.jects-grid__cell[data-col-index]`. This mirrors what `DomRenderer.paintRow`/
 * `paintCell` stamp, so `EditingFeature.cellElFor` (and `Grid.resolveCell`)
 * resolve the cell with the same selector the real renderer satisfies.
 */
export function makeCellEl(
  host: HTMLElement,
  rowIndex: number,
  colIndex: number,
): HTMLElement {
  let row = host.querySelector<HTMLElement>(
    `.jects-grid__row[data-row-index="${rowIndex}"]`,
  );
  if (!row) {
    row = document.createElement('div');
    row.className = 'jects-grid__row';
    row.setAttribute('data-row-index', String(rowIndex));
    host.appendChild(row);
  }
  const el = document.createElement('div');
  el.className = 'jects-grid__cell';
  el.setAttribute('data-col-index', String(colIndex));
  row.appendChild(el);
  return el;
}

export type { CellAddress, RecordId };
