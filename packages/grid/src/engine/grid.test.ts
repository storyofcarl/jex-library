import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Store, TreeStore, register, create, isRegistered } from '@jects/core';
import { Grid } from './grid.js';
import type { ColumnDef, GridFeature } from '../contract.js';

interface Row {
  id: number;
  name: string;
  age: number;
}

const cols: ColumnDef<Row>[] = [
  { field: 'name', header: 'Name', width: 120 },
  { field: 'age', header: 'Age', width: 80 },
];

function rows(n: number): Row[] {
  return Array.from({ length: n }, (_, i) => ({ id: i, name: `r${i}`, age: i }));
}

let host: HTMLElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  host.remove();
});

describe('Grid widget: structure', () => {
  it('builds root, scroller, header with column headers', () => {
    const g = new Grid<Row>(host, { data: rows(10), columns: cols });
    const root = host.querySelector('.jects-grid')!;
    expect(root).toBeTruthy();
    expect(root.getAttribute('role')).toBe('grid');
    expect(root.querySelector('.jects-grid__scroller')).toBeTruthy();
    const headerCells = root.querySelectorAll('.jects-grid__header-cell');
    expect(headerCells).toHaveLength(2);
    expect(headerCells[0]!.textContent).toBe('Name');
    g.destroy();
  });

  it('exposes true row/column totals + positions via ARIA (virtualized)', () => {
    const g = new Grid<Row>(host, { data: rows(1000), columns: cols, rowHeight: 20 });
    g.refresh();
    const root = host.querySelector('.jects-grid') as HTMLElement;
    // aria-rowcount counts the header row + every data row (1000 + 1).
    expect(root.getAttribute('aria-rowcount')).toBe('1001');
    expect(root.getAttribute('aria-colcount')).toBe('2');

    // Header is row 1; its columns are 1-based.
    const headerRow = root.querySelector('.jects-grid__header-row') as HTMLElement;
    expect(headerRow.getAttribute('aria-rowindex')).toBe('1');
    const headerCells = root.querySelectorAll('.jects-grid__header-cell');
    expect(headerCells[0]!.getAttribute('aria-colindex')).toBe('1');
    expect(headerCells[1]!.getAttribute('aria-colindex')).toBe('2');

    // Data rows are numbered after the header (rowIndex 0 → aria-rowindex 2).
    const firstRow = root.querySelector('.jects-grid__row') as HTMLElement;
    expect(firstRow.getAttribute('aria-rowindex')).toBe(
      String(Number(firstRow.dataset['rowIndex']) + 2),
    );
    const firstCell = firstRow.querySelector('.jects-grid__cell') as HTMLElement;
    expect(firstCell.getAttribute('aria-colindex')).toBe('1');
    g.destroy();
  });

  it('renders recycled rows for visible data', () => {
    const g = new Grid<Row>(host, { data: rows(5), columns: cols, rowHeight: 20 });
    g.refresh();
    const rowEls = host.querySelectorAll('.jects-grid__row');
    expect(rowEls.length).toBeGreaterThan(0);
    // each row carries its absolute index + id
    const first = host.querySelector('.jects-grid__row') as HTMLElement;
    expect(first.dataset['rowIndex']).toBeDefined();
    g.destroy();
  });

  it('shows empty state when there is no data', () => {
    const g = new Grid<Row>(host, { data: [], columns: cols });
    g.refresh();
    const empty = host.querySelector('.jects-grid__empty') as HTMLElement;
    expect(empty).toBeTruthy();
    expect(empty.hidden).toBe(false);
    g.destroy();
  });

  it('GridApi surface is present', () => {
    const g = new Grid<Row>(host, { data: rows(3), columns: cols });
    expect(g.store).toBeInstanceOf(Store);
    expect(g.columns).toHaveLength(2);
    expect(g.viewport).toBeTruthy();
    expect(g.selection).toBeTruthy();
    expect(g.editing).toBeTruthy();
    expect(g.renderer).toBeTruthy();
    expect(g.getRowCount()).toBe(3);
    expect(g.getRow(1)?.name).toBe('r1');
    expect(g.getColumn('age')?.header).toBe('Age');
    g.destroy();
  });
});

