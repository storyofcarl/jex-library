/**
 * CellMenuFeature + HeaderMenuFeature — context menus for @jects/grid that
 * reuse the @jects/widgets `Menu` component.
 *
 * - `CellMenuFeature` opens a popup `Menu` on right-click (contextmenu) over a
 *   body cell. Item sets can be static or built per-cell via a provider that
 *   receives the row/column/address.
 * - `HeaderMenuFeature` opens a `Menu` from a header (click on a trigger or
 *   contextmenu). Items typically drive Sort/Filter/Group/Column features, so a
 *   default item set is derived from the installed features when no provider is
 *   given.
 *
 * Both mount the `Menu` into a positioned popup element appended to the grid
 * root, wire its `select`/`dismiss` events, close on outside-click / Escape, and
 * tear everything down on `destroy()`. All interaction goes through `GridApi`.
 */

import type { Model } from '@jects/core';
import { createEl } from '@jects/core';
import { Menu, type MenuItem } from '@jects/widgets';
import type { CellAddress, ColumnDef, GridApi, GridFeature } from '../contract.js';
import { Disposers, colId } from './shared.js';
import type { SortFeature } from './sort.js';
import type { FilterFeature } from './filter.js';
import type { GroupFeature } from './group.js';
import type { ColumnStateFeature } from './column-state.js';

/** Context handed to a cell-menu item provider. */
export interface CellMenuContext<Row extends Model> {
  row: Row;
  column: ColumnDef<Row>;
  address: CellAddress;
  api: GridApi<Row>;
}

/** Context handed to a header-menu item provider. */
export interface HeaderMenuContext<Row extends Model> {
  column: ColumnDef<Row>;
  api: GridApi<Row>;
}

export interface CellMenuFeatureOptions<Row extends Model = Model> {
  /** Build the menu items for a given cell. */
  items: MenuItem[] | ((ctx: CellMenuContext<Row>) => MenuItem[]);
  /** Called when an item is selected. */
  onSelect?: (id: string, item: MenuItem, ctx: CellMenuContext<Row>) => void;
}

export interface HeaderMenuFeatureOptions<Row extends Model = Model> {
  /** Build the menu items for a given header (defaults to feature-derived). */
  items?: MenuItem[] | ((ctx: HeaderMenuContext<Row>) => MenuItem[]);
  /** Called when an item is selected. */
  onSelect?: (id: string, item: MenuItem, ctx: HeaderMenuContext<Row>) => void;
  /** Open on header contextmenu (right-click) in addition to trigger clicks. */
  openOnContextMenu?: boolean;
}

/** Shared popup host + Menu plumbing for both context-menu features. */
class MenuPopup<Row extends Model> {
  private popup: HTMLElement | null = null;
  private menu: Menu | null = null;
  private outside: ((e: Event) => void) | null = null;

  constructor(private readonly api: GridApi<Row>) {}

  open(
    items: MenuItem[],
    x: number,
    y: number,
    onSelect: (id: string, item: MenuItem) => void,
  ): void {
    this.close();
    const popup = createEl('div', { className: 'jects-grid-menu-popup' });
    popup.style.position = 'fixed';
    popup.style.left = `${x}px`;
    popup.style.top = `${y}px`;
    this.api.el.appendChild(popup);
    this.popup = popup;

    const menu = new Menu(popup, { items, label: 'Grid menu' });
    this.menu = menu;
    menu.on('select', ({ id, item }) => {
      onSelect(id, item);
      this.close();
    });
    menu.on('dismiss', () => this.close());
    menu.focusFirst();

    // Outside click / Escape closes.
    const outside = (e: Event): void => {
      if (e.type === 'keydown' && (e as KeyboardEvent).key !== 'Escape') return;
      if (e.type !== 'keydown' && this.popup && this.popup.contains(e.target as Node)) return;
      this.close();
    };
    this.outside = outside;
    // Defer to avoid catching the opening click.
    setTimeout(() => {
      document.addEventListener('pointerdown', outside, true);
      document.addEventListener('keydown', outside, true);
    }, 0);
  }

