import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Calendar } from './calendar.js';
import type { CalendarEvent } from './contract.js';

let host: HTMLElement;
const ANCHOR = new Date(2026, 5, 24); // Wed Jun 24 2026

/** A pointer-ish event jsdom accepts (MouseEvent carries clientX/Y/button). */
function pev(type: string, opts: MouseEventInit = {}): MouseEvent {
  return new MouseEvent(type, { bubbles: true, button: 0, ...opts });
}

/** Stub a stable bounding box so the time-grid pointer math is deterministic. */
function stubRect(el: HTMLElement, height = 480): void {
  el.getBoundingClientRect = () =>
    ({ top: 0, left: 0, right: 60, bottom: height, width: 60, height, x: 0, y: 0, toJSON() {} }) as DOMRect;
}

function sampleEvents(): CalendarEvent[] {
  return [
    { id: 'm', title: 'Standup', start: new Date(2026, 5, 24, 9, 0), end: new Date(2026, 5, 24, 9, 30) },
    { id: 'r', title: 'Gym', start: new Date(2026, 5, 24, 18, 0), end: new Date(2026, 5, 24, 19, 0), resourceId: 'room-a' },
  ];
}

function mk(config: Record<string, unknown> = {}): Calendar {
  return new Calendar(host, {
    date: ANCHOR,
    events: sampleEvents(),
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
  document.querySelectorAll('.jects-window').forEach((w) => w.remove());
});

describe('Calendar — undo / redo', () => {
  it('captures an add and undo/redo round-trips it', () => {
    const cal = mk({ view: 'day' });
    const before = cal.store.count;
    cal.store.addEvent({ title: 'New', start: new Date(2026, 5, 24, 14), end: new Date(2026, 5, 24, 15) });
    expect(cal.store.count).toBe(before + 1);
    expect(cal.canUndo()).toBe(true);

    expect(cal.undo()).toBe(true);
    expect(cal.store.count).toBe(before);
    expect(cal.canRedo()).toBe(true);

    expect(cal.redo()).toBe(true);
    expect(cal.store.count).toBe(before + 1);
    cal.destroy();
  });

  it('captures a move (update) and restores the prior times on undo', () => {
    const cal = mk({ view: 'day' });
    const orig = cal.store.getById('m')!.start.getTime();
    cal.store.moveEvent('m', new Date(2026, 5, 24, 11, 0), new Date(2026, 5, 24, 11, 30));
    expect(cal.store.getById('m')!.start.getHours()).toBe(11);
    cal.undo();
    expect(cal.store.getById('m')!.start.getTime()).toBe(orig);
    cal.destroy();
  });

  it('Ctrl+Z triggers undo from the root', () => {
    const cal = mk({ view: 'day' });
    cal.store.addEvent({ title: 'X', start: new Date(2026, 5, 24, 13), end: new Date(2026, 5, 24, 14) });
    const after = cal.store.count;
    cal.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    expect(cal.store.count).toBe(after - 1);
    cal.destroy();
  });
});

describe('Calendar — timeline view', () => {
  it('renders one row per resource and positions events on the time axis', () => {
    const cal = mk({ view: 'timeline' });
    expect(cal.el.classList.contains('jects-cal--timeline')).toBe(true);
    expect(cal.el.querySelectorAll('.jects-cal__tl-row')).toHaveLength(2); // room-a, room-b
    const bars = cal.el.querySelectorAll<HTMLElement>('.jects-cal__tl-event');
    expect(bars.length).toBeGreaterThan(0); // Gym @ 18:00 in room-a
    // 18:00 of a 24h axis → ~75% from the left.
    const left = parseFloat(bars[0]!.style.left);
    expect(left).toBeGreaterThan(70);
    expect(left).toBeLessThan(80);
    cal.destroy();
  });
});

describe('Calendar — drag-create & resize', () => {
  it('drag-create in a time column emits a timed rangeSelect', () => {
    const cal = mk({ view: 'day', editor: false });
    let range: { allDay: boolean } | undefined;
    cal.on('rangeSelect', (p) => (range = p));
    const col = cal.el.querySelector<HTMLElement>('.jects-cal__tg-col')!;
    stubRect(col);
    col.dispatchEvent(pev('pointerdown', { clientY: 60 }));
    document.dispatchEvent(pev('pointermove', { clientY: 200 }));
    document.dispatchEvent(pev('pointerup', { clientY: 200 }));
    expect(range).toBeTruthy();
    expect(range!.allDay).toBe(false);
    cal.destroy();
  });

  it('drag-create across the month grid emits an all-day rangeSelect', () => {
    const cal = mk({ view: 'month', editor: false });
    let range: { allDay: boolean } | undefined;
    cal.on('rangeSelect', (p) => (range = p));
    const cell = cal.el.querySelector<HTMLElement>('.jects-cal__month-cell')!;
    cell.dispatchEvent(pev('pointerdown', { clientX: 5, clientY: 5 }));
    document.dispatchEvent(pev('pointermove', { clientX: 8, clientY: 8 }));
    document.dispatchEvent(pev('pointerup', { clientX: 8, clientY: 8 }));
    expect(range).toBeTruthy();
    expect(range!.allDay).toBe(true);
    cal.destroy();
  });

  it('resizing a timed event commits a new end time (eventUpdate)', () => {
    const cal = mk({ view: 'day' });
    let updated = false;
    cal.on('eventUpdate', () => (updated = true));
    const handle = cal.el.querySelector<HTMLElement>('.jects-cal__event-resize')!;
    const col = handle.closest<HTMLElement>('.jects-cal__tg-col')!;
    const id = handle.closest<HTMLElement>('[data-event-id]')!.dataset.eventId!;
    stubRect(col);
    handle.dispatchEvent(pev('pointerdown', { clientY: 20 }));
    document.dispatchEvent(pev('pointermove', { clientY: 240 })); // ~12:00 on a 24h/480px axis
    document.dispatchEvent(pev('pointerup', { clientY: 240 }));
    expect(updated).toBe(true);
    expect(cal.store.getById(id)!.end.getHours()).toBeGreaterThanOrEqual(11);
    cal.destroy();
  });
});

describe('Calendar — load-on-demand', () => {
  it('calls the data source for the visible window and merges results', () => {
    const calls: Array<[Date, Date]> = [];
    const cal = new Calendar(host, {
      date: ANCHOR,
      view: 'day',
      loadEvents: (start, end) => {
        calls.push([start, end]);
        return [{ id: 'L', title: 'Lazy', start: new Date(2026, 5, 24, 10), end: new Date(2026, 5, 24, 11) }];
      },
    });
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0]![0]).toBeInstanceOf(Date);
    expect(cal.store.getById('L')).toBeTruthy();
    cal.destroy();
  });

  it('does not refetch an already-loaded window on re-render', () => {
    let count = 0;
    const cal = new Calendar(host, {
      date: ANCHOR,
      view: 'day',
      loadEvents: () => {
        count += 1;
        return [];
      },
    });
    const first = count;
    cal.setView('day'); // same view → same range; must not refetch
    cal.goToDate(ANCHOR); // same anchor → same range
    expect(count).toBe(first);
    cal.destroy();
  });
});

