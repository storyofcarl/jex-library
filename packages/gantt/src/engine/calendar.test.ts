import { describe, it, expect } from 'vitest';
import { buildCalculator, resolveCalendar } from './calendar.js';
import type { CalendarModel } from '../contract.js';

const DAY = 86_400_000;
const HOUR = 3_600_000;
const MIN = 60_000;

/** 2024-01-01 is a Monday (UTC). */
const MON = Date.UTC(2024, 0, 1, 0, 0, 0);

/** Standard 9-17 Mon-Fri calendar (8h/day). */
function standardWeek(): CalendarModel {
  return {
    id: 'std',
    name: 'Standard',
    week: [1, 2, 3, 4, 5].map((weekday) => ({
      weekday,
      intervals: [{ from: 9 * 60, to: 17 * 60 }],
    })),
    hoursPerDay: 8,
  };
}

/** 24/7 always-working calendar. */
function alwaysOn(): CalendarModel {
  return {
    id: 'always',
    week: Array.from({ length: 7 }, (_, weekday) => ({ weekday, intervals: [{ from: 0, to: 1440 }] })),
  };
}

describe('WorkingTimeCalculator — 24/7 calendar', () => {
  const calc = buildCalculator(alwaysOn());

  it('treats every instant as working time', () => {
    expect(calc.isWorkingTime(MON)).toBe(true);
    expect(calc.isWorkingTime(MON + 3 * DAY + 17 * HOUR)).toBe(true);
  });

  it('addWorkingTime is plain addition', () => {
    expect(calc.addWorkingTime(MON, 5 * DAY)).toBe(MON + 5 * DAY);
  });

  it('workingDurationBetween is wall-clock', () => {
    expect(calc.workingDurationBetween(MON, MON + 3 * DAY)).toBe(3 * DAY);
  });

  it('ceil/floor are identity inside working time', () => {
    expect(calc.ceilToWorkingTime(MON + 100)).toBe(MON + 100);
    expect(calc.floorToWorkingTime(MON + 100)).toBe(MON + 100);
  });
});

describe('WorkingTimeCalculator — 9-17 Mon-Fri', () => {
  const calc = buildCalculator(standardWeek());

  it('isWorkingTime respects working hours', () => {
    expect(calc.isWorkingTime(MON + 9 * HOUR)).toBe(true); // 09:00 Mon
    expect(calc.isWorkingTime(MON + 8 * HOUR)).toBe(false); // 08:00 Mon
    expect(calc.isWorkingTime(MON + 17 * HOUR)).toBe(false); // 17:00 exclusive
    expect(calc.isWorkingTime(MON + 5 * DAY + 9 * HOUR)).toBe(false); // Saturday
    expect(calc.isWorkingTime(MON + 6 * DAY + 9 * HOUR)).toBe(false); // Sunday
  });

  it('ceilToWorkingTime snaps forward to next work instant', () => {
    // 08:00 Mon -> 09:00 Mon
    expect(calc.ceilToWorkingTime(MON + 8 * HOUR)).toBe(MON + 9 * HOUR);
    // 17:00 Mon -> 09:00 Tue
    expect(calc.ceilToWorkingTime(MON + 17 * HOUR)).toBe(MON + DAY + 9 * HOUR);
    // Saturday -> Monday 09:00
    expect(calc.ceilToWorkingTime(MON + 5 * DAY)).toBe(MON + 7 * DAY + 9 * HOUR);
  });

  it('floorToWorkingTime snaps backward to previous work instant', () => {
    // 08:00 Mon -> previous Friday is before; with no prior days resolved it goes to
    // the previous working interval end. 09:00 boundary: 08:00 -> Sunday/Sat none ->
    // previous Friday 17:00. Here MON is the first Monday so floor goes to prior week.
    // Simpler: 12:00 Mon stays 12:00 Mon.
    expect(calc.floorToWorkingTime(MON + 12 * HOUR)).toBe(MON + 12 * HOUR);
    // 18:00 Mon -> 17:00 Mon
    expect(calc.floorToWorkingTime(MON + 18 * HOUR)).toBe(MON + 17 * HOUR);
  });

  it('addWorkingTime skips nights and weekends', () => {
    // Start Mon 09:00, add 8h -> Mon 17:00 (full work day)
    expect(calc.addWorkingTime(MON + 9 * HOUR, 8 * HOUR)).toBe(MON + 17 * HOUR);
    // Add 4h to Mon 15:00 -> 2h to 17:00 then 2h into Tue -> Tue 11:00
    expect(calc.addWorkingTime(MON + 15 * HOUR, 4 * HOUR)).toBe(MON + DAY + 11 * HOUR);
    // Add 40h (one work week) from Mon 09:00 fills Mon-Fri exactly -> Fri 17:00
    expect(calc.addWorkingTime(MON + 9 * HOUR, 40 * HOUR)).toBe(MON + 4 * DAY + 17 * HOUR);
    // Add 41h -> Fri 17:00 + 1h into next Mon -> Mon 10:00
    expect(calc.addWorkingTime(MON + 9 * HOUR, 41 * HOUR)).toBe(MON + 7 * DAY + 10 * HOUR);
  });

  it('addWorkingTime from a non-working instant ceils first', () => {
    // 08:00 Mon + 1h -> ceil to 09:00 then +1h = 10:00
    expect(calc.addWorkingTime(MON + 8 * HOUR, HOUR)).toBe(MON + 10 * HOUR);
  });

  it('workingDurationBetween counts only working minutes', () => {
    // Mon 09:00 -> Tue 09:00 spans one work day = 8h
    expect(calc.workingDurationBetween(MON + 9 * HOUR, MON + DAY + 9 * HOUR)).toBe(8 * HOUR);
    // Friday 09:00 -> Monday 09:00 = 8h (Fri only; weekend non-working)
    const fri = MON + 4 * DAY;
    expect(calc.workingDurationBetween(fri + 9 * HOUR, fri + 3 * DAY + 9 * HOUR)).toBe(8 * HOUR);
  });

  it('addWorkingTime then workingDurationBetween round-trips', () => {
    const s = MON + 9 * HOUR;
    const e = calc.addWorkingTime(s, 20 * HOUR);
    expect(calc.workingDurationBetween(s, e)).toBe(20 * HOUR);
  });
});

