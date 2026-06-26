import { describe, it, expect, beforeEach } from 'vitest';
import { CpmEngine } from './scheduler.js';
import {
  EffortDrivenEngine,
  createEffortDrivenEngine,
  resolveEffort,
  durationFromEffort,
  effortFromDuration,
  totalUnits,
  assignmentUnits,
  isEffortDriven,
  effortToPersonDays,
  personDaysToEffort,
  type EffortDrivenTask,
  type ResourceModel,
  type AssignmentModel,
} from './effort.js';
import { DefaultGanttEngine } from '../ui/default-engine.js';
import type { CalendarModel } from '../contract.js';

const HOUR = 3_600_000;
const DAY = 86_400_000;
const T0 = Date.UTC(2024, 0, 1, 0, 0, 0); // Monday

/** 24/7 calendar so working-ms == wall-clock ms (isolates the effort math). */
const cal247: CalendarModel = {
  id: 'c',
  hoursPerDay: 8,
  week: Array.from({ length: 7 }, (_, weekday) => ({ weekday, intervals: [{ from: 0, to: 1440 }] })),
};

const resources: ResourceModel[] = [
  { id: 'r1', name: 'Ann', capacity: 1 },
  { id: 'r2', name: 'Bob', capacity: 1 },
  { id: 'r3', name: 'Half', capacity: 0.5 },
];

function cpm(): EffortDrivenEngine {
  const e = new EffortDrivenEngine(new CpmEngine());
  e.setCalendars([cal247], 'c');
  e.setResources(resources);
  return e;
}

function task(id: string, patch: Partial<EffortDrivenTask> = {}): EffortDrivenTask {
  return { id, calendarId: 'c', ...patch };
}

/* ── pure resolution math ──────────────────────────────────────────────── */

describe('effort math — pure functions', () => {
  it('durationFromEffort divides effort by the FTE fraction (units%/100)', () => {
    expect(durationFromEffort(4 * DAY, 200)).toBe(2 * DAY); // 2 FTE
    expect(durationFromEffort(4 * DAY, 100)).toBe(4 * DAY); // 1 FTE
    expect(durationFromEffort(4 * DAY, 50)).toBe(8 * DAY); // half FTE
  });

  it('durationFromEffort is null when no units are assigned', () => {
    expect(durationFromEffort(4 * DAY, 0)).toBeNull();
    expect(durationFromEffort(4 * DAY, -100)).toBeNull();
  });

  it('effortFromDuration multiplies duration by the FTE fraction', () => {
    expect(effortFromDuration(2 * DAY, 200)).toBe(4 * DAY);
    expect(effortFromDuration(2 * DAY, 0)).toBe(2 * DAY); // floors to 1 FTE
  });

  it('assignmentUnits prefers own % units, then resource capacity ×100, then 100', () => {
    expect(assignmentUnits({ id: 'a', taskId: 't', resourceId: 'r', units: 25 })).toBe(25);
    expect(assignmentUnits({ id: 'a', taskId: 't', resourceId: 'r' }, { id: 'r', capacity: 0.5 })).toBe(50);
    expect(assignmentUnits({ id: 'a', taskId: 't', resourceId: 'r' })).toBe(100);
  });

  it('totalUnits sums effective % units across assignments', () => {
    const map = new Map(resources.map((r) => [r.id, r]));
    const asgs: AssignmentModel[] = [
      { id: '1', taskId: 't', resourceId: 'r1' }, // 100
      { id: '2', taskId: 't', resourceId: 'r3' }, // 50 (capacity 0.5)
    ];
    expect(totalUnits(asgs, map)).toBe(150);
  });

  it('person-day conversions round-trip', () => {
    const effort = personDaysToEffort(5, 8);
    expect(effort).toBe(5 * 8 * HOUR);
    expect(effortToPersonDays(effort, 8)).toBe(5);
  });

  it('isEffortDriven only true for strict flag', () => {
    expect(isEffortDriven(task('a', { effortDriven: true }))).toBe(true);
    expect(isEffortDriven(task('a'))).toBe(false);
  });

  it('resolveEffort: effort-driven derives duration from effort / units', () => {
    const map = new Map(resources.map((r) => [r.id, r]));
    const t = task('a', { effortDriven: true, effort: 4 * DAY, duration: 4 * DAY });
    const r = resolveEffort(t, [
      { id: '1', taskId: 'a', resourceId: 'r1' },
      { id: '2', taskId: 'a', resourceId: 'r2' },
    ], map);
    expect(r.units).toBe(200);
    expect(r.duration).toBe(2 * DAY);
    expect(r.effort).toBe(4 * DAY);
    expect(r.durationChanged).toBe(true);
  });

  it('resolveEffort: fixed-duration derives effort from duration × units', () => {
    const map = new Map(resources.map((r) => [r.id, r]));
    const t = task('a', { duration: 3 * DAY });
    const r = resolveEffort(t, [{ id: '1', taskId: 'a', resourceId: 'r1' }], map);
    expect(r.effortDriven).toBe(false);
    expect(r.duration).toBe(3 * DAY);
    expect(r.effort).toBe(3 * DAY);
  });

  it('resolveEffort: milestone stays zero on all axes', () => {
    const map = new Map<string, ResourceModel>();
    const r = resolveEffort(task('m', { milestone: true, effortDriven: true, duration: DAY }), [], map);
    expect(r.duration).toBe(0);
    expect(r.effort).toBe(0);
  });
});

