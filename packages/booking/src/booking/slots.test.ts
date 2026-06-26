/**
 * Pure slot-math unit tests (jsdom — no DOM needed, runs in default `pnpm test`).
 */
import { describe, it, expect } from 'vitest';
import { generateSlots, parseHM, formatHM, formatHM12 } from './slots.js';

describe('parseHM / formatHM', () => {
  it('parses valid 24h times', () => {
    expect(parseHM('09:00')).toBe(540);
    expect(parseHM('00:00')).toBe(0);
    expect(parseHM('23:59')).toBe(1439);
  });
  it('rejects malformed / out-of-range', () => {
    expect(parseHM('24:00')).toBeNull();
    expect(parseHM('09:60')).toBeNull();
    expect(parseHM('nope')).toBeNull();
  });
  it('formats minute-of-day back to HH:MM', () => {
    expect(formatHM(540)).toBe('09:00');
    expect(formatHM(0)).toBe('00:00');
    expect(formatHM(1439)).toBe('23:59');
  });
  it('formats 12h with AM/PM', () => {
    expect(formatHM12(0)).toBe('12:00 AM');
    expect(formatHM12(540)).toBe('9:00 AM');
    expect(formatHM12(720)).toBe('12:00 PM');
    expect(formatHM12(810)).toBe('1:30 PM');
  });
});

describe('generateSlots', () => {
  // A fixed "now" far in the past so generated slots are never marked past.
  const now = new Date(2000, 0, 1, 0, 0);

  it('generates back-to-back slots across working hours', () => {
    const slots = generateSlots({
      date: '2030-06-24',
      hours: { start: '09:00', end: '12:00' },
      slotDuration: 60,
      now,
    });
    expect(slots.map((s) => s.time)).toEqual(['09:00', '10:00', '11:00']);
    expect(slots.every((s) => s.available)).toBe(true);
  });

  it('does not emit a slot that overruns the end of the window', () => {
    const slots = generateSlots({
      date: '2030-06-24',
      hours: { start: '09:00', end: '10:30' },
      slotDuration: 60,
      now,
    });
    // 09:00 fits (ends 10:00); 10:00 would end 11:00 > 10:30 so it's dropped.
    expect(slots.map((s) => s.time)).toEqual(['09:00']);
  });

  it('honours a gap between slots', () => {
    const slots = generateSlots({
      date: '2030-06-24',
      hours: { start: '09:00', end: '12:00' },
      slotDuration: 30,
      slotGap: 30,
      now,
    });
    expect(slots.map((s) => s.time)).toEqual(['09:00', '10:00', '11:00']);
  });

  it('marks slots overlapping an existing booking as booked/unavailable', () => {
    const slots = generateSlots({
      date: '2030-06-24',
      hours: { start: '09:00', end: '11:00' },
      slotDuration: 30,
      bookings: [{ date: '2030-06-24', time: '09:30', duration: 30 }],
      now,
    });
    const byTime = Object.fromEntries(slots.map((s) => [s.time, s]));
    expect(byTime['09:00']!.available).toBe(true);
    expect(byTime['09:30']!.booked).toBe(true);
    expect(byTime['09:30']!.available).toBe(false);
    expect(byTime['10:00']!.available).toBe(true);
  });

  it('a booking longer than one slot blocks every overlapping slot', () => {
    const slots = generateSlots({
      date: '2030-06-24',
      hours: { start: '09:00', end: '11:00' },
      slotDuration: 30,
      bookings: [{ date: '2030-06-24', time: '09:00', duration: 90 }],
      now,
    });
    const blocked = slots.filter((s) => s.booked).map((s) => s.time);
    expect(blocked).toEqual(['09:00', '09:30', '10:00']);
  });

  it('ignores bookings on other days', () => {
    const slots = generateSlots({
      date: '2030-06-24',
      hours: { start: '09:00', end: '10:00' },
      slotDuration: 30,
      bookings: [{ date: '2030-06-25', time: '09:00', duration: 30 }],
      now,
    });
    expect(slots.every((s) => s.available)).toBe(true);
  });

  it('scopes booking conflicts to the selected resource', () => {
    const bookings = [{ date: '2030-06-24', time: '09:00', duration: 30, resourceId: 'rA' }];
    const forA = generateSlots({
      date: '2030-06-24',
      hours: { start: '09:00', end: '10:00' },
      slotDuration: 30,
      bookings,
      resourceId: 'rA',
      now,
    });
    const forB = generateSlots({
      date: '2030-06-24',
      hours: { start: '09:00', end: '10:00' },
      slotDuration: 30,
      bookings,
      resourceId: 'rB',
      now,
    });
    expect(forA.find((s) => s.time === '09:00')!.available).toBe(false);
    expect(forB.find((s) => s.time === '09:00')!.available).toBe(true);
  });

  it('marks past slots unavailable when now is on the same day', () => {
    const slots = generateSlots({
      date: '2030-06-24',
      hours: { start: '09:00', end: '12:00' },
      slotDuration: 60,
      now: new Date(2030, 5, 24, 10, 30), // 10:30 on the same day
    });
    const byTime = Object.fromEntries(slots.map((s) => [s.time, s]));
    expect(byTime['09:00']!.past).toBe(true); // ends 10:00 <= 10:30
    expect(byTime['09:00']!.available).toBe(false);
    expect(byTime['10:00']!.past).toBe(false); // ends 11:00 > 10:30
    expect(byTime['10:00']!.available).toBe(true);
  });

  it('returns no slots for an invalid window', () => {
    expect(
      generateSlots({ date: '2030-06-24', hours: { start: '17:00', end: '09:00' }, slotDuration: 30, now }),
    ).toEqual([]);
    expect(
      generateSlots({ date: '2030-06-24', hours: { start: '09:00', end: '17:00' }, slotDuration: 0, now }),
    ).toEqual([]);
  });
});
