/**
 * TodoList stories — framework-free usage examples used by the docs app and as
 * canonical examples. Each story returns a host-mounting function.
 */
import { TodoList } from './todo-list.js';
import type { TodoListConfig, TodoTask } from './contract.js';

export interface Story {
  name: string;
  render: (host: HTMLElement) => TodoList;
}

const story = (name: string, config: TodoListConfig): Story => ({
  name,
  render: (host) => new TodoList(host, config),
});

const groceries: TodoTask[] = [
  {
    id: 'launch',
    title: 'Launch checklist',
    priority: 'high',
    children: [
      { id: 'copy', title: 'Finalize landing copy', done: true },
      { id: 'qa', title: 'QA the signup flow', due: '2026-07-01' },
      {
        id: 'assets',
        title: 'Marketing assets',
        children: [
          { id: 'og', title: 'OG image', done: true },
          { id: 'video', title: 'Demo video', priority: 'medium' },
        ],
      },
    ],
  },
  { id: 'standup', title: 'Daily standup notes', due: '2026-06-24', priority: 'low' },
  { id: 'invoices', title: 'Send invoices', done: true },
];

export const stories: Story[] = [
  story('Basic (flat)', {
    tasks: [
      { id: '1', title: 'Buy milk' },
      { id: '2', title: 'Walk the dog', done: true },
      { id: '3', title: 'Read a chapter', priority: 'low' },
    ],
  }),
  story('Hierarchy + roll-up', { tasks: groceries }),
  story('Due dates + priorities', {
    tasks: [
      { id: 'p1', title: 'Ship release', due: '2026-06-20', priority: 'high' },
      { id: 'p2', title: 'Review PRs', due: '2026-06-30', priority: 'medium' },
      { id: 'p3', title: 'Update docs', priority: 'low' },
    ],
  }),
  story('No toolbar / no progress', {
    tasks: [{ id: 'x', title: 'Minimal embed' }],
    toolbar: false,
    progress: false,
  }),
  story('Reorder disabled', {
    tasks: [
      { id: 'r1', title: 'Fixed order one' },
      { id: 'r2', title: 'Fixed order two' },
    ],
    reorderable: false,
  }),
  story('Filtered to active', {
    tasks: groceries,
    filter: 'active',
  }),
  story('Empty', { tasks: [] }),
];
