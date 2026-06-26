/**
 * jsdom unit tests for the enterprise feature set of @jects/todo:
 * statuses/workflow, rich model, sort/group/filter/search, board view,
 * due-status + reminders, recurring tasks, multi-select + bulk, undo/redo,
 * data provider + load, and export.
 *
 * Runs in the default `pnpm test` (jsdom). Drag timing / axe live in the
 * browser suites; here we cover model + render + events + API logic.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TodoList } from './todo-list.js';
import { TodoModel } from './todo-model.js';
import {
  dueStatus,
  matchesSearch,
  matchesCriteria,
  sortTree,
  groupKeysOf,
  tasksToCsv,
  tasksToJson,
  DEFAULT_STATUSES,
  effectiveStatus,
} from './todo-utils.js';
import { parseRecurrence, nextOccurrence, describeRecurrence } from './todo-recurrence.js';
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
  { id: 'todo', label: 'To Do', isDone: false },
  { id: 'doing', label: 'In Progress', isDone: false },
  { id: 'blocked', label: 'Blocked', isDone: false },
  { id: 'done', label: 'Done', isDone: true },
];

const NOW = (): Date => new Date(2026, 5, 24); // 2026-06-24

const richTasks = (): TodoTask[] => [
  { id: 'a', title: 'Alpha', priority: 'high', due: '2026-06-20', assignees: ['Ada Lovelace'], tags: [{ text: 'urgent' }] },
  { id: 'b', title: 'Beta', priority: 'low', due: '2026-06-24', status: 'doing', assignees: ['Grace Hopper'], tags: [{ text: 'docs' }] },
  { id: 'c', title: 'Gamma', priority: 'medium', due: '2026-06-30', status: 'done' },
];

const mk = (cfg: Partial<TodoListConfig> = {}): TodoList =>
  new TodoList(host, { now: NOW, statuses: STATUSES, ...cfg });

/* ── pure helpers ────────────────────────────────────────────────────────── */

describe('recurrence (RRULE subset)', () => {
  it('parses + describes a weekly rule', () => {
    const r = parseRecurrence('FREQ=WEEKLY;BYDAY=MO,WE');
    expect(r?.freq).toBe('weekly');
    expect(r?.byWeekday).toEqual([1, 3]);
    expect(describeRecurrence('FREQ=WEEKLY;INTERVAL=2')).toContain('2 week');
  });

  it('computes the next daily occurrence after a date', () => {
    expect(nextOccurrence('FREQ=DAILY', '2026-06-24')).toBe('2026-06-25');
    expect(nextOccurrence('FREQ=DAILY;INTERVAL=3', '2026-06-24')).toBe('2026-06-27');
  });

  it('computes the next monthly occurrence honoring day-of-month', () => {
    expect(nextOccurrence('FREQ=MONTHLY', '2026-01-15')).toBe('2026-02-15');
  });

  it('stops at COUNT / UNTIL', () => {
    // anchor 06-24, count 1 → no occurrence after the first
    expect(nextOccurrence('FREQ=DAILY;COUNT=1', '2026-06-24', '2026-06-24')).toBeNull();
    expect(nextOccurrence('FREQ=DAILY;UNTIL=20260625', '2026-06-25')).toBeNull();
  });
});

