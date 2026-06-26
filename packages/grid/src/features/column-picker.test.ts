/** jsdom unit tests for ColumnPickerFeature (reuses @jects/widgets Checkbox). */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ColumnDef } from '../contract.js';
import { ColumnPickerFeature } from './column-picker.js';
import { ColumnStateFeature } from './column-state.js';
import { makeHarness, makeStore, type FeatureHarness } from './test-harness.js';

interface Row {
  id: number;
  name: string;
  amount: number;
  city: string;
}

const ROWS: Row[] = [
  { id: 1, name: 'Alice', amount: 10, city: 'NYC' },
  { id: 2, name: 'Bob', amount: 20, city: 'LA' },
];

function cols(): ColumnDef<Row>[] {
  return [
    { field: 'name', header: 'Name', id: 'name' },
    { field: 'amount', header: 'Amount', id: 'amount', type: 'number' },
    { field: 'city', header: 'City', id: 'city' },
  ];
}

let h: FeatureHarness<Row>;
beforeEach(() => {
  h = makeHarness<Row>({ store: makeStore(ROWS), columns: cols() });
});
afterEach(() => h.destroy());

function panel(): HTMLElement | null {
  return h.el.querySelector('.jects-grid-colpicker');
}

describe('ColumnPickerFeature — panel + visibility', () => {
  it('opens a panel listing every column with a labelled checkbox', () => {
    const f = h.api.use(new ColumnPickerFeature<Row>()) as ColumnPickerFeature<Row>;
    f.open(10, 10);
    const p = panel()!;
    expect(p).toBeTruthy();
    expect(p.getAttribute('role')).toBe('dialog');
    const rows = p.querySelectorAll('.jects-grid-colpicker__row');
    expect(rows.length).toBe(3);
    expect(p.textContent).toContain('Name');
    expect(p.textContent).toContain('Amount');
    expect(p.textContent).toContain('City');
    // Each row hosts a real Checkbox widget.
    expect(p.querySelectorAll('.jects-checkbox').length).toBe(3);
  });

  it('reflects current hidden state in checkbox checked state', () => {
    h.api.updateColumn('city', { hidden: true } as Partial<ColumnDef<Row>>);
    const f = h.api.use(new ColumnPickerFeature<Row>()) as ColumnPickerFeature<Row>;
    f.open();
    const cityRow = panel()!.querySelector('[data-column-id="city"]')!;
    const input = cityRow.querySelector<HTMLInputElement>('.jects-checkbox__input')!;
    expect(input.checked).toBe(false);
    const nameRow = panel()!.querySelector('[data-column-id="name"]')!;
    expect(nameRow.querySelector<HTMLInputElement>('.jects-checkbox__input')!.checked).toBe(true);
  });

  it('toggling a checkbox hides/shows the column via the GridApi', () => {
    const f = h.api.use(new ColumnPickerFeature<Row>()) as ColumnPickerFeature<Row>;
    f.open();
    const input = panel()!
      .querySelector('[data-column-id="amount"]')!
      .querySelector<HTMLInputElement>('.jects-checkbox__input')!;
    input.click(); // uncheck → hide
    expect(h.api.getColumn('amount')!.hidden).toBe(true);
    input.click(); // re-check → show
    expect(h.api.getColumn('amount')!.hidden).toBe(false);
  });

  it('emits beforeColumnVisibility (vetoable) and columnVisibility', () => {
    const f = h.api.use(new ColumnPickerFeature<Row>()) as ColumnPickerFeature<Row>;
    const before = vi.fn();
    const after = vi.fn();
    f.on('beforeColumnVisibility', before);
    f.on('columnVisibility', after);
    f.setColumnVisible('city', false);
    expect(before).toHaveBeenCalledWith({ columnId: 'city', visible: false });
    expect(after).toHaveBeenCalledWith({ columnId: 'city', visible: false });
    expect(h.api.getColumn('city')!.hidden).toBe(true);
  });

  it('a false return from beforeColumnVisibility vetoes the change', () => {
    const f = h.api.use(new ColumnPickerFeature<Row>()) as ColumnPickerFeature<Row>;
    f.on('beforeColumnVisibility', () => false);
    const ok = f.setColumnVisible('name', false);
    expect(ok).toBe(false);
    expect(h.api.getColumn('name')!.hidden).toBeFalsy();
  });

  it('keepOneVisible refuses to hide the last visible column', () => {
    const f = h.api.use(
      new ColumnPickerFeature<Row>({ keepOneVisible: true }),
    ) as ColumnPickerFeature<Row>;
    f.setColumnVisible('amount', false);
    f.setColumnVisible('city', false);
    // One left visible; this must be refused.
    expect(f.setColumnVisible('name', false)).toBe(false);
    expect(h.api.getColumn('name')!.hidden).toBeFalsy();
  });
});