  close(): void {
    if (this.outside) {
      document.removeEventListener('pointerdown', this.outside, true);
      document.removeEventListener('keydown', this.outside, true);
      this.outside = null;
    }
    this.menu?.destroy();
    this.menu = null;
    this.popup?.remove();
    this.popup = null;
  }

  isOpen(): boolean {
    return this.popup != null;
  }

  dispose(): void {
    this.close();
  }
}

export class CellMenuFeature<Row extends Model = Model> implements GridFeature<Row> {
  readonly name = 'cellMenu';

  private api!: GridApi<Row>;
  private readonly disposers = new Disposers();
  private popup!: MenuPopup<Row>;
  private readonly itemsCfg: CellMenuFeatureOptions<Row>['items'];
  private readonly onSelect?: CellMenuFeatureOptions<Row>['onSelect'];

  constructor(options: CellMenuFeatureOptions<Row>) {
    this.itemsCfg = options.items;
    this.onSelect = options.onSelect;
  }

  init(grid: GridApi<Row>): void {
    this.api = grid;
    this.popup = new MenuPopup<Row>(grid);
    grid.track(() => this.disposers.dispose());
    this.disposers.add(() => this.popup.dispose());

    const onCtx = (e: Event): void => this.handleContextMenu(e as MouseEvent);
    grid.el.addEventListener('contextmenu', onCtx);
    this.disposers.add(() => grid.el.removeEventListener('contextmenu', onCtx));
  }

  /** Open the cell menu programmatically at a screen position. */
  openAt(address: CellAddress, x: number, y: number): void {
    const row = this.api.getRow(address.rowIndex);
    const column = this.api.columns[address.colIndex];
    if (!row || !column) return;
    const ctx: CellMenuContext<Row> = { row, column, address, api: this.api };
    const items =
      typeof this.itemsCfg === 'function' ? this.itemsCfg(ctx) : this.itemsCfg;
    if (!items.length) return;
    this.popup.open(items, x, y, (id, item) => this.onSelect?.(id, item, ctx));
  }

  private handleContextMenu(event: MouseEvent): void {
    const cell = (event.target as HTMLElement).closest<HTMLElement>('[data-row-index][data-col-index]');
    if (!cell) return;
    const rowIndex = Number(cell.dataset['rowIndex']);
    const colIndex = Number(cell.dataset['colIndex']);
    if (Number.isNaN(rowIndex) || Number.isNaN(colIndex)) return;
    event.preventDefault();
    this.openAt({ rowIndex, colIndex }, event.clientX, event.clientY);
  }

  destroy(): void {
    this.disposers.dispose();
  }
}

export class HeaderMenuFeature<Row extends Model = Model> implements GridFeature<Row> {
  readonly name = 'headerMenu';

  private api!: GridApi<Row>;
  private readonly disposers = new Disposers();
  private popup!: MenuPopup<Row>;
  private readonly itemsCfg?: HeaderMenuFeatureOptions<Row>['items'];
  private readonly onSelect?: HeaderMenuFeatureOptions<Row>['onSelect'];
  private readonly openOnContextMenu: boolean;

  constructor(options: HeaderMenuFeatureOptions<Row> = {}) {
    this.itemsCfg = options.items;
    this.onSelect = options.onSelect;
    this.openOnContextMenu = options.openOnContextMenu ?? true;
  }

  init(grid: GridApi<Row>): void {
    this.api = grid;
    this.popup = new MenuPopup<Row>(grid);
    grid.track(() => this.disposers.dispose());
    this.disposers.add(() => this.popup.dispose());

    const onClick = (e: Event): void => this.handleTrigger(e as MouseEvent);
    grid.el.addEventListener('click', onClick);
    this.disposers.add(() => grid.el.removeEventListener('click', onClick));

    if (this.openOnContextMenu) {
      const onCtx = (e: Event): void => this.handleHeaderContext(e as MouseEvent);
      grid.el.addEventListener('contextmenu', onCtx);
      this.disposers.add(() => grid.el.removeEventListener('contextmenu', onCtx));
    }
  }