describe('WorkingTimeCalculator — exceptions/holidays', () => {
  it('a holiday exception makes a day non-working', () => {
    const cal: CalendarModel = {
      ...standardWeek(),
      exceptions: [
        { span: { start: MON + DAY, end: MON + 2 * DAY }, intervals: [], name: 'Holiday Tue' },
      ],
    };
    const calc = buildCalculator(cal);
    expect(calc.isWorkingTime(MON + DAY + 10 * HOUR)).toBe(false);
    // Mon 09:00 + 8h fills Monday, next 8h would normally be Tue but Tue is a
    // holiday -> lands on Wednesday.
    expect(calc.addWorkingTime(MON + 9 * HOUR, 16 * HOUR)).toBe(MON + 2 * DAY + 17 * HOUR);
  });

  it('an exception can add working hours to a normally-off day', () => {
    const cal: CalendarModel = {
      ...standardWeek(),
      exceptions: [
        { span: { start: MON + 5 * DAY, end: MON + 6 * DAY }, intervals: [{ from: 9 * 60, to: 13 * 60 }], name: 'Sat half-day' },
      ],
    };
    const calc = buildCalculator(cal);
    expect(calc.isWorkingTime(MON + 5 * DAY + 10 * HOUR)).toBe(true); // Saturday now working
    expect(calc.isWorkingTime(MON + 5 * DAY + 14 * HOUR)).toBe(false); // after 13:00
  });
});

describe('resolveCalendar — parent cascade', () => {
  it('child weekday rules override parent rules', () => {
    const parent = standardWeek();
    const child: CalendarModel = {
      id: 'child',
      parentId: 'std',
      // Override Monday to a half day, keep the rest inherited.
      week: [{ weekday: 1, intervals: [{ from: 9 * 60, to: 13 * 60 }] }],
    };
    const map = new Map([[parent.id, parent], [child.id, child]]);
    const resolved = resolveCalendar('child', map);
    const monRule = resolved.week.find((r) => r.weekday === 1);
    const tueRule = resolved.week.find((r) => r.weekday === 2);
    expect(monRule?.intervals).toEqual([{ from: 540, to: 780 }]);
    expect(tueRule?.intervals).toEqual([{ from: 540, to: 1020 }]); // inherited 9-17
  });

  it('child inherits hoursPerDay when not set', () => {
    const parent: CalendarModel = { ...standardWeek(), hoursPerDay: 7 };
    const child: CalendarModel = { id: 'c', parentId: 'std', week: [] };
    const map = new Map([['std', parent], ['c', child]]);
    expect(resolveCalendar('c', map).hoursPerDay).toBe(7);
  });
});

describe('WorkingTimeCalculator — degenerate calendars', () => {
  it('a no-working-time calendar reports hasAnyWorkingTime false and addWorkingTime falls back', () => {
    const cal: CalendarModel = { id: 'empty', week: [] };
    const calc = buildCalculator(cal);
    expect(calc.hasAnyWorkingTime()).toBe(false);
    expect(calc.isWorkingTime(MON)).toBe(false);
    // Fallback: wall-clock addition (so the scheduler can still flag a conflict).
    expect(calc.addWorkingTime(MON, 5 * MIN)).toBe(MON + 5 * MIN);
    expect(calc.workingDurationBetween(MON, MON + DAY)).toBe(0);
  });
});
