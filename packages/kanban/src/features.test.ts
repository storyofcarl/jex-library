/**
 * jsdom unit tests for the parity features added to the TaskBoard:
 *   1. rich card content (editor round-trip)
 *   2. REST / WebSocket data provider
 *   3. undo / redo
 *   4. toolbar sort
 *   5. toolbar filter
 *   6. export (JSON / CSV)
 *   7. touch DnD (long-press) + vertical auto-scroll wiring
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TaskBoard } from './board.js';
import { AjaxDataProvider } from './data-provider.js';
import type {
  BoardFilterDef,
  CardSyncOp,
  KanbanCard,
  KanbanColumnDef,
  TaskBoardConfig,
  TaskBoardDataProvider,
} from './types.js';

const COLUMNS: KanbanColumnDef[] = [
  { id: 'todo', title: 'To Do' },
  { id: 'doing', title: 'Doing' },
  { id: 'done', title: 'Done' },
];

function cards(): KanbanCard[] {
  return [
    { id: 1, column: 'todo', title: 'Banana', order: 0, votes: { count: 1 }, assignee: 'Jo' },
    { id: 2, column: 'todo', title: 'Apple', order: 1, votes: { count: 5 }, assignee: 'Mia' },
    { id: 3, column: 'todo', title: 'Cherry', order: 2, votes: { count: 3 }, assignee: 'Jo' },
  ];
}

let host: HTMLElement;

function mount(cfg: Partial<TaskBoardConfig> = {}): TaskBoard {
  return new TaskBoard(host, { columns: COLUMNS, cards: cards(), ...cfg });
}

function titlesIn(b: TaskBoard, col: string): (string | null)[] {
  const body = b.el.querySelector(`[data-col="${col}"] .jects-kanban-col__body`)!;
  return [...body.querySelectorAll('.jects-kanban-card__title')].map((t) => t.textContent);
}

/**
 * jsdom lacks `PointerEvent`, so synthesize one from a MouseEvent (which carries
 * clientX/Y) and tack on the pointer fields the board reads (pointerId/type).
 */
function pointer(
  type: string,
  init: { pointerId: number; pointerType: string; clientX: number; clientY: number; button?: number },
): Event {
  const ev = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: init.button ?? 0,
    clientX: init.clientX,
    clientY: init.clientY,
  });
  Object.defineProperty(ev, 'pointerId', { value: init.pointerId });
  Object.defineProperty(ev, 'pointerType', { value: init.pointerType });
  return ev;
}

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});

afterEach(() => {
  host.remove();
  vi.restoreAllMocks();
});

/* ── Gap 1: rich card content round-trips through the editor ── */
describe('rich card content editor round-trip', () => {
  it('edits cover/links/attachments/comments/votes and renders them', () => {
    const b = mount();
    b.editCard(1);
    const form = document.querySelector<HTMLFormElement>('.jects-kanban-editor')!;
    const inputs = form.querySelectorAll<HTMLInputElement>('input');
    const areas = form.querySelectorAll<HTMLTextAreaElement>('textarea');
    // Field order: title, tags, progress, avatar, cover, assignee, due, links, votes
    // (description + attachments + comments are textareas).
    const byLabel = (label: string): HTMLInputElement | HTMLTextAreaElement => {
      const wrap = [...form.querySelectorAll('.jects-kanban-editor__field')].find((w) =>
        w.querySelector('.jects-kanban-editor__label')?.textContent?.includes(label),
      )!;
      return wrap.querySelector('input, textarea') as HTMLInputElement | HTMLTextAreaElement;
    };
    expect(inputs.length).toBeGreaterThan(0);
    expect(areas.length).toBeGreaterThan(0);

    (byLabel('Cover') as HTMLInputElement).value = 'https://x/c.png';
    (byLabel('Links') as HTMLInputElement).value = '2, 3';
    (byLabel('Attachments') as HTMLTextAreaElement).value = 'spec.pdf|https://x/s\nnotes.txt';
    (byLabel('Comments') as HTMLTextAreaElement).value = 'Jo|looks good\nMia|ship it';
    (byLabel('Votes') as HTMLInputElement).value = '7';

    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    const stored = b.store.getById(1)!;
    expect(stored.cover).toBe('https://x/c.png');
    expect(stored.links).toEqual(['2', '3']);
    expect(stored.attachments).toEqual([
      { name: 'spec.pdf', url: 'https://x/s' },
      { name: 'notes.txt' },
    ]);
    expect(stored.comments).toEqual([
      { author: 'Jo', text: 'looks good' },
      { author: 'Mia', text: 'ship it' },
    ]);
    expect(stored.votes).toEqual({ count: 7 });

    // Rendered on the card.
    const cardEl = b.el.querySelector('.jects-kanban-card[data-card="1"]')!;
    expect(cardEl.querySelector('.jects-kanban-card__cover-img')).toBeTruthy();
    expect(cardEl.querySelector('.jects-kanban-card__attachments')?.textContent).toContain('2');
    expect(cardEl.querySelector('.jects-kanban-card__votes')?.textContent).toContain('7');
    expect(cardEl.querySelectorAll('.jects-kanban-card__link').length).toBe(2);

    document.querySelector<HTMLElement>('.jects-window')?.remove();
    b.destroy();
  });

  it('toggleVote increments count + flips voted, and clicking the badge calls it', () => {
    const b = mount();
    b.toggleVote(1);
    expect(b.store.getById(1)?.votes).toEqual({ count: 2, voted: true });
    // Click the rendered vote button → toggles back off.
    const btn = b.el.querySelector<HTMLElement>(
      '.jects-kanban-card[data-card="1"] .jects-kanban-card__votes',
    )!;
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(b.store.getById(1)?.votes).toEqual({ count: 1, voted: false });
    b.destroy();
  });
});

