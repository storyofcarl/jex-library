/**
 * Real-browser (Chromium) accessibility + interaction tests for the Calendar.
 * Run via `pnpm --filter @jects/calendar test:browser`.
 *
 * Covers:
 *  - axe-core has zero serious/critical violations in every view,
 *  - the view switcher is an honest toggle-button group (aria-pressed),
 *  - the month grid implements an APG roving tabindex (one focusable cell;
 *    arrows move a focus cursor cell-to-cell without changing the month),
 *  - a VISUAL/INTERACTION SMOKE: dragging a timed event updates its time, the
 *    editor modal mounts at document.body level and is not clipped, switching
 *    views renders the right structure, and tearing the widget down mid-drag
 *    leaks no document pointer listeners.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { Calendar } from './calendar.js';
import type { CalendarEvent } from './contract.js';
import { expectNoA11yViolations } from './test-utils/a11y.js';
import '@jects/theme/style.css';
import '@jects/widgets/style.css';
import './styles.css';

let cal: Calendar | undefined;
let host: HTMLElement | undefined;

const ANCHOR = new Date(2026, 5, 24);

function events(): CalendarEvent[] {
  return [
    { id: 'm', title: 'Standup', start: new Date(2026, 5, 24, 9), end: new Date(2026, 5, 24, 9, 30), categoryId: 'work' },
    { id: 'a', title: 'Conference', start: new Date(2026, 5, 24), end: new Date(2026, 5, 25), allDay: true, categoryId: 'travel' },
    { id: 'g', title: 'Gym', start: new Date(2026, 5, 24, 18), end: new Date(2026, 5, 24, 19), recurrence: { freq: 'daily', count: 5 }, categoryId: 'health', resourceId: 'room-a' },
  ];
}

function mount(view: CalendarConfigView = 'month'): Calendar {
  host = document.createElement('div');
  host.style.width = '900px';
  host.style.height = '600px';
  document.body.appendChild(host);
  return new Calendar(host, {
    date: ANCHOR,
    view,
    events: events(),
    categories: [
      { id: 'work', name: 'Work', color: 'data-1' },
      { id: 'travel', name: 'Travel', color: 'data-2' },
      { id: 'health', name: 'Health', color: 'data-3' },
    ],
    resources: [
      { id: 'room-a', name: 'Room A' },
      { id: 'room-b', name: 'Room B' },
    ],
  });
}

type CalendarConfigView = 'day' | 'week' | 'month' | 'year' | 'agenda' | 'resource';

afterEach(() => {
  cal?.destroy();
  cal = undefined;
  host?.remove();
  host = undefined;
  // Clean up any modal windows the editor mounted on body.
  document.querySelectorAll('.jects-window, .jects-mask').forEach((n) => n.remove());
});

describe('Calendar a11y (axe-core)', () => {
  for (const view of ['month', 'week', 'day', 'year', 'agenda', 'resource'] as const) {
    it(`${view} view has no serious/critical violations`, async () => {
      cal = mount(view);
      await expectNoA11yViolations(host!);
    });
  }

  it('exposes a grid role and a toggle-button view switcher', () => {
    cal = mount('month');
    expect(host!.querySelector('[role="grid"]')).toBeTruthy();
    // The view switcher is a group of aria-pressed toggle buttons (not a tablist
    // — there is no role=tabpanel to control, so the tab pattern was dropped).
    const switcher = host!.querySelector<HTMLElement>('.jects-cal__views')!;
    expect(switcher.getAttribute('role')).toBe('group');
    const tabs = host!.querySelectorAll<HTMLElement>('.jects-cal__view-btn');
    expect(tabs.length).toBeGreaterThan(0);
    tabs.forEach((t) => expect(t.getAttribute('aria-pressed')).toMatch(/true|false/));
    expect(host!.querySelector('[role="tablist"]')).toBeNull();
  });
});

describe('Calendar view switcher (interaction)', () => {
  it('switching views renders correctly and updates aria-pressed', () => {
    cal = mount('month');
    expect(host!.querySelector('.jects-cal__month')).toBeTruthy();

    const weekTab = host!.querySelector<HTMLElement>('[data-view="week"]')!;
    weekTab.click();
    expect(host!.querySelectorAll('.jects-cal__tg-col')).toHaveLength(7);
    expect(weekTab.getAttribute('aria-pressed')).toBe('true');
    // The previously-active month tab must flip back to false.
    expect(host!.querySelector<HTMLElement>('[data-view="month"]')!.getAttribute('aria-pressed')).toBe('false');

    host!.querySelector<HTMLElement>('[data-view="day"]')!.click();
    expect(host!.querySelectorAll('.jects-cal__tg-col')).toHaveLength(1);

    host!.querySelector<HTMLElement>('[data-view="resource"]')!.click();
    expect(host!.querySelectorAll('.jects-cal__tg-col')).toHaveLength(2);

    host!.querySelector<HTMLElement>('[data-view="month"]')!.click();
    expect(host!.querySelector('.jects-cal__month')).toBeTruthy();
  });

  it('clicking an event chip emits eventClick', () => {
    cal = mount('month');
    let fired = false;
    cal.on('eventClick', () => (fired = true));
    host!.querySelector<HTMLElement>('.jects-cal__event')?.click();
    expect(fired).toBe(true);
  });

  it('mini-calendar day navigates the calendar', () => {
    cal = mount('month');
    let navigated = false;
    cal.on('dateChange', () => (navigated = true));
    host!.querySelector<HTMLElement>('.jects-cal__mini-day')?.click();
    expect(navigated).toBe(true);
  });
});

describe('Calendar month grid roving tabindex (APG)', () => {
  it('exactly one gridcell is focusable and arrows move the cursor without changing month', () => {
    cal = mount('month');
    const focusable = () =>
      [...host!.querySelectorAll<HTMLElement>('.jects-cal__month-cell')].filter((c) => c.tabIndex === 0);
    expect(focusable()).toHaveLength(1);

    const cell = focusable()[0]!;
    const startKey = cell.dataset.day!;
    cell.focus();
    expect(document.activeElement).toBe(cell);

    let dateChanges = 0;
    cal.on('dateChange', () => (dateChanges += 1));
    cell.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));

    // Still exactly one focusable cell, and it moved one day forward.
    const after = focusable();
    expect(after).toHaveLength(1);
    expect(after[0]!.dataset.day).not.toBe(startKey);
    // Focus follows the cursor.
    expect(document.activeElement).toBe(after[0]!);
    // Arrow nav moves a focus cursor, NOT the anchor/month.
    expect(dateChanges).toBe(0);
    expect(cal.el.classList.contains('jects-cal--month')).toBe(true);
  });
});

describe('Calendar drag interaction (real browser)', () => {
  function colMidX(col: HTMLElement): number {
    const r = col.getBoundingClientRect();
    return r.left + r.width / 2;
  }
  function yForMinutes(col: HTMLElement, minutes: number): number {
    const r = col.getBoundingClientRect();
    const startMin = Number(col.dataset.startMin ?? 0);
    const endMin = Number(col.dataset.endMin ?? 1440);
    return r.top + ((minutes - startMin) / (endMin - startMin)) * r.height;
  }

  it('dragging a timed event updates its time (move) without opening the editor', async () => {
    cal = mount('day');
    const evEl = host!.querySelector<HTMLElement>('.jects-cal__event--timed[data-event-id="m"]')!;
    expect(evEl).toBeTruthy();
    const col = evEl.closest<HTMLElement>('.jects-cal__tg-col')!;
    const before = cal.store.getById('m')!;
    const beforeStartH = before.start.getHours();

    let updated: { start: Date; end: Date } | undefined;
    cal.on('eventUpdate', (p) => (updated = { start: p.start, end: p.end }));

    const x = colMidX(col);
    // Grab near the event's current start and drag down ~3 hours.
    const yStart = yForMinutes(col, beforeStartH * 60 + 5);
    const yEnd = yForMinutes(col, (beforeStartH + 3) * 60);

    evEl.dispatchEvent(new PointerEvent('pointerdown', { button: 0, pointerId: 1, clientX: x, clientY: yStart, bubbles: true }));
    document.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: x, clientY: (yStart + yEnd) / 2, bubbles: true }));
    document.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: x, clientY: yEnd, bubbles: true }));
    document.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, clientX: x, clientY: yEnd, bubbles: true }));

    expect(updated).toBeTruthy();
    const after = cal.store.getById('m')!;
    // The event moved later in the day (start hour increased).
    expect(after.start.getHours()).toBeGreaterThan(beforeStartH);
    // Duration preserved (30 min standup).
    expect(after.end.getTime() - after.start.getTime()).toBe(before.end.getTime() - before.start.getTime());

    // The synthetic click that follows a move-drag must NOT open the editor.
    const native = new MouseEvent('click', { bubbles: true });
    host!.querySelector<HTMLElement>('.jects-cal__event--timed[data-event-id="m"]')?.dispatchEvent(native);
    expect(document.querySelector('.jects-cal-editor')).toBeNull();
  });

  it('destroy() mid-drag removes document pointer listeners (no leak / throw)', () => {
    cal = mount('day');
    const col = host!.querySelector<HTMLElement>('.jects-cal__tg-col')!;
    const r = col.getBoundingClientRect();
    col.dispatchEvent(new PointerEvent('pointerdown', { button: 0, pointerId: 7, clientX: r.left + 5, clientY: r.top + 5, bubbles: true }));
    document.dispatchEvent(new PointerEvent('pointermove', { pointerId: 7, clientX: r.left + 5, clientY: r.top + 40, bubbles: true }));

    cal.destroy();
    cal = undefined; // afterEach won't double-destroy

    // Stray document pointer events after destroy must be inert.
    expect(() =>
      document.dispatchEvent(new PointerEvent('pointermove', { pointerId: 7, clientX: r.left + 5, clientY: r.top + 200, bubbles: true })),
    ).not.toThrow();
    expect(() =>
      document.dispatchEvent(new PointerEvent('pointerup', { pointerId: 7, bubbles: true })),
    ).not.toThrow();
    // No leftover ghost preview.
    expect(document.querySelector('.jects-cal__ghost')).toBeNull();
  });
});

describe('Calendar editor modal (body-level, not clipped)', () => {
  it('double-click create opens the editor mounted at document.body and is not clipped', async () => {
    cal = mount('month');
    // Double-clicking an empty month cell opens the create editor.
    const cell = host!.querySelector<HTMLElement>('.jects-cal__month-cell')!;
    cell.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));

    const editor = document.querySelector<HTMLElement>('.jects-cal-editor');
    expect(editor).toBeTruthy();
    const win = editor!.closest<HTMLElement>('.jects-window')!;
    expect(win).toBeTruthy();

    // The modal mounts at body level — NOT nested inside the calendar element,
    // so it cannot be clipped by the calendar's overflow containers.
    expect(win.parentElement).toBe(document.body);
    expect(cal.el.contains(win)).toBe(false);

    // And it is actually visible (laid out with non-zero size, on screen).
    const rect = win.getBoundingClientRect();
    expect(rect.width).toBeGreaterThan(0);
    expect(rect.height).toBeGreaterThan(0);
    expect(rect.bottom).toBeGreaterThan(0);
    expect(rect.right).toBeGreaterThan(0);

    // a11y: the open editor (dialog) has no serious/critical violations.
    await expectNoA11yViolations(win);

    win.querySelector<HTMLButtonElement>('.jects-cal-editor__btn')?.click(); // Cancel
  });
});
