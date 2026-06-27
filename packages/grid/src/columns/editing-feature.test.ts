/**
 * jsdom unit tests for EditingFeature ROW editing (gap 7).
 *
 * `editingFeature({ rowEdit: true })` was implemented but untested. These tests
 * exercise the row-edit lifecycle over a fake GridApi + DOM cells:
 *   - multi-editor mount (one editor per editable cell in the row),
 *   - atomic validate-all-then-commit (every editable field writes in one go),
 *   - validation on ANY cell blocks the WHOLE row commit (nothing written),
 *   - cancel restores (no writes, editors torn down),
 *   - a focusable editor is mounted in every editable cell so keyboard (Tab)
 *     can move across the row's cells.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@jects/widgets'; // register editor controls (textfield/numberfield/…)
import { editingFeature, type EditingFeature } from './editing-feature.js';
import { makeFakeApi, makeCellEl } from './test-api.js';
import type { Model } from '@jects/core';
import type { ColumnDef } from '../contract.js';

interface Row extends Model {
  id: number;
  name: string;
  age: number;
  note: string;
}

const baseRows = (): Row[] => [
  { id: 1, name: 'Ada', age: 36, note: 'x' },
  { id: 2, name: 'Linus', age: 54, note: 'y' },
];

/** name + age editable; an `action` column is NOT editable (skipped in row edit). */
const baseCols = (): ColumnDef<Row>[] => [
  { field: 'name', width: 160 },
  { field: 'age', type: 'number', width: 80 },
  { type: 'action', width: 60, meta: { actions: [] } },
];

let host: HTMLElement;
beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});

/** Mount a cell DOM element for every (row, col) the row-edit will touch. */
function mountCells(el: HTMLElement, rowIndex: number, colCount: number): void {
  for (let c = 0; c < colCount; c++) makeCellEl(el, rowIndex, c);
}

