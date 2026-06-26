/**
 * TaskBoard stories — framework-free usage examples for the docs app and as a
 * canonical usage reference. Each story returns a host-mounting function.
 */
import { TaskBoard } from './board.js';
import type { KanbanCard, KanbanColumnDef, KanbanLaneDef, TaskBoardConfig } from './types.js';

export interface Story {
  name: string;
  render: (host: HTMLElement) => TaskBoard;
}

const story = (name: string, config: TaskBoardConfig): Story => ({
  name,
  render: (host) => new TaskBoard(host, config),
});

const columns: KanbanColumnDef[] = [
  { id: 'backlog', title: 'Backlog', color: 1 },
  { id: 'todo', title: 'To Do', color: 2 },
  { id: 'doing', title: 'In Progress', color: 3, limit: 3 },
  { id: 'review', title: 'Review', color: 4, limit: 2, strictLimit: true },
  { id: 'done', title: 'Done', color: 5 },
];

const lanes: KanbanLaneDef[] = [
  { id: 'urgent', title: 'Urgent' },
  { id: 'normal', title: 'Normal' },
];

function sample(): KanbanCard[] {
  return [
    {
      id: 1,
      column: 'backlog',
      title: 'Design tokens audit',
      description: 'Verify OKLCH ramps across light/dark.',
      tags: [{ text: 'design', color: 1 }, { text: 'p2', color: 4 }],
      progress: 10,
      order: 0,
    },
    {
      id: 2,
      column: 'todo',
      title: 'Drag-and-drop polish',
      description: 'Auto-scroll + multiselect.',
      tags: [{ text: 'feature', color: 2 }],
      avatar: 'KM',
      progress: 0,
      order: 0,
    },
    {
      id: 3,
      column: 'doing',
      title: 'WIP limit enforcement',
      tags: [{ text: 'core', color: 3 }],
      avatar: 'AB',
      progress: 60,
      order: 0,
    },
    {
      id: 4,
      column: 'doing',
      title: 'Inline quick-edit',
      progress: 30,
      order: 1,
    },
    {
      id: 5,
      column: 'review',
      title: 'A11y axe pass',
      tags: [{ text: 'a11y', color: 5 }],
      progress: 90,
      order: 0,
    },
    {
      id: 6,
      column: 'done',
      title: 'Token-pure CSS',
      progress: 100,
      order: 0,
      bodyItems: [{ text: 'Merged in #142' }],
    },
  ];
}

function laneSample(): KanbanCard[] {
  return [
    { id: 1, column: 'todo', lane: 'urgent', title: 'Hotfix login', tags: [{ text: 'bug', color: 4 }], order: 0 },
    { id: 2, column: 'todo', lane: 'normal', title: 'Docs polish', order: 0 },
    { id: 3, column: 'doing', lane: 'urgent', title: 'Perf regression', progress: 50, order: 0 },
    { id: 4, column: 'done', lane: 'normal', title: 'Changelog', progress: 100, order: 0 },
  ];
}

export const stories: Story[] = [
  story('Default board', { columns, cards: sample() }),
  story('With swimlanes', { columns, lanes, cards: laneSample() }),
  story('No toolbar', { columns, cards: sample(), toolbar: false }),
  story('Read-only (no drag/edit)', {
    columns,
    cards: sample(),
    draggable: false,
    editable: false,
  }),
  story('Collapsed + locked column', {
    columns: [
      { id: 'backlog', title: 'Backlog', collapsed: true },
      { id: 'todo', title: 'To Do' },
      { id: 'done', title: 'Done', locked: true },
    ],
    cards: sample(),
  }),
  story('Custom card renderer', {
    columns,
    cards: sample(),
    cardRenderer: (card) =>
      `<div class="jects-kanban-card__title">#${String(card.id)} — ${String(card.title ?? '')}</div>`,
  }),
];
