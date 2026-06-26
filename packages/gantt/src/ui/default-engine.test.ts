/**
 * jsdom unit tests for `DefaultGanttEngine` — the fallback scheduling engine.
 * Covers consistency of {start,end,duration}, dependency propagation (FS/SS),
 * summary roll-up, drag pinning, constraint clamping, critical path + slack,
 * cycle rejection, and baselines.
 */
import { describe, it, expect } from 'vitest';
import { DefaultGanttEngine } from './default-engine.js';
import type { TaskModel } from '../contract.js';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 5); // a Monday

function task(id: string, start: number, days: number, extra: Partial<TaskModel> = {}): TaskModel {
  return { id, name: id, start, duration: days * DAY, end: start + days * DAY, ...extra };
}

describe('DefaultGanttEngine', () => {
  it('keeps start/end/duration consistent on load', () => {
    const eng = new DefaultGanttEngine();
    eng.setTasks([{ id: 'a', start: T0, duration: 2 * DAY }]);
    eng.schedule({ projectStart: T0 });
    const a = eng.getTask('a')!;
    expect(a.end).toBe(T0 + 2 * DAY);
    expect(a.duration).toBe(2 * DAY);
  });

  it('propagates a finish-to-start dependency forward', () => {
    const eng = new DefaultGanttEngine();
    eng.setTasks([task('a', T0, 2), task('b', T0, 3)]);
    eng.setDependencies([{ id: 'l1', fromId: 'a', toId: 'b', type: 'FS' }]);
    eng.schedule({ projectStart: T0 });
    const a = eng.getTask('a')!;
    const b = eng.getTask('b')!;
    expect(b.start).toBe(a.end); // b starts when a finishes
    expect(b.end).toBe(a.end! + 3 * DAY);
  });

  it('applies positive lag to a dependency', () => {
    const eng = new DefaultGanttEngine();
    eng.setTasks([task('a', T0, 2), task('b', T0, 1)]);
    eng.setDependencies([{ id: 'l1', fromId: 'a', toId: 'b', type: 'FS', lag: 2 * DAY }]);
    eng.schedule({ projectStart: T0 });
    expect(eng.getTask('b')!.start).toBe(eng.getTask('a')!.end! + 2 * DAY);
  });

  it('honors a start-to-start dependency', () => {
    const eng = new DefaultGanttEngine();
    eng.setTasks([task('a', T0, 4), task('b', T0, 2)]);
    eng.setDependencies([{ id: 'l1', fromId: 'a', toId: 'b', type: 'SS' }]);
    eng.schedule({ projectStart: T0 });
    expect(eng.getTask('b')!.start).toBe(eng.getTask('a')!.start);
  });

  it('rolls a summary parent span up from its children', () => {
    const eng = new DefaultGanttEngine();
    eng.setTasks([
      { id: 'p', name: 'parent' },
      task('c1', T0, 2, { parentId: 'p' }),
      task('c2', T0 + 5 * DAY, 3, { parentId: 'p' }),
    ]);
    eng.schedule({ projectStart: T0 });
    const p = eng.getTask('p')!;
    expect(p.start).toBe(T0);
    expect(p.end).toBe(T0 + 8 * DAY);
    expect(p.summary).toBe(true);
  });

  it('pins a manually dragged task via setTaskSpan and reports the change', () => {
    const eng = new DefaultGanttEngine();
    eng.setTasks([task('a', T0, 2), task('b', T0, 2)]);
    eng.setDependencies([{ id: 'l1', fromId: 'a', toId: 'b', type: 'FS' }]);
    eng.schedule({ projectStart: T0 });
    const newStart = T0 + 3 * DAY;
    const changes = eng.setTaskSpan('a', { start: newStart, end: newStart + 2 * DAY });
    expect(changes.some((c) => c.taskId === 'a')).toBe(true);
    // b re-propagates after a's move.
    expect(eng.getTask('b')!.start).toBe(eng.getTask('a')!.end);
  });

  it('clamps a startNoEarlierThan constraint', () => {
    const eng = new DefaultGanttEngine();
    eng.setTasks([task('a', T0, 2)]);
    const floor = T0 + 4 * DAY;
    eng.applyConstraint('a', 'startNoEarlierThan', floor);
    expect(eng.getTask('a')!.start).toBe(floor);
  });

  it('rejects a dependency that would create a cycle', () => {
    const eng = new DefaultGanttEngine();
    eng.setTasks([task('a', T0, 1), task('b', T0, 1)]);
    eng.addDependency({ id: 'l1', fromId: 'a', toId: 'b' });
    const changes = eng.addDependency({ id: 'l2', fromId: 'b', toId: 'a' });
    expect(changes).toEqual([]);
    expect(eng.getDependenciesFor('a').some((d) => d.id === 'l2')).toBe(false);
  });

  it('computes a critical path with zero-slack tasks', () => {
    const eng = new DefaultGanttEngine();
    eng.setTasks([task('a', T0, 2), task('b', T0, 3), task('c', T0, 1)]);
    eng.setDependencies([
      { id: 'l1', fromId: 'a', toId: 'b', type: 'FS' },
      { id: 'l2', fromId: 'a', toId: 'c', type: 'FS' },
    ]);
    const result = eng.schedule({ projectStart: T0 });
    expect(result.hasCycle).toBe(false);
    // The longer chain (a→b) is critical; the shorter (c) carries slack.
    expect(result.criticalPath).toContain('a');
    expect(result.criticalPath).toContain('b');
    const cSched = eng.getSchedule('c')!;
    expect(cSched.totalSlack).toBeGreaterThan(0);
  });

  it('captures a baseline and reports variance after a slip', () => {
    const eng = new DefaultGanttEngine();
    eng.setTasks([task('a', T0, 2)]);
    eng.schedule({ projectStart: T0 });
    eng.captureBaseline('base-1', 'Original');
    eng.setTaskSpan('a', { start: T0 + 2 * DAY, end: T0 + 4 * DAY });
    const variance = eng.variance('a', 'base-1');
    expect(variance).toBe(2 * DAY); // finished 2 days later than baseline
  });

  it('treats a milestone as zero-duration', () => {
    const eng = new DefaultGanttEngine();
    eng.setTasks([{ id: 'm', name: 'launch', start: T0, milestone: true }]);
    eng.schedule({ projectStart: T0 });
    const m = eng.getTask('m')!;
    expect(m.start).toBe(m.end);
    expect(m.duration).toBe(0);
  });
});
