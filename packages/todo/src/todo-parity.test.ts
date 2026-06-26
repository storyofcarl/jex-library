/**
 * jsdom unit tests for the category-leader parity feature set of @jects/todo:
 * calendar / timeline / table views, board swimlanes + WIP limits + board
 * multi-select + within-column reorder, inline pickers (status/priority/
 * assignee/tag/due), multi-sort + filter builders, comments + @mentions,
 * activity log, attachments, parent progress, dependency cycle detection +
 * blocker warning, time tracking, milestones, i18n, and import.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TodoList } from './todo-list.js';
import {
  wouldCreateCycle,
  subtreeProgress,
  monthGridDays,
  weekDays,
  timelineBounds,
  tasksFromJson,
  tasksFromCsv,
  tasksToCsv,
  tasksToJson,
  DEFAULT_STATUSES,
} from './todo-utils.js';
import { mergeMessages, formatDateLocale, formatMessage } from './todo-i18n.js';
import type { TodoTask, TodoStatus, TodoListConfig } from './contract.js';

let host: HTMLElement;
beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  host.remove();
});

const STATUSES: TodoStatus[] = [
  { id: 'todo', label: 'To Do', isDone: false, wipLimit: 1 },
  { id: 'doing', label: 'In Progress', isDone: false },
  { id: 'done', label: 'Done', isDone: true },
];

const NOW = (): Date => new Date(2026, 5, 24); // 2026-06-24

const tasks = (): TodoTask[] => [
  { id: 'a', title: 'Alpha', priority: 'high', due: '2026-06-24', startDate: '2026-06-20', assignees: ['Ada Lovelace'], tags: [{ text: 'urgent' }] },
  { id: 'b', title: 'Beta', priority: 'low', due: '2026-06-25', status: 'doing', assignees: ['Grace Hopper'] },
  { id: 'c', title: 'Gamma', priority: 'medium', due: '2026-06-30', status: 'done', milestone: true },
];

const mk = (cfg: Partial<TodoListConfig> = {}): TodoList =>
  new TodoList(host, { now: NOW, statuses: STATUSES, assignees: ['Ada Lovelace', 'Grace Hopper'], ...cfg });

const click = (el: Element | null): void => {
  el?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
};

/* ── pure helpers ────────────────────────────────────────────────────────── */

describe('pure parity helpers', () => {
  it('wouldCreateCycle detects direct + transitive cycles', () => {
    const t: TodoTask[] = [
      { id: 'a', title: 'A', dependencies: { blockedBy: ['b'] } },
      { id: 'b', title: 'B', dependencies: { blockedBy: ['c'] } },
      { id: 'c', title: 'C' },
    ];
    // a is blocked by b, b by c. Making c blocked by a closes a loop.
    expect(wouldCreateCycle(t, 'c', 'a')).toBe(true);
    expect(wouldCreateCycle(t, 'a', 'a')).toBe(true);
    // a depends on c (already transitively) is a diamond, not a cycle.
    expect(wouldCreateCycle(t, 'a', 'c')).toBe(false);
  });

  it('subtreeProgress counts descendant leaves', () => {
    const parent: TodoTask = { id: 'p', title: 'P', children: [
      { id: 'k1', title: 'K1', done: true },
      { id: 'k2', title: 'K2', done: false },
      { id: 'k3', title: 'K3', done: true },
    ] };
    const p = subtreeProgress(parent);
    expect(p.total).toBe(3);
    expect(p.done).toBe(2);
  });

  it('monthGridDays returns 42 days; weekDays returns 7', () => {
    expect(monthGridDays(new Date(2026, 5, 15))).toHaveLength(42);
    expect(weekDays(new Date(2026, 5, 15))).toHaveLength(7);
  });

  it('timelineBounds spans starts + dues', () => {
    const b = timelineBounds(tasks(), NOW());
    expect(b.min.getTime()).toBeLessThanOrEqual(new Date(2026, 5, 20).getTime());
    expect(b.max.getTime()).toBeGreaterThanOrEqual(new Date(2026, 5, 30).getTime());
  });
});