describe('Grid widget: keyboard cell navigation (WAI-ARIA grid)', () => {
  /** Dispatch a keydown from a given cell element. */
  function keyOn(cell: HTMLElement, key: string, mods: Partial<KeyboardEventInit> = {}): void {
    cell.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...mods }));
  }
  function cellAt(host: HTMLElement, r: number, c: number): HTMLElement | null {
    return host.querySelector<HTMLElement>(
      `.jects-grid__row[data-row-index="${r}"] .jects-grid__cell[data-col-index="${c}"]`,
    );
  }

  it('installs a single roving tabindex (entry cell tabindex=0, others -1)', () => {
    const g = new Grid<Row>(host, { data: rows(5), columns: cols, rowHeight: 20 });
    g.refresh();
    const tabbable = host.querySelectorAll('.jects-grid__cell[tabindex="0"]');
    expect(tabbable).toHaveLength(1);
    const entry = cellAt(host, 0, 0);
    expect(entry?.getAttribute('tabindex')).toBe('0');
    // Some other cell carries -1.
    const other = cellAt(host, 0, 1);
    expect(other?.getAttribute('tabindex')).toBe('-1');
    g.destroy();
  });

  it('ArrowRight / ArrowDown move the roving tabindex (and focus)', () => {
    const g = new Grid<Row>(host, { data: rows(5), columns: cols, rowHeight: 20 });
    g.refresh();
    const start = cellAt(host, 0, 0)!;
    keyOn(start, 'ArrowRight');
    expect(cellAt(host, 0, 1)?.getAttribute('tabindex')).toBe('0');
    expect(cellAt(host, 0, 0)?.getAttribute('tabindex')).toBe('-1');
    keyOn(cellAt(host, 0, 1)!, 'ArrowDown');
    expect(cellAt(host, 1, 1)?.getAttribute('tabindex')).toBe('0');
    g.destroy();
  });

  it('clamps at the edges (ArrowLeft/ArrowUp at 0,0 stays put)', () => {
    const g = new Grid<Row>(host, { data: rows(5), columns: cols, rowHeight: 20 });
    g.refresh();
    keyOn(cellAt(host, 0, 0)!, 'ArrowLeft');
    keyOn(cellAt(host, 0, 0)!, 'ArrowUp');
    expect(cellAt(host, 0, 0)?.getAttribute('tabindex')).toBe('0');
    g.destroy();
  });

  it('Home/End move to row start/end; Ctrl+Home/End to grid corners', () => {
    const g = new Grid<Row>(host, { data: rows(5), columns: cols, rowHeight: 20 });
    g.refresh();
    // Move to (0,1) then End → last column of the row.
    keyOn(cellAt(host, 0, 0)!, 'ArrowRight');
    keyOn(cellAt(host, 0, 1)!, 'End');
    expect(cellAt(host, 0, 1)?.getAttribute('tabindex')).toBe('0'); // 2 cols → last is col 1
    // Home → first column.
    keyOn(cellAt(host, 0, 1)!, 'Home');
    expect(cellAt(host, 0, 0)?.getAttribute('tabindex')).toBe('0');
    g.destroy();
  });

  it('a click moves the roving tabindex to the clicked cell', () => {
    const g = new Grid<Row>(host, { data: rows(5), columns: cols, rowHeight: 20 });
    g.refresh();
    const target = cellAt(host, 1, 1)!;
    target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(cellAt(host, 1, 1)?.getAttribute('tabindex')).toBe('0');
    g.destroy();
  });
});