/* ── Gap 2: REST / WebSocket data provider ── */
describe('data provider', () => {
  it('loads cards from the provider on mount', async () => {
    const remote: KanbanCard[] = [
      { id: 10, column: 'doing', title: 'Remote A', order: 0 },
      { id: 11, column: 'done', title: 'Remote B', order: 0 },
    ];
    const provider: TaskBoardDataProvider = {
      load: vi.fn().mockResolvedValue(remote),
      sync: vi.fn().mockResolvedValue(undefined),
    };
    const b = new TaskBoard(host, { columns: COLUMNS, dataProvider: provider });
    // Let the load promise resolve.
    await Promise.resolve();
    await Promise.resolve();
    expect(provider.load).toHaveBeenCalled();
    expect(b.el.querySelector('.jects-kanban-card[data-card="10"]')).toBeTruthy();
    expect(b.el.querySelector('.jects-kanban-card[data-card="11"]')).toBeTruthy();
    b.destroy();
  });

  it('pushes an optimistic move to the provider', async () => {
    const provider: TaskBoardDataProvider = {
      load: vi.fn().mockResolvedValue(cards()),
      sync: vi.fn().mockResolvedValue(undefined),
    };
    const b = new TaskBoard(host, { columns: COLUMNS, dataProvider: provider });
    await Promise.resolve();
    await Promise.resolve();
    (provider.sync as ReturnType<typeof vi.fn>).mockClear();
    b.moveCard(1, { column: 'done', index: 0 });
    expect(provider.sync).toHaveBeenCalled();
    const op = (provider.sync as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as CardSyncOp;
    expect(op.action).toBe('update');
    expect(op.id).toBe(1);
    expect(op.card?.column).toBe('done');
    b.destroy();
  });

  it('applies a remote subscription op to the live board (and does not echo it back)', async () => {
    let push: ((op: CardSyncOp) => void) | undefined;
    const provider: TaskBoardDataProvider = {
      load: vi.fn().mockResolvedValue(cards()),
      sync: vi.fn().mockResolvedValue(undefined),
      subscribe: vi.fn().mockImplementation((cb: (op: CardSyncOp) => void) => {
        push = cb;
        return () => {};
      }),
    };
    const remoteSpy = vi.fn();
    const b = new TaskBoard(host, { columns: COLUMNS, dataProvider: provider });
    b.on('remoteChange', remoteSpy);
    await Promise.resolve();
    await Promise.resolve();
    (provider.sync as ReturnType<typeof vi.fn>).mockClear();
    push!({ action: 'update', id: 1, card: { title: 'From server' } });
    expect(b.store.getById(1)?.title).toBe('From server');
    expect(remoteSpy).toHaveBeenCalled();
    // Remote-applied changes are not re-synced (no loop).
    expect(provider.sync).not.toHaveBeenCalled();
    b.destroy();
  });

  it('AjaxDataProvider.load + sync hit the REST endpoint via injected fetch', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => cards() } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) } as Response);
    const p = new AjaxDataProvider({ url: '/api/cards', fetchImpl: fetchImpl as typeof fetch });
    const loaded = await p.load();
    expect(loaded.length).toBe(3);
    expect(fetchImpl).toHaveBeenCalledWith('/api/cards', expect.objectContaining({ method: 'GET' }));
    await p.sync({ action: 'update', id: 1, card: { title: 'X' } });
    expect(fetchImpl).toHaveBeenLastCalledWith(
      '/api/cards',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('AjaxDataProvider.subscribe decodes WS messages into ops', () => {
    const listeners: Record<string, ((ev: MessageEvent) => void)[]> = {};
    class FakeWS {
      addEventListener(type: string, fn: (ev: MessageEvent) => void): void {
        (listeners[type] ??= []).push(fn);
      }
      removeEventListener(): void {}
      close(): void {}
    }
    const p = new AjaxDataProvider({
      url: '/api/cards',
      wsUrl: 'ws://x',
      fetchImpl: vi.fn() as unknown as typeof fetch,
      webSocketImpl: FakeWS as unknown as typeof WebSocket,
    });
    const onRemote = vi.fn();
    const unsub = p.subscribe(onRemote);
    listeners['message']?.forEach((fn) =>
      fn({ data: JSON.stringify({ action: 'remove', id: 9 }) } as MessageEvent),
    );
    expect(onRemote).toHaveBeenCalledWith({ action: 'remove', id: 9 });
    unsub();
  });
});