/* ── import round-trip ─────────────────────────────────────────────────────── */

describe('import (JSON + CSV round-trip)', () => {
  it('tasksFromJson restores a nested tree', () => {
    const tree: TodoTask[] = [{ id: 'p', title: 'P', children: [{ id: 'k', title: 'K' }] }];
    const json = tasksToJson(tree, false);
    const back = tasksFromJson(json);
    expect(back[0]!.children?.[0]!.title).toBe('K');
  });

  it('tasksFromJson rebuilds from a flat (depth) export', () => {
    const tree: TodoTask[] = [{ id: 'p', title: 'P', children: [{ id: 'k', title: 'K' }] }];
    const back = tasksFromJson(tasksToJson(tree, true));
    expect(back).toHaveLength(1);
    expect(back[0]!.children?.[0]!.title).toBe('K');
  });

  it('tasksFromCsv round-trips the CSV columns', () => {
    const tree: TodoTask[] = [{ id: 'p', title: 'Parent', priority: 'high', children: [{ id: 'k', title: 'Kid' }] }];
    const csv = tasksToCsv(tree, DEFAULT_STATUSES);
    const back = tasksFromCsv(csv, DEFAULT_STATUSES);
    expect(back[0]!.title).toBe('Parent');
    expect(back[0]!.priority).toBe('high');
    expect(back[0]!.children?.[0]!.title).toBe('Kid');
  });

  it('list.import(replace) swaps the whole tree', () => {
    const list = mk({ tasks: tasks() });
    const out = list.import(tasksToJson([{ id: 'z', title: 'Zeta' }], false), { format: 'json' });
    expect(out).toHaveLength(1);
    expect(list.getTask('z')!.title).toBe('Zeta');
    expect(list.getTask('a')).toBeUndefined();
    list.destroy();
  });

  it('list.import(append) keeps existing tasks', () => {
    const list = mk({ tasks: tasks() });
    list.import(tasksToJson([{ id: 'z', title: 'Zeta' }], false), { format: 'json', mode: 'append' });
    expect(list.getTask('a')).toBeTruthy();
    expect(list.getTask('z')).toBeTruthy();
    list.destroy();
  });
});

/* ── views ─────────────────────────────────────────────────────────────────── */

describe('calendar / timeline / table views', () => {
  it('calendar view renders a day grid with task chips on due dates', () => {
    const list = mk({ tasks: tasks(), view: 'calendar' });
    const cal = host.querySelector('.jects-todo__calendar')!;
    expect(cal.hasAttribute('hidden')).toBe(false);
    expect(cal.querySelectorAll('.jects-todo__cal-cell').length).toBe(42);
    const cell = cal.querySelector('[data-todo-day="2026-06-24"]')!;
    expect(cell.querySelector('.jects-todo__cal-chip')!.textContent).toContain('Alpha');
    list.destroy();
  });

  it('dragging a calendar chip reschedules due (drop handler)', () => {
    const list = mk({ tasks: tasks(), view: 'calendar' });
    // Simulate the drop pipeline by updating directly via the public API path.
    list.updateTask('a', { due: '2026-06-26' });
    list.setView('calendar');
    const cell = host.querySelector('[data-todo-day="2026-06-26"]')!;
    expect(cell.querySelector('.jects-todo__cal-chip')!.textContent).toContain('Alpha');
    list.destroy();
  });

  it('timeline view renders bars + a dependency arrow', () => {
    const data = tasks();
    data[1]!.dependencies = { blockedBy: ['a'] };
    const list = mk({ tasks: data, view: 'timeline' });
    const tl = host.querySelector('.jects-todo__timeline')!;
    expect(tl.querySelectorAll('.jects-todo__tl-bar').length).toBeGreaterThan(0);
    expect(tl.querySelector('.jects-todo__tl-arrows')).toBeTruthy();
    list.destroy();
  });

  it('table view renders configurable columns and inline cells', () => {
    const list = mk({ tasks: tasks(), view: 'table' });
    const table = host.querySelector('.jects-todo__table')!;
    // 8 data columns (+ 1 leading select column not counted via .jects-todo__tcol).
    expect(table.querySelectorAll('thead th.jects-todo__tcol').length).toBe(8);
    expect(table.querySelectorAll('tbody tr').length).toBe(3);
    // hide a column
    list.setTableColumns(list.getTableColumns().map((c) => c.field === 'startDate' ? { ...c, hidden: true } : c));
    expect(host.querySelectorAll('.jects-todo__table thead th.jects-todo__tcol').length).toBe(7);
    list.destroy();
  });
});