/* ── engine integration: adding/removing resources reflows duration ──────── */

describe('EffortDrivenEngine — duration reflows with staffing (CpmEngine)', () => {
  let e: EffortDrivenEngine;
  beforeEach(() => {
    e = cpm();
    e.setTasks([task('a', { effortDriven: true, duration: 4 * DAY, start: T0 })]);
    e.setDependencies([]);
  });

  it('first 100% resource is a no-op (seeds effort = 4d)', () => {
    e.schedule({ projectStart: T0 });
    const { changes } = e.assignResource('a', 'r1');
    expect(e.getTask('a')!.duration).toBe(4 * DAY);
    expect(e.getTask('a')!.effort).toBe(4 * DAY);
    expect(changes.find((c) => c.taskId === 'a')).toBeUndefined();
  });

  it('a second 100% resource halves the duration', () => {
    e.schedule({ projectStart: T0 });
    e.assignResource('a', 'r1');
    const { changes } = e.assignResource('a', 'r2');
    expect(e.getTask('a')!.duration).toBe(2 * DAY);
    expect(e.getTask('a')!.effort).toBe(4 * DAY); // work unchanged
    const ch = changes.find((c) => c.taskId === 'a');
    expect(ch).toBeDefined();
    expect(ch!.to.end - ch!.to.start).toBe(2 * DAY);
  });

  it('removing a resource lengthens the duration back', () => {
    e.schedule({ projectStart: T0 });
    e.assignResource('a', 'r1');
    const { assignment } = e.assignResource('a', 'r2');
    expect(e.getTask('a')!.duration).toBe(2 * DAY);
    e.unassignResource(assignment.id);
    expect(e.getTask('a')!.duration).toBe(4 * DAY);
  });

  it('a half-time resource added to a full one yields 4d / 1.5 units', () => {
    e.schedule({ projectStart: T0 });
    e.assignResource('a', 'r1'); // 100%
    e.assignResource('a', 'r3'); // 50% (capacity 0.5)
    expect(e.getAssignedUnits('a')).toBe(150);
    expect(e.getTask('a')!.duration).toBe(Math.round((4 * DAY) / 1.5));
  });

  it('changing assignment units reflows duration', () => {
    e.schedule({ projectStart: T0 });
    const { assignment } = e.assignResource('a', 'r1');
    e.setAssignmentUnits(assignment.id, 400); // 400% crash
    expect(e.getTask('a')!.duration).toBe(DAY);
  });

  it('fixed-duration tasks do NOT reflow; effort tracks staffing', () => {
    e.setTasks([task('f', { duration: 3 * DAY, start: T0 })]); // no effortDriven flag
    e.setDependencies([]);
    e.schedule({ projectStart: T0 });
    e.assignResource('f', 'r1');
    e.assignResource('f', 'r2');
    expect(e.getTask('f')!.duration).toBe(3 * DAY); // unchanged
    expect(e.getTask('f')!.effort).toBe(6 * DAY); // 3d × 2 units
  });
});

