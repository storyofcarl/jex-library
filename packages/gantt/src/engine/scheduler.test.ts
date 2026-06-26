import { describe, it, expect, beforeEach } from 'vitest';
import { CpmEngine, createSchedulingEngine } from './scheduler.js';
import type { CalendarModel, TaskModel } from '../contract.js';

const DAY = 86_400_000;
const T0 = Date.UTC(2024, 0, 1, 0, 0, 0); // Monday

/** 24/7 calendar so durations equal wall-clock ms (isolates scheduling math). */
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

describe('CpmEngine — single task forward scheduling', () => {
  it('places a lone task at project start with its duration', () => {
    const e = engine();
    e.setTasks([task('a', { duration: 2 * DAY })]);
    e.setDependencies([]);
    const res = e.schedule({ direction: 'forward', projectStart: T0 });
    const a = res.schedules.get('a')!;
    expect(a.start).toBe(T0);
    expect(a.end).toBe(T0 + 2 * DAY);
    expect(res.hasCycle).toBe(false);
    expect(res.conflicts).toHaveLength(0);
  });

  it('derives duration from start/end when duration absent', () => {
    const e = engine();
    e.setTasks([task('a', { start: T0, end: T0 + 3 * DAY })]);
    e.setDependencies([]);
    e.schedule({ projectStart: T0 });
    expect(e.getTask('a')!.duration).toBe(3 * DAY);
  });

  it('treats a milestone as zero duration', () => {
    const e = engine();
    e.setTasks([task('m', { milestone: true, start: T0 })]);
    e.setDependencies([]);
    const res = e.schedule({ projectStart: T0 });
    const m = res.schedules.get('m')!;
    expect(m.end).toBe(m.start);
  });
});

describe('CpmEngine — FS dependency chain', () => {
  let e: CpmEngine;
  beforeEach(() => {
    e = engine();
    e.setTasks([
      task('a', { duration: 2 * DAY }),
      task('b', { duration: 3 * DAY }),
      task('c', { duration: 1 * DAY }),
    ]);
    e.setDependencies([
      { id: 'ab', fromId: 'a', toId: 'b', type: 'FS' },
      { id: 'bc', fromId: 'b', toId: 'c', type: 'FS' },
    ]);
  });

  it('schedules b after a and c after b', () => {
    const res = e.schedule({ projectStart: T0 });
    expect(res.schedules.get('a')!.start).toBe(T0);
    expect(res.schedules.get('a')!.end).toBe(T0 + 2 * DAY);
    expect(res.schedules.get('b')!.start).toBe(T0 + 2 * DAY);
    expect(res.schedules.get('b')!.end).toBe(T0 + 5 * DAY);
    expect(res.schedules.get('c')!.start).toBe(T0 + 5 * DAY);
    expect(res.schedules.get('c')!.end).toBe(T0 + 6 * DAY);
  });

  it('applies positive lag on a link', () => {
    e.setDependencies([{ id: 'ab', fromId: 'a', toId: 'b', type: 'FS', lag: DAY }]);
    const res = e.schedule({ projectStart: T0 });
    expect(res.schedules.get('b')!.start).toBe(T0 + 3 * DAY); // a ends +2, +1 lag
  });

  it('applies negative lag (lead)', () => {
    e.setDependencies([{ id: 'ab', fromId: 'a', toId: 'b', type: 'FS', lag: -DAY }]);
    const res = e.schedule({ projectStart: T0 });
    expect(res.schedules.get('b')!.start).toBe(T0 + DAY); // a ends +2, -1 lead
  });
});

describe('CpmEngine — SS / FF / SF dependencies', () => {
  it('SS: successor starts with predecessor (+lag)', () => {
    const e = engine();
    e.setTasks([task('a', { duration: 4 * DAY }), task('b', { duration: 2 * DAY })]);
    e.setDependencies([{ id: 'l', fromId: 'a', toId: 'b', type: 'SS', lag: DAY }]);
    const res = e.schedule({ projectStart: T0 });
    expect(res.schedules.get('b')!.start).toBe(T0 + DAY);
  });

  it('FF: successor finishes with predecessor (+lag)', () => {
    const e = engine();
    e.setTasks([task('a', { duration: 4 * DAY }), task('b', { duration: 2 * DAY })]);
    e.setDependencies([{ id: 'l', fromId: 'a', toId: 'b', type: 'FF' }]);
    const res = e.schedule({ projectStart: T0 });
    // a ends at +4; b must finish at +4, duration 2 -> start +2
    expect(res.schedules.get('b')!.end).toBe(T0 + 4 * DAY);
    expect(res.schedules.get('b')!.start).toBe(T0 + 2 * DAY);
  });

  it('SF: successor finishes at predecessor start (+lag)', () => {
    const e = engine();
    e.setTasks([task('a', { duration: 4 * DAY, start: T0 + 5 * DAY, manuallyScheduled: true }), task('b', { duration: 2 * DAY })]);
    e.setDependencies([{ id: 'l', fromId: 'a', toId: 'b', type: 'SF' }]);
    const res = e.schedule({ projectStart: T0 });
    // a starts at +5; b must finish by +5
    expect(res.schedules.get('b')!.end).toBe(T0 + 5 * DAY);
  });
});

describe('CpmEngine — fan-in takes the latest predecessor', () => {
  it('successor waits for the later of two predecessors', () => {
    const e = engine();
    e.setTasks([
      task('a', { duration: 2 * DAY }),
      task('b', { duration: 5 * DAY }),
      task('c', { duration: 1 * DAY }),
    ]);
    e.setDependencies([
      { id: 'ac', fromId: 'a', toId: 'c', type: 'FS' },
      { id: 'bc', fromId: 'b', toId: 'c', type: 'FS' },
    ]);
    const res = e.schedule({ projectStart: T0 });
    expect(res.schedules.get('c')!.start).toBe(T0 + 5 * DAY); // waits for b
  });
});

describe('CpmEngine — inactive dependencies are ignored', () => {
  it('an inactive link does not constrain the successor', () => {
    const e = engine();
    e.setTasks([task('a', { duration: 2 * DAY }), task('b', { duration: 2 * DAY })]);
    e.setDependencies([{ id: 'ab', fromId: 'a', toId: 'b', type: 'FS', active: false }]);
    const res = e.schedule({ projectStart: T0 });
    expect(res.schedules.get('b')!.start).toBe(T0); // not pushed after a
  });
});

describe('CpmEngine — factory', () => {
  it('createSchedulingEngine returns a working engine', () => {
    const e = createSchedulingEngine();
    e.setCalendars([cal247], 'c');
    e.setTasks([task('a', { duration: DAY })]);
    e.setDependencies([]);
    const res = e.schedule({ projectStart: T0 });
    expect(res.schedules.get('a')!.end).toBe(T0 + DAY);
  });
});