describe('Calendar — locale', () => {
  it('a non-English locale changes the month/weekday labels', () => {
    const cal = mk({ view: 'month', locale: 'es-ES' });
    expect(cal.el.querySelector('.jects-cal__title')!.textContent!.toLowerCase()).toContain('junio');
    const dows = [...cal.el.querySelectorAll('.jects-cal__month-dow')].map((d) => d.textContent!.toLowerCase());
    // Spanish weekday abbreviations (e.g. "lun", "mié"); definitely not "Mon".
    expect(dows.join(' ')).not.toContain('Mon');
    cal.destroy();
  });
});

describe('Calendar — timezone display', () => {
  it('projects timed occurrences to the configured zone wall-clock', () => {
    const event: CalendarEvent = {
      id: 'z',
      title: 'Z',
      start: new Date(Date.UTC(2026, 5, 24, 3, 0)), // 03:00 UTC
      end: new Date(Date.UTC(2026, 5, 24, 4, 0)),
    };
    const cal = new Calendar(host, { date: ANCHOR, view: 'day', timeZone: 'Asia/Tokyo', events: [event] });
    // Wide window so the occurrence is returned regardless of the runner's zone.
    const occ = cal.occurrencesInRange(new Date(Date.UTC(2026, 5, 22)), new Date(Date.UTC(2026, 5, 26)))[0]!;
    expect(occ.start.getHours()).toBe(12); // 03:00Z + 9h = 12:00 Tokyo
    cal.destroy();
  });
});

describe('Calendar — export methods', () => {
  it('exportICS returns a VEVENT-bearing document', () => {
    const cal = mk();
    const ics = cal.exportICS();
    expect(ics).toContain('BEGIN:VEVENT');
    expect(ics).toMatch(/DTSTART/);
    cal.destroy();
  });

  it('exportExcel returns CSV with a header', () => {
    const cal = mk();
    expect(cal.exportExcel()).toContain('title');
    cal.destroy();
  });

  it('print() is a no-op-safe call', () => {
    const cal = mk();
    expect(() => cal.print()).not.toThrow();
    cal.destroy();
  });
});

describe('Calendar — advanced recurrence editor', () => {
  it('round-trips an advanced weekly rule from the editor inputs', () => {
    const cal = mk({ view: 'week' });
    let created: CalendarEvent | undefined;
    cal.on('eventCreate', (p) => (created = p.event));
    cal.requestEdit(null, { start: new Date(2026, 5, 24, 9), end: new Date(2026, 5, 24, 10), allDay: false });

    const recSel = document.querySelector<HTMLSelectElement>('#jects-cal-rec')!;
    recSel.value = 'weekly';
    recSel.dispatchEvent(new Event('change'));

    const nums = document.querySelectorAll<HTMLInputElement>('.jects-cal-editor__rec-num');
    nums[0]!.value = '2'; // interval
    const wcbs = document.querySelectorAll<HTMLInputElement>('.jects-cal-editor__weekday-cb');
    wcbs[1]!.checked = true; // Mon
    wcbs[3]!.checked = true; // Wed

    const endSel = document.querySelector<HTMLSelectElement>('.jects-cal-editor__rec-end')!;
    endSel.value = 'count';
    endSel.dispatchEvent(new Event('change'));
    document.querySelectorAll<HTMLInputElement>('.jects-cal-editor__rec-num')[1]!.value = '6'; // count

    document
      .querySelector<HTMLFormElement>('.jects-cal-editor__form')!
      .dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));

    expect(created).toBeTruthy();
    expect(created!.recurrence).toBeTruthy();
    expect(created!.recurrence!.freq).toBe('weekly');
    expect(created!.recurrence!.interval).toBe(2);
    expect(created!.recurrence!.byWeekday).toEqual([1, 3]);
    expect(created!.recurrence!.count).toBe(6);
    cal.destroy();
  });
});
