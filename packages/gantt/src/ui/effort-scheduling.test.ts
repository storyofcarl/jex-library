/**
 * jsdom unit tests for the effort-driven scheduling UI wiring:
 *   - the pure presentation helpers (formatEffort / formatUnits / conversions),
 *   - the engine-path guard + wrapper (`shouldUseEffortScheduling`,
 *     `toEffortDrivenEngine`, `isResourceAwareEngine`),
 *   - the `Gantt` integration: passing `resources`/`assignments` (or effort tasks)
 *     wraps the default engine in an EffortDrivenEngine, `gantt.engine` still
 *     reports the BASE `DefaultGanttEngine`, and `assignResource` /
 *     `setAssignmentUnits` / `unassignResource` reflow the effort-driven duration
 *     and write it back to the store + tree column.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Gantt } from './gantt.js';
import { DefaultGanttEngine } from './default-engine.js';
import { CpmEngine } from '../engine/scheduler.js';
import {
  formatEffort,
  formatUnits,
  personDaysToEffortMs,
  normalizeUnitsPercent,
  shouldUseEffortScheduling,
  toEffortDrivenEngine,
  isResourceAwareEngine,
  EFFORT_COLUMN,
  UNITS_COLUMN,
  formatEffortCell,
} from './effort-scheduling.js';
import { EffortDrivenEngine } from '../engine/effort.js';
import type { TaskModel } from '../contract.js';

const DAY = 86_400_000;
const HOUR = 3_600_000;
const T0 = Date.UTC(2026, 0, 5);

/* ── pure helpers ────────────────────────────────────────────────────────── */

describe('effort presentation helpers', () => {
  it('formatEffort renders person-days', () => {
    expect(formatEffort(8 * HOUR, 8)).toBe('1d');
    expect(formatEffort(20 * HOUR, 8)).toBe('2.5d');
    expect(formatEffort(undefined)).toBe('');
  });

  it('formatUnits renders an allocation percentage', () => {
    expect(formatUnits(100)).toBe('100%');
    expect(formatUnits(150)).toBe('150%');
    expect(formatUnits(0)).toBe('0%');
    expect(formatUnits(undefined)).toBe('');
  });

  it('personDaysToEffortMs / normalizeUnitsPercent convert editor inputs', () => {
    expect(personDaysToEffortMs(2, 8)).toBe(2 * 8 * HOUR);
    expect(normalizeUnitsPercent(150)).toBe(150);
    expect(normalizeUnitsPercent(-5)).toBe(0);
  });

  it('formatEffortCell owns effort/units and falls through otherwise', () => {
    const t = { id: 'a', effort: 16 * HOUR, resourceIds: ['r1', 'r2'] } as TaskModel;
    expect(formatEffortCell('effort', t, { hoursPerDay: 8 })).toBe('2d');
    // No engine resolution → derive units from resource count (2 FTE = 200%).
    expect(formatEffortCell('units', t)).toBe('200%');
    // Engine-resolved units (a percentage) win.
    expect(formatEffortCell('units', t, { unitsOf: () => 150 })).toBe('150%');
    expect(formatEffortCell('name', t)).toBeUndefined();
  });

  it('EFFORT_COLUMN / UNITS_COLUMN are typed column configs', () => {
    expect(EFFORT_COLUMN.field).toBe('effort');
    expect(UNITS_COLUMN.field).toBe('units');
  });
});

/* ── engine-path guard + wrapper ─────────────────────────────────────────── */

describe('engine-path wiring helpers', () => {
  it('shouldUseEffortScheduling triggers on resources / assignments / effort tasks', () => {
    expect(
      shouldUseEffortScheduling({ tasks: [{ id: 'a' } as TaskModel] }),
    ).toBe(false);
    expect(
      shouldUseEffortScheduling({
        tasks: [{ id: 'a' } as TaskModel],
        resources: [{ id: 'r1' }],
      }),
    ).toBe(true);
    expect(
      shouldUseEffortScheduling({
        tasks: [{ id: 'a' } as TaskModel],
        assignments: [{ id: 'x', taskId: 'a', resourceId: 'r1' }],
      }),
    ).toBe(true);
    expect(
      shouldUseEffortScheduling({
        tasks: [{ id: 'a', effort: 4 * DAY } as TaskModel],
      }),
    ).toBe(true);
    expect(
      shouldUseEffortScheduling({
        tasks: [{ id: 'a', effortDriven: true } as TaskModel],
      }),
    ).toBe(true);
  });

  it('toEffortDrivenEngine wraps once (idempotent) and isResourceAwareEngine guards it', () => {
    const base = new CpmEngine();
    expect(isResourceAwareEngine(base)).toBe(false);
    const wrapped = toEffortDrivenEngine(base);
    expect(wrapped).toBeInstanceOf(EffortDrivenEngine);
    expect(isResourceAwareEngine(wrapped)).toBe(true);
    // Already resource-aware → returned as-is.
    expect(toEffortDrivenEngine(wrapped)).toBe(wrapped);
  });
});

/* ── Gantt integration ───────────────────────────────────────────────────── */

let host: HTMLElement;
let gantt: Gantt | null = null;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});

afterEach(() => {
  gantt?.destroy();
  gantt = null;
  host.remove();
});

