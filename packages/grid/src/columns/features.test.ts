/** jsdom unit tests — the GridFeature plugins (column / editing / selection+clipboard) over a fake GridApi. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@jects/widgets'; // register editor controls
import { ColumnFeature } from './column-feature.js';
import { EditingFeature } from './editing-feature.js';
import { SelectionFeature } from './selection-feature.js';
import { UndoRedoFeature } from '../features/undo-redo.js';
import { makeFakeApi, makeCellEl } from './test-api.js';
import type { Model } from '@jects/core';
import type { ColumnDef, GridFeature } from '../contract.js';

interface Row extends Model {
  id: number;
  name: string;
  age: number;
  active: boolean;
}

const baseRows = (): Row[] => [
  { id: 1, name: 'Ada', age: 36, active: true },
  { id: 2, name: 'Grace', age: 45, active: false },
  { id: 3, name: 'Linus', age: 30, active: true },
];

const baseCols = (): ColumnDef<Row>[] => [
  { field: 'name', width: 200 },
  { field: 'age', type: 'number', width: 80 },
  { field: 'active', type: 'check', width: 60 },
];

describe('ColumnFeature', () => {
  it('resize emits columnResize and pushes columns back to the engine', () => {
    const { api } = makeFakeApi<Row>({ rows: baseRows(), columns: baseCols() });
    const feat = new ColumnFeature<Row>();
    const spy = vi.fn();
    api.on('columnResize', spy);
    api.use(feat);
    feat.resize('name', 250);
    expect(spy).toHaveBeenCalledWith({ columnId: 'name', width: 250 });
    expect(api.getColumn('name')!.width).toBe(250);
  });

  it('reorder emits columnReorder and reorders the engine columns', () => {
    const { api } = makeFakeApi<Row>({ rows: baseRows(), columns: baseCols() });
    const feat = new ColumnFeature<Row>();
    const spy = vi.fn();
    api.on('columnReorder', spy);
    api.use(feat);
    expect(feat.reorder(0, 2)).toBe(true);
    expect(spy).toHaveBeenCalledWith({ columnId: 'name', fromIndex: 0, toIndex: 2 });
    expect(api.columns.map((c) => c.field)).toEqual(['age', 'active', 'name']);
  });

  it('respects per-column resizable:false / reorderable:false', () => {
    const cols: ColumnDef<Row>[] = [
      { field: 'name', width: 100, resizable: false, reorderable: false },
      { field: 'age', width: 80 },
    ];
    const { api } = makeFakeApi<Row>({ rows: baseRows(), columns: cols });
    const feat = new ColumnFeature<Row>();
    api.use(feat);
    feat.resize('name', 300);
    expect(api.getColumn('name')!.width).toBe(100);
    expect(feat.reorder(0, 1)).toBe(false);
  });

  it('hide/freeze update the layout', () => {
    const { api } = makeFakeApi<Row>({ rows: baseRows(), columns: baseCols() });
    const feat = new ColumnFeature<Row>();
    api.use(feat);
    feat.setHidden('age', true);
    expect(feat.layout(800).all.map((c) => c.id)).toEqual(['name', 'active']);
    feat.setFrozen('name', 'left');
    expect(feat.layout(800).left.map((c) => c.id)).toEqual(['name']);
  });
});

describe('EditingFeature', () => {
  let host: HTMLElement;
  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  it('dblclick starts an edit; commit writes to the store + emits cellEdit', () => {
    const { api, store, el } = makeFakeApi<Row>({ rows: baseRows(), columns: baseCols() });
    host.appendChild(el);
    makeCellEl(el, 0, 0); // cell for row 0, col 0
    const feat = new EditingFeature<Row>({ enabled: true, trigger: 'dblclick' });
    const edited = vi.fn();
    api.on('cellEdit', edited);
    api.use(feat);

    api.emit('cellDblClick', {
      row: store.getAt(0)!,
      column: api.columns[0]!,
      address: { rowIndex: 0, colIndex: 0 },
      event: new MouseEvent('dblclick'),
    });
    expect(feat.isEditing()).toBe(true);

    const input = el.querySelector('input') as HTMLInputElement;
    input.value = 'Adelaide';
    expect(feat.commit()).toBe(true);
    expect(store.getById(1)!.name).toBe('Adelaide');
    expect(edited).toHaveBeenCalledWith(
      expect.objectContaining({ oldValue: 'Ada', value: 'Adelaide' }),
    );
  });

  it('mounts the editor into the visible cell (data-row-index/data-col-index), not a detached div', () => {
    // Regression: cellElFor previously queried `[data-row][data-col]`, which the
    // DomRenderer never sets (it stamps data-row-index/data-col-index). The editor
    // then mounted into a throwaway detached div, so inline editing did nothing
    // on screen. Assert the editor element is the rendered, document-attached cell.
    const { api, store, el } = makeFakeApi<Row>({ rows: baseRows(), columns: baseCols() });
    host.appendChild(el);
    const cell = makeCellEl(el, 0, 0);
    const feat = new EditingFeature<Row>({ enabled: true, trigger: 'dblclick' });
    api.use(feat);

    api.emit('cellDblClick', {
      row: store.getAt(0)!,
      column: api.columns[0]!,
      address: { rowIndex: 0, colIndex: 0 },
      event: new MouseEvent('dblclick'),
    });
    expect(feat.isEditing()).toBe(true);

    const input = el.querySelector('input') as HTMLInputElement;
    expect(input).toBeTruthy();
    // The editor input lives inside the rendered cell, which is attached to the
    // document — never a detached fallback node.
    expect(cell.contains(input)).toBe(true);
    expect(input.isConnected).toBe(true);
    feat.cancel();
  });

  it('beforeCellEdit veto blocks the edit', () => {
    const { api, store } = makeFakeApi<Row>({ rows: baseRows(), columns: baseCols() });
    const feat = new EditingFeature<Row>({ enabled: true });
    api.on('beforeCellEdit', () => false);
    api.use(feat);
    api.emit('cellDblClick', {
      row: store.getAt(0)!,
      column: api.columns[0]!,
      address: { rowIndex: 0, colIndex: 0 },
      event: new MouseEvent('dblclick'),
    });
    expect(feat.isEditing()).toBe(false);
  });

  it('does not edit action/template columns', () => {
    const cols: ColumnDef<Row>[] = [{ type: 'action', meta: { actions: [] } }];
    const { api, store } = makeFakeApi<Row>({ rows: baseRows(), columns: cols });
    const feat = new EditingFeature<Row>({ enabled: true });
    api.use(feat);
    expect(
      feat.start({ rowIndex: 0, colIndex: 0 }),
    ).toBe(false);
    expect(store.getById(1)!.name).toBe('Ada');
  });

  it('destroy cancels any active edit and unsubscribes', () => {
    const { api, el } = makeFakeApi<Row>({ rows: baseRows(), columns: baseCols() });
    makeCellEl(el, 0, 0);
    const feat = new EditingFeature<Row>({ enabled: true });
    api.use(feat);
    feat.start({ rowIndex: 0, colIndex: 0 });
    expect(feat.isEditing()).toBe(true);
    feat.destroy();
    expect(feat.isEditing()).toBe(false);
  });
});

describe('SelectionFeature + clipboard', () => {
  it('cellClick selects a cell and emits selectionChange', () => {
    const { api } = makeFakeApi<Row>({ rows: baseRows(), columns: baseCols() });
    const feat = new SelectionFeature<Row>({ mode: 'range' });
    const change = vi.fn();
    api.on('selectionChange', change);
    api.use(feat);
    api.emit('cellClick', {
      row: api.getRow(1)!,
      column: api.columns[1]!,
      address: { rowIndex: 1, colIndex: 1 },
      event: new MouseEvent('click'),
    });
    expect(feat.getModel().getRect()).toEqual({ top: 1, left: 1, bottom: 1, right: 1 });
    expect(change).toHaveBeenCalled();
  });

  it('shift-click extends the range', () => {
    const { api } = makeFakeApi<Row>({ rows: baseRows(), columns: baseCols() });
    const feat = new SelectionFeature<Row>({ mode: 'range' });
    api.use(feat);
    api.emit('cellClick', {
      row: api.getRow(0)!,
      column: api.columns[0]!,
      address: { rowIndex: 0, colIndex: 0 },
      event: new MouseEvent('click'),
    });
    api.emit('cellClick', {
      row: api.getRow(2)!,
      column: api.columns[1]!,
      address: { rowIndex: 2, colIndex: 1 },
      event: new MouseEvent('click', { shiftKey: true }),
    });
    expect(feat.getModel().getRect()).toEqual({ top: 0, left: 0, bottom: 2, right: 1 });
  });

  it('copy serializes the selection to TSV', () => {
    const { api } = makeFakeApi<Row>({ rows: baseRows(), columns: baseCols() });
    const feat = new SelectionFeature<Row>({ mode: 'range' });
    api.use(feat);
    feat.getModel().selectRange({ rowIndex: 0, colIndex: 0 }, { rowIndex: 1, colIndex: 1 });
    expect(feat.copy()).toBe('Ada\t36\nGrace\t45');
  });

  it('paste writes values back through store.update with type coercion', () => {
    const { api, store } = makeFakeApi<Row>({ rows: baseRows(), columns: baseCols() });
    const feat = new SelectionFeature<Row>({ mode: 'range' });
    api.use(feat);
    feat.getModel().selectCell({ rowIndex: 0, colIndex: 0 });
    feat.paste('Zed\t99');
    expect(store.getById(1)!.name).toBe('Zed');
    expect(store.getById(1)!.age).toBe(99); // coerced to number
  });

  it('a multi-cell paste is ONE undo step when UndoRedoFeature is installed', () => {
    const { api, store } = makeFakeApi<Row>({ rows: baseRows(), columns: baseCols() });
    const undo = new UndoRedoFeature<Row>({ mergeWindow: 0 });
    api.use(undo as unknown as GridFeature<Row>);
    const feat = new SelectionFeature<Row>({ mode: 'range' });
    api.use(feat);

    // Paste a 2x2 block anchored at the top-left so 4 cells get written.
    feat.getModel().selectCell({ rowIndex: 0, colIndex: 0 });
    feat.paste('Zed\t99\nAmy\t21');
    expect(store.getById(1)!.name).toBe('Zed');
    expect(store.getById(2)!.name).toBe('Amy');

    // 4 store.update calls → ONE undo command.
    expect(undo.undoLength).toBe(1);
    expect(undo.peekUndo()).toMatch(/paste/i);

    // One undo reverts the whole paste.
    undo.undo();
    expect(store.getById(1)!.name).toBe('Ada');
    expect(store.getById(1)!.age).toBe(36);
    expect(store.getById(2)!.name).toBe('Grace');
  });
});