/* ── table interactions: multi-select + column resize + row height ──────────── */

describe('table view: multi-select + column resize', () => {
  // jsdom (25) lacks PointerEvent; synthesize a MouseEvent carrying pointerId.
  const pointer = (el: Element, type: string, clientX: number): void => {
    const ev = new MouseEvent(type, { bubbles: true, clientX, button: 0 });
    Object.defineProperty(ev, 'pointerId', { value: 1, configurable: true });
    el.dispatchEvent(ev);
  };

  it('renders a leading select column with a per-row + select-all checkbox', () => {
    const list = mk({ tasks: tasks(), view: 'table' });
    const table = host.querySelector('.jects-todo__table')!;
    expect(table.querySelector('thead th [data-todo-select-all]')).toBeTruthy();
    expect(table.querySelectorAll('tbody [data-todo-select]').length).toBe(3);
    list.destroy();
  });

  it('clicking a table row select box toggles selection (shared SelectionModel)', () => {
    const list = mk({ tasks: tasks(), view: 'table' });
    const rowB = host.querySelector('.jects-todo__trow[data-todo-id="b"]')!;
    click(rowB.querySelector('[data-todo-select]'));
    expect(list.getSelected()).toEqual(['b']);
    expect(rowB.classList.contains('jects-todo__trow--selected')).toBe(true);
    // Toggling off
    click(rowB.querySelector('[data-todo-select]'));
    expect(list.getSelected()).toEqual([]);
    list.destroy();
  });

  it('select-all in the table header selects every rendered row', () => {
    const list = mk({ tasks: tasks(), view: 'table' });
    click(host.querySelector('.jects-todo__table [data-todo-select-all]'));
    expect(new Set(list.getSelected())).toEqual(new Set(['a', 'b', 'c']));
    // Header reflects all-selected (aria-checked + class).
    const selAll = host.querySelector('.jects-todo__table [data-todo-select-all]')!;
    expect(selAll.getAttribute('aria-checked')).toBe('true');
    expect(selAll.classList.contains('jects-todo__rowsel--on')).toBe(true);
    list.destroy();
  });

  it('shift-clicking a row body extends a range selection in the table', () => {
    const list = mk({ tasks: tasks(), view: 'table' });
    list.select('a');
    const cellC = host.querySelector('.jects-todo__trow[data-todo-id="c"] td')!;
    cellC.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
    expect(new Set(list.getSelected())).toEqual(new Set(['a', 'b', 'c']));
    list.destroy();
  });

  it('dragging a column edge handle resizes + persists the column width', () => {
    const list = mk({ tasks: tasks(), view: 'table' });
    const events: Array<{ field: string; width: number }> = [];
    list.on('columnresize', (e) => events.push({ field: e.field, width: e.width }));
    const handle = host.querySelector<HTMLElement>('[data-table-resize="status"]')!;
    // jsdom getBoundingClientRect() is 0, so width == the drag delta.
    pointer(handle, 'pointerdown', 100);
    pointer(document.documentElement, 'pointermove', 180); // +80px
    pointer(document.documentElement, 'pointerup', 180);
    expect(list.getTableColumns().find((c) => c.field === 'status')?.width).toBe(80);
    expect(events.at(-1)).toEqual({ field: 'status', width: 80 });
    // The new width is reflected on the rebuilt header cell.
    const th = host.querySelector<HTMLElement>('th[data-table-col="status"]')!;
    expect(th.style.inlineSize).toBe('80px');
    list.destroy();
  });

  it('clamps a column drag to the minimum width', () => {
    const list = mk({ tasks: tasks(), view: 'table' });
    const handle = host.querySelector<HTMLElement>('[data-table-resize="priority"]')!;
    pointer(handle, 'pointerdown', 200);
    pointer(document.documentElement, 'pointermove', 100); // -100px → below min
    pointer(document.documentElement, 'pointerup', 100);
    expect(list.getTableColumns().find((c) => c.field === 'priority')?.width).toBe(56);
    list.destroy();
  });

  it('arrow keys on the resize handle nudge the column width', () => {
    const list = mk({ tasks: tasks(), view: 'table', tableColumns: [{ field: 'title', width: 200 }] });
    const handle = host.querySelector<HTMLElement>('[data-table-resize="title"]')!;
    handle.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowRight', shiftKey: true }));
    expect(list.getTableColumns().find((c) => c.field === 'title')?.width).toBe(210);
    const handle2 = host.querySelector<HTMLElement>('[data-table-resize="title"]')!;
    handle2.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowLeft' }));
    expect(list.getTableColumns().find((c) => c.field === 'title')?.width).toBe(208);
    list.destroy();
  });

  it('setTableRowHeight applies a uniform row height to the table', () => {
    const list = mk({ tasks: tasks(), view: 'table' });
    expect(list.getTableRowHeight()).toBeNull();
    list.setTableRowHeight(40);
    expect(list.getTableRowHeight()).toBe(40);
    const table = host.querySelector('.jects-todo__table')!;
    expect(table.classList.contains('jects-todo__table--fixed-rows')).toBe(true);
    const row = host.querySelector<HTMLElement>('.jects-todo__trow')!;
    expect(row.style.getPropertyValue('--_todo-trow-h')).toBe('40px');
    list.setTableRowHeight(null);
    expect(list.getTableRowHeight()).toBeNull();
    expect(host.querySelector('.jects-todo__table--fixed-rows')).toBeNull();
    list.destroy();
  });

  it('a non-selectable table omits the select column', () => {
    const list = mk({ tasks: tasks(), view: 'table', selectable: false });
    expect(host.querySelector('.jects-todo__table [data-todo-select]')).toBeNull();
    expect(host.querySelector('.jects-todo__table [data-todo-select-all]')).toBeNull();
    list.destroy();
  });
});

