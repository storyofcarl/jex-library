import { describe, it, expect } from 'vitest';
import {
  timeZoneOffsetMinutes,
  wallTimeToInstant,
  slotInstant,
  instantToZoned,
  offsetLabel,
  commonTimeZones,
  localTimeZone,
} from './timezone.js';

describe('timeZoneOffsetMinutes', () => {
  it('is 0 for UTC', () => {
    expect(timeZoneOffsetMinutes(new Date('2030-06-24T12:00:00Z'), 'UTC')).toBe(0);
  });
  it('is DST-correct for New York (summer vs winter)', () => {
    // EDT = UTC-4 in June, EST = UTC-5 in January.
    expect(timeZoneOffsetMinutes(new Date('2030-06-24T12:00:00Z'), 'America/New_York')).toBe(-240);
    expect(timeZoneOffsetMinutes(new Date('2030-01-24T12:00:00Z'), 'America/New_York')).toBe(-300);
  });
  it('handles half-hour zones (Kolkata)', () => {
    expect(timeZoneOffsetMinutes(new Date('2030-06-24T12:00:00Z'), 'Asia/Kolkata')).toBe(330);
  });
});

describe('wallTimeToInstant / round-trip', () => {
  it('converts a NY wall time to the correct UTC instant (summer)', () => {
    // 09:00 wall in NY (EDT, -4) ⇒ 13:00 UTC.
    const inst = wallTimeToInstant(2030, 6, 24, 9, 0, 'America/New_York');
    expect(inst.toISOString()).toBe('2030-06-24T13:00:00.000Z');
  });
  it('round-trips slotInstant ⇄ instantToZoned', () => {
    const inst = slotInstant('2030-06-24', '09:30', 'America/New_York');
    const back = instantToZoned(inst, 'America/New_York');
    expect(back).toEqual({ date: '2030-06-24', time: '09:30' });
  });
  it('cross-zone display: 09:00 NY shows as 14:00 London (both summer DST)', () => {
    const inst = slotInstant('2030-06-24', '09:00', 'America/New_York');
    expect(instantToZoned(inst, 'Europe/London').time).toBe('14:00');
  });
});

describe('offsetLabel', () => {
  it('formats whole and half-hour offsets', () => {
    expect(offsetLabel('UTC', new Date('2030-06-24T12:00:00Z'))).toBe('GMT+0');
    expect(offsetLabel('America/New_York', new Date('2030-06-24T12:00:00Z'))).toBe('GMT-4');
    expect(offsetLabel('Asia/Kolkata', new Date('2030-06-24T12:00:00Z'))).toBe('GMT+5:30');
  });
});

describe('commonTimeZones / localTimeZone', () => {
  it('lists zones with the local zone first and no duplicates', () => {
    const zones = commonTimeZones();
    expect(zones[0]).toBe(localTimeZone());
    expect(new Set(zones).size).toBe(zones.length);
    expect(zones).toContain('UTC');
  });
});