describe('EffortDrivenEngine — reflow re-propagates dependents', () => {
  it('shortening an effort-driven predecessor pulls its FS successor earlier', () => {
    const e = cpm();
    e.setTasks([
      task('a', { effortDriven: true, duration: 4 * DAY, start: T0 }),
      task('b', { duration: 2 * DAY }),
    ]);
    e.setDependencies([{ id: 'ab', fromId: 'a', toId: 'b', type: 'FS' }]);
    e.schedule({ projectStart: T0 });
    expect(e.getSchedule('b')!.start).toBe(T0 + 4 * DAY);

    e.assignResource('a', 'r1');
    const changes = e.assignResource('a', 'r2').changes; // halves a -> 2d
    expect(e.getTask('a')!.duration).toBe(2 * DAY);
    expect(e.getSchedule('b')!.start).toBe(T0 + 2 * DAY);
    expect(changes.some((c) => c.taskId === 'b')).toBe(true);
  });
});

describe('EffortDrivenEngine — effort/duration edits stay consistent', () => {
  let e: EffortDrivenEngine;
  beforeEach(() => {
    e = cpm();
    e.setTasks([task('a', { effortDriven: true, duration: 4 * DAY, start: T0 })]);
    e.setDependencies([]);
    e.schedule({ projectStart: T0 });
    e.assignResource('a', 'r1');
    e.assignResource('a', 'r2'); // units 2, effort 4d, duration 2d
  });

  it('authoring effort recomputes duration at current units', () => {
    e.updateTask('a', { effort: 8 * DAY });
    expect(e.getTask('a')!.duration).toBe(4 * DAY); // 8d / 2 units
  });

  it('authoring duration recomputes effort at current units', () => {
    e.updateTask('a', { duration: 3 * DAY });
    expect(e.getTask('a')!.effort).toBe(6 * DAY); // 3d × 2 units
  });

  it('a drag (setTaskSpan) changes work, not crew', () => {
    e.setTaskSpan('a', { start: T0, end: T0 + 5 * DAY });
    expect(e.getTask('a')!.duration).toBe(5 * DAY);
    expect(e.getTask('a')!.effort).toBe(10 * DAY); // 5d × 2 units
  });

  it('flipping effortDriven off freezes duration; on re-derives it', () => {
    e.updateTask('a', { effortDriven: false });
    e.assignResource('a', 'r3'); // adding 0.5 must NOT reflow a fixed task
    expect(e.getTask('a')!.duration).toBe(2 * DAY);
  });
});

describe('EffortDrivenEngine — DefaultGanttEngine inner + factory', () => {
  it('works over the UI default engine too', () => {
    const e = createEffortDrivenEngine(new DefaultGanttEngine());
    e.setCalendars([cal247], 'c');
    e.setResources(resources);
    e.setTasks([task('a', { effortDriven: true, duration: 4 * DAY, start: T0 })]);
    e.setDependencies([]);
    e.schedule({ projectStart: T0 });
    e.assignResource('a', 'r1');
    e.assignResource('a', 'r2');
    expect(e.getTask('a')!.duration).toBe(2 * DAY);
  });

  it('delegates base SchedulingEngine reads transparently', () => {
    const e = cpm();
    e.setTasks([task('a', { duration: DAY })]);
    e.setDependencies([]);
    const res = e.schedule({ projectStart: T0 });
    expect(res.schedules.get('a')!.end).toBe(T0 + DAY);
    expect(e.getDependenciesFor('a')).toEqual([]);
    expect(e.getCalculatorFor('a').calendar.id).toBe('c');
  });

  it('captures a baseline through the wrapper', () => {
    const e = cpm();
    e.setTasks([task('a', { duration: DAY, start: T0 })]);
    e.setDependencies([]);
    e.schedule({ projectStart: T0 });
    const b = e.captureBaseline('bl-1', 'Plan');
    expect(b.tasks.get('a')!.duration).toBe(DAY);
  });
});