describe('due-status + search + criteria + sort + group helpers', () => {
  it('buckets due dates relative to now', () => {
    const now = new Date(2026, 5, 24);
    expect(dueStatus('2026-06-23', now)).toBe('overdue');
    expect(dueStatus('2026-06-24', now)).toBe('today');
    expect(dueStatus('2026-06-26', now, 3)).toBe('soon');
    expect(dueStatus('2026-07-30', now, 3)).toBe('upcoming');
    expect(dueStatus(null, now)).toBe('none');
  });

  it('search matches title / notes / tags / assignees', () => {
    const t = richTasks()[0]!;
    expect(matchesSearch(t, 'alph')).toBe(true);
    expect(matchesSearch(t, 'urgent')).toBe(true);
    expect(matchesSearch(t, 'ada')).toBe(true);
    expect(matchesSearch(t, 'zzz')).toBe(false);
  });

  it('multi-criteria filtering ANDs across axes', () => {
    const t = richTasks()[1]!; // Beta, doing, low, Grace, docs
    expect(matchesCriteria(t, { status: ['doing'] }, STATUSES)).toBe(true);
    expect(matchesCriteria(t, { status: ['todo'] }, STATUSES)).toBe(false);
    expect(matchesCriteria(t, { priority: ['low'], tags: ['docs'] }, STATUSES)).toBe(true);
    expect(matchesCriteria(t, { assignees: ['Ada Lovelace'] }, STATUSES)).toBe(false);
  });

  it('sortTree orders siblings by field', () => {
    const sorted = sortTree(richTasks(), [{ field: 'title', dir: 'desc' }], STATUSES);
    expect(sorted.map((t) => t.id)).toEqual(['c', 'b', 'a']);
    const byPrio = sortTree(richTasks(), [{ field: 'priority', dir: 'desc' }], STATUSES);
    expect(byPrio[0]!.id).toBe('a'); // high first
  });

  it('groupKeysOf returns multiple keys for tags', () => {
    const t: TodoTask = { id: 'x', title: 'X', tags: [{ text: 'p1' }, { text: 'p2' }] };
    const keys = groupKeysOf(t, 'tag', STATUSES);
    expect(keys.map((k) => k.key).sort()).toEqual(['p1', 'p2']);
  });
});

/* ── feature 1: statuses / workflow ──────────────────────────────────────── */

describe('statuses / workflow', () => {
  it('exposes the configured statuses and maps done<->status', () => {
    const list = mk({ tasks: richTasks() });
    expect(list.getStatuses().map((s) => s.id)).toEqual(['todo', 'doing', 'blocked', 'done']);
    // c is done → effective done true; b doing → not done
    expect(list.getTask('c')!.done).toBe(true);
    expect(list.getTask('b')!.done).toBe(false);
    list.destroy();
  });

  it('setStatus updates status + done and fires the status event', () => {
    const list = mk({ tasks: richTasks() });
    const spy = vi.fn();
    list.on('status', spy);
    list.setStatus('a', 'done');
    expect(list.getTask('a')!.status).toBe('done');
    expect(list.getTask('a')!.done).toBe(true);
    list.setStatus('a', 'blocked');
    expect(list.getTask('a')!.done).toBe(false);
    expect(spy).toHaveBeenCalled();
    list.destroy();
  });

  it('roll-up + progress respect isDone via status', () => {
    const list = mk({ tasks: [{ id: 'p', title: 'P', children: [{ id: 'c1', title: 'C1' }, { id: 'c2', title: 'C2' }] }] });
    list.setStatus('c1', 'done');
    list.setStatus('c2', 'done');
    expect(list.getProgress().done).toBe(2);
    expect(effectiveStatus(list.getTask('p')!, STATUSES).isDone).toBe(true);
    list.destroy();
  });
});

/* ── feature 3: sort / group / filter / search (widget) ──────────────────── */

