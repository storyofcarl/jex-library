import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isRegistered, getCtor } from '@jects/core';
import { HOUR_AND_DAY } from '@jects/timeline-core';
import { Scheduler } from './scheduler.js';
import type { ResourceModel, EventModel } from '../contract.js';

const DAY = 86_400_000;
const start = Date.UTC(2025, 0, 1);

function resources(): ResourceModel[] {
  return [
    { id: 'r1', name: 'Alice' },
    { id: 'r2', name: 'Bob' },
  ];
}
function events(): EventModel[] {
  return [
    { id: 'e1', resourceId: 'r1', name: 'Task A', startDate: start, endDate: start + DAY },
    { id: 'e2', resourceId: 'r2', name: 'Task B', startDate: start + DAY, endDate: start + DAY * 2 },
  ];
}

describe('Scheduler', () => {
  let host: HTMLElement;
  let sched: Scheduler | undefined;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
  });
  afterEach(() => {
    sched?.destroy();
    sched = undefined;
    host.remove();
  });

  function make(extra: Partial<Parameters<typeof Scheduler.prototype.update>[0]> = {}): Scheduler {
    sched = new Scheduler(host, {
      resources: resources(),
      events: events(),
      preset: HOUR_AND_DAY,
      range: { start: start - DAY, end: start + DAY * 5 },
      ...extra,
    });
    return sched;
  }

  it('registers with the factory as "scheduler"', () => {
    expect(isRegistered('scheduler')).toBe(true);
    expect(getCtor('scheduler')).toBeDefined();
  });

  it('renders the scaffold with an application role + label', () => {
    const s = make();
    expect(s.el.getAttribute('role')).toBe('application');
    expect(s.el.getAttribute('aria-label')).toBe('Resource scheduler');
    expect(s.el.querySelector('.jects-scheduler__time-header')).toBeTruthy();
    expect(s.el.querySelector('.jects-scheduler__scroller')).toBeTruthy();
    expect(s.el.querySelector('.jects-scheduler__resources')).toBeTruthy();
  });

  it('renders one resource row per resource', () => {
    const s = make();
    const rows = s.el.querySelectorAll('.jects-scheduler__resource-row');
    expect(rows.length).toBe(2);
    expect(rows[0]!.textContent).toContain('Alice');
  });

  it('renders an event bar per event with an aria-label', () => {
    const s = make();
    const bars = s.el.querySelectorAll('.jects-scheduler__bar');
    expect(bars.length).toBe(2);
    const a = s.el.querySelector('[data-event-id="e1"]')!;
    expect(a.getAttribute('aria-label')).toContain('Task A');
    // Bars are interactive controls (a11y): exposed as buttons with roving tabindex.
    expect(a.getAttribute('role')).toBe('button');
  });

  it('shows an empty state when there are no resources', () => {
    sched = new Scheduler(host, {
      resources: [],
      events: [],
      preset: HOUR_AND_DAY,
      range: { start, end: start + DAY },
    });
    const empty = sched.el.querySelector('.jects-scheduler__empty') as HTMLElement;
    expect(empty.hidden).toBe(false);
  });

  it('emits eventClick when a bar is clicked', () => {
    const s = make();
    let clicked: string | undefined;
    s.on('eventClick', ({ event }) => {
      clicked = String(event.id);
    });
    const bar = s.el.querySelector('[data-event-id="e1"]') as HTMLElement;
    bar.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(clicked).toBe('e1');
  });

  it('deletes an event via the public API with veto + emit', () => {
    const s = make();
    const record = s.getEventStore().getById('e1')!;
    let deleted = false;
    s.on('eventDelete', () => {
      deleted = true;
    });
    s.deleteEvent(record);
    expect(deleted).toBe(true);
    expect(s.getEventStore().getById('e1')).toBeUndefined();
    expect(s.el.querySelector('[data-event-id="e1"]')).toBeNull();
  });

  it('honours a beforeEventDelete veto', () => {
    const s = make();
    s.on('beforeEventDelete', () => false);
    s.deleteEvent(s.getEventStore().getById('e1')!);
    expect(s.getEventStore().getById('e1')).toBeDefined();
  });

  it('changes the view + emits viewChange on zoom', () => {
    const s = make();
    let zoomed = false;
    s.on('viewChange', () => {
      zoomed = true;
    });
    s.zoomIn();
    expect(zoomed).toBe(true);
  });

  it('expands a recurring event into multiple bars', () => {
    sched = new Scheduler(host, {
      resources: [{ id: 'r1', name: 'Alice' }],
      events: [
        {
          id: 'rec',
          resourceId: 'r1',
          name: 'Daily standup',
          startDate: start,
          endDate: start + 3_600_000,
          recurrenceRule: 'FREQ=DAILY;COUNT=4',
        },
      ],
      preset: HOUR_AND_DAY,
      range: { start, end: start + DAY * 5 },
    });
    const bars = sched.el.querySelectorAll('.jects-scheduler__bar');
    expect(bars.length).toBeGreaterThanOrEqual(2);
  });

  it('renders dependency lines when supplied', () => {
    sched = new Scheduler(host, {
      resources: resources(),
      events: events(),
      dependencies: [{ id: 'd', fromId: 'e1', toId: 'e2', type: 'FS' }],
      preset: HOUR_AND_DAY,
      range: { start: start - DAY, end: start + DAY * 5 },
    });
    const lines = sched.el.querySelectorAll('.jects-scheduler__dep-line');
    expect(lines.length).toBe(1);
  });

  it('repaints when the event store changes', () => {
    const s = make();
    s.getEventStore().add({
      id: 'e3',
      resourceId: 'r1',
      name: 'Task C',
      startDate: start,
      endDate: start + DAY,
    });
    expect(s.el.querySelector('[data-event-id="e3"]')).toBeTruthy();
  });

  it('supports vertical orientation', () => {
    const s = make({ orientation: 'vertical' });
    expect(s.el.classList.contains('jects-scheduler--vertical')).toBe(true);
  });

  it('marks recurrence occurrence bars read-only (not draggable)', () => {
    sched = new Scheduler(host, {
      resources: [{ id: 'r1', name: 'Alice' }],
      events: [
        {
          id: 'rec',
          resourceId: 'r1',
          name: 'Daily standup',
          startDate: start,
          endDate: start + 3_600_000,
          recurrenceRule: 'FREQ=DAILY;COUNT=4',
        },
      ],
      preset: HOUR_AND_DAY,
      range: { start, end: start + DAY * 5 },
    });
    // The master bar keeps id 'rec'; occurrences carry data-occurrence + read-only.
    const master = sched.el.querySelector('[data-event-id="rec"]') as HTMLElement;
    expect(master).toBeTruthy();
    expect(master.dataset.occurrence).toBeUndefined();
    const occurrences = sched.el.querySelectorAll('.jects-scheduler__bar[data-occurrence="true"]');
    expect(occurrences.length).toBeGreaterThanOrEqual(1);
    for (const occ of occurrences) {
      expect(occ.getAttribute('aria-readonly')).toBe('true');
      expect(occ.classList.contains('jects-scheduler__bar--locked')).toBe(true);
    }
  });

  it('uses a roving tabindex over the event bars (one Tab stop)', () => {
    const s = make();
    const bars = Array.from(s.el.querySelectorAll<HTMLElement>('.jects-scheduler__bar'));
    expect(bars.length).toBe(2);
    const tabbable = bars.filter((b) => b.tabIndex === 0);
    expect(tabbable.length).toBe(1);
    expect(bars.every((b) => b.getAttribute('role') === 'button')).toBe(true);
  });

  it('opens the editor at document.body level (not clipped inside the root)', () => {
    const s = make();
    const before = document.querySelectorAll('.jects-window').length;
    s.editEvent(s.getEventStore().getById('e1')!);
    const win = document.querySelector('.jects-window') as HTMLElement;
    expect(win).toBeTruthy();
    // The editor Window is a direct child of body, NOT nested inside the
    // overflow:hidden scheduler root (which would clip it).
    expect(win.parentElement).toBe(document.body);
    expect(s.el.contains(win)).toBe(false);
    expect(document.querySelectorAll('.jects-window').length).toBe(before + 1);
    win.remove();
  });

  it('exposes a polite live region for move/delete announcements', () => {
    const s = make();
    const live = s.el.querySelector('.jects-scheduler__live') as HTMLElement;
    expect(live).toBeTruthy();
    expect(live.getAttribute('aria-live')).toBe('polite');
    expect(live.getAttribute('role')).toBe('status');
  });

  it('is idempotent + leak-free on destroy', () => {
    const s = make();
    const el = s.el;
    s.destroy();
    expect(s.isDestroyed).toBe(true);
    expect(el.isConnected).toBe(false);
    // Second destroy is a no-op.
    expect(() => s.destroy()).not.toThrow();
  });
});
