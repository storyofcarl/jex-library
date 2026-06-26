import { describe, it, expect } from 'vitest';
import { zonedTime, timeZoneOffsetMinutes, weekdayLabels, monthLabels } from './tz.js';

describe('tz — timezone projection', () => {
  it('projects an instant to the zone wall-clock hour', () => {
    // 2026-06-24T03:00:00Z (June → New York is UTC-4, Tokyo UTC+9).
    const instant = new Date(Date.UTC(2026, 5, 24, 3, 0, 0));
    expect(zonedTime(instant, 'America/New_York').getHours()).toBe(23); // prev day 23:00
    expect(zonedTime(instant, 'Asia/Tokyo').getHours()).toBe(12);
  });

  it('reports the offset minutes for a zone at an instant', () => {
    const instant = new Date(Date.UTC(2026, 5, 24, 12, 0, 0));
    expect(timeZoneOffsetMinutes(instant, 'America/New_York')).toBe(-240);
    expect(timeZoneOffsetMinutes(instant, 'Asia/Tokyo')).toBe(540);
  });

  it('passing no zone returns a clone, not the same instant', () => {
    const instant = new Date(Date.UTC(2026, 5, 24, 3));
    const out = zonedTime(instant, undefined);
    expect(out).not.toBe(instant);
    expect(out.getTime()).toBe(instant.getTime());
  });
});

describe('tz — locale labels', () => {
  it('weekday labels are localized + indexed 0=Sun', () => {
    expect(weekdayLabels('en-US', 'short')[1]).toMatch(/Mon/);
    expect(weekdayLabels('es-ES', 'short')[1]!.toLowerCase()).toContain('lun');
  });

  it('month labels are localized + indexed 0=Jan', () => {
    expect(monthLabels('en-US', 'long')[0]).toBe('January');
    expect(monthLabels('es-ES', 'long')[0]!.toLowerCase()).toContain('enero');
  });
});