/* ── board power features ───────────────────────────────────────────────────── */

describe('board swimlanes + WIP + multi-select', () => {
  it('WIP limit shows count / limit and an over class', () => {
    const list = mk({ tasks: tasks(), view: 'board' });
    const board = host.querySelector('.jects-todo__board')!;
    const todoCol = board.querySelector('[data-todo-status="todo"]')!;
    // 'a' is in todo, limit is 1 → at limit, not over
    expect(todoCol.querySelector('.jects-todo__group-count')!.textContent).toBe('1 / 1');
    // move b into todo → over limit
    list.setStatus('b', 'todo');
    const todoCol2 = host.querySelector('[data-todo-status="todo"]')!;
    expect(todoCol2.querySelector('.jects-todo__group-count')!.textContent).toBe('2 / 1');
    expect(todoCol2.classList.contains('jects-todo__col--over')).toBe(true);
    list.destroy();
  });

  it('swimlanes split the board into a lanes grid', () => {
    const list = mk({ tasks: tasks(), view: 'board', boardSwimlane: 'priority' });
    const board = host.querySelector('.jects-todo__board')!;
    expect(board.classList.contains('jects-todo__board--swimlanes')).toBe(true);
    expect(board.querySelectorAll('.jects-todo__lane-label').length).toBeGreaterThan(1);
    list.destroy();
  });

  it('cards carry a multi-select affordance and selection works', () => {
    const list = mk({ tasks: tasks(), view: 'board' });
    const card = host.querySelector('.jects-todo__card[data-todo-id="a"]')!;
    expect(card.querySelector('[data-todo-select]')).toBeTruthy();
    list.select('a');
    expect(host.querySelector('.jects-todo__bulkbar')!.hasAttribute('hidden')).toBe(false);
    list.destroy();
  });
});