describe('sort / group / filter / search (widget)', () => {
  it('setSearch narrows rows and keeps ancestors of matches', () => {
    const list = mk({ tasks: [{ id: 'p', title: 'Parent', children: [{ id: 'k', title: 'needle child' }] }] });
    list.setSearch('needle');
    // ancestor p + matching k visible
    expect(host.querySelector('[data-todo-id="p"]')).toBeTruthy();
    expect(host.querySelector('[data-todo-id="k"]')).toBeTruthy();
    list.setSearch('zzz');
    expect(host.querySelectorAll('[role="treeitem"]')).toHaveLength(0);
    list.destroy();
  });

  it('setFilters filters by status', () => {
    const list = mk({ tasks: richTasks() });
    list.setFilters({ status: ['doing'] });
    expect(host.querySelectorAll('[data-todo-id]')).toHaveLength(1);
    expect(host.querySelector('[data-todo-id="b"]')).toBeTruthy();
    list.destroy();
  });

  it('setGroupBy renders group headers with counts', () => {
    const list = mk({ tasks: richTasks(), groupBy: 'priority' });
    const headers = host.querySelectorAll('.jects-todo__group-header');
    expect(headers.length).toBeGreaterThanOrEqual(3);
    const counts = [...host.querySelectorAll('.jects-todo__group-count')].map((e) => e.textContent);
    expect(counts).toContain('1');
    list.destroy();
  });

  it('setSort reorders rows (title desc)', () => {
    const list = mk({ tasks: richTasks() });
    list.setSort({ field: 'title', dir: 'desc' });
    const ids = [...host.querySelectorAll('[data-todo-id]')].map((e) => (e as HTMLElement).dataset.todoId);
    expect(ids).toEqual(['c', 'b', 'a']);
    list.destroy();
  });

  it('saveFilter + applySavedFilter round-trips', () => {
    const list = mk({ tasks: richTasks() });
    list.setFilters({ priority: ['high'] });
    const saved = list.saveFilter('Highs');
    list.setFilters({});
    expect(host.querySelectorAll('[data-todo-id]').length).toBe(3);
    expect(list.applySavedFilter(saved.id)).toBe(true);
    expect(host.querySelectorAll('[data-todo-id]')).toHaveLength(1);
    list.destroy();
  });
});

/* ── feature 4: board view ───────────────────────────────────────────────── */

describe('board view', () => {
  it('setView("board") renders a column per status', () => {
    const list = mk({ tasks: richTasks() });
    list.setView('board');
    expect(list.getView()).toBe('board');
    expect(host.querySelectorAll('.jects-todo__col')).toHaveLength(4);
    // each task becomes a card
    expect(host.querySelectorAll('.jects-todo__card')).toHaveLength(3);
    // 'b' sits in the doing column
    const doingCol = host.querySelector('[data-todo-status="doing"]')!;
    expect(doingCol.querySelector('[data-todo-id="b"]')).toBeTruthy();
    list.destroy();
  });

  it('setStatus moves a card between columns', () => {
    const list = mk({ tasks: richTasks(), view: 'board' });
    list.setStatus('a', 'blocked');
    const blockedCol = host.querySelector('[data-todo-status="blocked"]')!;
    expect(blockedCol.querySelector('[data-todo-id="a"]')).toBeTruthy();
    list.destroy();
  });
});

/* ── feature 5: due-status + reminders ───────────────────────────────────── */

describe('due-status + reminders', () => {
  it('marks overdue / due-today rows with classes', () => {
    const list = mk({ tasks: richTasks() });
    expect(host.querySelector('[data-todo-id="a"]')!.classList.contains('jects-todo__row--due-overdue')).toBe(true);
    expect(host.querySelector('[data-todo-id="b"]')!.classList.contains('jects-todo__row--due-today')).toBe(true);
    list.destroy();
  });

  it('fires reminder events for due/overdue tasks on load', () => {
    const list = mk({ tasks: richTasks() });
    const spy = vi.fn();
    list.on('reminder', spy);
    list.load(richTasks()); // clears reminded keys + re-checks
    const kinds = spy.mock.calls.map((c) => c[0].kind);
    expect(kinds).toContain('overdue'); // a
    expect(kinds).toContain('today'); // b
    list.destroy();
  });
});

/* ── feature 6: recurring tasks ──────────────────────────────────────────── */

describe('recurring tasks', () => {
  it('completing a recurring task spawns the next occurrence', () => {
    const list = mk({ tasks: [{ id: 'r', title: 'Standup', due: '2026-06-24', recurrence: 'FREQ=DAILY' }] });
    const spy = vi.fn();
    list.on('recur', spy);
    list.toggleTask('r', true);
    expect(spy).toHaveBeenCalledTimes(1);
    const tasks = list.getTasks();
    const next = tasks.find((t) => t.id !== 'r' && t.title === 'Standup');
    expect(next?.due).toBe('2026-06-25');
    expect(next?.done).toBe(false);
    list.destroy();
  });

  it('model.spawnNext respects the series anchor', () => {
    const m = new TodoModel([{ id: 'r', title: 'R', due: '2026-06-24', recurrence: 'FREQ=WEEKLY' }], 'id', STATUSES);
    const next = m.spawnNext('r', '2026-06-24');
    expect(next?.due).toBe('2026-07-01');
    expect(next?.recurrenceAnchor).toBe('2026-06-24');
  });
});

