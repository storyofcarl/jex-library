/** jsdom unit tests for CellMenuFeature + HeaderMenuFeature (reuse widgets Menu). */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ColumnDef } from '../contract.js';
import { CellMenuFeature, HeaderMenuFeature } from './context-menus.js';
import { SortFeature } from './sort.js';
import { GroupFeature } from './group.js';
import { makeHarness, makeStore, type FeatureHarness } from './test-harness.js';

interface Row {
  id: number;
  name: string;
  amount: number;
}

const ROWS: Row[] = [
  { id: 1, name: 'Alice', amount: 10 },
  { id: 2, name: 'Bob', amount: 20 },
];

const COLUMNS: ColumnDef<Row>[] = [
  { field: 'name', header: 'Name', id: 'name', sortable: true },
  { field: 'amount', header: 'Amount', id: 'amount', type: 'number', sortable: true },
];

let h: FeatureHarness<Row>;
beforeEach(() => {
  h = makeHarness<Row>({ store: makeStore(ROWS), columns: COLUMNS });
});
afterEach(() => h.destroy());

describe('CellMenuFeature (jsdom)', () => {
  it('opens a Menu popup at a position with provided items', () => {
    const f = h.api.use(
      new CellMenuFeature<Row>({
        items: [{ id: 'copy', text: 'Copy' }],
      }),
    ) as CellMenuFeature<Row>;
    f.openAt({ rowIndex: 0, colIndex: 0 }, 50, 60);
    const popup = h.el.querySelector('.jects-grid-menu-popup') as HTMLElement;
    expect(popup).toBeTruthy();
    expect(popup.querySelector('.jects-menu')).toBeTruthy();
    expect(popup.textContent).toContain('Copy');
  });

  it('builds items per-cell from a provider with the row context', () => {
    const provider = vi.fn(() => [{ id: 'x', text: 'X' }]);
    const f = h.api.use(new CellMenuFeature<Row>({ items: provider })) as CellMenuFeature<Row>;
    f.openAt({ rowIndex: 1, colIndex: 0 }, 0, 0);
    expect(provider).toHaveBeenCalledTimes(1);
    expect(provider.mock.calls[0]![0].row.id).toBe(2);
  });

  it('invokes onSelect when a menu item is chosen', () => {
    const onSelect = vi.fn();
    const f = h.api.use(
      new CellMenuFeature<Row>({ items: [{ id: 'del', text: 'Delete' }], onSelect }),
    ) as CellMenuFeature<Row>;
    f.openAt({ rowIndex: 0, colIndex: 0 }, 0, 0);
    const item = h.el.querySelector<HTMLElement>('.jects-menu__item[data-id="del"]')!;
    item.click();
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0]![0]).toBe('del');
  });

  it('opens on a body cell contextmenu event', () => {
    h.api.use(new CellMenuFeature<Row>({ items: [{ id: 'a', text: 'A' }] }));
    const cell = document.createElement('div');
    cell.setAttribute('data-row-index', '0');
    cell.setAttribute('data-col-index', '1');
    h.el.appendChild(cell);
    cell.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 5, clientY: 5 }));
    expect(h.el.querySelector('.jects-grid-menu-popup')).toBeTruthy();
  });

  it('destroy removes any open popup and listeners', () => {
    const f = h.api.use(new CellMenuFeature<Row>({ items: [{ id: 'a', text: 'A' }] })) as CellMenuFeature<Row>;
    f.openAt({ rowIndex: 0, colIndex: 0 }, 0, 0);
    h.api.removeFeature('cellMenu');
    expect(h.el.querySelector('.jects-grid-menu-popup')).toBeNull();
  });
});

describe('HeaderMenuFeature (jsdom)', () => {
  it('derives default items from installed Sort/Group features', () => {
    h.api.use(new SortFeature<Row>());
    h.api.use(new GroupFeature<Row>());
    const f = h.api.use(new HeaderMenuFeature<Row>()) as HeaderMenuFeature<Row>;
    f.openFor('name', 0, 0);
    const popup = h.el.querySelector('.jects-grid-menu-popup')!;
    expect(popup.textContent).toContain('Sort ascending');
    expect(popup.textContent).toContain('Group by this column');
  });

  it('sort-asc item drives the SortFeature', () => {
    const sort = h.api.use(new SortFeature<Row>()) as SortFeature<Row>;
    const f = h.api.use(new HeaderMenuFeature<Row>()) as HeaderMenuFeature<Row>;
    f.openFor('amount', 0, 0);
    const item = h.el.querySelector<HTMLElement>('.jects-menu__item[data-id="sort-asc"]')!;
    item.click();
    expect(sort.directionOf('amount')).toBe('asc');
  });

  it('group item drives the GroupFeature', () => {
    const group = h.api.use(new GroupFeature<Row>()) as GroupFeature<Row>;
    const f = h.api.use(new HeaderMenuFeature<Row>()) as HeaderMenuFeature<Row>;
    f.openFor('name', 0, 0);
    h.el.querySelector<HTMLElement>('.jects-menu__item[data-id="group"]')!.click();
    expect(group.getColumns()).toEqual(['name']);
  });

  it('opens via a header contextmenu carrying data-header-col', () => {
    h.api.use(new SortFeature<Row>());
    h.api.use(new HeaderMenuFeature<Row>({ openOnContextMenu: true }));
    const header = document.createElement('div');
    header.setAttribute('data-header-col', 'name');
    h.el.appendChild(header);
    header.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 1, clientY: 1 }));
    expect(h.el.querySelector('.jects-grid-menu-popup')).toBeTruthy();
  });

  it('custom items override the defaults', () => {
    const onSelect = vi.fn();
    const f = h.api.use(
      new HeaderMenuFeature<Row>({ items: [{ id: 'pin', text: 'Pin column' }], onSelect }),
    ) as HeaderMenuFeature<Row>;
    f.openFor('name', 0, 0);
    expect(h.el.querySelector('.jects-grid-menu-popup')!.textContent).toContain('Pin column');
    h.el.querySelector<HTMLElement>('.jects-menu__item[data-id="pin"]')!.click();
    expect(onSelect).toHaveBeenCalledWith('pin', expect.anything(), expect.anything());
  });
});