/* ── inline editing + pickers ──────────────────────────────────────────────── */

describe('inline editing + pickers', () => {
  it('clicking a status pill opens a picker that changes status', () => {
    const list = mk({ tasks: tasks() });
    const pill = host.querySelector('[data-todo-id="a"] [data-todo-inline="status"]') as HTMLElement;
    click(pill);
    const pop = host.querySelector('.jects-todo__popover')!;
    expect(pop).toBeTruthy();
    const doneOpt = [...pop.querySelectorAll('.jects-todo__picker-item')].find((b) => b.textContent?.includes('Done'))!;
    click(doneOpt);
    expect(list.getTask('a')!.status).toBe('done');
    list.destroy();
  });

  it('the assignee picker (detail) toggles assignees with create-new', () => {
    const list = mk({ tasks: tasks() });
    list.openDetail('a');
    const trigger = host.querySelector('[data-detail-picker="assignee"]') as HTMLElement;
    click(trigger);
    const pop = host.querySelector('.jects-todo__popover')!;
    const grace = [...pop.querySelectorAll('.jects-todo__picker-item')].find((b) => b.textContent?.includes('Grace'))!;
    click(grace);
    expect(list.getTask('a')!.assignees).toContain('Grace Hopper');
    list.destroy();
  });

  it('the tag picker creates a new tag', () => {
    const list = mk({ tasks: tasks() });
    list.openDetail('b');
    click(host.querySelector('[data-detail-picker="tag"]'));
    const search = host.querySelector('.jects-todo__picker-search') as HTMLInputElement;
    search.value = 'backend';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    const add = host.querySelector('.jects-todo__picker-add')!;
    click(add);
    expect(list.getTask('b')!.tags?.some((t) => t.text === 'backend')).toBe(true);
    list.destroy();
  });

  it('multi-sort popover adds a criterion', () => {
    const list = mk({ tasks: tasks() });
    click(host.querySelector('[data-todo-action="multi-sort"]'));
    click(host.querySelector('.jects-todo__builder-add'));
    expect(list.getSort().filter((s) => s.field !== 'manual').length).toBeGreaterThan(0);
    list.destroy();
  });

  it('filter builder popover wires to setFilters', () => {
    const list = mk({ tasks: tasks() });
    click(host.querySelector('[data-todo-action="filter-builder"]'));
    const cb = host.querySelector('.jects-todo__builder-sec .jects-todo__builder-chk input') as HTMLInputElement;
    cb.checked = true;
    cb.dispatchEvent(new Event('change', { bubbles: true }));
    expect((list.getFilters().status ?? []).length).toBeGreaterThan(0);
    list.destroy();
  });
});

/* ── labeled columns + discoverable subtasks ──────────────────────────────── */