/* ── feature 7: multi-select + bulk ──────────────────────────────────────── */

describe('multi-select + bulk actions', () => {
  it('select / selectAll / getSelected track selection', () => {
    const list = mk({ tasks: richTasks() });
    list.select('a');
    expect(list.getSelected()).toEqual(['a']);
    list.select('b', { additive: true });
    expect(list.getSelected().sort()).toEqual(['a', 'b']);
    list.selectAll();
    expect(list.getSelected().sort()).toEqual(['a', 'b', 'c']);
    list.clearSelection();
    expect(list.getSelected()).toEqual([]);
    list.destroy();
  });

  it('bulkComplete + bulkSetStatus + bulkRemove operate on the selection', () => {
    const list = mk({ tasks: richTasks() });
    list.selectAll();
    list.bulkComplete(true);
    expect(list.getProgress().done).toBe(3);
    list.selectAll();
    list.bulkSetPriority('low');
    expect(list.getTask('a')!.priority).toBe('low');
    list.select('a');
    list.bulkRemove();
    expect(list.getTask('a')).toBeUndefined();
    list.destroy();
  });

  it('shows the bulk bar when a selection exists', () => {
    const list = mk({ tasks: richTasks() });
    const bar = host.querySelector('.jects-todo__bulkbar') as HTMLElement;
    expect(bar.hidden).toBe(true);
    list.select('a');
    expect(bar.hidden).toBe(false);
    expect(bar.querySelector('.jects-todo__bulk-count')!.textContent).toBe('1 selected');
    list.destroy();
  });
});

/* ── feature 8: undo / redo ──────────────────────────────────────────────── */

describe('undo / redo', () => {
  it('undoes and redoes add / remove / status / move', () => {
    const list = mk({ tasks: richTasks() });
    list.addTask({ id: 'd', title: 'Delta' });
    expect(list.getTask('d')).toBeTruthy();
    expect(list.canUndo()).toBe(true);
    list.undo();
    expect(list.getTask('d')).toBeUndefined();
    list.redo();
    expect(list.getTask('d')).toBeTruthy();

    list.setStatus('a', 'done');
    expect(list.getTask('a')!.status).toBe('done');
    list.undo();
    expect(list.getTask('a')!.status).toBe('todo');
    list.destroy();
  });

  it('emits history events with availability', () => {
    const list = mk({ tasks: richTasks() });
    const spy = vi.fn();
    list.on('history', spy);
    list.addTask({ id: 'z', title: 'Z' });
    const last = spy.mock.calls.at(-1)![0];
    expect(last.canUndo).toBe(true);
    list.destroy();
  });
});

/* ── feature 9: persistence / data provider ──────────────────────────────── */

describe('persistence / data provider', () => {
  it('load replaces tasks and emits load + change', () => {
    const list = mk({ tasks: [] });
    const loadSpy = vi.fn();
    const changeSpy = vi.fn();
    list.on('load', loadSpy);
    list.on('change', changeSpy);
    list.load([{ id: 'n', title: 'New' }]);
    expect(list.getTask('n')!.title).toBe('New');
    expect(loadSpy).toHaveBeenCalledTimes(1);
    expect(changeSpy).toHaveBeenCalled();
    list.destroy();
  });

  it('onChange + dataProvider.sync fire optimistically on mutation', () => {
    const sync = vi.fn();
    const onChange = vi.fn();
    const list = mk({ tasks: richTasks(), onChange, dataProvider: { sync } });
    list.addTask({ id: 'd', title: 'Delta' });
    expect(onChange).toHaveBeenCalled();
    expect(sync).toHaveBeenCalled();
    const [tasks, change] = sync.mock.calls.at(-1)!;
    expect(change.action).toBe('add');
    expect((tasks as TodoTask[]).some((t) => t.id === 'd')).toBe(true);
    list.destroy();
  });

  it('dataProvider.load hydrates on mount', async () => {
    const load = vi.fn(async () => [{ id: 'srv', title: 'Server task' }] as TodoTask[]);
    const list = mk({ tasks: [], dataProvider: { load } });
    await Promise.resolve();
    await Promise.resolve();
    expect(load).toHaveBeenCalled();
    expect(list.getTask('srv')?.title).toBe('Server task');
    list.destroy();
  });
});

