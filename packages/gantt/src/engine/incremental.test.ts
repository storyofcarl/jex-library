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

describe('Cycle detection', () => {
  it('flags hasCycle and aborts when a→b→a', () => {
    const e = engine();
    e.setTasks([task('a', { duration: DAY }), task('b', { duration: DAY })]);
    e.setDependencies([
      { id: 'ab', fromId: 'a', toId: 'b' },
      { id: 'ba', fromId: 'b', toId: 'a' },
    ]);
    const res = e.schedule({ projectStart: T0 });
    expect(res.hasCycle).toBe(true);
    expect(res.conflicts.some((c) => c.reason === 'dependencyCycle')).toBe(true);
  });

  it('addDependency rejects a link that would create a cycle', () => {
    const e = engine();
    e.setTasks([task('a', { duration: DAY }), task('b', { duration: DAY })]);
    e.setDependencies([{ id: 'ab', fromId: 'a', toId: 'b' }]);
    e.schedule({ projectStart: T0 });
    const changes = e.addDependency({ id: 'ba', fromId: 'b', toId: 'a' });
    expect(changes).toEqual([]); // rejected, no changes
    expect(e.getDependenciesFor('a').some((d) => d.id === 'ba')).toBe(false);
  });
});

describe('Incremental edits — updateTask', () => {
  it('re-propagates dependents when a duration grows', () => {
    const e = engine();
    e.setTasks([task('a', { duration: 2 * DAY }), task('b', { duration: DAY })]);
    e.setDependencies([{ id: 'ab', fromId: 'a', toId: 'b' }]);
    e.schedule({ projectStart: T0 });
    expect(e.getTask('b')!.start).toBe(T0 + 2 * DAY);
    const changes = e.updateTask('a', { duration: 5 * DAY });
    // both a (its own end) and b (pushed) move
    const ids = changes.map((c) => c.taskId).sort();
    expect(ids).toContain('a');
    expect(ids).toContain('b');
    expect(e.getTask('b')!.start).toBe(T0 + 5 * DAY);
  });
});

describe('Incremental edits — addDependency / removeDependency', () => {
  it('adding a link pushes the successor and returns its change', () => {
    const e = engine();
    e.setTasks([task('a', { duration: 2 * DAY }), task('b', { duration: DAY })]);
    e.setDependencies([]);
    e.schedule({ projectStart: T0 });
    expect(e.getTask('b')!.start).toBe(T0);
    const changes = e.addDependency({ id: 'ab', fromId: 'a', toId: 'b' });
    expect(changes.some((c) => c.taskId === 'b')).toBe(true);
    expect(e.getTask('b')!.start).toBe(T0 + 2 * DAY);
  });

  it('removing the link frees the successor back to project start', () => {
    const e = engine();
    e.setTasks([task('a', { duration: 2 * DAY }), task('b', { duration: DAY })]);
    e.setDependencies([{ id: 'ab', fromId: 'a', toId: 'b' }]);
    e.schedule({ projectStart: T0 });
    const changes = e.removeDependency('ab');
    expect(changes.some((c) => c.taskId === 'b')).toBe(true);
    expect(e.getTask('b')!.start).toBe(T0);
  });
});

describe('Incremental edits — setTaskSpan', () => {
  it('moves a task and re-propagates dependents', () => {
    const e = engine();
    e.setTasks([task('a', { duration: 2 * DAY }), task('b', { duration: DAY })]);
    e.setDependencies([{ id: 'ab', fromId: 'a', toId: 'b' }]);
    e.schedule({ projectStart: T0 });
    e.setTaskSpan('a', { start: T0 + 3 * DAY, end: T0 + 5 * DAY });
    expect(e.getTask('a')!.start).toBe(T0 + 3 * DAY);
    expect(e.getTask('b')!.start).toBe(T0 + 5 * DAY); // pushed by moved predecessor
  });
});

describe('Manual scheduling', () => {
  it('honors a manually-scheduled task position and does not auto-move it', () => {
    const e = engine();
    e.setTasks([
      task('a', { duration: 2 * DAY }),
      task('b', { duration: DAY, manuallyScheduled: true, start: T0 + 10 * DAY, end: T0 + 11 * DAY }),
    ]);
    e.setDependencies([{ id: 'ab', fromId: 'a', toId: 'b' }]);
    const res = e.schedule({ projectStart: T0 });
    expect(res.schedules.get('b')!.start).toBe(T0 + 10 * DAY); // not pulled to a.end
  });
});

describe('setTaskSpan drag pin is engine-owned and cleared (no stale SNET)', () => {
  it('does not leave a synthesised startNoEarlierThan constraint on the task', () => {
    const e = engine();
    e.setTasks([task('a', { duration: 2 * DAY }), task('b', { duration: DAY })]);
    e.setDependencies([{ id: 'ab', fromId: 'a', toId: 'b' }]);
    e.schedule({ projectStart: T0 });
    e.setTaskSpan('b', { start: T0 + 10 * DAY, end: T0 + 11 * DAY });
    // The drag must NOT overload the task's constraint type with a hidden SNET.
    const bTask = e.getTask('b')!;
    expect(bTask.constraintType == null || bTask.constraintType === 'asSoonAsPossible').toBe(true);
  });

  it('a dragged successor returns to its dependency position once the link is removed', () => {
    const e = engine();
    e.setTasks([task('a', { duration: 2 * DAY }), task('b', { duration: DAY })]);
    e.setDependencies([{ id: 'ab', fromId: 'a', toId: 'b' }]);
    e.schedule({ projectStart: T0 });
    // Drag b far to the right.
    e.setTaskSpan('b', { start: T0 + 10 * DAY, end: T0 + 11 * DAY });
    expect(e.getTask('b')!.start).toBe(T0 + 10 * DAY); // pin holds while link exists
    // Remove the link that justified the dragged position.
    e.removeDependency('ab');
    // b is no longer clamped by a stale SNET; it floats back to project start.
    expect(e.getTask('b')!.start).toBe(T0);
  });

  it('a genuine constraint edit supersedes the drag pin', () => {
    const e = engine();
    e.setTasks([task('a', { duration: DAY })]);
    e.setDependencies([]);
    e.schedule({ projectStart: T0 });
    e.setTaskSpan('a', { start: T0 + 5 * DAY, end: T0 + 6 * DAY });
    expect(e.getTask('a')!.start).toBe(T0 + 5 * DAY);
    // Re-anchor with an ASAP constraint: the drag pin must not keep it pinned.
    e.applyConstraint('a', 'asSoonAsPossible');
    expect(e.getTask('a')!.start).toBe(T0);
  });
});

describe('recalc after external mutation', () => {
  it('returns only the spans that moved', () => {
    const e = engine();
    e.setTasks([task('a', { duration: 2 * DAY }), task('b', { duration: DAY })]);
    e.setDependencies([{ id: 'ab', fromId: 'a', toId: 'b' }]);
    e.schedule({ projectStart: T0 });
    const noChange = e.recalc();
    expect(noChange).toEqual([]); // nothing mutated
  });
});
