/**
 * @jects/calendar — TIMEZONE / DST known-answer fixtures.
 *
 * Proof-grade vectors for the IANA-zone projection helpers across real US DST
 * transitions. Each instant is a fixed UTC epoch (`Date.UTC`), and every
 * assertion is made via the package's own `zonedTime` / `timeZoneOffsetMinutes`
 * (which use `Intl` with an explicit `timeZone`), so the results are independent
 * of the test runner's local zone.
 *
 * Transitions exercised (America/New_York):
 *   - Spring forward 2024-03-10 02:00 EST → 03:00 EDT  (the 02:00 hour DOES NOT EXIST)
 *   - Fall back     2024-11-03 02:00 EDT → 01:00 EST  (the 01:00 hour HAPPENS TWICE)
 */
import { describe, it, expect } from 'vitest';
import { zonedTime, timeZoneOffsetMinutes } from './tz.js';

const NY = 'America/New_York';

/** Local `HH:MM` of a (already zone-projected) Date. */
function hm(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

describe('timezone fixtures — spring forward (2024-03-10, the missing hour)', () => {
  // The NY transition happens at 07:00Z (02:00 EST jumps to 03:00 EDT).
  const before = new Date(Date.UTC(2024, 2, 10, 6, 30)); // 06:30Z
  const after = new Date(Date.UTC(2024, 2, 10, 7, 30)); // 07:30Z

  it('offset shifts EST(-5h) → EDT(-4h) across the boundary', () => {
    expect(timeZoneOffsetMinutes(before, NY)).toBe(-300); // EST
    expect(timeZoneOffsetMinutes(after, NY)).toBe(-240); // EDT
  });

  it('wall clock jumps 01:30 → 03:30, skipping the 02:xx hour entirely', () => {
    expect(hm(zonedTime(before, NY))).toBe('01:30'); // 06:30Z − 5h
    expect(hm(zonedTime(after, NY))).toBe('03:30'); // 07:30Z − 4h
  });
});

describe('timezone fixtures — fall back (2024-11-03, the repeated hour)', () => {
  // The NY transition happens at 06:00Z (02:00 EDT falls back to 01:00 EST).
  const firstOnePM = new Date(Date.UTC(2024, 10, 3, 5, 30)); // 05:30Z, still EDT
  const secondOnePM = new Date(Date.UTC(2024, 10, 3, 6, 30)); // 06:30Z, now EST

  it('offset shifts EDT(-4h) → EST(-5h) across the boundary', () => {
    expect(timeZoneOffsetMinutes(firstOnePM, NY)).toBe(-240); // EDT
    expect(timeZoneOffsetMinutes(secondOnePM, NY)).toBe(-300); // EST
  });

  it('two distinct UTC instants both render as 01:30 local (ambiguous hour)', () => {
    expect(hm(zonedTime(firstOnePM, NY))).toBe('01:30'); // 05:30Z − 4h
    expect(hm(zonedTime(secondOnePM, NY))).toBe('01:30'); // 06:30Z − 5h
    // ...yet they are genuinely different instants one hour apart.
    expect(secondOnePM.getTime() - firstOnePM.getTime()).toBe(60 * 60 * 1000);
  });
});

describe('timezone fixtures — a fixed wall-clock event maps to season-dependent UTC', () => {
  // A 09:00 New York meeting is a different UTC instant in summer vs winter
  // because the zone offset changes. We verify the projection of the correct
  // UTC instant reads back as 09:00 local in each season.
  it('09:00 NY in summer (EDT) corresponds to 13:00Z', () => {
    const summerInstant = new Date(Date.UTC(2024, 6, 4, 13, 0)); // 13:00Z
    expect(timeZoneOffsetMinutes(summerInstant, NY)).toBe(-240);
    expect(hm(zonedTime(summerInstant, NY))).toBe('09:00');
  });

  it('09:00 NY in winter (EST) corresponds to 14:00Z', () => {
    const winterInstant = new Date(Date.UTC(2024, 0, 4, 14, 0)); // 14:00Z
    expect(timeZoneOffsetMinutes(winterInstant, NY)).toBe(-300);
    expect(hm(zonedTime(winterInstant, NY))).toBe('09:00');
  });
});

describe('timezone fixtures — same instant renders per-zone (NY vs UTC)', () => {
  it('one summer instant reads 12:00 in NY and 16:00 in UTC', () => {
    const instant = new Date(Date.UTC(2024, 6, 1, 16, 0)); // 16:00Z, July
    expect(hm(zonedTime(instant, NY))).toBe('12:00'); // EDT −4
    expect(hm(zonedTime(instant, 'UTC'))).toBe('16:00');
    expect(timeZoneOffsetMinutes(instant, 'UTC')).toBe(0);
  });
});
