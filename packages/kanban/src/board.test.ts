/**
 * jsdom unit tests for the TaskBoard. Cover render, selection, column
 * collapse/lock/reorder, WIP-limit enforcement (soft + strict), editing
 * (programmatic + inline quick-edit), search filtering, factory registration,
 * and clean destroy().
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { create, isRegistered, Store } from '@jects/core';

import { TaskBoard } from './board.js';
import type { KanbanCard, KanbanColumnDef, TaskBoardConfig } from './types.js';

const COLUMNS: KanbanColumnDef[] = [
  { id: 'todo', title: 'To Do' },
  { id: 'doing', title: 'Doing', limit: 2 },
  { id: 'done', title: 'Done' },
];

function cards(): KanbanCard[] {
  return [
    { id: 1, column: 'todo', title: 'Alpha', order: 0, tags: [{ text: 'bug' }] },
    { id: 2, column: 'todo', title: 'Beta', order: 1, progress: 50 },
    { id: 3, column: 'doing', title: 'Gamma', order: 0 },
  ];
}

let host: HTMLElement;

function mount(cfg: Partial<TaskBoardConfig> = {}): TaskBoard {
  return new TaskBoard(host, { columns: COLUMNS, cards: cards(), ...cfg });
}

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});

afterEach(() => {
  host.remove();
});

describe('TaskBoard render', () => {
  it('renders a column per def and cards in the right column', () => {
    const b = mount();
    const cols = b.el.querySelectorAll('.jects-kanban-col');
    expect(cols.length).toBe(3);
    const todo = b.el.querySelector('[data-col="todo"] .jects-kanban-col__body');
    expect(todo?.querySelectorAll('.jects-kanban-card').length).toBe(2);
    b.destroy();
  });

  it('renders template fields: title, tags, progress', () => {
    const b = mount();
    expect(b.el.querySelector('.jects-kanban-card__title')?.textContent).toContain('Alpha');
    expect(b.el.querySelector('.jects-kanban-card__tag')?.textContent).toBe('bug');
    expect(b.el.querySelector('.jects-kanban-card__progress')).toBeTruthy();
    b.destroy();
  });

  it('shows a WIP limit count badge and flags over-limit', () => {
    const b = mount({
      cards: [
        { id: 1, column: 'doing', title: 'a', order: 0 },
        { id: 2, column: 'doing', title: 'b', order: 1 },
        { id: 3, column: 'doing', title: 'c', order: 2 },
      ],
    });
    const count = b.el.querySelector('[data-col="doing"] .jects-kanban-col__count');
    expect(count?.textContent).toBe('3/2');
    expect(count?.classList.contains('jects-kanban-col__count--over')).toBe(true);
    b.destroy();
  });

  it('renders swimlanes when lanes configured', () => {
    const b = new TaskBoard(host, {
      columns: COLUMNS,
      lanes: [
        { id: 'l1', title: 'High' },
        { id: 'l2', title: 'Low' },
      ],
      cards: [
        { id: 1, column: 'todo', lane: 'l1', title: 'x', order: 0 },
        { id: 2, column: 'todo', lane: 'l2', title: 'y', order: 0 },
      ],
    });
    const lanes = b.el.querySelectorAll('[data-col="todo"] .jects-kanban-col__lane');
    expect(lanes.length).toBe(2);
    b.destroy();
  });
});

describe('selection', () => {
  it('selects a card on pointerdown and emits selectionChange', () => {
    const b = mount();
    const spy = vi.fn();
    b.on('selectionChange', spy);
    const card = b.el.querySelector<HTMLElement>('.jects-kanban-card[data-card="1"]')!;
    card.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
    expect(b.getSelection()).toEqual([1]);
    expect(card.classList.contains('jects-kanban-card--selected')).toBe(true);
    expect(spy).toHaveBeenCalled();
    b.destroy();
  });

  it('setSelection marks the card current and selected', () => {
    const b = mount();
    b.setSelection([2]);
    const card = b.el.querySelector<HTMLElement>('.jects-kanban-card[data-card="2"]')!;
    expect(card.getAttribute('aria-current')).toBe('true');
    expect(card.classList.contains('jects-kanban-card--selected')).toBe(true);
    b.destroy();
  });
});

describe('columns', () => {
  it('toggleColumn collapses and emits columnToggle', () => {
    const b = mount();
    const spy = vi.fn();
    b.on('columnToggle', spy);
    b.toggleColumn('todo');
    const col = b.el.querySelector('[data-col="todo"]');
    expect(col?.classList.contains('jects-kanban-col--collapsed')).toBe(true);
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ column: 'todo', collapsed: true }),
    );
    b.destroy();
  });

  it('moveColumn reorders and emits columnReorder', () => {
    const b = mount();
    const spy = vi.fn();
    b.on('columnReorder', spy);
    b.moveColumn('done', 0);
    const order = [...b.el.querySelectorAll('.jects-kanban-col')].map((c) =>
      c.getAttribute('data-col'),
    );
    expect(order).toEqual(['done', 'todo', 'doing']);
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ order: ['done', 'todo', 'doing'] }),
    );
    b.destroy();
  });

  it('setColumnLocked marks a column locked', () => {
    const b = mount();
    b.setColumnLocked('todo', true);
    expect(b.el.querySelector('[data-col="todo"]')?.classList.contains('jects-kanban-col--locked')).toBe(
      true,
    );
    b.destroy();
  });
});

describe('moving cards & WIP limits', () => {
  it('moveCard moves a card across columns and emits cardMove', () => {
    const b = mount();
    const spy = vi.fn();
    b.on('cardMove', spy);
    b.moveCard(1, { column: 'done', index: 0 });
    expect(b.store.getById(1)?.column).toBe('done');
    expect(spy).toHaveBeenCalled();
    b.destroy();
  });

  it('reassigns dense order on reorder', () => {
    const b = mount();
    b.moveCard(2, { column: 'todo', index: 0 }); // Beta before Alpha
    const todo = b.el.querySelector('[data-col="todo"] .jects-kanban-col__body')!;
    const titles = [...todo.querySelectorAll('.jects-kanban-card__title')].map((t) => t.textContent);
    expect(titles).toEqual(['Beta', 'Alpha']);
    b.destroy();
  });

  it('strictLimit vetoes an over-limit move and emits limitReject', () => {
    const strictCols: KanbanColumnDef[] = [
      { id: 'todo', title: 'To Do' },
      { id: 'doing', title: 'Doing', limit: 1, strictLimit: true },
    ];
    const b = new TaskBoard(host, {
      columns: strictCols,
      cards: [
        { id: 1, column: 'todo', title: 'a', order: 0 },
        { id: 2, column: 'doing', title: 'b', order: 0 },
      ],
    });
    const reject = vi.fn();
    b.on('limitReject', reject);
    b.moveCard(1, { column: 'doing', index: 1 });
    expect(b.store.getById(1)?.column).toBe('todo'); // unchanged
    expect(reject).toHaveBeenCalledWith(expect.objectContaining({ column: 'doing', limit: 1 }));
    b.destroy();
  });

  it('soft limit allows the move (no veto)', () => {
    const b = mount(); // doing limit:2, currently 1 card
    b.moveCard(1, { column: 'doing', index: 1 });
    b.moveCard(2, { column: 'doing', index: 2 }); // now 3 in a limit-2 col, soft => allowed
    expect(b.store.getById(2)?.column).toBe('doing');
    b.destroy();
  });

  it('beforeCardMove veto cancels the move', () => {
    const b = mount();
    b.on('beforeCardMove', () => false);
    b.moveCard(1, { column: 'done', index: 0 });
    expect(b.store.getById(1)?.column).toBe('todo');
    b.destroy();
  });
});

describe('editing', () => {
  it('applyCardEdit updates the store and emits cardEdit', () => {
    const b = mount();
    const spy = vi.fn();
    b.on('cardEdit', spy);
    b.applyCardEdit(1, { title: 'Alpha!' });
    expect(b.store.getById(1)?.title).toBe('Alpha!');
    expect(b.el.querySelector('.jects-kanban-card[data-card="1"] .jects-kanban-card__title')?.textContent).toBe(
      'Alpha!',
    );
    expect(spy).toHaveBeenCalled();
    b.destroy();
  });

  it('beforeCardEdit veto prevents the editor opening', () => {
    const b = mount();
    b.on('beforeCardEdit', () => false);
    b.editCard(1);
    expect(document.querySelector('.jects-kanban-editor')).toBeNull();
    b.destroy();
  });

  it('quickEditCard commits a new title on Enter', () => {
    const b = mount();
    b.quickEditCard(1);
    const input = b.el.querySelector<HTMLInputElement>('.jects-kanban-card__quick-edit')!;
    expect(input).toBeTruthy();
    input.value = 'Renamed';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(b.store.getById(1)?.title).toBe('Renamed');
    b.destroy();
  });

  it('quickEditCard discards on Escape', () => {
    const b = mount();
    b.quickEditCard(1);
    const input = b.el.querySelector<HTMLInputElement>('.jects-kanban-card__quick-edit')!;
    input.value = 'Nope';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(b.store.getById(1)?.title).toBe('Alpha');
    b.destroy();
  });

  it('opens the modal editor on editCard()', () => {
    const b = mount();
    b.editCard(1);
    expect(document.querySelector('.jects-kanban-editor')).toBeTruthy();
    // Clean up the editor window.
    document.querySelector<HTMLElement>('.jects-window')?.remove();
    b.destroy();
  });
});

describe('keyboard move (WCAG 2.1.1)', () => {
  it('Ctrl+ArrowRight moves a card to the next column and emits cardMove', () => {
    const b = mount();
    const spy = vi.fn();
    b.on('cardMove', spy);
    const card = b.el.querySelector<HTMLElement>('.jects-kanban-card[data-card="1"]')!;
    card.focus();
    card.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', ctrlKey: true, bubbles: true }),
    );
    expect(b.store.getById(1)?.column).toBe('doing');
    expect(spy).toHaveBeenCalled();
    b.destroy();
  });

  it('Ctrl+ArrowDown reorders a card within its column', () => {
    const b = mount(); // todo has Alpha(1), Beta(2)
    const card = b.el.querySelector<HTMLElement>('.jects-kanban-card[data-card="1"]')!;
    card.focus();
    card.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', ctrlKey: true, bubbles: true }),
    );
    const todo = b.el.querySelector('[data-col="todo"] .jects-kanban-col__body')!;
    const titles = [...todo.querySelectorAll('.jects-kanban-card__title')].map((t) => t.textContent);
    expect(titles).toEqual(['Beta', 'Alpha']);
    b.destroy();
  });

  it('Ctrl+Arrow respects a strict WIP limit (move rejected)', () => {
    const strictCols: KanbanColumnDef[] = [
      { id: 'todo', title: 'To Do' },
      { id: 'doing', title: 'Doing', limit: 1, strictLimit: true },
    ];
    const b = new TaskBoard(host, {
      columns: strictCols,
      cards: [
        { id: 1, column: 'todo', title: 'a', order: 0 },
        { id: 2, column: 'doing', title: 'b', order: 0 },
      ],
    });
    const reject = vi.fn();
    b.on('limitReject', reject);
    const card = b.el.querySelector<HTMLElement>('.jects-kanban-card[data-card="1"]')!;
    card.focus();
    card.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', ctrlKey: true, bubbles: true }),
    );
    expect(b.store.getById(1)?.column).toBe('todo'); // blocked
    expect(reject).toHaveBeenCalled();
    b.destroy();
  });

  it('exposes a polite live region for announcements', () => {
    const b = mount();
    const live = b.el.querySelector('.jects-kanban__live');
    expect(live?.getAttribute('aria-live')).toBe('polite');
    b.destroy();
  });
});

describe('search', () => {
  it('setQuery filters cards by title', () => {
    const b = mount();
    b.setQuery('alpha');
    const visible = b.el.querySelectorAll('.jects-kanban-card');
    expect(visible.length).toBe(1);
    expect(visible[0]?.textContent).toContain('Alpha');
    b.destroy();
  });
});

describe('addCard', () => {
  it('adds a card and renders it', () => {
    const b = mount();
    b.addCard({ id: 99, column: 'done', title: 'New' });
    expect(b.el.querySelector('[data-col="done"] .jects-kanban-card[data-card="99"]')).toBeTruthy();
    b.destroy();
  });
});

describe('external store', () => {
  it('uses a provided Store and reflects external changes', () => {
    const store = new Store<KanbanCard>({ data: cards(), idField: 'id' });
    const b = new TaskBoard(host, { columns: COLUMNS, store });
    store.add({ id: 50, column: 'done', title: 'Ext', order: 0 });
    expect(b.el.querySelector('.jects-kanban-card[data-card="50"]')).toBeTruthy();
    b.destroy();
  });
});

describe('factory + lifecycle', () => {
  it('registers as "taskboard"', () => {
    expect(isRegistered('taskboard')).toBe(true);
    const w = create({ type: 'taskboard', columns: COLUMNS, cards: cards() }, host) as TaskBoard;
    expect(w).toBeInstanceOf(TaskBoard);
    w.destroy();
  });

  it('destroy() removes the element and is idempotent', () => {
    const b = mount();
    b.destroy();
    expect(b.isDestroyed).toBe(true);
    expect(host.querySelector('.jects-kanban')).toBeNull();
    expect(() => b.destroy()).not.toThrow();
  });
});
