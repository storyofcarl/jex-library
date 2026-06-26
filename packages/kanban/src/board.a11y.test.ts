/**
 * Accessibility (axe-core) suite — Quality Gate Q2. Runs in real Chromium.
 * Asserts zero serious/critical violations for the TaskBoard across its main
 * configurations (plain, swimlanes, with toolbar/search), and checks the core
 * keyboard/roles contract: a search toolbar, list/listitem semantics on
 * columns/cards, focusable cards, and column collapse toggles with
 * aria-expanded.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import '@jects/theme/style.css';
import './styles.css';
import { TaskBoard } from './board.js';
import type { KanbanCard, KanbanColumnDef } from './types.js';
import { expectNoA11yViolations } from './test-utils/a11y.js';

const columns: KanbanColumnDef[] = [
  { id: 'todo', title: 'To Do' },
  { id: 'doing', title: 'Doing', limit: 2 },
  { id: 'done', title: 'Done' },
];

function cards(): KanbanCard[] {
  return [
    { id: 1, column: 'todo', title: 'Write spec', description: 'Draft it', tags: [{ text: 'doc' }] },
    { id: 2, column: 'todo', title: 'Review PR', progress: 40 },
    { id: 3, column: 'doing', title: 'Build board', avatar: 'AB' },
  ];
}

let host: HTMLElement;
beforeEach(() => {
  host = document.createElement('div');
  host.style.width = '900px';
  host.style.height = '480px';
  document.body.appendChild(host);
});
afterEach(() => host.remove());

describe('TaskBoard a11y', () => {
  it('plain board has no serious/critical violations', async () => {
    const b = new TaskBoard(host, { columns, cards: cards() });
    await expectNoA11yViolations(host);
    b.destroy();
  });

  it('board with swimlanes has no serious/critical violations', async () => {
    const b = new TaskBoard(host, {
      columns,
      lanes: [
        { id: 'hi', title: 'High' },
        { id: 'lo', title: 'Low' },
      ],
      cards: [
        { id: 1, column: 'todo', lane: 'hi', title: 'A' },
        { id: 2, column: 'todo', lane: 'lo', title: 'B' },
      ],
    });
    await expectNoA11yViolations(host);
    b.destroy();
  });

  it('exposes search toolbar, list semantics, focusable cards and toggle aria', () => {
    const b = new TaskBoard(host, { columns, cards: cards() });

    expect(host.querySelector('[role="toolbar"]')).toBeTruthy();
    expect(host.querySelector('.jects-kanban__search')?.getAttribute('aria-label')).toBe(
      'Search cards',
    );

    const body = host.querySelector('.jects-kanban-col__body');
    expect(body?.getAttribute('role')).toBe('list');

    const card = host.querySelector<HTMLElement>('.jects-kanban-card');
    expect(card?.getAttribute('role')).toBe('listitem');
    expect(card?.getAttribute('tabindex')).toBe('0');
    expect(card?.getAttribute('aria-label')).toBeTruthy();

    const toggle = host.querySelector<HTMLElement>('.jects-kanban-col__toggle');
    expect(toggle?.getAttribute('aria-expanded')).toBe('true');
    toggle?.click();
    const toggleAfter = host.querySelector<HTMLElement>('.jects-kanban-col__toggle');
    expect(toggleAfter?.getAttribute('aria-expanded')).toBe('false');

    b.destroy();
  });

  it('keyboard: Enter activates a card, ArrowDown moves focus', () => {
    const b = new TaskBoard(host, { columns, cards: cards(), editable: false });
    let activated = 0;
    b.on('cardActivate', () => activated++);

    const first = host.querySelector<HTMLElement>('.jects-kanban-card[data-card="1"]')!;
    first.focus();
    first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(activated).toBe(1);

    first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement?.getAttribute('data-card')).toBe('2');

    b.destroy();
  });
});