function effortTasks(): TaskModel[] {
  return [
    { id: 'a', name: 'Design', start: T0, duration: 4 * DAY, end: T0 + 4 * DAY, effortDriven: true } as TaskModel,
    { id: 'b', name: 'Build', duration: 2 * DAY } as TaskModel,
  ];
}

describe('Gantt — effort-driven default engine path', () => {
  it('does NOT wrap when no effort config is present (engine stays DefaultGanttEngine)', () => {
    gantt = new Gantt(host, {
      tasks: [{ id: 'a', name: 'A', start: T0, duration: 2 * DAY, end: T0 + 2 * DAY }],
      projectStart: T0,
    });
    expect(gantt.engine).toBeInstanceOf(DefaultGanttEngine);
    expect(gantt.effortEngine).toBeNull();
    expect(gantt.assignResource('a', 'r1')).toBeUndefined();
  });

  it('wraps the default engine when effort tasks are present, but reports the base engine', () => {
    gantt = new Gantt(host, { tasks: effortTasks(), projectStart: T0 });
    // Public `engine` still surfaces the base scheduler.
    expect(gantt.engine).toBeInstanceOf(DefaultGanttEngine);
    // …but the effort engine is wired and resource-aware.
    expect(gantt.effortEngine).not.toBeNull();
  });

  it('assigning resources reflows an effort-driven task duration and re-propagates', () => {
    gantt = new Gantt(host, {
      tasks: [
        { id: 'a', name: 'Design', start: T0, duration: 4 * DAY, end: T0 + 4 * DAY, effortDriven: true } as TaskModel,
        { id: 'b', name: 'Build', duration: 2 * DAY } as TaskModel,
      ],
      dependencies: [{ id: 'ab', fromId: 'a', toId: 'b', type: 'FS' }],
      // Seed an effort engine via a resource so the wrapper is active.
      resources: [{ id: 'r1', name: 'Ann' }, { id: 'r2', name: 'Bob' }],
      projectStart: T0,
    } as never);

    // First 100% resource seeds effort = 4d (no-op on duration).
    gantt.assignResource('a', 'r1');
    expect(gantt.getTask('a')!.duration).toBe(4 * DAY);

    // Second 100% resource halves the duration to 2d (effort 4d unchanged).
    gantt.assignResource('a', 'r2');
    expect(gantt.getTask('a')!.duration).toBe(2 * DAY);
    expect(gantt.getTask('a')!.effort).toBe(4 * DAY);
    expect(gantt.getAssignedUnits('a')).toBe(200); // Σ units = 200% (two FTE)

    // FS successor 'b' pulled earlier (predecessor finishes at T0 + 2d now).
    expect(gantt.getSchedule('b')!.start).toBe(T0 + 2 * DAY);
  });

  it('setAssignmentUnits reflows duration; unassigning a resource lengthens it back', () => {
    gantt = new Gantt(host, {
      tasks: [
        { id: 'a', name: 'Design', start: T0, duration: 4 * DAY, end: T0 + 4 * DAY, effortDriven: true } as TaskModel,
      ],
      resources: [{ id: 'r1', name: 'Ann' }, { id: 'r2', name: 'Bob' }],
      projectStart: T0,
    } as never);

    const asg = gantt.assignResource('a', 'r1')!;
    expect(asg).toBeDefined();
    // 400% crash on the single assignment → duration / 4 (units are a percentage).
    gantt.setAssignmentUnits(asg.id, 400);
    expect(gantt.getTask('a')!.duration).toBe(DAY);

    // Back to 100%, then add a second FTE → halves to 2d; remove it → back to 4d.
    gantt.setAssignmentUnits(asg.id, 100);
    expect(gantt.getTask('a')!.duration).toBe(4 * DAY);
    const asg2 = gantt.assignResource('a', 'r2')!;
    expect(gantt.getTask('a')!.duration).toBe(2 * DAY);
    gantt.unassignResource(asg2.id);
    expect(gantt.getTask('a')!.duration).toBe(4 * DAY);
  });

  it('mirrors the reflowed effort/units into the tree Effort + Units columns', () => {
    // Seed a 4 working-day duration (8h/day) so effort reads as 4 person-days.
    const WORK_DAY = 8 * HOUR;
    gantt = new Gantt(host, {
      tasks: [
        {
          id: 'a',
          name: 'Design',
          start: T0,
          duration: 4 * WORK_DAY,
          end: T0 + 4 * WORK_DAY,
          effortDriven: true,
        } as TaskModel,
      ],
      resources: [{ id: 'r1', name: 'Ann' }, { id: 'r2', name: 'Bob' }],
      columns: [
        { field: 'name', header: 'Task name', width: 200 },
        EFFORT_COLUMN,
        UNITS_COLUMN,
      ],
      projectStart: T0,
    } as never);

    gantt.assignResource('a', 'r1');
    gantt.assignResource('a', 'r2');

    // The accessible fallback table renders the Effort + Units cells.
    const cells = [...gantt.el.querySelectorAll('.jects-gantt__tree-td')].map(
      (c) => c.textContent ?? '',
    );
    expect(cells).toContain('4d'); // effort = 4 person-days (8h/day)
    expect(cells).toContain('200%'); // Σ units = 200% (two FTE)
  });
});
