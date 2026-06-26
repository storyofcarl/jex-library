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

describe('Constraint: startNoEarlierThan (SNET)', () => {
  it('pushes a task forward to the constraint date', () => {
    const e = engine();
    e.setTasks([task('a', { duration: 2 * DAY, constraintType: 'startNoEarlierThan', constraintDate: T0 + 5 * DAY })]);
    e.setDependencies([]);
    const res = e.schedule({ projectStart: T0 });
    expect(res.schedules.get('a')!.start).toBe(T0 + 5 * DAY);
    expect(res.conflicts).toHaveLength(0);
  });

  it('does not pull a task earlier than where deps already place it', () => {
    const e = engine();
    e.setTasks([
      task('a', { duration: 3 * DAY }),
      task('b', { duration: DAY, constraintType: 'startNoEarlierThan', constraintDate: T0 + DAY }),
    ]);
    e.setDependencies([{ id: 'ab', fromId: 'a', toId: 'b', type: 'FS' }]);
    const res = e.schedule({ projectStart: T0 });
    expect(res.schedules.get('b')!.start).toBe(T0 + 3 * DAY); // dep wins (later)
  });
});

describe('Constraint: startNoLaterThan (SNLT)', () => {
  it('flags a conflict when deps force the task past the deadline', () => {
    const e = engine();
    e.setTasks([
      task('a', { duration: 5 * DAY }),
      task('b', { duration: DAY, constraintType: 'startNoLaterThan', constraintDate: T0 + 2 * DAY }),
    ]);
    e.setDependencies([{ id: 'ab', fromId: 'a', toId: 'b', type: 'FS' }]);
    const res = e.schedule({ projectStart: T0 });
    expect(res.conflicts.some((c) => c.taskId === 'b' && c.reason === 'constraintViolation')).toBe(true);
  });
});

describe('Constraint: finishNoEarlierThan / finishNoLaterThan', () => {
  it('FNET pushes the finish to the constraint date', () => {
    const e = engine();
    e.setTasks([task('a', { duration: DAY, constraintType: 'finishNoEarlierThan', constraintDate: T0 + 4 * DAY })]);
    e.setDependencies([]);
    const res = e.schedule({ projectStart: T0 });
    expect(res.schedules.get('a')!.end).toBe(T0 + 4 * DAY);
    expect(res.schedules.get('a')!.start).toBe(T0 + 3 * DAY);
  });

  it('FNLT conflicts when a dependency forces a later finish', () => {
    const e = engine();
    e.setTasks([
      task('a', { duration: 5 * DAY }),
      task('b', { duration: 2 * DAY, constraintType: 'finishNoLaterThan', constraintDate: T0 + 3 * DAY }),
    ]);
    e.setDependencies([{ id: 'ab', fromId: 'a', toId: 'b', type: 'FS' }]);
    const res = e.schedule({ projectStart: T0 });
    expect(res.conflicts.some((c) => c.taskId === 'b')).toBe(true);
  });
});

describe('Constraint: mustStartOn (MSO) — hard', () => {
  it('pins the start exactly when no dependency conflicts', () => {
    const e = engine();
    e.setTasks([task('a', { duration: 2 * DAY, constraintType: 'mustStartOn', constraintDate: T0 + 3 * DAY })]);
    e.setDependencies([]);
    const res = e.schedule({ projectStart: T0 });
    expect(res.schedules.get('a')!.start).toBe(T0 + 3 * DAY);
    expect(res.schedules.get('a')!.end).toBe(T0 + 5 * DAY);
  });

  it('records a conflict but still pins when a dependency wants it later', () => {
    const e = engine();
    e.setTasks([
      task('a', { duration: 5 * DAY }),
      task('b', { duration: DAY, constraintType: 'mustStartOn', constraintDate: T0 + DAY }),
    ]);
    e.setDependencies([{ id: 'ab', fromId: 'a', toId: 'b', type: 'FS' }]);
    const res = e.schedule({ projectStart: T0 });
    expect(res.schedules.get('b')!.start).toBe(T0 + DAY); // hard pin honored
    expect(res.conflicts.some((c) => c.taskId === 'b')).toBe(true);
  });
});

