import { describe, it, expect } from 'vitest';
import { CpmEngine } from './scheduler.js';
import type { CalendarModel, TaskModel } from '../contract.js';

const DAY = 86_400_000;
const T0 = Date.UTC(2024, 0, 1, 0, 0, 0);

const cal247: CalendarModel = {
  id: 'c',
  week: Array.from({ length: 7 }, (_, weekday) => ({ weekday, intervals: [{ from: 0, to: 1440 }] })),
};
function engine(): CpmEngine {
  const e = new CpmEngine();
  e.setCalendars([cal247], 'c');
  return e;
}
function task(id: string, patch: Partial<TaskModel> = {}): TaskModel {
  return { id, calendarId: 'c', ...patch };
}

describe('Baselines', () => {
  it('captures a snapshot of current task spans', () => {
    const e = engine();
    e.setTasks([task('a', { duration: 2 * DAY }), task('b', { duration: DAY })]);
    e.setDependencies([{ id: 'ab', fromId: 'a', toId: 'b' }]);
    e.schedule({ projectStart: T0 });
    const baseline = e.captureBaseline('b1', 'Initial plan');
    expect(baseline.id).toBe('b1');
    expect(baseline.name).toBe('Initial plan');
    expect(baseline.tasks.get('a')!.start).toBe(T0);
    expect(baseline.tasks.get('b')!.end).toBe(T0 + 3 * DAY);
  });

  it('variance reflects a later slip vs the baseline', () => {
    const e = engine();
    e.setTasks([task('a', { duration: 2 * DAY }), task('b', { duration: DAY })]);
    e.setDependencies([{ id: 'ab', fromId: 'a', toId: 'b' }]);
    e.schedule({ projectStart: T0 });
    e.captureBaseline('b1');
    // a slips: grows to 4 days, b is pushed.
    e.updateTask('a', { duration: 4 * DAY });
    // b's end was T0+3d; now T0+5d → variance +2d.
    expect(e.variance('b', 'b1')).toBe(2 * DAY);
    expect(e.variance('a', 'b1')).toBe(2 * DAY);
  });

  it('variance is undefined for an unknown baseline or task', () => {
    const e = engine();
    e.setTasks([task('a', { duration: DAY })]);
    e.setDependencies([]);
    e.schedule({ projectStart: T0 });
    e.captureBaseline('b1');
    expect(e.variance('a', 'nope')).toBeUndefined();
    expect(e.variance('zzz', 'b1')).toBeUndefined();
  });
});
