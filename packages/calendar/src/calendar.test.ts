import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { create, isRegistered } from '@jects/core';
import { Calendar } from './calendar.js';
import { EventStore } from './event-store.js';
import type { CalendarEvent } from './contract.js';

let host: HTMLElement;

const ANCHOR = new Date(2026, 5, 24); // Wed Jun 24 2026

function sampleEvents(): CalendarEvent[] {
  return [
    {
      id: 'm',
      title: 'Standup',
      start: new Date(2026, 5, 24, 9, 0),
      end: new Date(2026, 5, 24, 9, 30),
      categoryId: 'work',
    },
    {
      id: 'a',
      title: 'Conference',
      start: new Date(2026, 5, 24),
      end: new Date(2026, 5, 25),
      allDay: true,
      categoryId: 'travel',
    },
    {
      id: 'r',
      title: 'Gym',
      start: new Date(2026, 5, 22, 18, 0),
      end: new Date(2026, 5, 22, 19, 0),
      recurrence: { freq: 'daily', count: 10 },
      categoryId: 'health',
      resourceId: 'room-a',
    },
  ];
}

function mk(config = {}): Calendar {
  return new Calendar(host, {
    date: ANCHOR,
    events: sampleEvents(),
    categories: [
      { id: 'work', name: 'Work', color: 'data-1' },
      { id: 'travel', name: 'Travel', color: 'data-2' },
      { id: 'health', name: 'Health', color: 'data-3' },
    ],
    resources: [
      { id: 'room-a', name: 'Room A' },
      { id: 'room-b', name: 'Room B' },
    ],
    ...config,
  });
}

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});

afterEach(() => {
  host.remove();
});

describe('Calendar — registration & lifecycle', () => {
  it('registers with the factory as "calendar"', () => {
    expect(isRegistered('calendar')).toBe(true);
  });

  it('can be created via the factory', () => {
    const w = create({ type: 'calendar', date: ANCHOR, events: [] }, host);
    expect(w).toBeInstanceOf(Calendar);
    w.destroy();
  });

  it('builds a root with role=grid and view class', () => {
    const cal = mk();
    expect(cal.el.classList.contains('jects-cal')).toBe(true);
    expect(cal.el.classList.contains('jects-cal--month')).toBe(true);
    expect(cal.el.querySelector('[role="grid"]')).toBeTruthy();
    cal.destroy();
  });

  it('exposes an EventStore', () => {
    const cal = mk();
    expect(cal.store).toBeInstanceOf(EventStore);
    expect(cal.store.count).toBe(3);
    cal.destroy();
  });

  it('destroy() is idempotent and removes the element', () => {
    const cal = mk();
    cal.destroy();
    expect(cal.isDestroyed).toBe(true);
    expect(() => cal.destroy()).not.toThrow();
    expect(host.querySelector('.jects-cal')).toBeNull();
  });
});

describe('Calendar — views', () => {
  it('renders the month grid (6 weeks + headers)', () => {
    const cal = mk({ view: 'month' });
    expect(cal.el.querySelectorAll('.jects-cal__month-row')).toHaveLength(6);
    expect(cal.el.querySelectorAll('.jects-cal__month-dow')).toHaveLength(7);
    cal.destroy();
  });

  it('renders the week time grid with 7 day columns', () => {
    const cal = mk({ view: 'week' });
    expect(cal.el.querySelectorAll('.jects-cal__tg-col')).toHaveLength(7);
    cal.destroy();
  });

  it('renders the day time grid with 1 day column', () => {
    const cal = mk({ view: 'day' });
    expect(cal.el.querySelectorAll('.jects-cal__tg-col')).toHaveLength(1);
    cal.destroy();
  });

  it('renders the year view with 12 months', () => {
    const cal = mk({ view: 'year' });
    expect(cal.el.querySelectorAll('.jects-cal__year-month')).toHaveLength(12);
    cal.destroy();
  });

  it('renders the agenda view listing events', () => {
    const cal = mk({ view: 'agenda' });
    const rows = cal.el.querySelectorAll('.jects-cal__agenda-row');
    expect(rows.length).toBeGreaterThan(0);
    cal.destroy();
  });

  it('renders the resource view with one column per resource', () => {
    const cal = mk({ view: 'resource' });
    expect(cal.el.querySelectorAll('.jects-cal__tg-col')).toHaveLength(2);
    cal.destroy();
  });

  it('setView switches view and emits viewChange', () => {
    const cal = mk({ view: 'month' });
    let fired: string | undefined;
    cal.on('viewChange', (p) => (fired = p.view));
    cal.setView('week');
    expect(fired).toBe('week');
    expect(cal.el.classList.contains('jects-cal--week')).toBe(true);
    cal.destroy();
  });

  it('renders recurring occurrences in the week', () => {
    const cal = mk({ view: 'week' });
    // Gym recurs daily; multiple timed events should appear across the week.
    const timed = cal.el.querySelectorAll('.jects-cal__event--timed');
    expect(timed.length).toBeGreaterThan(1);
    cal.destroy();
  });
});