describe('Constraint: mustFinishOn (MFO) — hard', () => {
  it('pins the finish exactly', () => {
    const e = engine();
    e.setTasks([task('a', { duration: 2 * DAY, constraintType: 'mustFinishOn', constraintDate: T0 + 6 * DAY })]);
    e.setDependencies([]);
    const res = e.schedule({ projectStart: T0 });
    expect(res.schedules.get('a')!.end).toBe(T0 + 6 * DAY);
    expect(res.schedules.get('a')!.start).toBe(T0 + 4 * DAY);
  });
});

describe('Constraint: asLateAsPossible (ALAP) via backward scheduling', () => {
  it('places a task as late as the deadline allows', () => {
    const e = engine();
    e.setTasks([task('a', { duration: 2 * DAY }), task('b', { duration: 2 * DAY })]);
    e.setDependencies([{ id: 'ab', fromId: 'a', toId: 'b', type: 'FS' }]);
    const res = e.schedule({ direction: 'backward', projectStart: T0, projectEnd: T0 + 10 * DAY });
    // b must finish by the deadline; a must finish before b starts.
    expect(res.schedules.get('b')!.end).toBe(T0 + 10 * DAY);
    expect(res.schedules.get('b')!.start).toBe(T0 + 8 * DAY);
    expect(res.schedules.get('a')!.end).toBe(T0 + 8 * DAY);
    expect(res.schedules.get('a')!.start).toBe(T0 + 6 * DAY);
  });
});

describe('Backward (ALAP) scheduling with no projectEnd', () => {
  it('pushes a chain against a constraint-defined deadline rather than collapsing to ASAP', () => {
    const e = engine();
    // a(2d) -> b(2d); b must finish no later than day 10. The project may run to
    // day 10, so ALAP must right-align the chain there, not at the forward dates.
    e.setTasks([
      task('a', { duration: 2 * DAY }),
      task('b', { duration: 2 * DAY, constraintType: 'finishNoLaterThan', constraintDate: T0 + 10 * DAY }),
    ]);
    e.setDependencies([{ id: 'ab', fromId: 'a', toId: 'b', type: 'FS' }]);
    const res = e.schedule({ direction: 'backward', projectStart: T0 });
    expect(res.schedules.get('b')!.end).toBe(T0 + 10 * DAY);
    expect(res.schedules.get('b')!.start).toBe(T0 + 8 * DAY);
    expect(res.schedules.get('a')!.end).toBe(T0 + 8 * DAY);
    expect(res.schedules.get('a')!.start).toBe(T0 + 6 * DAY);
  });

  it('floats a slack branch LATE under ALAP (not at its forward early date)', () => {
    const mk = (): CpmEngine => {
      const e = engine();
      // a(4d) -> c ; b(1d) -> c ; c(2d). b carries 3d of slack.
      e.setTasks([
        task('a', { duration: 4 * DAY }),
        task('b', { duration: DAY }),
        task('c', { duration: 2 * DAY }),
      ]);
      e.setDependencies([
        { id: 'ac', fromId: 'a', toId: 'c', type: 'FS' },
        { id: 'bc', fromId: 'b', toId: 'c', type: 'FS' },
      ]);
      return e;
    };
    const fwd = mk().schedule({ direction: 'forward', projectStart: T0 });
    const bwd = mk().schedule({ direction: 'backward', projectStart: T0 });
    // Forward places b early; backward floats it late against c's start.
    expect(fwd.schedules.get('b')!.start).toBe(T0);
    expect(bwd.schedules.get('b')!.start).toBe(T0 + 3 * DAY);
    expect(bwd.schedules.get('b')!.end).toBe(bwd.schedules.get('c')!.start);
  });
});

describe('Constraint: applyConstraint incremental edit', () => {
  it('returns the spans that moved', () => {
    const e = engine();
    e.setTasks([task('a', { duration: 2 * DAY })]);
    e.setDependencies([]);
    e.schedule({ projectStart: T0 });
    const changes = e.applyConstraint('a', 'startNoEarlierThan', T0 + 4 * DAY);
    expect(changes).toHaveLength(1);
    expect(changes[0].taskId).toBe('a');
    expect(changes[0].to.start).toBe(T0 + 4 * DAY);
  });
});