/* ── Gap 3: undo / redo ── */
describe('undo / redo', () => {
  it('undoes and redoes a move', () => {
    const b = mount({ undoRedo: true });
    expect(b.canUndo()).toBe(false);
    b.moveCard(1, { column: 'done', index: 0 });
    expect(b.store.getById(1)?.column).toBe('done');
    expect(b.canUndo()).toBe(true);
    b.undo();
    expect(b.store.getById(1)?.column).toBe('todo');
    expect(b.canRedo()).toBe(true);
    b.redo();
    expect(b.store.getById(1)?.column).toBe('done');
    b.destroy();
  });

  it('undoes an edit', () => {
    const b = mount({ undoRedo: true });
    b.applyCardEdit(1, { title: 'Edited' });
    expect(b.store.getById(1)?.title).toBe('Edited');
    b.undo();
    expect(b.store.getById(1)?.title).toBe('Banana');
    b.destroy();
  });

  it('Ctrl+Z / Ctrl+Y drive undo/redo', () => {
    const b = mount({ undoRedo: true });
    b.applyCardEdit(2, { title: 'Z' });
    b.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    expect(b.store.getById(2)?.title).toBe('Apple');
    b.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'y', ctrlKey: true, bubbles: true }));
    expect(b.store.getById(2)?.title).toBe('Z');
    b.destroy();
  });

  it('does not record history when undoRedo is off', () => {
    const b = mount();
    b.moveCard(1, { column: 'done', index: 0 });
    expect(b.canUndo()).toBe(false);
    b.destroy();
  });
});

/* ── Gap 4: toolbar sort ── */
describe('toolbar sort', () => {
  it('sorts cards within a column by title', () => {
    const b = mount({ sortable: true });
    expect(titlesIn(b, 'todo')).toEqual(['Banana', 'Apple', 'Cherry']); // manual order
    b.setSortField('title');
    expect(titlesIn(b, 'todo')).toEqual(['Apple', 'Banana', 'Cherry']);
    b.destroy();
  });

  it('sorts by votes (descending) and restores manual order', () => {
    const b = mount({ sortable: true });
    b.setSortField('votes');
    expect(titlesIn(b, 'todo')).toEqual(['Apple', 'Cherry', 'Banana']); // 5,3,1
    b.setSortField('order');
    expect(titlesIn(b, 'todo')).toEqual(['Banana', 'Apple', 'Cherry']);
    b.destroy();
  });

  it('the toolbar select changes the sort field', () => {
    const b = mount({ sortable: true });
    const select = b.el.querySelector<HTMLSelectElement>('.jects-kanban__sort-select')!;
    select.value = 'title';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    expect(b.getSortField()).toBe('title');
    expect(titlesIn(b, 'todo')).toEqual(['Apple', 'Banana', 'Cherry']);
    b.destroy();
  });
});

