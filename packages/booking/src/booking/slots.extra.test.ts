/**
 * Extended slot-engine tests covering the parity features: multiple ranges,
 * buffers, minimum notice, max horizon and capacity. Timezone-naive, jsdom-free.
 */
import { describe, it, expect } from 'vitest';
import { generateSlots } from './slots.js';

const now = new Date(2000, 0, 1, 0, 0); // far past ⇒ nothing is "past"

describe('generateSlots — ranges (split shifts)', () => {
  it('honours multiple availability windows over the legacy `hours`', () => {
    const slots = generateSlots({
      date: '2030-06-24',
      hours: { start: '00:00', end: '23:59' }, // ignored when ranges present
      ranges: [
        { start: '09:00', end: '11:00' },
        { start: '13:00', end: '14:00' },
      ],
      slotDuration: 60,
      now,
    });
    expect(slots.map((s) => s.time)).toEqual(['09:00', '10:00', '13:00']);
  });
  it('empty ranges ⇒ no slots', () => {
    expect(
      generateSlots({ date: '2030-06-24', hours: { start: '09:00', end: '17:00' }, ranges: [], slotDuration: 60, now }),
    ).toEqual([]);
  });
});

describe('generateSlots — buffers', () => {
  it('a buffer reserves padding around an existing booking', () => {
    const slots = generateSlots({
      date: '2030-06-24',
      hours: { start: '09:00', end: '12:00' },
      slotDuration: 30,
      bufferAfter: 30,
      bookings: [{ date: '2030-06-24', time: '09:30', duration: 30 }], // blocks 09:30–10:30
      now,
    });
    const by = Object.fromEntries(slots.map((s) => [s.time, s]));
    expect(by['09:30']!.booked).toBe(true);
    expect(by['10:00']!.booked).toBe(true); // within the post-buffer
    expect(by['10:30']!.available).toBe(true);
  });
});

describe('generateSlots — minimum notice', () => {
  it('marks slots within the notice window too-soon on today', () => {
    const slots = generateSlots({
      date: '2030-06-24',
      hours: { start: '09:00', end: '12:00' },
      slotDuration: 60,
      minNotice: 120, // 2h
      now: new Date(2030, 5, 24, 9, 0), // 09:00 today
    });
    const by = Object.fromEntries(slots.map((s) => [s.time, s]));
    expect(by['09:00']!.tooSoon).toBe(true); // < 11:00
    expect(by['10:00']!.tooSoon).toBe(true);
    expect(by['11:00']!.available).toBe(true); // exactly at cutoff
  });
  it('a future day beyond the notice window is fully bookable', () => {
    const slots = generateSlots({
      date: '2030-06-26',
      hours: { start: '09:00', end: '10:00' },
      slotDuration: 60,
      minNotice: 120,
      now: new Date(2030, 5, 24, 9, 0),
    });
    expect(slots[0]!.available).toBe(true);
  });
});

describe('generateSlots — max horizon', () => {
  it('marks days beyond the horizon too-far', () => {
    const opts = {
      hours: { start: '09:00', end: '10:00' },
      slotDuration: 60,
      maxHorizonDays: 7,
      now: new Date(2030, 5, 24, 0, 0),
    };
    expect(generateSlots({ ...opts, date: '2030-06-30' })[0]!.available).toBe(true); // 6 days
    const far = generateSlots({ ...opts, date: '2030-07-05' })[0]!; // 11 days
    expect(far.tooFar).toBe(true);
    expect(far.available).toBe(false);
  });
});

describe('generateSlots — capacity', () => {
  it('reports seats and stays available until full', () => {
    const slots = generateSlots({
      date: '2030-06-24',
      hours: { start: '09:00', end: '10:00' },
      slotDuration: 60,
      capacity: 3,
      bookings: [
        { date: '2030-06-24', time: '09:00' },
        { date: '2030-06-24', time: '09:00' },
      ],
      now,
    });
    const s = slots[0]!;
    expect(s.seatsTotal).toBe(3);
    expect(s.seatsBooked).toBe(2);
    expect(s.seatsRemaining).toBe(1);
    expect(s.available).toBe(true);
  });
  it('full when seats are exhausted', () => {
    const slots = generateSlots({
      date: '2030-06-24',
      hours: { start: '09:00', end: '10:00' },
      slotDuration: 60,
      capacity: 2,
      bookings: [
        { date: '2030-06-24', time: '09:00' },
        { date: '2030-06-24', time: '09:00' },
      ],
      now,
    });
    expect(slots[0]!.seatsRemaining).toBe(0);
    expect(slots[0]!.booked).toBe(true);
    expect(slots[0]!.available).toBe(false);
  });
});