describe('ColumnPickerFeature — reorder + pin', () => {
  it('moveColumn reorders columns and emits columnMove', () => {
    const f = h.api.use(new ColumnPickerFeature<Row>()) as ColumnPickerFeature<Row>;
    const moved = vi.fn();
    f.on('columnMove', moved);
    f.moveColumn('city', -1); // city: index 2 → 1
    expect(h.api.columns.map((c) => c.id)).toEqual(['name', 'city', 'amount']);
    expect(moved).toHaveBeenCalledWith({ columnId: 'city', fromIndex: 2, toIndex: 1 });
  });

  it('moveColumn is a no-op at the boundaries', () => {
    const f = h.api.use(new ColumnPickerFeature<Row>()) as ColumnPickerFeature<Row>;
    f.moveColumn('name', -1);
    expect(h.api.columns.map((c) => c.id)).toEqual(['name', 'amount', 'city']);
    f.moveColumn('city', 1);
    expect(h.api.columns.map((c) => c.id)).toEqual(['name', 'amount', 'city']);
  });

  it('setColumnFrozen pins/unpins and emits columnPin', () => {
    const f = h.api.use(new ColumnPickerFeature<Row>()) as ColumnPickerFeature<Row>;
    const pinned = vi.fn();
    f.on('columnPin', pinned);
    f.setColumnFrozen('name', 'left');
    expect(h.api.getColumn('name')!.frozen).toBe('left');
    expect(pinned).toHaveBeenCalledWith({ columnId: 'name', frozen: 'left' });
    f.setColumnFrozen('name', null);
    expect(h.api.getColumn('name')!.frozen).toBeUndefined();
  });

  it('the pin button cycles none → left → right → none', () => {
    const f = h.api.use(new ColumnPickerFeature<Row>()) as ColumnPickerFeature<Row>;
    f.open();
    const pinBtn = () =>
      panel()!
        .querySelector('[data-column-id="name"]')!
        .querySelector<HTMLButtonElement>('.jects-grid-colpicker__pin')!;
    pinBtn().click();
    expect(h.api.getColumn('name')!.frozen).toBe('left');
    pinBtn().click();
    expect(h.api.getColumn('name')!.frozen).toBe('right');
    pinBtn().click();
    expect(h.api.getColumn('name')!.frozen).toBeUndefined();
  });

  it('reorder buttons drive moveColumn from the panel', () => {
    const f = h.api.use(new ColumnPickerFeature<Row>()) as ColumnPickerFeature<Row>;
    f.open();
    const down = panel()!
      .querySelector('[data-column-id="name"]')!
      .querySelectorAll<HTMLButtonElement>('.jects-grid-colpicker__btn');
    // [pin, up, down] — last is "down".
    down[down.length - 1]!.click();
    expect(h.api.columns.map((c) => c.id)).toEqual(['amount', 'name', 'city']);
  });
});