  /** Open the header menu for a column at a screen position. */
  openFor(columnId: string, x: number, y: number): void {
    const column = this.api.getColumn(columnId);
    if (!column) return;
    const ctx: HeaderMenuContext<Row> = { column, api: this.api };
    const items =
      this.itemsCfg == null
        ? this.defaultItems(ctx)
        : typeof this.itemsCfg === 'function'
          ? this.itemsCfg(ctx)
          : this.itemsCfg;
    if (!items.length) return;
    this.popup.open(items, x, y, (id, item) => this.handleSelect(id, item, ctx));
  }

  /** Build a sensible default menu from the installed features. */
  private defaultItems(ctx: HeaderMenuContext<Row>): MenuItem[] {
    const id = colId(ctx.column);
    const items: MenuItem[] = [];
    const sort = this.api.features.get('sort') as SortFeature<Row> | undefined;
    if (sort && ctx.column.sortable !== false) {
      items.push({ id: 'sort-asc', text: 'Sort ascending', icon: 'arrow-up' });
      items.push({ id: 'sort-desc', text: 'Sort descending', icon: 'arrow-down' });
      items.push({ id: 'sort-clear', text: 'Clear sort' });
      items.push({ separator: true });
    }
    const group = this.api.features.get('group') as GroupFeature<Row> | undefined;
    if (group) {
      const grouped = group.getColumns().includes(id);
      items.push({
        id: grouped ? 'ungroup' : 'group',
        text: grouped ? 'Ungroup this column' : 'Group by this column',
      });
      items.push({ separator: true });
    }
    const filter = this.api.features.get('filter') as FilterFeature<Row> | undefined;
    if (filter && ctx.column.filterable !== false) {
      items.push({ id: 'filter-clear', text: 'Clear filter', disabled: !filter.isActive(id) });
    }
    const columns = this.api.features.get('columnState') as ColumnStateFeature<Row> | undefined;
    if (columns) {
      items.push({ id: 'hide-column', text: 'Hide column' });
    }
    return items;
  }

  private handleSelect(id: string, item: MenuItem, ctx: HeaderMenuContext<Row>): void {
    const colKey = colId(ctx.column);
    const sort = this.api.features.get('sort') as SortFeature<Row> | undefined;
    const group = this.api.features.get('group') as GroupFeature<Row> | undefined;
    const filter = this.api.features.get('filter') as FilterFeature<Row> | undefined;
    const columns = this.api.features.get('columnState') as ColumnStateFeature<Row> | undefined;

    switch (id) {
      case 'sort-asc':
        sort?.setState([{ columnId: colKey, direction: 'asc' }]);
        break;
      case 'sort-desc':
        sort?.setState([{ columnId: colKey, direction: 'desc' }]);
        break;
      case 'sort-clear':
        sort?.clear();
        break;
      case 'group':
        group?.groupBy(colKey);
        break;
      case 'ungroup':
        group?.ungroup(colKey);
        break;
      case 'filter-clear':
        filter?.clear(colKey);
        break;
      case 'hide-column':
        columns?.setVisible(colKey, false);
        break;
      default:
        break;
    }
    this.onSelect?.(id, item, ctx);
  }

  private handleTrigger(event: MouseEvent): void {
    const trigger = (event.target as HTMLElement).closest<HTMLElement>('[data-header-menu]');
    if (!trigger) return;
    const columnId = trigger.dataset['headerMenu'];
    if (!columnId) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = trigger.getBoundingClientRect();
    this.openFor(columnId, rect.left, rect.bottom);
  }

  private handleHeaderContext(event: MouseEvent): void {
    const header = (event.target as HTMLElement).closest<HTMLElement>('[data-header-col]');
    if (!header) return;
    const columnId = header.dataset['headerCol'];
    if (!columnId) return;
    event.preventDefault();
    this.openFor(columnId, event.clientX, event.clientY);
  }

  destroy(): void {
    this.disposers.dispose();
  }
}

/** Convenience factories. */
export function cellMenuFeature<Row extends Model = Model>(
  options: CellMenuFeatureOptions<Row>,
): CellMenuFeature<Row> {
  return new CellMenuFeature<Row>(options);
}

export function headerMenuFeature<Row extends Model = Model>(
  options?: HeaderMenuFeatureOptions<Row>,
): HeaderMenuFeature<Row> {
  return new HeaderMenuFeature<Row>(options);
}
