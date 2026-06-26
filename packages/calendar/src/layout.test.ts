import { describe, it, expect } from 'vitest';
import { layoutDay } from './layout.js';
import type { EventOccurrence, CalendarEvent } from './contract.js';

function occ(startH: number, endH: number, id = 'e'): EventOccurrence {
  const start = new Date(2026, 5, 24, startH, 0);
  const end = new Date(2026, 5, 24, endH, 0);
  const event: CalendarEvent = { id, title: id, start, end };
  return { event, start, end, occurrenceKey: `${id}@${start.toISOString()}`, isRecurring: false };
}

const DAY = new Date(2026, 5, 24);

describe('layoutDay', () => {
  it('places a single event full width', () => {
    const laid = layoutDay([occ(9, 10)], DAY, 0, 1440);
    expect(laid).toHaveLength(1);
    expect(laid[0]!.columns).toBe(1);
    expect(laid[0]!.column).toBe(0);
  });

  it('top/height are fractions of the visible window', () => {
    const laid = layoutDay([occ(6, 12)], DAY, 0, 1440);
    expect(laid[0]!.top).toBeCloseTo(360 / 1440, 5);
    expect(laid[0]!.height).toBeCloseTo(360 / 1440, 5);
  });

  it('overlapping events split into columns', () => {
    const laid = layoutDay([occ(9, 11, 'a'), occ(10, 12, 'b')], DAY, 0, 1440);
    expect(laid).toHaveLength(2);
    expect(laid.every((l) => l.columns === 2)).toBe(true);
    const cols = laid.map((l) => l.column).sort();
    expect(cols).toEqual([0, 1]);
  });

  it('non-overlapping events reuse column 0', () => {
    const laid = layoutDay([occ(9, 10, 'a'), occ(11, 12, 'b')], DAY, 0, 1440);
    expect(laid.every((l) => l.columns === 1)).toBe(true);
  });

  it('three mutually overlapping events get 3 columns', () => {
    const laid = layoutDay([occ(9, 12, 'a'), occ(9, 12, 'b'), occ(9, 12, 'c')], DAY, 0, 1440);
    expect(laid.every((l) => l.columns === 3)).toBe(true);
    expect(new Set(laid.map((l) => l.column)).size).toBe(3);
  });

  it('skips all-day events', () => {
    const start = new Date(2026, 5, 24);
    const end = new Date(2026, 5, 25);
    const event: CalendarEvent = { id: 'ad', title: 'all', start, end, allDay: true };
    const allDayOcc: EventOccurrence = {
      event,
      start,
      end,
      occurrenceKey: 'ad',
      isRecurring: false,
    };
    expect(layoutDay([allDayOcc], DAY, 0, 1440)).toHaveLength(0);
  });

  it('respects a narrowed visible window', () => {
    const laid = layoutDay([occ(8, 9)], DAY, 8 * 60, 18 * 60);
    expect(laid[0]!.top).toBeCloseTo(0, 5);
  });
});