describe('Calendar — navigation', () => {
  it('next/prev move by the view period and emit dateChange', () => {
    const cal = mk({ view: 'month' });
    let last: Date | undefined;
    cal.on('dateChange', (p) => (last = p.date));
    cal.next();
    expect(last!.getMonth()).toBe(6); // July
    cal.prev();
    expect(last!.getMonth()).toBe(5); // back to June
    cal.destroy();
  });

  it('today() navigates to the current date', () => {
    const cal = mk({ view: 'day' });
    cal.today();
    const cfgDate = cal.getConfig();
    expect(cfgDate).toBeTruthy();
    cal.destroy();
  });

  it('goToDate updates the toolbar title', () => {
    const cal = mk({ view: 'month' });
    cal.goToDate(new Date(2027, 0, 15));
    const title = cal.el.querySelector('.jects-cal__title')!.textContent ?? '';
    expect(title).toContain('January');
    expect(title).toContain('2027');
    cal.destroy();
  });

  it('weekNumber returns the ISO week of the anchor', () => {
    const cal = mk();
    expect(cal.weekNumber()).toBeGreaterThan(20);
    cal.destroy();
  });
});

describe('Calendar — events & editor', () => {
  it('emits eventClick when an event chip is clicked', () => {
    const cal = mk({ view: 'month', editor: false });
    let clicked: CalendarEvent | undefined;
    cal.on('eventClick', (p) => (clicked = p.event));
    const chip = cal.el.querySelector<HTMLElement>('.jects-cal__event');
    expect(chip).toBeTruthy();
    chip!.click();
    expect(clicked).toBeTruthy();
    cal.destroy();
  });

  it('deleteEvent removes from the store and emits eventDelete (vetoable)', () => {
    const cal = mk();
    const ev = cal.store.getById('m')!;
    let deleted = false;
    cal.on('eventDelete', () => (deleted = true));
    expect(cal.deleteEvent(ev)).toBe(true);
    expect(cal.store.getById('m')).toBeUndefined();
    expect(deleted).toBe(true);
    cal.destroy();
  });

  it('beforeEventDelete veto cancels deletion', () => {
    const cal = mk();
    cal.on('beforeEventDelete', () => false);
    const ev = cal.store.getById('m')!;
    expect(cal.deleteEvent(ev)).toBe(false);
    expect(cal.store.getById('m')).toBeTruthy();
    cal.destroy();
  });

  it('re-renders when the store changes', () => {
    const cal = mk({ view: 'day' });
    const before = cal.el.querySelectorAll('.jects-cal__event--timed').length;
    cal.store.addEvent({
      title: 'Extra',
      start: new Date(2026, 5, 24, 14),
      end: new Date(2026, 5, 24, 15),
    });
    const after = cal.el.querySelectorAll('.jects-cal__event--timed').length;
    expect(after).toBeGreaterThan(before);
    cal.destroy();
  });
});

