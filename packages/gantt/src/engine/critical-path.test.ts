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

describe('Critical path — diamond network', () => {
  // a -> b -> d  and  a -> c -> d.  b is long (4d), c is short (1d).
  // Critical: a, b, d.  Slack on c.
  function build(): CpmEngine {
    const e = engine();
    e.setTasks([
      task('a', { duration: 2 * DAY }),
      task('b', { duration: 4 * DAY }),
      task('c', { duration: DAY }),
      task('d', { duration: 2 * DAY }),
    ]);
    e.setDependencies([
      { id: 'ab', fromId: 'a', toId: 'b', type: 'FS' },
      { id: 'ac', fromId: 'a', toId: 'c', type: 'FS' },
      { id: 'bd', fromId: 'b', toId: 'd', type: 'FS' },
      { id: 'cd', fromId: 'c', toId: 'd', type: 'FS' },
    ]);
    return e;
  }

  it('identifies the longest chain as critical', () => {
    const e = build();
    const res = e.schedule({ projectStart: T0 });
    expect(res.schedules.get('a')!.critical).toBe(true);
    expect(res.schedules.get('b')!.critical).toBe(true);
    expect(res.schedules.get('d')!.critical).toBe(true);
    expect(res.schedules.get('c')!.critical).toBe(false);
  });

  it('reports c having positive total slack', () => {
    const e = build();
    const res = e.schedule({ projectStart: T0 });
    // c is 1d but the b-branch is 4d; c can slip 3d.
    expect(res.schedules.get('c')!.totalSlack).toBe(3 * DAY);
    expect(res.schedules.get('b')!.totalSlack).toBe(0);
  });

  it('exposes the ordered critical path', () => {
    const e = build();
    const res = e.schedule({ projectStart: T0 });
    expect(res.criticalPath).toEqual(['a', 'b', 'd']);
  });

  it('project span runs from a.start to d.end', () => {
    const e = build();
    const res = e.schedule({ projectStart: T0 });
    expect(res.projectSpan.start).toBe(T0);
    expect(res.projectSpan.end).toBe(T0 + 8 * DAY); // 2 + 4 + 2
  });
});

describe('Critical path — free slack', () => {
  it('computes free slack independent of total slack', () => {
    // a(2) -> b(1) ; a(2) -> c(4). b has free slack since its only successor is none.
    const e = engine();
    e.setTasks([
      task('a', { duration: 2 * DAY }),
      task('b', { duration: DAY }),
      task('c', { duration: 4 * DAY }),
      task('d', { duration: DAY }),
    ]);
    e.setDependencies([
      { id: 'ab', fromId: 'a', toId: 'b' },
      { id: 'ac', fromId: 'a', toId: 'c' },
      { id: 'bd', fromId: 'b', toId: 'd' },
      { id: 'cd', fromId: 'c', toId: 'd' },
    ]);
    const res = e.schedule({ projectStart: T0 });
    // b finishes at +3, d cannot start until c finishes at +6 → b free slack 3d.
    expect(res.schedules.get('b')!.freeSlack).toBe(3 * DAY);
    expect(res.schedules.get('c')!.freeSlack).toBe(0);
  });
});

describe('Critical path — criticalPath() accessor', () => {
  it('returns the path computed by the last schedule', () => {
    const e = engine();
    e.setTasks([task('a', { duration: 2 * DAY }), task('b', { duration: 2 * DAY })]);
    e.setDependencies([{ id: 'ab', fromId: 'a', toId: 'b' }]);
    e.schedule({ projectStart: T0 });
    expect(e.criticalPath()).toEqual(['a', 'b']);
  });
});
