/**
 * jsdom unit tests for `toWorkingTimeCalendar` — the projection of a rich Gantt
 * `CalendarModel` onto the lighter timeline-core `WorkingTimeCalendar` used for
 * non-working backdrop shading. Verifies custom weeks, the working-hours window,
 * holiday exceptions, and the null fallback for empty calendars.
 */
import { describe, it, expect } from 'vitest';
import { toWorkingTimeCalendar } from './calendar-bridge.js';
import type { CalendarModel } from '../contract.js';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 5);

/** 8h working interval, 09:00–17:00 in minutes-from-midnight. */
const NINE_TO_FIVE = [{ from: 9 * 60, to: 17 * 60 }];

describe('toWorkingTimeCalendar', () => {
  it('returns null for an empty / weekless calendar (caller falls back to default)', () => {
    expect(toWorkingTimeCalendar(undefined)).toBeNull();
    expect(toWorkingTimeCalendar({ id: 'c', week: [] })).toBeNull();
  });

  it('maps a Mon–Fri week to weekendDays [Sun, Sat] + the working-hours window', () => {
    const cal: CalendarModel = {
      id: 'std',
      week: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, intervals: NINE_TO_FIVE })),
    };
    const wt = toWorkingTimeCalendar(cal);
    expect(wt).not.toBeNull();
    expect(wt!.weekendDays).toEqual([0, 6]);
    expect(wt!.dayStartHour).toBe(9);
    expect(wt!.dayEndHour).toBe(17);
  });

  it('shades the real non-working day for a Mon–Sat week (only Sunday is off)', () => {
    const cal: CalendarModel = {
      id: 'six-day',
      week: [1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, intervals: NINE_TO_FIVE })),
    };
    const wt = toWorkingTimeCalendar(cal)!;
    // Saturday (6) is a working day here, so it must NOT be shaded; only Sunday.
    expect(wt.weekendDays).toEqual([0]);
  });

  it('projects holiday (no-work) exceptions into the holidays list', () => {
    const cal: CalendarModel = {
      id: 'std',
      week: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, intervals: NINE_TO_FIVE })),
      exceptions: [
        { span: { start: T0, end: T0 + DAY }, intervals: [], name: 'Holiday' },
        // A working override (non-empty intervals) is NOT a holiday.
        { span: { start: T0 + 7 * DAY, end: T0 + 8 * DAY }, intervals: NINE_TO_FIVE },
      ],
    };
    const wt = toWorkingTimeCalendar(cal)!;
    expect(wt.holidays).toEqual([{ start: T0, end: T0 + DAY }]);
  });

  it('treats weekdays absent from the pattern as non-working', () => {
    const cal: CalendarModel = {
      id: 'partial',
      // Only Tue/Wed/Thu defined as working.
      week: [2, 3, 4].map((weekday) => ({ weekday, intervals: NINE_TO_FIVE })),
    };
    const wt = toWorkingTimeCalendar(cal)!;
    expect(wt.weekendDays).toEqual([0, 1, 5, 6]);
  });
});