describe('EditingFeature — row editing', () => {
  it('startRow mounts an editor in every editable cell (and skips action cols)', () => {
    const { api, el } = makeFakeApi<Row>({ rows: baseRows(), columns: baseCols() });
    host.appendChild(el);
    mountCells(el, 0, 3);
    const feat = api.use(editingFeature<Row>({ rowEdit: true })) as EditingFeature<Row>;

    expect(feat.start({ rowIndex: 0, colIndex: 0 })).toBe(true);
    expect(feat.isEditing()).toBe(true);
    expect(feat.getActiveRowId()).toBe(1);

    // name + age cells get an input; the action cell does NOT.
    const nameCell = el.querySelector('.jects-grid__row[data-row-index="0"] .jects-grid__cell[data-col-index="0"]')!;
    const ageCell = el.querySelector('.jects-grid__row[data-row-index="0"] .jects-grid__cell[data-col-index="1"]')!;
    const actionCell = el.querySelector('.jects-grid__row[data-row-index="0"] .jects-grid__cell[data-col-index="2"]')!;
    expect(nameCell.querySelector('input')).toBeTruthy();
    expect(ageCell.querySelector('input')).toBeTruthy();
    expect(actionCell.querySelector('input')).toBeNull();
    feat.cancel();
  });

  it('every mounted editor is focusable so keyboard can move across cells', () => {
    const { api, el } = makeFakeApi<Row>({ rows: baseRows(), columns: baseCols() });
    host.appendChild(el);
    mountCells(el, 0, 3);
    const feat = api.use(editingFeature<Row>({ rowEdit: true })) as EditingFeature<Row>;
    feat.start({ rowIndex: 0, colIndex: 0 });

    const inputs = el.querySelectorAll<HTMLInputElement>('.jects-grid__row[data-row-index="0"] input');
    // One per editable column (name, age).
    expect(inputs.length).toBe(2);
    // Each is reachable by keyboard (not tabindex=-1), so Tab traverses the row.
    inputs.forEach((i) => expect(i.tabIndex).not.toBe(-1));
    feat.cancel();
  });

  it('commitRow writes every edited cell atomically + emits cellEdit per cell', () => {
    const { api, store, el } = makeFakeApi<Row>({ rows: baseRows(), columns: baseCols() });
    host.appendChild(el);
    mountCells(el, 0, 3);
    const edits = vi.fn();
    api.on('cellEdit', edits);
    const feat = api.use(editingFeature<Row>({ rowEdit: true })) as EditingFeature<Row>;
    feat.start({ rowIndex: 0, colIndex: 0 });

    const nameInput = el.querySelector<HTMLInputElement>('[data-col-index="0"] input')!;
    const ageInput = el.querySelector<HTMLInputElement>('[data-col-index="1"] input')!;
    nameInput.value = 'Adelaide';
    ageInput.value = '37';

    expect(feat.commit()).toBe(true);
    expect(feat.isEditing()).toBe(false);
    // Both fields written in the single row commit.
    expect(store.getById(1)!.name).toBe('Adelaide');
    expect(store.getById(1)!.age).toBe(37);
    // One cellEdit per edited cell.
    expect(edits).toHaveBeenCalledTimes(2);
  });

  it('a validation failure on ANY cell blocks the whole row commit (nothing written)', () => {
    const cols: ColumnDef<Row>[] = [
      { field: 'name', width: 160 },
      {
        field: 'age',
        type: 'number',
        width: 80,
        // Reject any age input → the whole row commit must be blocked.
        meta: { editor: { validate: () => 'Invalid age' } },
      },
    ];
    const { api, store, el } = makeFakeApi<Row>({ rows: baseRows(), columns: cols });
    host.appendChild(el);
    mountCells(el, 0, 2);
    const feat = api.use(editingFeature<Row>({ rowEdit: true })) as EditingFeature<Row>;
    feat.start({ rowIndex: 0, colIndex: 0 });

    const nameInput = el.querySelector<HTMLInputElement>('[data-col-index="0"] input')!;
    nameInput.value = 'Adelaide';

    expect(feat.commit()).toBe(false);
    // Row stays in edit mode; NOTHING was written (atomic).
    expect(feat.isEditing()).toBe(true);
    expect(store.getById(1)!.name).toBe('Ada');
    expect(store.getById(1)!.age).toBe(36);
    feat.cancel();
  });

  it('cancel restores the row (no writes, editors torn down)', () => {
    const { api, store, el } = makeFakeApi<Row>({ rows: baseRows(), columns: baseCols() });
    host.appendChild(el);
    mountCells(el, 0, 3);
    const feat = api.use(editingFeature<Row>({ rowEdit: true })) as EditingFeature<Row>;
    feat.start({ rowIndex: 0, colIndex: 0 });

    const nameInput = el.querySelector<HTMLInputElement>('[data-col-index="0"] input')!;
    nameInput.value = 'Throwaway';

    feat.cancel();
    expect(feat.isEditing()).toBe(false);
    expect(feat.getActiveRowId()).toBeNull();
    expect(store.getById(1)!.name).toBe('Ada');
    // Editors were torn down — no inputs remain in the row.
    expect(el.querySelectorAll('.jects-grid__row[data-row-index="0"] input').length).toBe(0);
  });

  it('beforeCellEdit veto blocks starting the row edit', () => {
    const { api, el } = makeFakeApi<Row>({ rows: baseRows(), columns: baseCols() });
    host.appendChild(el);
    mountCells(el, 0, 3);
    api.on('beforeCellEdit', () => false);
    const feat = api.use(editingFeature<Row>({ rowEdit: true })) as EditingFeature<Row>;
    expect(feat.start({ rowIndex: 0, colIndex: 0 })).toBe(false);
    expect(feat.isEditing()).toBe(false);
  });

  it('starting a new row edit closes the prior one', () => {
    const { api, el } = makeFakeApi<Row>({ rows: baseRows(), columns: baseCols() });
    host.appendChild(el);
    mountCells(el, 0, 3);
    mountCells(el, 1, 3);
    const feat = api.use(editingFeature<Row>({ rowEdit: true })) as EditingFeature<Row>;
    feat.start({ rowIndex: 0, colIndex: 0 });
    expect(feat.getActiveRowId()).toBe(1);
    feat.start({ rowIndex: 1, colIndex: 0 });
    expect(feat.getActiveRowId()).toBe(2);
    // Only the second row's editors remain mounted.
    expect(el.querySelectorAll('.jects-grid__row[data-row-index="0"] input').length).toBe(0);
    expect(el.querySelectorAll('.jects-grid__row[data-row-index="1"] input').length).toBe(2);
    feat.cancel();
  });
});
