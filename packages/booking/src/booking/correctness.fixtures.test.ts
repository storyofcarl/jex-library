/**
 * KNOWN-ANSWER correctness fixtures for @jects/booking.
 *
 * Unlike the behavioural unit tests, every assertion here pins a HAND-COMPUTED
 * expected value (a literal instant, offset, range list or slot count) so the
 * suite acts as a regression oracle: if the timezone or availability math ever
 * drifts, these break with a concrete, human-checkable diff.
 *
 * The helpers exercised are exactly the package's public exports
 * (timeZoneOffsetMinutes / wallTimeToInstant / slotInstant / instantToZoned /
 * resolveAvailableRanges / generateSlots) — re-exported from the barrel and
 * verified against the built `dist/booking.js`.
 *
 * Reference DST transitions (US, IANA `America/New_York`, year 2026):
 *   • spring-forward — Sun 8 Mar 2026, 02:00 EST → 03:00 EDT (offset −300 → −240)
 *   • fall-back      — Sun 1 Nov 2026, 02:00 EDT → 01:00 EST (offset −240 → −300)
 */

import { describe, it, expect } from 'vitest';
import {
  timeZoneOffsetMinutes,
  wallTimeToInstant,
  slotInstant,
  instantToZoned,
} from './timezone.js';
import { resolveAvailableRanges, type AvailabilityRules } from './availability-rules.js';
import { generateSlots } from './slots.js';

const NY = 'America/New_York';
const TOKYO = 'Asia/Tokyo';

// ---------------------------------------------------------------------------
// TIMEZONES / DST
// ---------------------------------------------------------------------------

describe('fixtures: timezone offsets (DST-correct)', () => {
  it('America/New_York is EST (−300) in winter and EDT (−240) in summer', () => {
    expect(timeZoneOffsetMinutes(new Date('2026-01-15T12:00:00Z'), NY)).toBe(-300);
    expect(timeZoneOffsetMinutes(new Date('2026-07-15T12:00:00Z'), NY)).toBe(-240);
  });

  it('offset flips exactly across the spring-forward boundary (8 Mar 2026)', () => {
    // 09:00 wall-clock the day BEFORE the change is still EST (−300).
    const beforeSpring = slotInstant('2026-03-07', '09:00', NY);
    // 09:00 wall-clock ON the change day is past the 02:00→03:00 jump ⇒ EDT (−240).
    const afterSpring = slotInstant('2026-03-08', '09:00', NY);
    expect(timeZoneOffsetMinutes(beforeSpring, NY)).toBe(-300);
    expect(timeZoneOffsetMinutes(afterSpring, NY)).toBe(-240);
    expect(timeZoneOffsetMinutes(afterSpring, NY)).not.toBe(
      timeZoneOffsetMinutes(beforeSpring, NY),
    );
  });

  it('offset flips exactly across the fall-back boundary (1 Nov 2026)', () => {
    const beforeFall = slotInstant('2026-10-31', '09:00', NY); // EDT (−240)
    const afterFall = slotInstant('2026-11-01', '09:00', NY); // EST (−300)
    expect(timeZoneOffsetMinutes(beforeFall, NY)).toBe(-240);
    expect(timeZoneOffsetMinutes(afterFall, NY)).toBe(-300);
  });
});

describe('fixtures: slot instants resolve to exact UTC across DST', () => {
  it('spring-forward: same wall time, different absolute instant (EST vs EDT)', () => {
    // EST: 09:00 − (−05:00) ⇒ 14:00Z. EDT: 09:00 − (−04:00) ⇒ 13:00Z.
    expect(slotInstant('2026-03-07', '09:00', NY).toISOString()).toBe(
      '2026-03-07T14:00:00.000Z',
    );
    expect(slotInstant('2026-03-08', '09:00', NY).toISOString()).toBe(
      '2026-03-08T13:00:00.000Z',
    );
  });

  it('fall-back: same wall time, different absolute instant (EDT vs EST)', () => {
    expect(slotInstant('2026-10-31', '09:00', NY).toISOString()).toBe(
      '2026-10-31T13:00:00.000Z',
    );
    expect(slotInstant('2026-11-01', '09:00', NY).toISOString()).toBe(
      '2026-11-01T14:00:00.000Z',
    );
  });

  it('wallTimeToInstant agrees with slotInstant for the spring-forward day', () => {
    expect(wallTimeToInstant(2026, 3, 8, 9, 0, NY).getTime()).toBe(
      slotInstant('2026-03-08', '09:00', NY).getTime(),
    );
  });
});