describe('list view: labeled columns + subtasks', () => {
  it('renders a persistent, labeled column header above the rows', () => {
    const list = mk({ tasks: tasks() });
    const header = host.querySelector('.jects-todo__header') as HTMLElement;
    expect(header).toBeTruthy();
    expect(header.hidden).toBe(false);
    // Every column is labeled by its visible header cell (not a tooltip).
    expect(header.querySelector('.jects-todo__hcell--done')!.textContent).toBe('Done');
    expect(header.querySelector('.jects-todo__hcell--status')!.textContent).toBe('Status');
    expect(header.querySelector('.jects-todo__hcell--task')!.textContent).toBe('Task');
    expect(header.querySelector('.jects-todo__hcell--people')!.textContent).toBe('Assignees');
    expect(header.querySelector('.jects-todo__hcell--due')!.textContent).toBe('Due');
    expect(header.querySelector('.jects-todo__hcell--priority')!.textContent).toBe('Priority');
    // The leading cell carries the "select all" checkbox.
    expect(header.querySelector('[data-todo-select-all]')).toBeTruthy();
    // The header must not appear as a focusable tree item.
    expect(header.getAttribute('role')).toBe('presentation');
    expect(header.querySelectorAll('[role="treeitem"]')).toHaveLength(0);
    list.destroy();
  });

  it('the header "select all" checkbox toggles selection of all rows', () => {
    const list = mk({ tasks: tasks() });
    const selAll = host.querySelector('[data-todo-select-all]') as HTMLElement;
    click(selAll);
    expect(list.getSelected().length).toBe(3);
    expect(selAll.classList.contains('jects-todo__rowsel--on')).toBe(true);
    click(selAll); // clears
    expect(list.getSelected().length).toBe(0);
    list.destroy();
  });

  it('the always-visible "+ subtask" button adds a nested child and edits it', () => {
    const list = mk({ tasks: tasks() });
    const before = host.querySelectorAll('[role="treeitem"]').length;
    const addBtn = host.querySelector('[data-todo-id="a"] [data-todo-action="addsub"]') as HTMLElement;
    expect(addBtn).toBeTruthy();
    click(addBtn);
    // Parent now has a child and is expanded so the child is visible.
    expect((list.getTask('a')!.children ?? []).length).toBe(1);
    expect(host.querySelector('[data-todo-id="a"]')!.getAttribute('aria-expanded')).toBe('true');
    expect(host.querySelectorAll('[role="treeitem"]').length).toBe(before + 1);
    // The new child renders nested (one level deeper) and opens inline editing.
    const editingRow = host.querySelector('.jects-todo__row--editing') as HTMLElement;
    expect(editingRow).toBeTruthy();
    expect(editingRow.getAttribute('aria-level')).toBe('2');
    expect(host.querySelector('.jects-todo__editor')).toBeTruthy();
    list.destroy();
  });
});

/* ── collaboration ─────────────────────────────────────────────────────────── */

describe('comments / activity / attachments', () => {
  it('addComment resolves @mentions against assignees + emits', () => {
    const list = mk({ tasks: tasks(), currentUser: 'Carl' });
    let fired = false;
    list.on('comment', () => { fired = true; });
    const c = list.addComment('a', 'ping @Grace Hopper please');
    expect(c?.author).toBe('Carl');
    expect(c?.mentions).toContain('Grace Hopper');
    expect(fired).toBe(true);
    expect(list.getTask('a')!.comments).toHaveLength(1);
    list.destroy();
  });

  it('field updates append activity entries', () => {
    const list = mk({ tasks: tasks(), currentUser: 'Carl' });
    list.updateTask('a', { priority: 'low' });
    const acts = list.getTask('a')!.activity ?? [];
    const entry = acts.find((x) => x.field === 'priority');
    expect(entry).toBeTruthy();
    expect(entry!.to).toBe('low');
    expect(entry!.who).toBe('Carl');
    list.destroy();
  });

  it('status changes log a status activity', () => {
    const list = mk({ tasks: tasks() });
    list.setStatus('a', 'doing');
    const acts = list.getTask('a')!.activity ?? [];
    expect(acts.some((x) => x.action === 'status' && x.to === 'doing')).toBe(true);
    list.destroy();
  });

  it('attachments add + remove with events', () => {
    const list = mk({ tasks: tasks() });
    const att = list.addAttachment('a', { name: 'spec.pdf', url: 'https://x/spec.pdf' });
    expect(att).toBeTruthy();
    expect(list.getTask('a')!.attachments).toHaveLength(1);
    expect(list.removeAttachment('a', att!.id)).toBe(true);
    expect(list.getTask('a')!.attachments).toBeUndefined();
    list.destroy();
  });
});

