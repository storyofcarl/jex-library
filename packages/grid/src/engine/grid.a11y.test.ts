/**
 * Accessibility (axe-core) suite — Quality Gate Q2. Runs in real Chromium.
 * Asserts zero serious/critical violations for the public Grid across its main
 * configurations (plain, selectable, editable, tree). Also asserts the core
 * WAI-ARIA grid keyboard contract: role=grid, a single roving-tabindex cell
 * (one tabindex=0, the rest tabindex=-1), and Arrow-key cell navigation.
 */
import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import '@jects/theme/style.css';
import '../styles.css';
import { Store, TreeStore } from '@jects/core';
import { Grid } from './grid.js';
import type { ColumnDef } from '../contract.js';
import { expectNoA11yViolations } from '../test-utils/a11y.js';

interface Row {
  id: number;
  name: string;
  age: number;
}

const cols: ColumnDef<Row>[] = [
  { field: 'name', header: 'Name', width: 160 },
  { field: 'age', header: 'Age', type: 'number', width: 100 },
];

function rows(n: number): Row[] {
  return Array.from({ length: n }, (_, i) => ({ id: i, name: `Person ${i}`, age: 20 + i }));
}

let host: HTMLElement;
beforeEach(() => {
  host = document.createElement('div');
  host.style.width = '480px';
  host.style.height = '320px';
  document.body.appendChild(host);
});
afterEach(() => host.remove());

describe('Grid a11y', () => {
  it('plain grid has no serious/critical violations and exposes role=grid', async () => {
    const g = new Grid<Row>(host, { data: rows(40), columns: cols, rowHeight: 28 });
    g.refresh();
    const root = host.querySelector('.jects-grid') as HTMLElement;
    expect(root.getAttribute('role')).toBe('grid');
    expect(root.getAttribute('aria-rowcount')).toBe('41'); // 40 data + 1 header
    await expectNoA11yViolations(host);
    g.destroy();
  });

  it('selectable grid has no serious/critical violations', async () => {
    const g = new Grid<Row>(host, {
      data: rows(30),
      columns: cols,
      selection: 'single',
      rowHeight: 28,
    });
    g.refresh();
    await expectNoA11yViolations(host);
    g.destroy();
  });

  it('editable grid has no serious/critical violations', async () => {
    const store = new Store<Row>({ data: rows(20) });
    const g = new Grid<Row>(host, {
      data: store,
      columns: cols,
      editing: { enabled: true, trigger: 'dblclick' },
      rowHeight: 28,
    });
    g.refresh();
    await expectNoA11yViolations(host);
    g.destroy();
  });

  it('tree grid has no serious/critical violations', async () => {
    const tree = new TreeStore({
      data: [
        { id: 'a', name: 'A', age: 0, children: [{ id: 'a1', name: 'A1', age: 1 }] },
        { id: 'b', name: 'B', age: 2 },
      ],
    });
    const g = new Grid(host, {
      data: tree,
      columns: [{ field: 'name', header: 'Name', type: 'tree', width: 200 }],
      treeMode: true,
      rowHeight: 28,
    });
    g.refresh();
    await expectNoA11yViolations(host);
    g.destroy();
  });
});

describe('Grid keyboard navigation (WAI-ARIA grid pattern)', () => {
  it('maintains a single roving tabindex=0 cell', async () => {
    const g = new Grid<Row>(host, { data: rows(20), columns: cols, rowHeight: 28 });
    g.refresh();
    const root = host.querySelector('.jects-grid') as HTMLElement;
    const tabbable = root.querySelectorAll<HTMLElement>('.jects-grid__cell[tabindex="0"]');
    const untabbable = root.querySelectorAll<HTMLElement>('.jects-grid__cell[tabindex="-1"]');
    // Exactly one cell is in the tab order; the rest are reachable via arrows.
    expect(tabbable.length).toBe(1);
    expect(untabbable.length).toBeGreaterThan(0);
    // Entry point is the top-left cell.
    const entry = tabbable[0]!;
    const entryRow = entry.closest<HTMLElement>('.jects-grid__row');
    expect(entryRow?.dataset['rowIndex']).toBe('0');
    expect(entry.dataset['colIndex']).toBe('0');
    g.destroy();
  });

  it('ArrowDown / ArrowRight move the roving cell', async () => {
    const g = new Grid<Row>(host, { data: rows(20), columns: cols, rowHeight: 28 });
    g.refresh();
    const root = host.querySelector('.jects-grid') as HTMLElement;
    const fire = (key: string): void => {
      const cell = root.querySelector<HTMLElement>('.jects-grid__cell[tabindex="0"]')!;
      cell.focus();
      cell.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    };

    fire('ArrowDown');
    let focused = root.querySelector<HTMLElement>('.jects-grid__cell[tabindex="0"]')!;
    expect(focused.closest<HTMLElement>('.jects-grid__row')?.dataset['rowIndex']).toBe('1');
    expect(focused.dataset['colIndex']).toBe('0');

    fire('ArrowRight');
    focused = root.querySelector<HTMLElement>('.jects-grid__cell[tabindex="0"]')!;
    expect(focused.dataset['colIndex']).toBe('1');

    g.destroy();
  });
});