describe('fixtures: one instant renders at the expected wall time in two display zones', () => {
  it('2026-07-15T16:00Z is 12:00 in New York (EDT) and 01:00 next day in Tokyo', () => {
    const instant = new Date('2026-07-15T16:00:00.000Z');
    expect(instantToZoned(instant, NY)).toEqual({ date: '2026-07-15', time: '12:00' });
    expect(instantToZoned(instant, TOKYO)).toEqual({ date: '2026-07-16', time: '01:00' });
    expect(instantToZoned(instant, 'UTC')).toEqual({ date: '2026-07-15', time: '16:00' });
  });

  it('a winter instant renders one hour earlier in New York (EST, not EDT)', () => {
    // 2026-01-15T16:00Z ⇒ EST (−05:00) ⇒ 11:00 (vs 12:00 in summer).
    const instant = new Date('2026-01-15T16:00:00.000Z');
    expect(instantToZoned(instant, NY)).toEqual({ date: '2026-01-15', time: '11:00' });
  });
});

// ---------------------------------------------------------------------------
// AVAILABILITY
// ---------------------------------------------------------------------------

// Weekly pattern: Monday is a split shift (09:00–12:00, 13:00–17:00),
// Wednesday is 10:00–14:00. Plus a date OVERRIDE on Mon 22 Jun 2026 and a
// BLACKOUT on Wed 24 Jun 2026.
const rules: AvailabilityRules = {
  weekly: {
    1: [
      { start: '09:00', end: '12:00' },
      { start: '13:00', end: '17:00' },
    ],
    3: [{ start: '10:00', end: '14:00' }],
  },
  overrides: [{ date: '2026-06-22', ranges: [{ start: '09:00', end: '11:00' }] }],
  blackouts: ['2026-06-24'],
};

