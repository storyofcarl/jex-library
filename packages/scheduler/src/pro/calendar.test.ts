import { describe, it, expect } from 'vitest';
import { WorkingCalendar } from './calendar.js';

const H = 3_600_000;
// Monday 2025-01-06.
const MON = Date.UTC(2025, 0, 6);
const SAT = Date.UTC(2025, 0, 11);

describe('WorkingCalendar', () => {
  const cal = new WorkingCalendar(); // Mon–Fri 9–17

  it('recognises working vs non-working instants', () => {
    expect(cal.isWorking(MON + 10 * H)).toBe(true); // Mon 10:00
    expect(cal.isWorking(MON + 2 * H)).toBe(false); // Mon 02:00 (before 9)
    expect(cal.isWorking(SAT + 10 * H)).toBe(false); // Saturday
  });

  it('skips non-working time to the next working instant', () => {
    const next = cal.skipNonWorking(SAT + 10 * H);
    expect(cal.isWorking(next)).toBe(true);
  });

  it('measures working duration excluding off-hours', () => {
    // Mon 09:00 → Mon 17:00 is exactly 8 working hours.
    const dur = cal.workingDuration(MON + 9 * H, MON + 17 * H);
    expect(dur).toBeGreaterThanOrEqual(8 * H - 60_000);
    expect(dur).toBeLessThanOrEqual(8 * H + 60_000);
  });

  it('adding working time skips weekends', () => {
    // Add 8 working hours starting Friday 15:00 → should land next Monday.
    const fri15 = Date.UTC(2025, 0, 10, 15);
    const end = cal.addWorking(fri15, 8 * H);
    expect(new Date(end).getUTCDay()).not.toBe(6); // not Saturday
    expect(new Date(end).getUTCDay()).not.toBe(0); // not Sunday
  });

  it('subtractWorking is the inverse direction of addWorking', () => {
    const start = MON + 9 * H;
    const end = cal.addWorking(start, 4 * H);
    const back = cal.subtractWorking(end, 4 * H);
    // Within one scan step of the original start.
    expect(Math.abs(back - start)).toBeLessThanOrEqual(60_000);
  });

  it('honours holidays', () => {
    const holiday = { start: MON, end: MON + 86_400_000 };
    const withHoliday = new WorkingCalendar({ holidays: [holiday] });
    expect(withHoliday.isWorking(MON + 10 * H)).toBe(false);
  });

  it('falls through to a parent calendar', () => {
    const parent = new WorkingCalendar({ holidays: [{ start: MON, end: MON + 86_400_000 }] });
    const child = new WorkingCalendar({}, parent);
    // Child has no holiday but parent does → still non-working.
    expect(child.isWorking(MON + 10 * H)).toBe(false);
  });
});
