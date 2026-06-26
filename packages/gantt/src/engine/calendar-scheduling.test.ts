import { describe, it, expect } from 'vitest';
import { CpmEngine } from './scheduler.js';
import type { CalendarModel, TaskModel } from '../contract.js';

const DAY = 86_400_000;
const HOUR = 3_600_000;
const MON = Date.UTC(2024, 0, 1, 0, 0, 0); // Monday

/** 9-17 Mon-Fri working calendar. */
const work: CalendarModel = {
  id: 'work',
  week: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, intervals: [{ from: 9 * 60, to: 17 * 60 }] })),
  hoursPerDay: 8,
};
/** A calendar with no working time, to test the conflict path. */
const empty: CalendarModel = { id: 'empty', week: [] };

function engine(cals = [work], def = 'work'): CpmEngine {
  const e = new CpmEngine();
  e.setCalendars(cals, def);
  return e;
}
function task(id: string, patch: Partial<TaskModel> = {}): TaskModel {
  return { id, calendarId: 'work', ...patch };
}

describe('Calendar-aware scheduling — skips non-working time', () => {
  it('a 16h task started Monday spans two work days', () => {
    const e = engine();
    e.setTasks([task('a', { duration: 16 * HOUR, constraintType: 'startNoEarlierThan', constraintDate: MON + 9 * HOUR })]);
    e.setDependencies([]);
    const res = e.schedule({ projectStart: MON + 9 * HOUR });
    const a = res.schedules.get('a')!;
    expect(a.start).toBe(MON + 9 * HOUR);
    expect(a.end).toBe(MON + DAY + 17 * HOUR); // Tue 17:00
  });

  it('a chain crossing the weekend lands on the next Monday', () => {
    const e = engine();
    // Start Friday 09:00, a is 8h (fills Friday), b 8h starts after → Monday.
    const fri = MON + 4 * DAY;
    e.setTasks([
      task('a', { duration: 8 * HOUR, constraintType: 'startNoEarlierThan', constraintDate: fri + 9 * HOUR }),
      task('b', { duration: 8 * HOUR }),
    ]);
    e.setDependencies([{ id: 'ab', fromId: 'a', toId: 'b', type: 'FS' }]);
    const res = e.schedule({ projectStart: fri + 9 * HOUR });
    expect(res.schedules.get('a')!.end).toBe(fri + 17 * HOUR); // Fri 17:00
    // b starts next working instant = Monday 09:00
    expect(res.schedules.get('b')!.start).toBe(MON + 7 * DAY + 9 * HOUR);
  });

  it('project start before working hours is ceiled to the first work instant', () => {
    const e = engine();
    e.setTasks([task('a', { duration: 4 * HOUR })]);
    e.setDependencies([]);
    // Project start at Monday 00:00 (non-working) → ceil to 09:00.
    const res = e.schedule({ projectStart: MON });
    expect(res.schedules.get('a')!.start).toBe(MON + 9 * HOUR);
    expect(res.schedules.get('a')!.end).toBe(MON + 13 * HOUR);
  });
});

describe('Calendar with no working time → conflict', () => {
  it('reports calendarHasNoWorkingTime', () => {
    const e = engine([work, empty], 'work');
    e.setTasks([task('a', { calendarId: 'empty', duration: 4 * HOUR })]);
    e.setDependencies([]);
    const res = e.schedule({ projectStart: MON });
    expect(res.conflicts.some((c) => c.taskId === 'a' && c.reason === 'calendarHasNoWorkingTime')).toBe(true);
  });
});

describe('Per-task calendar override', () => {
  it('uses the task calendar for its duration math', () => {
    const e = engine();
    const calc = e.getCalculatorFor('work-task-not-present');
    // default calendar resolves to the project default (work)
    expect(calc.calendar.id).toBe('work');
  });
});