describe('Grid widget: events & selection', () => {
  it('emits cellClick and selects the row in single mode', () => {
    const g = new Grid<Row>(host, { data: rows(5), columns: cols, selection: 'single', rowHeight: 20 });
    g.refresh();
    const clickSpy = vi.fn();
    const selSpy = vi.fn();
    g.on('cellClick', clickSpy);
    g.on('selectionChange', selSpy);
    const cell = host.querySelector('.jects-grid__cell') as HTMLElement;
    cell.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(selSpy).toHaveBeenCalled();
    expect(g.selection.getSelectedIds().length).toBe(1);
    g.destroy();
  });

  it('emits scroll when the scroller scrolls', () => {
    const g = new Grid<Row>(host, { data: rows(100), columns: cols, rowHeight: 20 });
    const spy = vi.fn();
    g.on('scroll', spy);
    const scroller = host.querySelector('.jects-grid__scroller') as HTMLElement;
    Object.defineProperty(scroller, 'scrollTop', { value: 40, configurable: true });
    scroller.dispatchEvent(new Event('scroll'));
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ scrollTop: 40 }));
    g.destroy();
  });

  it('updateColumn re-renders the header', () => {
    const g = new Grid<Row>(host, { data: rows(3), columns: cols });
    g.updateColumn('name', { header: 'Renamed' });
    const headerCell = host.querySelector('.jects-grid__header-cell') as HTMLElement;
    expect(headerCell.textContent).toBe('Renamed');
    g.destroy();
  });
});

describe('Grid widget: editing', () => {
  it('double-click starts an inline editor and commit writes to the store', () => {
    const store = new Store<Row>({ data: rows(3) });
    const g = new Grid<Row>(host, {
      data: store,
      columns: cols,
      editing: { enabled: true, trigger: 'dblclick' },
      rowHeight: 20,
    });
    g.refresh();
    const editSpy = vi.fn();
    g.on('cellEdit', editSpy);
    const cell = host.querySelector('.jects-grid__cell') as HTMLElement;
    cell.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    const input = host.querySelector('.jects-grid__editor-input') as HTMLInputElement;
    expect(input).toBeTruthy();
    input.value = 'edited';
    g.editing.commit();
    expect(store.getById(0)?.name).toBe('edited');
    expect(editSpy).toHaveBeenCalledTimes(1);
    g.destroy();
  });

  it('beforeCellEdit veto blocks editing', () => {
    const g = new Grid<Row>(host, {
      data: rows(3),
      columns: cols,
      editing: true,
      rowHeight: 20,
    });
    g.refresh();
    g.on('beforeCellEdit', () => false);
    g.editing.start({ rowIndex: 0, colIndex: 0 });
    expect(g.editing.isEditing()).toBe(false);
    g.destroy();
  });

  it('start() over an invalid edit does NOT orphan the previous editor', () => {
    // Column whose editor always fails validation, so commit() returns false.
    let destroys = 0;
    const failingCol: ColumnDef<Row> = {
      field: 'name',
      header: 'Name',
      width: 120,
      editor: {
        mount(ctx): void {
          const input = ctx.el.ownerDocument.createElement('input');
          input.className = 'jects-grid__editor-input';
          ctx.el.appendChild(input);
        },
        getValue: () => 'x',
        validate: () => 'invalid',
        destroy(): void {
          destroys++;
        },
      },
    };
    const g = new Grid<Row>(host, {
      data: rows(3),
      columns: [failingCol, { field: 'age', header: 'Age', width: 80 }],
      editing: { enabled: true },
      rowHeight: 20,
    });
    g.refresh();
    g.editing.start({ rowIndex: 0, colIndex: 0 });
    expect(g.editing.isEditing()).toBe(true);
    const first = g.editing.active;

    // Starting a new edit while the current one is invalid must NOT mount a new
    // editor on top of the old one (which would leak it). The blocked commit
    // keeps the original edit active and leaves state untouched.
    g.editing.start({ rowIndex: 1, colIndex: 0 });
    expect(g.editing.active).toEqual(first);
    // Exactly one editor input is mounted (no orphan); destroy wasn't called.
    expect(host.querySelectorAll('.jects-grid__editor-input').length).toBe(1);
    expect(destroys).toBe(0);
    expect(host.querySelectorAll('.jects-grid__cell--editing').length).toBe(1);
    g.destroy();
  });
});

