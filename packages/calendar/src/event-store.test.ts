import { describe, it, expect } from 'vitest';
import { EventStore, normalizeEvent } from './event-store.js';

describe('normalizeEvent', () => {
  it('coerces string dates to Date', () => {
    const e = normalizeEvent({ title: 'X', start: '2026-06-24T09:00' as unknown as Date });
    expect(e.start).toBeInstanceOf(Date);
    expect(e.start.getFullYear()).toBe(2026);
  });

  it('defaults end to start + 1h when missing', () => {
    const start = new Date(2026, 5, 24, 9);
    const e = normalizeEvent({ title: 'X', start });
    expect(e.end.getTime() - e.start.getTime()).toBe(3_600_000);
  });

  it('fixes end before start', () => {
    const e = normalizeEvent({
      title: 'X',
      start: new Date(2026, 5, 24, 10),
      end: new Date(2026, 5, 24, 9),
    });
    expect(e.end.getTime()).toBeGreaterThan(e.start.getTime());
  });

  it('assigns an id when missing', () => {
    const e = normalizeEvent({ title: 'X', start: new Date() });
    expect(e.id).toBeTruthy();
  });
});

describe('EventStore', () => {
  it('normalizes events on construction', () => {
    const store = new EventStore({
      data: [{ id: '1', title: 'A', start: new Date(2026, 5, 1, 9), end: new Date(2026, 5, 1, 10) }],
    });
    expect(store.count).toBe(1);
    expect(store.getById('1')!.start).toBeInstanceOf(Date);
  });

  it('addEvent returns a normalized event', () => {
    const store = new EventStore();
    const e = store.addEvent({ title: 'New', start: new Date(2026, 5, 1, 9) });
    expect(e.id).toBeTruthy();
    expect(e.end.getTime() - e.start.getTime()).toBe(3_600_000);
    expect(store.count).toBe(1);
  });

  it('moveEvent preserves duration by default', () => {
    const store = new EventStore({
      data: [{ id: '1', title: 'A', start: new Date(2026, 5, 1, 9), end: new Date(2026, 5, 1, 11) }],
    });
    const moved = store.moveEvent('1', new Date(2026, 5, 2, 14))!;
    expect(moved.start.getDate()).toBe(2);
    expect(moved.start.getHours()).toBe(14);
    expect(moved.end.getHours()).toBe(16); // duration 2h preserved
  });

  it('resizeEvent clamps end above start', () => {
    const store = new EventStore({
      data: [{ id: '1', title: 'A', start: new Date(2026, 5, 1, 9), end: new Date(2026, 5, 1, 11) }],
    });
    const resized = store.resizeEvent('1', new Date(2026, 5, 1, 8))!;
    expect(resized.end.getTime()).toBeGreaterThan(resized.start.getTime());
  });

  it('occurrencesInRange expands recurring events', () => {
    const store = new EventStore({
      data: [
        {
          id: 'r',
          title: 'Daily',
          start: new Date(2026, 5, 1, 9),
          end: new Date(2026, 5, 1, 10),
          recurrence: { freq: 'daily', count: 3 },
        },
      ],
    });
    const occs = store.occurrencesInRange(new Date(2026, 5, 1), new Date(2026, 5, 5));
    expect(occs).toHaveLength(3);
  });

  it('emits change on add (drives calendar re-render)', () => {
    const store = new EventStore();
    let fired = 0;
    store.events.on('change', () => fired++);
    store.addEvent({ title: 'X', start: new Date(2026, 5, 1, 9) });
    expect(fired).toBeGreaterThan(0);
  });
});
