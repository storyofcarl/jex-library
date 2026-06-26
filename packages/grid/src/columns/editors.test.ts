/** jsdom unit tests — cell editors (factory-built @jects/widgets controls) + edit lifecycle. */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import '@jects/widgets'; // registers textfield/numberfield/checkbox/select/datepicker
import { isRegistered, type Model } from '@jects/core';
import {
  WidgetCellEditor,
  EditController,
  controlForColumn,
  resolveEditor,
} from './editors.js';
import type { CellEditContext, ColumnDef, GridApi } from '../contract.js';

interface Row extends Model {
  id: number;
  name: string;
  age: number;
  active: boolean;
}

function editCtx<Row extends Model>(
  column: ColumnDef<Row>,
  value: unknown,
  row: Row,
): CellEditContext<Row> {
  return {
    row,
    value,
    column,
    rowIndex: 0,
    colIndex: 0,
    el: document.createElement('div'),
    api: {} as GridApi<Row>,
  };
}

beforeAll(() => {
  // sanity: widgets registered themselves on import
  expect(isRegistered('textfield')).toBe(true);
});

describe('controlForColumn mapping', () => {
  it('maps types to controls', () => {
    expect(controlForColumn({ field: 'name' })).toBe('textfield');
    expect(controlForColumn({ field: 'age', type: 'number' })).toBe('numberfield');
    expect(controlForColumn({ field: 'd', type: 'date' })).toBe('datepicker');
    expect(controlForColumn({ field: 'b', type: 'check' })).toBe('checkbox');
    expect(controlForColumn({ field: 's', meta: { editor: { options: [] } } })).toBe('select');
    expect(controlForColumn({ field: 'x', meta: { editor: { control: 'numberfield' } } })).toBe(
      'numberfield',
    );
  });
});

describe('WidgetCellEditor', () => {
  it('mounts a TextField and reads the edited value', () => {
    const ed = new WidgetCellEditor<Row>('textfield');
    const ctx = editCtx<Row>({ field: 'name' }, 'Ada', { id: 1, name: 'Ada', age: 1, active: true });
    ed.mount(ctx);
    const input = ctx.el.querySelector('input') as HTMLInputElement;
    expect(input.value).toBe('Ada');
    input.value = 'Grace';
    expect(ed.getValue()).toBe('Grace');
    ed.destroy();
    expect(ctx.el.querySelector('input')).toBeNull(); // destroyed
  });

  it('NumberField editor coerces to a number', () => {
    const ed = new WidgetCellEditor<Row>('numberfield');
    const ctx = editCtx<Row>({ field: 'age', type: 'number' }, 30, { id: 1, name: 'A', age: 30, active: true });
    ed.mount(ctx);
    const input = ctx.el.querySelector('input') as HTMLInputElement;
    input.value = '42';
    expect(ed.getValue()).toBe(42);
    ed.destroy();
  });

  it('Checkbox editor reads boolean', () => {
    const ed = new WidgetCellEditor<Row>('checkbox');
    const ctx = editCtx<Row>({ field: 'active', type: 'check' }, false, { id: 1, name: 'A', age: 1, active: false });
    ed.mount(ctx);
    const input = ctx.el.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(input.checked).toBe(false);
    input.checked = true;
    expect(ed.getValue()).toBe(true);
    ed.destroy();
  });

  it('per-column validate blocks invalid values', () => {
    const column: ColumnDef<Row> = {
      field: 'name',
      meta: { editor: { validate: (v: unknown) => (String(v).length > 0 ? true : 'required') } },
    };
    const ed = resolveEditor(column);
    const ctx = editCtx<Row>(column, '', { id: 1, name: '', age: 1, active: true });
    ed.mount(ctx);
    expect(ed.validate?.()).toBe('required');
    (ctx.el.querySelector('input') as HTMLInputElement).value = 'ok';
    expect(ed.validate?.()).toBe(true);
    ed.destroy();
  });
});

describe('EditController lifecycle', () => {
  const row: Row = { id: 1, name: 'Ada', age: 1, active: true };

  it('start → commit writes via the writer and fires committed', () => {
    const write = vi.fn();
    const committed = vi.fn();
    const ctrl = new EditController<Row>({ write, committed });
    const ctx = editCtx<Row>({ field: 'name' }, 'Ada', row);
    expect(ctrl.start(ctx)).toBe(true);
    expect(ctrl.isEditing()).toBe(true);
    (ctx.el.querySelector('input') as HTMLInputElement).value = 'Grace';
    expect(ctrl.commit()).toBe(true);
    expect(write).toHaveBeenCalledWith(expect.objectContaining({ value: 'Grace' }));
    expect(committed).toHaveBeenCalledWith(
      expect.objectContaining({ oldValue: 'Ada', value: 'Grace' }),
    );
    expect(ctrl.isEditing()).toBe(false);
  });

  it('beforeStart veto blocks the edit', () => {
    const ctrl = new EditController<Row>({ beforeStart: () => false });
    expect(ctrl.start(editCtx<Row>({ field: 'name' }, 'x', row))).toBe(false);
    expect(ctrl.isEditing()).toBe(false);
  });

  it('validation failure keeps the edit open and fires invalid', () => {
    const invalid = vi.fn();
    const ctrl = new EditController<Row>({ invalid });
    const column: ColumnDef<Row> = {
      field: 'name',
      meta: { editor: { validate: () => 'bad' } },
    };
    ctrl.start(editCtx<Row>(column, '', row));
    expect(ctrl.commit()).toBe(false);
    expect(invalid).toHaveBeenCalledWith(expect.objectContaining({ message: 'bad' }));
    expect(ctrl.isEditing()).toBe(true);
    ctrl.cancel();
  });

  it('beforeCommit veto keeps the edit open and does not write', () => {
    const write = vi.fn();
    const ctrl = new EditController<Row>({ write, beforeCommit: () => false });
    ctrl.start(editCtx<Row>({ field: 'name' }, 'x', row));
    expect(ctrl.commit()).toBe(false);
    expect(write).not.toHaveBeenCalled();
    expect(ctrl.isEditing()).toBe(true);
    ctrl.cancel();
  });

  it('cancel tears down without writing and fires cancelled', () => {
    const write = vi.fn();
    const cancelled = vi.fn();
    const ctrl = new EditController<Row>({ write, cancelled });
    const ctx = editCtx<Row>({ field: 'name' }, 'x', row);
    ctrl.start(ctx);
    ctrl.cancel();
    expect(write).not.toHaveBeenCalled();
    expect(cancelled).toHaveBeenCalled();
    expect(ctx.el.querySelector('input')).toBeNull();
  });

  it('starting a new edit commits the previous one', () => {
    const write = vi.fn();
    const ctrl = new EditController<Row>({ write });
    const a = editCtx<Row>({ field: 'name' }, 'A', row);
    ctrl.start(a);
    (a.el.querySelector('input') as HTMLInputElement).value = 'A2';
    ctrl.start(editCtx<Row>({ field: 'name' }, 'B', row));
    expect(write).toHaveBeenCalledWith(expect.objectContaining({ value: 'A2' }));
    ctrl.destroy();
  });
});