describe('fixtures: resolveAvailableRanges yields exactly the expected ranges', () => {
  it('plain Monday (29 Jun 2026) ⇒ the weekly split shift', () => {
    expect(resolveAvailableRanges(rules, '2026-06-29')).toEqual([
      { start: '09:00', end: '12:00' },
      { start: '13:00', end: '17:00' },
    ]);
  });

  it('override day (Mon 22 Jun 2026) ⇒ the override wins over weekly', () => {
    expect(resolveAvailableRanges(rules, '2026-06-22')).toEqual([
      { start: '09:00', end: '11:00' },
    ]);
  });

  it('blackout day (Wed 24 Jun 2026) ⇒ closed (empty)', () => {
    expect(resolveAvailableRanges(rules, '2026-06-24')).toEqual([]);
  });

  it('un-scheduled weekday (Sun 28 Jun 2026) ⇒ closed (empty)', () => {
    expect(resolveAvailableRanges(rules, '2026-06-28')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// SLOT GENERATION (buffers, minNotice, capacity) — known counts
// ---------------------------------------------------------------------------

// `now` built with the LOCAL Date ctor so nowISO is '2026-06-01' regardless of
// the runner's timezone — a different calendar day than the target, so no slot
// is marked past/tooSoon unless a test opts in.
const farPast = new Date(2026, 5, 1, 0, 0, 0);

describe('fixtures: generateSlots counts (buffers / minNotice / capacity)', () => {
  it('plain 09:00–17:00 @ 60min ⇒ 8 slots, all available', () => {
    const slots = generateSlots({
      date: '2026-06-22',
      hours: { start: '09:00', end: '17:00' },
      slotDuration: 60,
      now: farPast,
    });
    expect(slots.length).toBe(8);
    expect(slots.filter((s) => s.available).length).toBe(8);
    expect(slots.map((s) => s.time)).toEqual([
      '09:00',
      '10:00',
      '11:00',
      '12:00',
      '13:00',
      '14:00',
      '15:00',
      '16:00',
    ]);
  });

  it('buffers expand a 12:00 booking to block 11:00/12:00/13:00 ⇒ 5 available', () => {
    // booking 12:00–13:00 with ±30m buffer ⇒ blocked [11:30, 13:30].
    const slots = generateSlots({
      date: '2026-06-22',
      hours: { start: '09:00', end: '17:00' },
      slotDuration: 60,
      now: farPast,
      bookings: [{ date: '2026-06-22', time: '12:00', duration: 60 }],
      bufferBefore: 30,
      bufferAfter: 30,
    });
    expect(slots.filter((s) => s.booked).map((s) => s.time)).toEqual([
      '11:00',
      '12:00',
      '13:00',
    ]);
    expect(slots.filter((s) => s.available).length).toBe(5);
  });

  it('minNotice of 120m at 10:00 same-day ⇒ 09/10/11 unbookable, 12:00 onward open', () => {
    const sameDay = new Date(2026, 5, 22, 10, 0, 0); // 22 Jun 2026 10:00 local
    const slots = generateSlots({
      date: '2026-06-22',
      hours: { start: '09:00', end: '17:00' },
      slotDuration: 60,
      now: sameDay,
      minNotice: 120,
    });
    expect(slots.filter((s) => s.available).map((s) => s.time)).toEqual([
      '12:00',
      '13:00',
      '14:00',
      '15:00',
      '16:00',
    ]);
    expect(slots.filter((s) => s.tooSoon).map((s) => s.time)).toEqual([
      '09:00',
      '10:00',
      '11:00',
    ]);
    // 09:00 ends at 10:00 == now ⇒ also flagged past.
    expect(slots.filter((s) => s.past).map((s) => s.time)).toEqual(['09:00']);
  });

  it('capacity 2 with two 10:00 bookings ⇒ that slot is full, others keep 2 seats', () => {
    const slots = generateSlots({
      date: '2026-06-22',
      hours: { start: '09:00', end: '17:00' },
      slotDuration: 60,
      now: farPast,
      capacity: 2,
      bookings: [
        { date: '2026-06-22', time: '10:00' },
        { date: '2026-06-22', time: '10:00' },
      ],
    });
    const at10 = slots.find((s) => s.time === '10:00')!;
    const at11 = slots.find((s) => s.time === '11:00')!;
    expect(at10.seatsTotal).toBe(2);
    expect(at10.seatsBooked).toBe(2);
    expect(at10.seatsRemaining).toBe(0);
    expect(at10.booked).toBe(true);
    expect(at10.available).toBe(false);
    expect(at11.seatsRemaining).toBe(2);
    expect(at11.available).toBe(true);
    // Only the 10:00 slot is consumed ⇒ 7 of 8 remain available.
    expect(slots.filter((s) => s.available).length).toBe(7);
  });
});

describe('fixtures: resolveAvailableRanges feeds generateSlots (split-shift count)', () => {
  it('Monday split shift @ 60min ⇒ 7 slots (3 morning + 4 afternoon)', () => {
    const ranges = resolveAvailableRanges(rules, '2026-06-29');
    const slots = generateSlots({
      date: '2026-06-29',
      hours: { start: '00:00', end: '00:00' }, // ignored when `ranges` present
      ranges,
      slotDuration: 60,
      now: farPast,
    });
    expect(slots.map((s) => s.time)).toEqual([
      '09:00',
      '10:00',
      '11:00',
      '13:00',
      '14:00',
      '15:00',
      '16:00',
    ]);
    expect(slots.filter((s) => s.available).length).toBe(7);
  });
});