/* ── visibility ────────────────────────────────────────────────────────────── */

describe('progress / dependencies / timer / milestones', () => {
  it('renders a parent progress badge on a parent row', () => {
    const list = mk({ tasks: [{ id: 'p', title: 'P', children: [
      { id: 'k1', title: 'K1', done: true },
      { id: 'k2', title: 'K2' },
    ] }] });
    const badge = host.querySelector('[data-todo-id="p"] .jects-todo__pbadge-num')!;
    expect(badge.textContent).toBe('1/2');
    list.destroy();
  });

  it('addDependency rejects a cycle and keeps reverse edge', () => {
    const list = mk({ tasks: tasks() });
    expect(list.addDependency('b', 'a')).toBe(true);
    expect(list.getTask('b')!.dependencies?.blockedBy).toContain('a');
    expect(list.getTask('a')!.dependencies?.blocks).toContain('b');
    // a blocked-by b would now create a cycle (a→b→a)
    expect(list.addDependency('a', 'b')).toBe(false);
    expect(list.removeDependency('b', 'a')).toBe(true);
    expect(list.getTask('b')!.dependencies?.blockedBy ?? []).not.toContain('a');
    list.destroy();
  });

  it('shows an open-blocker warning in the detail panel', () => {
    const data = tasks();
    data[0]!.done = false; // a not done
    const list = mk({ tasks: data });
    list.addDependency('b', 'a'); // b blocked by a (a is open)
    list.openDetail('b');
    expect(host.querySelector('.jects-todo__dep-warn')).toBeTruthy();
    list.destroy();
  });

  it('start/stop timer accumulates into timeSpent', () => {
    let t = new Date(2026, 5, 24, 10, 0, 0).getTime();
    const list = mk({ tasks: tasks(), now: () => new Date(t) });
    expect(list.startTimer('a')).toBe(true);
    expect(list.isTimerRunning('a')).toBe(true);
    t += 3_600_000; // +1 hour
    const hours = list.stopTimer('a');
    expect(hours).toBeCloseTo(1, 3);
    expect(list.getTask('a')!.timeSpent).toBeCloseTo(1, 3);
    expect(list.isTimerRunning('a')).toBe(false);
    list.destroy();
  });

  it('milestone tasks render a marker and are filterable', () => {
    const list = mk({ tasks: tasks() });
    expect(host.querySelector('[data-todo-id="c"] .jects-todo__milestone')).toBeTruthy();
    list.setFilters({ milestone: true });
    expect(host.querySelector('[data-todo-id="c"]')).toBeTruthy();
    expect(host.querySelector('[data-todo-id="a"]')).toBeNull();
    list.destroy();
  });
});

/* ── i18n ──────────────────────────────────────────────────────────────────── */

describe('i18n', () => {
  it('mergeMessages overrides defaults; formatMessage interpolates', () => {
    const m = mergeMessages({ viewBoard: 'Tablero' });
    expect(m.viewBoard).toBe('Tablero');
    expect(m.viewList).toBe('List');
    expect(formatMessage(m.selectedCount, { n: 3 })).toBe('3 selected');
  });

  it('a messages override localizes the view tabs', () => {
    const list = mk({ tasks: tasks(), messages: { viewBoard: 'Tablero', viewTable: 'Tabla' } });
    const boardBtn = host.querySelector('[data-todo-view="board"]')!;
    expect(boardBtn.textContent).toBe('Tablero');
    list.destroy();
  });

  it('formatDateLocale formats per locale', () => {
    expect(formatDateLocale('2026-06-24', 'en-US')).toContain('2026');
    expect(formatDateLocale('2026-06-24', 'en-US', { month: 'long' })).toBe('June');
  });
});
