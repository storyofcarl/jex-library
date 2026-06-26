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

describe('Summary roll-up — dates', () => {
  it('summary spans min child start to max child end', () => {
    const e = engine();
    e.setTasks([
      task('parent'),
      task('a', { parentId: 'parent', duration: 2 * DAY }),
      task('b', { parentId: 'parent', duration: 3 * DAY }),
    ]);
    e.setDependencies([{ id: 'ab', fromId: 'a', toId: 'b' }]);
    const res = e.schedule({ projectStart: T0 });
    const p = res.schedules.get('parent')!;
    expect(p.start).toBe(T0); // a starts at project start
    expect(p.end).toBe(T0 + 5 * DAY); // b ends after a(2)+b(3)
  });

  it('nested summaries roll up transitively', () => {
    const e = engine();
    e.setTasks([
      task('root'),
      task('mid', { parentId: 'root' }),
      task('leaf1', { parentId: 'mid', duration: 2 * DAY }),
      task('leaf2', { parentId: 'mid', duration: 4 * DAY }),
    ]);
    e.setDependencies([]);
    const res = e.schedule({ projectStart: T0 });
    // both leaves start at T0 (no deps); mid ends at +4; root mirrors mid.
    expect(res.schedules.get('mid')!.end).toBe(T0 + 4 * DAY);
    expect(res.schedules.get('root')!.end).toBe(T0 + 4 * DAY);
    expect(res.schedules.get('root')!.start).toBe(T0);
  });
});

describe('Summary roll-up — percentDone (duration-weighted)', () => {
  it('weights children completion by duration', () => {
    const e = engine();
    e.setTasks([
      task('parent'),
      task('a', { parentId: 'parent', duration: 2 * DAY, percentDone: 1 }), // done
      task('b', { parentId: 'parent', duration: 6 * DAY, percentDone: 0 }), // not started
    ]);
    e.setDependencies([]);
    e.schedule({ projectStart: T0 });
    // weighted: (1*2 + 0*6) / 8 = 0.25
    expect(e.getTask('parent')!.percentDone).toBeCloseTo(0.25, 6);
  });
});

describe('Summary roll-up — is excluded from dependency math', () => {
  it('a summary is not topologically ordered as a leaf', () => {
    const e = engine();
    e.setTasks([
      task('parent'),
      task('a', { parentId: 'parent', duration: 2 * DAY }),
    ]);
    e.setDependencies([]);
    const res = e.schedule({ projectStart: T0 });
    expect(res.hasCycle).toBe(false);
    expect(res.schedules.get('parent')!.start).toBe(T0);
  });
});
