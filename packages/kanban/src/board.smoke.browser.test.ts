/**
 * Visual / interaction SMOKE suite — real Chromium.
 *
 * Exercises the TaskBoard's primary behaviours against a real layout engine
 * (jsdom lies about geometry, so pointer drags that depend on getBoundingClientRect
 * / elementsFromPoint must run here):
 *
 *   1. A card drags between columns (pointer down → move → up) and lands in the
 *      target column with reassigned order.
 *   2. A STRICT WIP limit blocks an over-limit drop (card stays put, limitReject
 *      fires) — the kanban-specific smoke assertion.
 *   3. The modal card editor mounts at BODY level (portaled out of the board) and
 *      is not clipped by an overflow:hidden ancestor.
 *   4. Keyboard move (Ctrl+Arrow) relocates a card without a pointer (WCAG 2.1.1)
 *      and announces via the live region.
 *
 * A separate axe-core a11y suite for the public surface lives in
 * `board.a11y.test.ts`.
 */
import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import '@jects/theme/style.css';
import './styles.css';
import { TaskBoard } from './board.js';
import type { KanbanCard, KanbanColumnDef } from './types.js';
import { expectNoA11yViolations } from './test-utils/a11y.js';

const columns: KanbanColumnDef[] = [
  { id: 'todo', title: 'To Do' },
  { id: 'doing', title: 'Doing' },
  { id: 'done', title: 'Done' },
];

function cards(): KanbanCard[] {
  return [
    { id: 1, column: 'todo', title: 'Alpha', order: 0 },
    { id: 2, column: 'todo', title: 'Beta', order: 1 },
    { id: 3, column: 'doing', title: 'Gamma', order: 0 },
  ];
}

// The browser viewport here is small (mobile-sized). Keep the board narrow
// enough that every column sits inside the visible viewport so pointer drops
// (which rely on elementsFromPoint) land on a real column body.
const NARROW = { columnWidth: 110 } as const;

let host: HTMLElement;
beforeEach(() => {
  host = document.createElement('div');
  host.style.width = '380px';
  host.style.height = '480px';
  document.body.appendChild(host);
});
afterEach(() => {
  host.remove();
  // Sweep any stray editor windows.
  document.querySelectorAll('.jects-window').forEach((w) => w.remove());
});

/** Dispatch a pointer event with realistic geometry on a target element. */
function pointer(
  el: Element,
  type: string,
  x: number,
  y: number,
  pointerId = 1,
): void {
  const ev = new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    composed: true,
    pointerId,
    clientX: x,
    clientY: y,
    button: 0,
    buttons: type === 'pointerup' || type === 'pointercancel' ? 0 : 1,
  });
  el.dispatchEvent(ev);
}