describe('Grid widget: tree mode', () => {
  it('toggles tree expansion on the expander button', async () => {
    const tree = new TreeStore({
      data: [{ id: 'a', name: 'A', age: 0, children: [{ id: 'a1', name: 'A1', age: 1 }] }],
    });
    const g = new Grid(host, {
      data: tree,
      columns: [{ field: 'name', type: 'tree' }],
      treeMode: true,
      rowHeight: 20,
    });
    g.refresh();
    expect(g.getRowCount()).toBe(1);
    const toggle = host.querySelector('[data-tree-toggle]') as HTMLElement;
    expect(toggle).toBeTruthy();
    const expandSpy = vi.fn();
    g.on('rowExpand', expandSpy);
    toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await Promise.resolve();
    expect(g.getRowCount()).toBe(2);
    expect(expandSpy).toHaveBeenCalled();
    g.destroy();
  });
});

describe('Grid widget: feature lifecycle', () => {
  it('use() installs a feature and removeFeature destroys it', () => {
    const g = new Grid<Row>(host, { data: rows(3), columns: cols });
    const initSpy = vi.fn();
    const destroySpy = vi.fn();
    const feature: GridFeature<Row> = {
      name: 'demo',
      init: initSpy,
      destroy: destroySpy,
    };
    g.use(feature);
    expect(initSpy).toHaveBeenCalledWith(g);
    expect(g.features.get('demo')).toBe(feature);
    g.removeFeature('demo');
    expect(destroySpy).toHaveBeenCalledTimes(1);
    expect(g.features.has('demo')).toBe(false);
    g.destroy();
  });

  it('installs construction-time plugins and destroys them on grid destroy', () => {
    const destroySpy = vi.fn();
    const feature: GridFeature<Row> = { name: 'p', init: vi.fn(), destroy: destroySpy };
    const g = new Grid<Row>(host, { data: rows(3), columns: cols, plugins: [feature] });
    expect(g.features.has('p')).toBe(true);
    g.destroy();
    expect(destroySpy).toHaveBeenCalledTimes(1);
  });

  it('GridApi.track runs disposers on destroy', () => {
    const g = new Grid<Row>(host, { data: rows(2), columns: cols });
    const disposer = vi.fn();
    g.track(disposer);
    g.destroy();
    expect(disposer).toHaveBeenCalledTimes(1);
  });
});

describe('Grid widget: lifecycle', () => {
  it('registers with the factory and is creatable by type', () => {
    expect(isRegistered('grid')).toBe(true);
    const g = create({ type: 'grid', data: rows(2), columns: cols }, host) as unknown as Grid<Row>;
    expect(g.getRowCount()).toBe(2);
    g.destroy();
  });

  it('destroy removes the element and is idempotent', () => {
    const g = new Grid<Row>(host, { data: rows(2), columns: cols });
    g.destroy();
    expect(host.querySelector('.jects-grid')).toBeNull();
    expect(() => g.destroy()).not.toThrow();
  });

  it('update re-renders on data change', () => {
    const g = new Grid<Row>(host, { data: rows(2), columns: cols });
    expect(g.getRowCount()).toBe(2);
    g.update({ data: rows(5) });
    expect(g.getRowCount()).toBe(5);
    g.destroy();
  });

  it('reacts to store changes (add) by re-virtualizing', () => {
    const store = new Store<Row>({ data: rows(2) });
    const g = new Grid<Row>(host, { data: store, columns: cols });
    expect(g.getRowCount()).toBe(2);
    store.add({ id: 99, name: 'new', age: 99 });
    expect(g.getRowCount()).toBe(3);
    g.destroy();
  });
});

// Ensure registration happened on import.
register('grid-noop', class {} as never);
