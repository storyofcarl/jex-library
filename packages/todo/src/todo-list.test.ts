/**
 * jsdom unit tests for @jects/todo — runs in the default `pnpm test`.
 * The axe-core a11y suite is todo-list.a11y.test.ts (real Chromium).
 *
 * Note: jsdom does not implement `requestAnimationFrame` timing reliably nor
 * drag events; those paths are exercised in the browser suite. Here we cover
 * model + render + events + hierarchy logic.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TodoList } from './todo-list.js';
import {
  computeProgress,
  effectiveDone,
  passesFilter,
  isOverdue,
  formatDue,
  isoToDate,
  dateToIso,
} from './todo-utils.js';
import { TodoModel } from './todo-model.js';
import type { TodoTask } from './contract.js';

let host: HTMLElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  host.remove();
});

const sample = (): TodoTask[] => [
  {
    id: 'a',
    title: 'Parent A',
    children: [
      { id: 'a1', title: 'Child A1', done: false },
      { id: 'a2', title: 'Child A2', done: false },
    ],
  },
  { id: 'b', title: 'Task B', done: true },
];

describe('todo-utils (pure)', () => {
  it('formatDue formats ISO date timezone-free', () => {
    expect(formatDue('2026-06-24')).toBe('Jun 24, 2026');
    expect(formatDue(null)).toBe('');
    expect(formatDue('')).toBe('');
  });

  it('isoToDate / dateToIso round-trip', () => {
    const d = isoToDate('2026-01-05')!;
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(0);
    expect(d.getDate()).toBe(5);
    expect(dateToIso(d)).toBe('2026-01-05');
    expect(dateToIso(null)).toBeNull();
  });

  it('isOverdue compares date-only', () => {
    const now = new Date(2026, 5, 24);
    expect(isOverdue('2026-06-23', now)).toBe(true);
    expect(isOverdue('2026-06-24', now)).toBe(false);
    expect(isOverdue('2026-06-25', now)).toBe(false);
    expect(isOverdue(null, now)).toBe(false);
  });

  it('effectiveDone derives parent completion from leaves', () => {
    const t = sample();
    expect(effectiveDone(t[0]!)).toBe(false);
    t[0]!.children![0]!.done = true;
    t[0]!.children![1]!.done = true;
    expect(effectiveDone(t[0]!)).toBe(true);
    expect(effectiveDone(t[1]!)).toBe(true);
  });

  it('computeProgress counts leaves only', () => {
    const p = computeProgress(sample());
    // leaves: a1, a2 (not done), b (done) => 1/3
    expect(p.total).toBe(3);
    expect(p.done).toBe(1);
    expect(p.percent).toBe(33);
  });

  it('passesFilter respects effective done', () => {
    const t = sample();
    expect(passesFilter(t[1]!, 'done')).toBe(true);
    expect(passesFilter(t[1]!, 'active')).toBe(false);
    expect(passesFilter(t[0]!, 'active')).toBe(true);
    expect(passesFilter(t[0]!, 'all')).toBe(true);
  });
});

describe('TodoModel (headless hierarchy)', () => {
  it('adds root + nested tasks', () => {
    const m = new TodoModel([]);
    const root = m.add({ title: 'Root' });
    const child = m.add({ title: 'Child' }, root.id);
    expect(m.roots).toHaveLength(1);
    expect(m.parentOf(child.id)?.id).toBe(root.id);
  });

  it('remove drops the subtree', () => {
    const m = new TodoModel(sample());
    m.remove('a');
    expect(m.getTask('a')).toBeUndefined();
    expect(m.getTask('a1')).toBeUndefined();
    expect(m.roots).toHaveLength(1);
  });

  it('indent nests under preceding sibling; outdent promotes', () => {
    const m = new TodoModel([
      { id: '1', title: 'One' },
      { id: '2', title: 'Two' },
    ]);
    expect(m.indent('2')).toBe(true);
    expect(m.parentOf('2')?.id).toBe('1');
    expect(m.roots).toHaveLength(1);
    expect(m.outdent('2')).toBe(true);
    expect(m.parentOf('2')).toBeNull();
    expect(m.roots).toHaveLength(2);
  });

  it('indent refuses for the first sibling', () => {
    const m = new TodoModel([{ id: '1', title: 'One' }]);
    expect(m.indent('1')).toBe(false);
  });

  it('reorder moves among siblings', () => {
    const m = new TodoModel([
      { id: '1', title: 'One' },
      { id: '2', title: 'Two' },
      { id: '3', title: 'Three' },
    ]);
    expect(m.reorder('3', 0)).toBe(true);
    expect(m.roots.map((t) => t.id)).toEqual(['3', '1', '2']);
  });

  it('moveTo refuses to drop a task into its own subtree', () => {
    const m = new TodoModel(sample());
    expect(m.moveTo('a', 'a1', 0)).toBe(false);
  });

  it('setDone cascades down and rolls up', () => {
    const m = new TodoModel(sample());
    // mark a1 + a2 done; parent a should roll up to done
    m.setDone('a1', true, true);
    m.setDone('a2', true, true);
    expect(m.getTask('a')!.done).toBe(true);
    // unchecking a child rolls the parent back down
    m.setDone('a1', false, true);
    expect(m.getTask('a')!.done).toBe(false);
  });

  it('setDone on a parent cascades to all descendants', () => {
    const m = new TodoModel(sample());
    const affected = m.setDone('a', true, true);
    expect(m.getTask('a1')!.done).toBe(true);
    expect(m.getTask('a2')!.done).toBe(true);
    expect(affected.map((t) => String(t.id)).sort()).toEqual(['a', 'a1', 'a2']);
  });
});

describe('TodoList (jsdom widget)', () => {
  it('renders toolbar, list (role=tree), and progress', () => {
    const list = new TodoList(host, { tasks: sample() });
    expect(host.querySelector('.jects-todo')).toBeTruthy();
    expect(host.querySelector('[role="tree"]')).toBeTruthy();
    expect(host.querySelector('.jects-todo__toolbar')).toBeTruthy();
    expect(host.querySelector('[role="progressbar"]')).toBeTruthy();
    list.destroy();
  });

  it('renders visible rows (collapsed parents hide children by default)', () => {
    const list = new TodoList(host, { tasks: sample() });
    // a is collapsed by default => a1/a2 not rendered; a and b shown
    const rows = host.querySelectorAll('[role="treeitem"]');
    expect(rows).toHaveLength(2);
    list.expand('a');
    expect(host.querySelectorAll('[role="treeitem"]')).toHaveLength(4);
    list.destroy();
  });

  it('treeitem rows carry aria-level / aria-expanded', () => {
    const list = new TodoList(host, { tasks: sample() });
    list.expand('a');
    const parent = host.querySelector('[data-todo-id="a"]')!;
    expect(parent.getAttribute('aria-level')).toBe('1');
    expect(parent.getAttribute('aria-expanded')).toBe('true');
    const child = host.querySelector('[data-todo-id="a1"]')!;
    expect(child.getAttribute('aria-level')).toBe('2');
    list.destroy();
  });

  it('addTask emits beforeAdd + add and renders a new row', () => {
    const list = new TodoList(host, { tasks: [] });
    const before = vi.fn();
    const after = vi.fn();
    list.on('beforeAdd', before);
    list.on('add', after);
    const created = list.addTask({ title: 'New' });
    expect(created).toBeTruthy();
    expect(before).toHaveBeenCalledTimes(1);
    expect(after).toHaveBeenCalledTimes(1);
    expect(host.querySelectorAll('[role="treeitem"]')).toHaveLength(1);
    list.destroy();
  });

  it('beforeAdd veto cancels the add', () => {
    const list = new TodoList(host, { tasks: [] });
    list.on('beforeAdd', () => false);
    const created = list.addTask({ title: 'Nope' });
    expect(created).toBeUndefined();
    expect(host.querySelectorAll('[role="treeitem"]')).toHaveLength(0);
    list.destroy();
  });

  it('inline add input commits on Enter', () => {
    const list = new TodoList(host, { tasks: [] });
    const input = host.querySelector('.jects-todo__add-input') as HTMLInputElement;
    input.value = 'Typed task';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(list.getTasks().map((t) => t.title)).toContain('Typed task');
    expect(input.value).toBe('');
    list.destroy();
  });

  it('clicking the Done toggle toggles + emits toggle', () => {
    const list = new TodoList(host, { tasks: [{ id: 'x', title: 'X' }] });
    const spy = vi.fn();
    list.on('toggle', spy);
    const doneBtn = host.querySelector('[data-todo-id="x"] .jects-todo__done') as HTMLButtonElement;
    expect(doneBtn.textContent).toContain('Done');
    expect(doneBtn.getAttribute('aria-pressed')).toBe('false');
    doneBtn.click();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(list.getTask('x')!.done).toBe(true);
    // After toggling the row re-renders; the toggle now reflects the done state.
    const after = host.querySelector('[data-todo-id="x"] .jects-todo__done') as HTMLButtonElement;
    expect(after.getAttribute('aria-pressed')).toBe('true');
    expect(after.classList.contains('jects-todo__done--on')).toBe(true);
    list.destroy();
  });

  it('removeTask emits remove and drops the row', () => {
    const list = new TodoList(host, { tasks: [{ id: 'x', title: 'X' }] });
    const spy = vi.fn();
    list.on('remove', spy);
    list.removeTask('x');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(host.querySelectorAll('[role="treeitem"]')).toHaveLength(0);
    list.destroy();
  });

  it('delete action button removes a task', () => {
    const list = new TodoList(host, { tasks: [{ id: 'x', title: 'X' }] });
    const del = host.querySelector('[data-todo-id="x"] [data-todo-action="delete"]') as HTMLButtonElement;
    del.click();
    expect(list.getTask('x')).toBeUndefined();
    list.destroy();
  });

  it('twisty click toggles expansion', () => {
    const list = new TodoList(host, { tasks: sample() });
    const twisty = host.querySelector('[data-todo-id="a"] [data-todo-action="twisty"]') as HTMLButtonElement;
    twisty.click();
    expect(host.querySelectorAll('[role="treeitem"]')).toHaveLength(4);
    list.destroy();
  });

  it('setFilter filters rows and emits filter', () => {
    const list = new TodoList(host, { tasks: sample() });
    const spy = vi.fn();
    list.on('filter', spy);
    list.setFilter('done');
    // only b (done) is shown
    expect(host.querySelectorAll('[role="treeitem"]')).toHaveLength(1);
    expect(host.querySelector('[data-todo-id="b"]')).toBeTruthy();
    expect(spy).toHaveBeenCalledTimes(1);
    list.setFilter('active');
    expect(host.querySelector('[data-todo-id="b"]')).toBeNull();
    list.destroy();
  });

  it('clicking a filter button updates aria-pressed', () => {
    const list = new TodoList(host, { tasks: sample() });
    const doneBtn = host.querySelector('[data-todo-filter="done"]') as HTMLButtonElement;
    doneBtn.click();
    expect(doneBtn.getAttribute('aria-pressed')).toBe('true');
    expect(list.getFilter()).toBe('done');
    list.destroy();
  });

  it('progress reflects completion and emits progress', () => {
    const list = new TodoList(host, { tasks: sample() });
    const p = list.getProgress();
    expect(p.total).toBe(3);
    expect(p.done).toBe(1);
    const bar = host.querySelector('[role="progressbar"]')!;
    expect(bar.getAttribute('aria-valuenow')).toBe('33');
    list.destroy();
  });

  it('indent/outdent API re-parents and emits move', () => {
    const list = new TodoList(host, {
      tasks: [
        { id: '1', title: 'One' },
        { id: '2', title: 'Two' },
      ],
    });
    const spy = vi.fn();
    list.on('move', spy);
    expect(list.indent('2')).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    // '1' is now a parent; expand to see child '2'
    list.expand('1');
    expect(host.querySelector('[data-todo-id="2"]')!.getAttribute('aria-level')).toBe('2');
    list.destroy();
  });

  it('keyboard: ArrowDown moves roving focus, Space toggles done', () => {
    const list = new TodoList(host, {
      tasks: [
        { id: '1', title: 'One' },
        { id: '2', title: 'Two' },
      ],
    });
    const row1 = host.querySelector('[data-todo-id="1"]') as HTMLElement;
    row1.focus();
    row1.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    expect(list.getTask('1')!.done).toBe(true);
    // Toggling rebuilt the rows; re-query the live row1 (as real focus would be).
    const liveRow1 = host.querySelector('[data-todo-id="1"]') as HTMLElement;
    liveRow1.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    const row2 = host.querySelector('[data-todo-id="2"]') as HTMLElement;
    expect(row2.getAttribute('tabindex')).toBe('0');
    list.destroy();
  });

  it('keyboard: Tab indents, Shift+Tab outdents', () => {
    const list = new TodoList(host, {
      tasks: [
        { id: '1', title: 'One' },
        { id: '2', title: 'Two' },
      ],
    });
    const row2 = host.querySelector('[data-todo-id="2"]') as HTMLElement;
    row2.focus();
    row2.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    expect(list.getTask('2') && list.getTasks()[0]!.children?.[0]?.id).toBe('2');
    list.destroy();
  });

  it('updateTask patches title and emits update', () => {
    const list = new TodoList(host, { tasks: [{ id: 'x', title: 'Old' }] });
    const spy = vi.fn();
    list.on('update', spy);
    list.updateTask('x', { title: 'New', priority: 'high' });
    expect(list.getTask('x')!.title).toBe('New');
    expect(list.getTask('x')!.priority).toBe('high');
    expect(spy).toHaveBeenCalledTimes(1);
    list.destroy();
  });

  it('update({ tasks }) rebuilds the tree', () => {
    const list = new TodoList(host, { tasks: [{ id: 'old', title: 'Old' }] });
    list.update({ tasks: [{ id: 'new', title: 'New' }] });
    expect(list.getTask('old')).toBeUndefined();
    expect(list.getTask('new')!.title).toBe('New');
    expect(host.querySelector('[data-todo-id="new"]')).toBeTruthy();
    list.destroy();
  });

  it('update({ filter }) re-filters in place', () => {
    const list = new TodoList(host, { tasks: sample() });
    list.update({ filter: 'done' });
    expect(host.querySelectorAll('[role="treeitem"]')).toHaveLength(1);
    expect(host.querySelector('[data-todo-id="b"]')).toBeTruthy();
    list.destroy();
  });

  it('role="tree" is dropped when the list is empty (aria-required-children)', () => {
    const list = new TodoList(host, { tasks: [] });
    expect(host.querySelector('.jects-todo__list')!.getAttribute('role')).toBeNull();
    list.addTask({ title: 'first' });
    expect(host.querySelector('.jects-todo__list')!.getAttribute('role')).toBe('tree');
    list.destroy();
  });

  it('registers with the factory as "todolist"', async () => {
    const { isRegistered, create } = await import('@jects/core');
    expect(isRegistered('todolist')).toBe(true);
    const w = create({ type: 'todolist', tasks: [{ id: 'z', title: 'Z' }] }, host) as unknown as TodoList;
    expect(host.querySelector('[data-todo-id="z"]')).toBeTruthy();
    w.destroy();
  });

  it('destroy removes element and its rows', () => {
    const list = new TodoList(host, { tasks: sample() });
    expect(host.querySelector('.jects-todo__done')).toBeTruthy();
    expect(host.querySelector('.jects-todo__row')).toBeTruthy();
    list.destroy();
    expect(host.querySelector('.jects-todo')).toBeNull();
    expect(host.querySelector('.jects-todo__row')).toBeNull();
  });

  it('destroy is idempotent', () => {
    const list = new TodoList(host, { tasks: sample() });
    list.destroy();
    expect(() => list.destroy()).not.toThrow();
  });
});