describe('Calendar — filtering', () => {
  it('categoryFilter limits visible events', () => {
    const cal = mk({ view: 'day', categoryFilter: ['work'] });
    // only the 9:00 Standup (work) timed event should show; Gym (health) hidden.
    const occs = cal.occurrencesInRange(new Date(2026, 5, 24), new Date(2026, 5, 25));
    expect(occs.every((o) => o.event.categoryId === 'work')).toBe(true);
    cal.destroy();
  });

  it('resourceFilter limits the resource view', () => {
    const cal = mk({ view: 'resource', resourceFilter: ['room-a'] });
    expect(cal.el.querySelectorAll('.jects-cal__tg-col')).toHaveLength(1);
    cal.destroy();
  });

  it('toggling a category checkbox emits filterChange', () => {
    const cal = mk({ view: 'month' });
    let fired = false;
    cal.on('filterChange', () => (fired = true));
    const cb = cal.el.querySelector<HTMLInputElement>('.jects-cal__filter-cb');
    expect(cb).toBeTruthy();
    cb!.checked = false;
    cb!.dispatchEvent(new Event('change'));
    expect(fired).toBe(true);
    cal.destroy();
  });
});

describe('Calendar — mini-calendar & keyboard', () => {
  it('mini-calendar renders 42 day cells', () => {
    const cal = mk();
    expect(cal.el.querySelectorAll('.jects-cal__mini-day')).toHaveLength(42);
    cal.destroy();
  });

  it('clicking a mini-calendar day navigates', () => {
    const cal = mk();
    let navigated = false;
    cal.on('dateChange', () => (navigated = true));
    const day = cal.el.querySelector<HTMLElement>('.jects-cal__mini-day');
    day!.click();
    expect(navigated).toBe(true);
    cal.destroy();
  });

  it('ArrowRight on the root advances the date', () => {
    const cal = mk({ view: 'day' });
    let moved = false;
    cal.on('dateChange', () => (moved = true));
    cal.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(moved).toBe(true);
    cal.destroy();
  });

  it('PageDown navigates by period', () => {
    const cal = mk({ view: 'month' });
    let date: Date | undefined;
    cal.on('dateChange', (p) => (date = p.date));
    cal.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true }));
    expect(date!.getMonth()).toBe(6);
    cal.destroy();
  });
});

describe('Calendar — recurrence round-trip (commitEditor)', () => {
  // Editing a recurring series via the editor (which only exposes freq) must NOT
  // wipe interval/byWeekday/count/until/exDates when the frequency is unchanged.
  function recurringCal(): Calendar {
    const cal = new Calendar(host, {
      date: ANCHOR,
      view: 'week',
      events: [
        {
          id: 'series',
          title: 'Sprint sync',
          start: new Date(2026, 5, 22, 10, 0),
          end: new Date(2026, 5, 22, 10, 30),
          recurrence: {
            freq: 'weekly',
            interval: 2,
            byWeekday: [1, 3],
            count: 10,
            until: new Date(2026, 11, 31),
            exDates: [new Date(2026, 6, 1)],
          },
        } as CalendarEvent,
      ],
    });
    return cal;
  }

  it('preserves interval/byWeekday/count/until/exDates when freq is unchanged', () => {
    const cal = recurringCal();
    // Open the editor for the recurring occurrence and submit with no recurrence
    // change (the editor only has a freq <select>, defaulting to the same freq).
    const ev = cal.store.getById('series')!;
    cal.requestEdit({ event: ev, start: ev.start, end: ev.end, occurrenceKey: 'k', isRecurring: true });
    const form = document.querySelector<HTMLFormElement>('.jects-cal-editor__form')!;
    expect(form).toBeTruthy();
    form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));

    const after = cal.store.getById('series')!;
    expect(after.recurrence).toBeTruthy();
    expect(after.recurrence!.freq).toBe('weekly');
    expect(after.recurrence!.interval).toBe(2);
    expect(after.recurrence!.byWeekday).toEqual([1, 3]);
    expect(after.recurrence!.count).toBe(10);
    expect(after.recurrence!.until).toBeInstanceOf(Date);
    expect(after.recurrence!.exDates?.length).toBe(1);
    cal.destroy();
    document.querySelectorAll('.jects-window').forEach((w) => w.remove());
  });

  it('replaces the rule wholesale when the user picks a different frequency', () => {
    const cal = recurringCal();
    const ev = cal.store.getById('series')!;
    cal.requestEdit({ event: ev, start: ev.start, end: ev.end, occurrenceKey: 'k', isRecurring: true });
    const sel = document.querySelector<HTMLSelectElement>('.jects-cal-editor__select[id="jects-cal-rec"]')
      ?? [...document.querySelectorAll<HTMLSelectElement>('.jects-cal-editor__select')]
        .find((s) => [...s.options].some((o) => o.value === 'daily'))!;
    sel.value = 'daily';
    const form = document.querySelector<HTMLFormElement>('.jects-cal-editor__form')!;
    form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));

    const after = cal.store.getById('series')!;
    expect(after.recurrence!.freq).toBe('daily');
    expect(after.recurrence!.interval).toBe(1);
    // The weekly-only detail must be gone (user changed the frequency entirely).
    expect(after.recurrence!.byWeekday).toBeUndefined();
    expect(after.recurrence!.count).toBeUndefined();
    cal.destroy();
    document.querySelectorAll('.jects-window').forEach((w) => w.remove());
  });
});