function centerOf(el: Element): { x: number; y: number } {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/**
 * A drop point inside `targetBody` that is also within the (possibly small,
 * mobile-sized) test viewport — `elementsFromPoint` returns nothing for
 * off-screen coordinates, so we clamp the point into the visible window.
 */
function dropPointIn(targetBody: HTMLElement): { x: number; y: number } {
  const r = targetBody.getBoundingClientRect();
  const x = Math.min(r.left + r.width / 2, window.innerWidth - 2);
  const y = Math.min(r.top + Math.min(r.height / 2, 20), window.innerHeight - 2);
  return { x: Math.max(1, x), y: Math.max(1, y) };
}

/** Drive a full pointer drag of `card` onto `targetBody`. */
function dragCardTo(card: HTMLElement, targetBody: HTMLElement): void {
  const start = centerOf(card);
  const end = dropPointIn(targetBody);
  pointer(card, 'pointerdown', start.x, start.y);
  // First move past the 4px threshold, then to the destination.
  pointer(card, 'pointermove', start.x + 8, start.y + 8);
  pointer(card, 'pointermove', end.x, end.y);
  pointer(card, 'pointerup', end.x, end.y);
}

describe('TaskBoard interaction smoke (real Chromium)', () => {
  it('drags a card between columns and lands it in the target column', () => {
    const b = new TaskBoard(host, { columns, cards: cards(), ...NARROW });

    const alpha = host.querySelector<HTMLElement>('.jects-kanban-card[data-card="1"]')!;
    const doingBody = host.querySelector<HTMLElement>(
      '[data-col="doing"] .jects-kanban-col__body',
    )!;
    expect(alpha).toBeTruthy();
    expect(doingBody).toBeTruthy();

    dragCardTo(alpha, doingBody);

    expect(b.store.getById(1)?.column).toBe('doing');
    // It now renders inside the Doing column.
    expect(
      host.querySelector('[data-col="doing"] .jects-kanban-card[data-card="1"]'),
    ).toBeTruthy();
    // No ghost/placeholder left on the body.
    expect(document.querySelector('.jects-kanban__ghost')).toBeNull();
    expect(document.querySelector('.jects-kanban__placeholder')).toBeNull();

    b.destroy();
  });

  it('a STRICT WIP limit blocks an over-limit drop', () => {
    const strictColumns: KanbanColumnDef[] = [
      { id: 'todo', title: 'To Do' },
      { id: 'doing', title: 'Doing', limit: 1, strictLimit: true },
    ];
    const b = new TaskBoard(host, {
      columns: strictColumns,
      cards: [
        { id: 1, column: 'todo', title: 'Alpha', order: 0 },
        { id: 2, column: 'doing', title: 'Gamma', order: 0 },
      ],
      ...NARROW,
    });

    let rejected = 0;
    b.on('limitReject', () => rejected++);

    const alpha = host.querySelector<HTMLElement>('.jects-kanban-card[data-card="1"]')!;
    const doingBody = host.querySelector<HTMLElement>(
      '[data-col="doing"] .jects-kanban-col__body',
    )!;

    dragCardTo(alpha, doingBody);

    // The drop is rejected: Alpha stays in To Do and limitReject fired.
    expect(b.store.getById(1)?.column).toBe('todo');
    expect(rejected).toBe(1);
    expect(
      host.querySelector('[data-col="todo"] .jects-kanban-card[data-card="1"]'),
    ).toBeTruthy();

    b.destroy();
  });

  it('the card editor mounts at body level and is not clipped by an overflow:hidden ancestor', () => {
    // Wrap the host in a tiny clipping ancestor.
    const clip = document.createElement('div');
    clip.style.position = 'fixed';
    clip.style.top = '20px';
    clip.style.left = '20px';
    clip.style.width = '200px';
    clip.style.height = '120px';
    clip.style.overflow = 'hidden';
    document.body.appendChild(clip);
    clip.appendChild(host);

    const b = new TaskBoard(host, { columns, cards: cards(), editable: true });

    b.editCard(1);

    const editor = document.querySelector<HTMLElement>('.jects-kanban-editor');
    expect(editor).toBeTruthy();

    // The editor lives inside a Window that is portaled to <body>, NOT inside the
    // clipping ancestor — so overflow:hidden cannot clip it.
    const win = document.querySelector<HTMLElement>('.jects-window')!;
    expect(win).toBeTruthy();
    expect(clip.contains(win)).toBe(false);
    expect(win.parentElement).toBe(document.body);

    // It is laid out with real, non-collapsed dimensions (a clipped panel would
    // be ~zero area).
    const rect = win.getBoundingClientRect();
    expect(rect.width).toBeGreaterThan(40);
    expect(rect.height).toBeGreaterThan(40);
    // Visibly larger than the 120px-tall clip box → not constrained by it.
    expect(rect.height).toBeGreaterThan(clip.getBoundingClientRect().height);

    win.remove();
    b.destroy();
    clip.remove();
  });

  it('keyboard move (Ctrl+ArrowRight) relocates a card without a pointer and announces it', async () => {
    const b = new TaskBoard(host, { columns, cards: cards() });

    const alpha = host.querySelector<HTMLElement>('.jects-kanban-card[data-card="1"]')!;
    alpha.focus();
    alpha.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', ctrlKey: true, bubbles: true }),
    );

    expect(b.store.getById(1)?.column).toBe('doing');

    // The live region eventually carries an announcement (set on next frame).
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    const live = host.querySelector('.jects-kanban__live');
    expect(live?.textContent ?? '').toContain('moved to');

    b.destroy();
  });

  it('public surface has no serious/critical axe violations (plain + swimlanes)', async () => {
    const plain = new TaskBoard(host, { columns, cards: cards() });
    await expectNoA11yViolations(host);
    plain.destroy();

    const laned = new TaskBoard(host, {
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
    laned.destroy();
  });
});