/* ── Gap 5: toolbar filter ── */
describe('toolbar filter', () => {
  const filters: BoardFilterDef[] = [
    { id: 'jo', label: 'Jo', test: (c) => c.assignee === 'Jo' },
  ];

  it('filter hides non-matching cards', () => {
    const b = mount({ filters });
    expect(b.el.querySelectorAll('.jects-kanban-card').length).toBe(3);
    b.toggleFilter('jo');
    const visible = [...b.el.querySelectorAll('.jects-kanban-card__title')].map((t) => t.textContent);
    expect(visible.sort()).toEqual(['Banana', 'Cherry']); // both assigned to Jo
    b.toggleFilter('jo');
    expect(b.el.querySelectorAll('.jects-kanban-card').length).toBe(3);
    b.destroy();
  });

  it('the toolbar filter chip toggles the filter', () => {
    const b = mount({ filters });
    const chip = b.el.querySelector<HTMLElement>('[data-filter="jo"]')!;
    chip.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(b.getActiveFilters()).toEqual(['jo']);
    expect(chip.getAttribute('aria-pressed')).toBe('true');
    b.destroy();
  });

  it('filterFn narrows cards alongside search', () => {
    const b = mount({ filterFn: (c) => (c.votes?.count ?? 0) >= 3 });
    const visible = [...b.el.querySelectorAll('.jects-kanban-card__title')].map((t) => t.textContent);
    expect(visible.sort()).toEqual(['Apple', 'Cherry']); // votes 5 + 3
    b.destroy();
  });
});

/* ── Gap 6: export ── */
describe('export', () => {
  it('exports JSON containing every card', () => {
    const b = mount();
    const json = b.export({ format: 'json' });
    const parsed = JSON.parse(json) as KanbanCard[];
    expect(parsed.map((c) => c.id).sort()).toEqual([1, 2, 3]);
    b.destroy();
  });

  it('exports CSV with a header row and one row per card', () => {
    const b = mount();
    const csv = b.export({ format: 'csv' });
    const lines = csv.split('\n');
    expect(lines[0]).toContain('id');
    expect(lines[0]).toContain('title');
    expect(lines.length).toBe(4); // header + 3 cards
    expect(csv).toContain('Banana');
    expect(csv).toContain('Apple');
    b.destroy();
  });

  it('quotes CSV cells with commas', () => {
    const b = mount({ cards: [{ id: 1, column: 'todo', title: 'a, b', order: 0 }] });
    const csv = b.export({ format: 'csv' });
    expect(csv).toContain('"a, b"');
    b.destroy();
  });
});

/* ── Gap 7: touch DnD (long-press) + vertical auto-scroll wiring ── */
describe('touch drag-and-drop', () => {
  it('a touch move before the long-press does NOT start a drag (treated as scroll)', () => {
    vi.useFakeTimers();
    const b = mount();
    const card = b.el.querySelector<HTMLElement>('.jects-kanban-card[data-card="1"]')!;
    card.setPointerCapture = () => {};
    card.releasePointerCapture = () => {};
    card.dispatchEvent(
      pointer('pointerdown', { pointerId: 1, pointerType: 'touch', clientX: 10, clientY: 10 }),
    );
    expect(card.classList.contains('jects-kanban-card--press')).toBe(true);
    // Move immediately (no hold) → cancels the pending lift, no ghost appears.
    card.dispatchEvent(
      pointer('pointermove', { pointerId: 1, pointerType: 'touch', clientX: 60, clientY: 12 }),
    );
    expect(document.querySelector('.jects-kanban__ghost')).toBeNull();
    expect(b.el.classList.contains('jects-kanban--dragging')).toBe(false);
    vi.useRealTimers();
    b.destroy();
  });

  it('a touch long-press lifts the card, then a move drags it', () => {
    vi.useFakeTimers();
    const b = mount();
    const card = b.el.querySelector<HTMLElement>('.jects-kanban-card[data-card="1"]')!;
    card.setPointerCapture = () => {};
    card.releasePointerCapture = () => {};
    card.dispatchEvent(
      pointer('pointerdown', { pointerId: 1, pointerType: 'touch', clientX: 10, clientY: 10 }),
    );
    // Hold past the long-press threshold.
    vi.advanceTimersByTime(400);
    expect(card.classList.contains('jects-kanban-card--lifted')).toBe(true);
    // Now a move begins a real drag (ghost appears).
    card.dispatchEvent(
      pointer('pointermove', { pointerId: 1, pointerType: 'touch', clientX: 60, clientY: 60 }),
    );
    expect(document.querySelector('.jects-kanban__ghost')).toBeTruthy();
    expect(b.el.classList.contains('jects-kanban--dragging')).toBe(true);
    // End the drag.
    card.dispatchEvent(
      pointer('pointerup', { pointerId: 1, pointerType: 'touch', clientX: 60, clientY: 60 }),
    );
    vi.useRealTimers();
    b.destroy();
  });
});