describe('ColumnPickerFeature — bulk actions + locking', () => {
  it('Hide all hides everything but one (keepOneVisible)', () => {
    const f = h.api.use(
      new ColumnPickerFeature<Row>({ keepOneVisible: true }),
    ) as ColumnPickerFeature<Row>;
    f.setAllVisible(false);
    const visible = h.api.columns.filter((c) => !c.hidden);
    expect(visible.length).toBe(1);
  });

  it('Show all reveals every hidden column', () => {
    h.api.updateColumn('amount', { hidden: true } as Partial<ColumnDef<Row>>);
    h.api.updateColumn('city', { hidden: true } as Partial<ColumnDef<Row>>);
    const f = h.api.use(new ColumnPickerFeature<Row>()) as ColumnPickerFeature<Row>;
    f.setAllVisible(true);
    expect(h.api.columns.every((c) => !c.hidden)).toBe(true);
  });

  it('locked columns cannot be hidden, moved, or pinned', () => {
    const f = h.api.use(
      new ColumnPickerFeature<Row>({ lockedColumns: ['name'] }),
    ) as ColumnPickerFeature<Row>;
    expect(f.setColumnVisible('name', false)).toBe(false);
    f.moveColumn('name', 1);
    f.setColumnFrozen('name', 'left');
    expect(h.api.getColumn('name')!.hidden).toBeFalsy();
    expect(h.api.columns.map((c) => c.id)).toEqual(['name', 'amount', 'city']);
    expect(h.api.getColumn('name')!.frozen).toBeUndefined();
  });

  it('disables the checkbox for a locked column in the panel', () => {
    const f = h.api.use(
      new ColumnPickerFeature<Row>({ lockedColumns: ['name'] }),
    ) as ColumnPickerFeature<Row>;
    f.open();
    const input = panel()!
      .querySelector('[data-column-id="name"]')!
      .querySelector<HTMLInputElement>('.jects-checkbox__input')!;
    expect(input.disabled).toBe(true);
  });
});

describe('ColumnPickerFeature — ColumnState integration', () => {
  it('routes visibility through an installed ColumnStateFeature', () => {
    const state = h.api.use(new ColumnStateFeature<Row>()) as ColumnStateFeature<Row>;
    const spy = vi.spyOn(state, 'setVisible');
    const f = h.api.use(new ColumnPickerFeature<Row>()) as ColumnPickerFeature<Row>;
    f.setColumnVisible('city', false);
    expect(spy).toHaveBeenCalledWith('city', false);
    expect(h.api.getColumn('city')!.hidden).toBe(true);
  });

  it('reorder emits columnReorder so ColumnState can persist it', () => {
    h.api.use(new ColumnStateFeature<Row>());
    const reorder = vi.fn();
    h.api.on('columnReorder', reorder);
    const f = h.api.use(new ColumnPickerFeature<Row>()) as ColumnPickerFeature<Row>;
    f.moveColumn('city', -1);
    // Full-model reorder pushed through setColumns + a columnReorder notification
    // (ColumnState listens to columnReorder to schedule persistence).
    expect(reorder).toHaveBeenCalledWith({ columnId: 'city', fromIndex: 2, toIndex: 1 });
    expect(h.api.columns.map((c) => c.id)).toEqual(['name', 'city', 'amount']);
  });
});

describe('ColumnPickerFeature — trigger, toggle, lifecycle', () => {
  it('toggle opens then closes', () => {
    const f = h.api.use(new ColumnPickerFeature<Row>()) as ColumnPickerFeature<Row>;
    expect(f.isOpen()).toBe(false);
    f.toggle();
    expect(f.isOpen()).toBe(true);
    f.toggle();
    expect(f.isOpen()).toBe(false);
  });

  it('a header trigger [data-column-picker] toggles the panel', () => {
    h.api.use(new ColumnPickerFeature<Row>());
    const trigger = document.createElement('button');
    trigger.setAttribute('data-column-picker', '');
    h.el.appendChild(trigger);
    trigger.click();
    expect(panel()).toBeTruthy();
    trigger.click();
    expect(panel()).toBeNull();
  });

  it('emits pickerOpen and pickerClose', () => {
    const f = h.api.use(new ColumnPickerFeature<Row>()) as ColumnPickerFeature<Row>;
    const open = vi.fn();
    const close = vi.fn();
    f.on('pickerOpen', open);
    f.on('pickerClose', close);
    f.open();
    f.close();
    expect(open).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('Escape closes the panel', async () => {
    const f = h.api.use(new ColumnPickerFeature<Row>()) as ColumnPickerFeature<Row>;
    f.open();
    // Dismiss listeners are installed on a deferred timer (to avoid catching the
    // opening click); flush it before dispatching.
    await new Promise((r) => setTimeout(r, 0));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(f.isOpen()).toBe(false);
  });

  it('destroy removes the open panel and all Checkbox widgets', () => {
    const f = h.api.use(new ColumnPickerFeature<Row>()) as ColumnPickerFeature<Row>;
    f.open();
    expect(panel()).toBeTruthy();
    h.api.removeFeature('columnPicker');
    expect(panel()).toBeNull();
  });
});