/* ── feature 10: export ──────────────────────────────────────────────────── */

describe('export', () => {
  it('exports JSON containing the tasks', () => {
    const list = mk({ tasks: richTasks() });
    const json = list.export({ format: 'json' });
    const parsed = JSON.parse(json) as TodoTask[];
    expect(parsed.map((t) => t.id)).toEqual(['a', 'b', 'c']);
    list.destroy();
  });

  it('exports CSV with a header + a row per task', () => {
    const list = mk({ tasks: richTasks() });
    const csv = list.export({ format: 'csv' });
    const lines = csv.split('\n');
    expect(lines[0]).toContain('title');
    expect(lines).toHaveLength(4); // header + 3
    expect(csv).toContain('Alpha');
    expect(csv).toContain('In Progress'); // status label for b
    list.destroy();
  });

  it('utils tasksToCsv / tasksToJson flatten the tree', () => {
    const tasks: TodoTask[] = [{ id: 'p', title: 'P', children: [{ id: 'k', title: 'K' }] }];
    expect(tasksToCsv(tasks, DEFAULT_STATUSES).split('\n')).toHaveLength(3);
    expect(JSON.parse(tasksToJson(tasks, true))).toHaveLength(2);
  });
});

/* ── feature 2: rich model rendering + detail panel ──────────────────────── */

describe('rich model + detail panel', () => {
  it('renders status pill, tags, and avatars on the row', () => {
    const list = mk({ tasks: richTasks() });
    const rowA = host.querySelector('[data-todo-id="a"]')!;
    expect(rowA.querySelector('.jects-todo__status')!.textContent).toBe('To Do');
    expect(rowA.querySelector('.jects-todo__tag')!.textContent).toBe('urgent');
    expect(rowA.querySelector('.jects-todo__avatar')!.textContent).toBe('AL'); // Ada Lovelace
    list.destroy();
  });

  it('openDetail builds the side panel; editing a field commits', () => {
    const list = mk({ tasks: richTasks() });
    list.openDetail('a');
    const panel = host.querySelector('.jects-todo__detail')!;
    expect(panel).toBeTruthy();
    // change estimate via the detail field
    const est = panel.querySelector('[data-detail-field="estimate"]') as HTMLInputElement;
    est.value = '5';
    est.dispatchEvent(new Event('change', { bubbles: true }));
    expect(list.getTask('a')!.estimate).toBe(5);
    // change status via detail select
    const statusSel = panel.querySelector('[data-detail-field="status"]') as HTMLSelectElement;
    statusSel.value = 'done';
    statusSel.dispatchEvent(new Event('change', { bubbles: true }));
    expect(list.getTask('a')!.done).toBe(true);
    list.closeDetail();
    expect(host.querySelector('.jects-todo__detail')).toBeNull();
    list.destroy();
  });

  it('supports custom fields in the detail panel', () => {
    const list = mk({
      tasks: [{ id: 'a', title: 'A' }],
      customFieldDefs: [{ id: 'sp', label: 'Story Points', type: 'number', showOnRow: true }],
    });
    list.openDetail('a');
    const cf = host.querySelector('[data-detail-field="cf:sp"]') as HTMLInputElement;
    cf.value = '8';
    cf.dispatchEvent(new Event('change', { bubbles: true }));
    expect(list.getTask('a')!.customFields?.sp).toBe(8);
    list.destroy();
  });
});