describe('Calendar — month grid roving tabindex (APG)', () => {
  it('exactly one gridcell is focusable (tabIndex=0)', () => {
    const cal = mk({ view: 'month' });
    const focusable = [...cal.el.querySelectorAll<HTMLElement>('.jects-cal__month-cell')].filter(
      (c) => c.tabIndex === 0,
    );
    expect(focusable).toHaveLength(1);
    cal.destroy();
  });

  it('ArrowRight on a focused cell moves the cursor one day forward', () => {
    const cal = mk({ view: 'month' });
    const cell = cal.el.querySelector<HTMLElement>('.jects-cal__month-cell[tabindex="0"]')!;
    const startKey = cell.dataset.day!;
    cell.focus();
    cell.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    const focusable = cal.el.querySelector<HTMLElement>('.jects-cal__month-cell[tabindex="0"]')!;
    expect(focusable.dataset.day).not.toBe(startKey);
    cal.destroy();
  });

  it('ArrowDown moves the cursor one week (7 days) forward', () => {
    const cal = mk({ view: 'month' });
    const cell = cal.el.querySelector<HTMLElement>('.jects-cal__month-cell[tabindex="0"]')!;
    const startDate = cell.dataset.day!;
    cell.focus();
    cell.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    const after = cal.el.querySelector<HTMLElement>('.jects-cal__month-cell[tabindex="0"]')!;
    const ms = new Date(after.dataset.day! + 'T00:00').getTime() - new Date(startDate + 'T00:00').getTime();
    expect(ms).toBe(7 * 86_400_000);
    cal.destroy();
  });

  it('arrow navigation does NOT change the displayed month while in-grid', () => {
    const cal = mk({ view: 'month' });
    let dateChanges = 0;
    cal.on('dateChange', () => (dateChanges += 1));
    const cell = cal.el.querySelector<HTMLElement>('.jects-cal__month-cell[tabindex="0"]')!;
    cell.focus();
    cell.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    // Anchor/month unchanged: arrows move a focus cursor, not the anchor date.
    expect(dateChanges).toBe(0);
    expect(cal.el.classList.contains('jects-cal--month')).toBe(true);
    cal.destroy();
  });
});

describe('Calendar — update()', () => {
  it('update({ view }) switches the active view', () => {
    const cal = mk({ view: 'month' });
    cal.update({ view: 'week' });
    expect(cal.el.querySelectorAll('.jects-cal__tg-col')).toHaveLength(7);
    cal.destroy();
  });

  it('update({ events }) replaces the data', () => {
    const cal = mk({ view: 'day' });
    cal.update({
      events: [{ id: 'x', title: 'Only', start: new Date(2026, 5, 24, 10), end: new Date(2026, 5, 24, 11) }] as CalendarEvent[],
    });
    expect(cal.store.count).toBe(1);
    cal.destroy();
  });
});