describe('Grid sortable headers (WAI-ARIA columnheader pattern)', () => {
  const nameAt = (root: HTMLElement, i: number): string =>
    root.querySelector<HTMLElement>(
      `.jects-grid__row[data-row-index="${i}"] .jects-grid__cell[data-col-index="0"]`,
    )!.textContent ?? '';

  it('sortable headers are focusable and advertise aria-sort=none', async () => {
    const g = new Grid<Row>(host, { data: rows(10), columns: cols, rowHeight: 28 });
    g.refresh();
    const root = host.querySelector('.jects-grid') as HTMLElement;
    const header = root.querySelector<HTMLElement>(
      '.jects-grid__header-cell[data-col-id="name"]',
    )!;
    expect(header.getAttribute('role')).toBe('columnheader');
    expect(header.tabIndex).toBe(0);
    expect(header.getAttribute('aria-sort')).toBe('none');
    await expectNoA11yViolations(host);
    g.destroy();
  });

  it('clicking a header sorts the column and updates aria-sort', async () => {
    const data: Row[] = [
      { id: 1, name: 'Carol', age: 1 },
      { id: 2, name: 'Alice', age: 2 },
      { id: 3, name: 'Bob', age: 3 },
    ];
    const g = new Grid<Row>(host, { data, columns: cols, rowHeight: 28 });
    g.refresh();
    const root = host.querySelector('.jects-grid') as HTMLElement;
    const header = root.querySelector<HTMLElement>(
      '.jects-grid__header-cell[data-col-id="name"]',
    )!;

    header.click(); // asc
    expect(header.getAttribute('aria-sort')).toBe('ascending');
    expect([nameAt(root, 0), nameAt(root, 1), nameAt(root, 2)]).toEqual([
      'Alice',
      'Bob',
      'Carol',
    ]);

    header.click(); // desc
    expect(header.getAttribute('aria-sort')).toBe('descending');
    expect(nameAt(root, 0)).toBe('Carol');

    header.click(); // none → restores natural (insertion) order
    expect(header.getAttribute('aria-sort')).toBe('none');
    expect(nameAt(root, 0)).toBe('Carol'); // original first row
    expect(nameAt(root, 1)).toBe('Alice');

    g.destroy();
  });

  it('Enter / Space on a focused header activates the sort', async () => {
    const data: Row[] = [
      { id: 1, name: 'Carol', age: 1 },
      { id: 2, name: 'Alice', age: 2 },
    ];
    const g = new Grid<Row>(host, { data, columns: cols, rowHeight: 28 });
    g.refresh();
    const root = host.querySelector('.jects-grid') as HTMLElement;
    const header = root.querySelector<HTMLElement>(
      '.jects-grid__header-cell[data-col-id="name"]',
    )!;
    header.focus();
    header.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(header.getAttribute('aria-sort')).toBe('ascending');
    expect(nameAt(root, 0)).toBe('Alice');

    header.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    expect(header.getAttribute('aria-sort')).toBe('descending');
    g.destroy();
  });

  it('non-sortable headers are not focusable and carry no aria-sort', async () => {
    const ncols: ColumnDef<Row>[] = [
      { field: 'name', header: 'Name', width: 160, sortable: false },
      { field: 'age', header: 'Age', type: 'number', width: 100 },
    ];
    const g = new Grid<Row>(host, { data: rows(5), columns: ncols, rowHeight: 28 });
    g.refresh();
    const root = host.querySelector('.jects-grid') as HTMLElement;
    const header = root.querySelector<HTMLElement>(
      '.jects-grid__header-cell[data-col-id="name"]',
    )!;
    expect(header.hasAttribute('tabindex')).toBe(false);
    expect(header.hasAttribute('aria-sort')).toBe(false);
    g.destroy();
  });
});

describe('Grid frozen columns', () => {
  it('right-frozen columns sit in display order against the right edge', async () => {
    const fcols: ColumnDef<Row>[] = [
      { field: 'name', header: 'Name', width: 160 },
      { id: 'r1', field: 'age', header: 'R1', width: 80, frozen: 'right' },
      { id: 'r2', header: 'R2', width: 60, frozen: 'right' },
    ];
    const g = new Grid<Row>(host, { data: rows(6), columns: fcols, rowHeight: 28 });
    g.refresh();
    const root = host.querySelector('.jects-grid') as HTMLElement;
    const h1 = root.querySelector<HTMLElement>('.jects-grid__header-cell[data-col-id="r1"]')!;
    const h2 = root.querySelector<HTMLElement>('.jects-grid__header-cell[data-col-id="r2"]')!;
    // rightWidth = 80 + 60 = 140. First right col (r1, left=0)  → right inset 60.
    // Second right col (r2, left=80) → right inset 0 (hard against the edge).
    expect(h1.style.right).toBe('60px');
    expect(h2.style.right).toBe('0px');
    expect(h1.style.left).toBe('auto');
    g.destroy();
  });
});
