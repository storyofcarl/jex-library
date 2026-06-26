/**
 * axe-core a11y browser test for TodoList (real Chromium).
 * Run with `pnpm --filter @jects/todo test:browser`.
 * Asserts zero serious/critical violations (Quality Gate Q2).
 */
import { describe, it, beforeEach, afterEach } from 'vitest';
import { TodoList } from './todo-list.js';
import { expectNoA11yViolations } from './test-utils/a11y.js';
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
    priority: 'high',
    due: '2026-06-23',
    children: [
      { id: 'a1', title: 'Child A1' },
      { id: 'a2', title: 'Child A2', done: true },
    ],
  },
  { id: 'b', title: 'Task B', done: true, priority: 'low' },
];

describe('TodoList a11y (axe-core)', () => {
  it('has no serious/critical violations (default, collapsed)', async () => {
    const list = new TodoList(host, { tasks: sample() });
    await expectNoA11yViolations(host);
    list.destroy();
  });

  it('has no serious/critical violations when expanded', async () => {
    const list = new TodoList(host, { tasks: sample() });
    list.expand('a');
    await expectNoA11yViolations(host);
    list.destroy();
  });

  it('has no serious/critical violations when empty', async () => {
    const list = new TodoList(host, { tasks: [] });
    await expectNoA11yViolations(host);
    list.destroy();
  });

  it('has no serious/critical violations with the inline editor open', async () => {
    const list = new TodoList(host, { tasks: sample() });
    const editBtn = host.querySelector(
      '[data-todo-id="a"] [data-todo-action="edit"]',
    ) as HTMLButtonElement;
    editBtn.click();
    await expectNoA11yViolations(host);
    list.destroy();
  });

  it('has no serious/critical violations across each filter', async () => {
    const list = new TodoList(host, { tasks: sample() });
    for (const f of ['active', 'done', 'all'] as const) {
      list.setFilter(f);
      await expectNoA11yViolations(host);
    }
    list.destroy();
  });
});
