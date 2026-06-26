/**
 * Test harness for @jects/grid feature unit tests (jsdom).
 *
 * Builds a minimal but faithful `GridApi` backed by a *real* `@jects/core`
 * `Store`/`TreeStore`, so feature plugins can be exercised exactly as the engine
 * would drive them — without depending on the engine implementation (which is
 * built in parallel). The harness implements the data/column/event/refresh/
 * feature surface of `GridApi`; viewport and renderer are lightweight stubs.
 */

import { EventEmitter, Store, type Model, type RecordId } from '@jects/core';
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
  ViewportWindow,
} from '../contract.js';

export interface HarnessOptions<Row extends Model> {
  store: Store<Row>;
  columns: ColumnDef<Row>[];
  el?: HTMLElement;
}

export interface FeatureHarness<Row extends Model> {
  api: GridApi<Row>;
  el: HTMLElement;
  /** Count of refresh() calls (proxy for "engine repainted"). */
  refreshCount(): number;
  /** Scroll requests recorded by the viewport stub. */
  scrolledRows(): number[];
  destroy(): void;
}

/** Build a feature harness around a real Store + columns. */
export function makeHarness<Row extends Model>(
  options: HarnessOptions<Row>,
): FeatureHarness<Row> {
  const el = options.el ?? document.createElement('div');
  if (!el.isConnected) document.body.appendChild(el);

  const store = options.store;
  let columns: ColumnDef<Row>[] = options.columns.map((c) => ({ ...c }));
  const emitter = new EventEmitter<GridEvents<Row>>();
  const features = new Map<string, GridFeature<Row>>();
  const disposers: Array<() => void> = [];
  let refreshes = 0;
  const scrolledRows: number[] = [];

  const colId = (c: ColumnDef<Row>): string => c.id ?? c.field ?? '';

  const window0: ViewportWindow = {
    startIndex: 0,
    endIndex: 0,
    offset: 0,
    totalSize: 0,
    columns: [],
    scrollTop: 0,
    scrollLeft: 0,
  };

  const viewport: Viewport = {
    scrollTop: 0,
    scrollLeft: 0,
    height: 400,
    width: 600,
    window: window0,
    scrollToRow: (rowIndex: number) => {
      scrolledRows.push(rowIndex);
    },
    scrollToColumn: () => {},
    scrollTo: () => {},
  };

  const selection = {
    mode: 'none',
    getSelectedIds: () => [],
    getSelectedRows: () => [],
    getSelectedCells: () => [],
    isSelected: () => false,
    select: () => {},
    add: () => {},
    deselect: () => {},
    selectRange: () => {},
    clear: () => {},
  } as unknown as SelectionModel<Row>;

  const editing = {
    active: null as CellAddress | null,
    activeRow: null,
    start: () => {},
    commit: () => true,
    cancel: () => {},
    isEditing: () => false,
  } as unknown as EditSession<Row>;

  const renderer = {
    mount: () => {},
    renderViewport: () => {},
    updateCell: () => {},
    destroy: () => {},
  } as unknown as Renderer<Row>;

  const api: GridApi<Row> = {
    store,
    get columns() {
      return columns;
    },
    viewport,
    selection,
    editing,
    renderer,
    el,
    features,

    getRow: (rowIndex: number) => store.getAt(rowIndex),
    getRowById: (id: RecordId) => store.getById(id),
    getRowIndex: (id: RecordId) => store.indexOf(id),
    getRowCount: () => store.count,

    getColumn: (id: string) => columns.find((c) => colId(c) === id || c.field === id),
    setColumns: (next: ColumnDef<Row>[]) => {
      columns = next.map((c) => ({ ...c }));
      refreshes++;
    },
    updateColumn: (id: string, patch: Partial<ColumnDef<Row>>) => {
      columns = columns.map((c) => (colId(c) === id || c.field === id ? { ...c, ...patch } : c));
      refreshes++;
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
    invalidateLayout: () => {
      refreshes++;
    },

    use: (feature: GridFeature<Row>) => {
      features.set(feature.name, feature);
      feature.init(api);
      return feature;
    },
    removeFeature: (name: string) => {
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

    track: (disposer: () => void) => {
      disposers.push(disposer);
    },
  };

  return {
    api,
    el,
    refreshCount: () => refreshes,
    scrolledRows: () => [...scrolledRows],
    destroy: () => {
      for (const f of [...features.values()]) f.destroy();
      features.clear();
      for (let i = disposers.length - 1; i >= 0; i--) disposers[i]!();
      disposers.length = 0;
      emitter.clear();
      el.remove();
    },
  };
}

/** Build a plain Store from rows. */
export function makeStore<Row extends Model>(rows: Row[], idField = 'id'): Store<Row> {
  return new Store<Row>({ data: rows, idField });
}
