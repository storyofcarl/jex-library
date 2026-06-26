/**
 * jsdom unit tests for the `Gantt` widget — the composed task-tree + timeline +
 * scheduling-engine bridge. Covers construction & rendering of both panes, the
 * engine-routed mutations (updateTaskSpan / updateTask / addDependency /
 * applyConstraint) with their vetoable + notify events, critical-path toggling,
 * baselines, factory registration, and leak-free destroy.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TreeStore, isRegistered, create } from '@jects/core';
import { Gantt } from './gantt.js';
import { DefaultGanttEngine } from './default-engine.js';
import type { TaskModel, DependencyModel } from '../contract.js';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 5);

let host: HTMLElement;
let gantt: Gantt | null = null;

function sampleTasks(): TaskModel[] {
  return [
    { id: 'p', name: 'Phase 1' },
    { id: 'a', name: 'Design', parentId: 'p', start: T0, duration: 3 * DAY, end: T0 + 3 * DAY },
    {
      id: 'b',
      name: 'Build',
      parentId: 'p',
      start: T0 + 3 * DAY,
      duration: 3 * DAY,
      end: T0 + 6 * DAY,
      percentDone: 0.25,
    },
    { id: 'm', name: 'Launch', parentId: 'p', start: T0 + 6 * DAY, milestone: true },
  ];
}

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});

afterEach(() => {
  gantt?.destroy();
  gantt = null;
  host.remove();
});

describe('Gantt', () => {
  it('builds both panes and renders a bar per visible task', () => {
    gantt = new Gantt(host, { tasks: sampleTasks(), projectStart: T0 });
    expect(gantt.el.querySelector('.jects-gantt__tree')).not.toBeNull();
    expect(gantt.el.querySelector('.jects-gantt__timeline')).not.toBeNull();
    // 4 tasks (parent + 3 children) -> 4 bars.
    expect(gantt.el.querySelectorAll('.jects-gantt__bar').length).toBe(4);
    expect(gantt.el.querySelector('.jects-gantt__bar--summary')).not.toBeNull();
    expect(gantt.el.querySelector('.jects-gantt__bar--milestone')).not.toBeNull();
  });

  it('exposes the engine and reads schedules / critical path through the API', () => {
    gantt = new Gantt(host, {
      tasks: [
        { id: 'a', name: 'A', start: T0, duration: 2 * DAY, end: T0 + 2 * DAY },
        { id: 'b', name: 'B', start: T0, duration: 3 * DAY, end: T0 + 3 * DAY },
      ],
      dependencies: [{ id: 'l1', fromId: 'a', toId: 'b', type: 'FS' }],
      projectStart: T0,
    });
    expect(gantt.engine).toBeInstanceOf(DefaultGanttEngine);
    expect(gantt.getSchedule('a')).toBeDefined();
    expect(gantt.getCriticalPath().length).toBeGreaterThan(0);
    // FS link drove B to start at A's finish.
    expect(gantt.getTask('b')!.start).toBe(gantt.getTask('a')!.end);
  });

  it('routes updateTaskSpan through the engine and fires beforeTaskChange + taskChange', () => {
    const events: string[] = [];
    gantt = new Gantt(host, { tasks: sampleTasks(), projectStart: T0 });
    gantt.on('beforeTaskChange', () => {
      events.push('before');
    });
    gantt.on('taskChange', () => {
      events.push('change');
    });
    const newStart = T0 + 5 * DAY;
    const ok = gantt.updateTaskSpan('a', { start: newStart, end: newStart + 3 * DAY });
    expect(ok).toBe(true);
    expect(events).toEqual(['before', 'change']);
    expect(gantt.getTask('a')!.start).toBe(newStart);
  });

  it('honors a beforeTaskChange veto (returns false, no mutation)', () => {
    gantt = new Gantt(host, { tasks: sampleTasks(), projectStart: T0 });
    const before = gantt.getTask('a')!.start;
    gantt.on('beforeTaskChange', () => false);
    const ok = gantt.updateTaskSpan('a', { start: T0 + 9 * DAY, end: T0 + 12 * DAY });
    expect(ok).toBe(false);
    expect(gantt.getTask('a')!.start).toBe(before);
  });

  it('creates a dependency through the API and fires dependencyCreate', () => {
    let created: DependencyModel | null = null;
    gantt = new Gantt(host, {
      tasks: [
        { id: 'a', name: 'A', start: T0, duration: 2 * DAY, end: T0 + 2 * DAY },
        { id: 'b', name: 'B', start: T0, duration: 2 * DAY, end: T0 + 2 * DAY },
      ],
      projectStart: T0,
    });
    gantt.on('dependencyCreate', ({ dependency }) => {
      created = dependency;
    });
    const dep = gantt.addDependency({ fromId: 'a', toId: 'b', type: 'FS' });
    expect(dep).toBeDefined();
    expect(created).not.toBeNull();
    expect(gantt.getDependenciesFor('b').length).toBe(1);
    // The new FS link re-propagated B.
    expect(gantt.getTask('b')!.start).toBe(gantt.getTask('a')!.end);
  });

  it('rejects a dependency that would create a cycle', () => {
    gantt = new Gantt(host, {
      tasks: [
        { id: 'a', name: 'A', start: T0, duration: DAY, end: T0 + DAY },
        { id: 'b', name: 'B', start: T0, duration: DAY, end: T0 + DAY },
      ],
      dependencies: [{ id: 'l1', fromId: 'a', toId: 'b' }],
      projectStart: T0,
    });
    const dep = gantt.addDependency({ fromId: 'b', toId: 'a' });
    expect(dep).toBeUndefined();
  });

  it('vetoes a dependency via beforeDependencyCreate', () => {
    gantt = new Gantt(host, {
      tasks: [
        { id: 'a', name: 'A', start: T0, duration: DAY, end: T0 + DAY },
        { id: 'b', name: 'B', start: T0, duration: DAY, end: T0 + DAY },
      ],
      projectStart: T0,
    });
    gantt.on('beforeDependencyCreate', () => false);
    const dep = gantt.addDependency({ fromId: 'a', toId: 'b' });
    expect(dep).toBeUndefined();
    expect(gantt.getDependenciesFor('a').length).toBe(0);
  });

  it('applies a constraint and patches task fields through the engine', () => {
    gantt = new Gantt(host, {
      tasks: [{ id: 'a', name: 'A', start: T0, duration: 2 * DAY, end: T0 + 2 * DAY }],
      projectStart: T0,
    });
    const floor = T0 + 4 * DAY;
    expect(gantt.applyConstraint('a', 'startNoEarlierThan', floor)).toBe(true);
    expect(gantt.getTask('a')!.start).toBe(floor);

    expect(gantt.updateTask('a', { percentDone: 0.5 })).toBe(true);
    expect(gantt.getTask('a')!.percentDone).toBe(0.5);
  });

  it('captures a baseline and can show its overlay', () => {
    let captured = false;
    gantt = new Gantt(host, {
      tasks: [{ id: 'a', name: 'A', start: T0, duration: 2 * DAY, end: T0 + 2 * DAY }],
      projectStart: T0,
    });
    gantt.on('baselineCapture', () => {
      captured = true;
    });
    const baseline = gantt.captureBaseline('base-1', 'Original');
    expect(baseline.id).toBe('base-1');
    expect(captured).toBe(true);
    gantt.updateTaskSpan('a', { start: T0 + 2 * DAY, end: T0 + 4 * DAY });
    gantt.showBaseline('base-1');
    expect(gantt.el.querySelector('.jects-gantt__baseline')).not.toBeNull();
  });

  it('toggles critical-path highlighting', () => {
    gantt = new Gantt(host, {
      tasks: [
        { id: 'a', name: 'A', start: T0, duration: 2 * DAY, end: T0 + 2 * DAY },
        { id: 'b', name: 'B', start: T0, duration: 3 * DAY, end: T0 + 3 * DAY },
      ],
      dependencies: [{ id: 'l1', fromId: 'a', toId: 'b' }],
      projectStart: T0,
    });
    expect(gantt.el.querySelector('.jects-gantt__bar--critical')).not.toBeNull();
    gantt.setCriticalPathVisible(false);
    expect(gantt.el.querySelector('.jects-gantt__bar--critical')).toBeNull();
  });

  it('accepts a TreeStore data source and a custom injected engine', () => {
    const store = new TreeStore<TaskModel & { children?: TaskModel[] }>({
      data: [
        {
          id: 'p',
          name: 'Parent',
          children: [{ id: 'c', name: 'Child', start: T0, duration: DAY, end: T0 + DAY }],
        },
      ],
    });
    const engine = new DefaultGanttEngine();
    gantt = new Gantt(host, { tasks: store, engine, projectStart: T0 });
    expect(gantt.engine).toBe(engine);
    expect(gantt.el.querySelectorAll('.jects-gantt__bar').length).toBe(2);
  });

  it('registers with the factory under "gantt"', () => {
    expect(isRegistered('gantt')).toBe(true);
    const w = create({ type: 'gantt', tasks: sampleTasks(), projectStart: T0 } as never, host);
    expect(w.el.classList.contains('jects-gantt')).toBe(true);
    w.destroy();
  });

  it('destroy() removes the root and is idempotent', () => {
    gantt = new Gantt(host, { tasks: sampleTasks(), projectStart: T0 });
    const el = gantt.el;
    gantt.destroy();
    expect(el.isConnected).toBe(false);
    expect(gantt.isDestroyed).toBe(true);
    expect(() => gantt!.destroy()).not.toThrow();
    gantt = null;
  });

  it('keeps the group role + accessible name on the root', () => {
    gantt = new Gantt(host, { tasks: sampleTasks(), projectStart: T0 });
    expect(gantt.el.getAttribute('role')).toBe('group');
    expect(gantt.el.getAttribute('aria-label')).toBe('Gantt chart');
  });

  it('does not re-enter the schedule pipeline on its own write-back (re-entrancy guard)', () => {
    // A non-idempotent engine: each recalc nudges every task forward by 1ms, so
    // writeBackSpans always reports a diff. Without the applyingSpans guard the
    // store `change` echo would re-enter onStoreChange → recalc → writeBackSpans
    // unboundedly. With the guard, a single external edit triggers a bounded set
    // of recalcs and terminates.
    let recalcCount = 0;
    class DriftingEngine extends DefaultGanttEngine {
      override recalc() {
        recalcCount++;
        const base = super.recalc();
        // Non-idempotent: bump every task end by 1ms so spans keep "changing".
        for (const id of ['a'] as const) {
          const t = this.getTask(id);
          if (t && t.end != null) {
            t.end += 1;
            t.duration = (t.duration ?? 0) + 1;
          }
        }
        return base;
      }
    }
    const engine = new DriftingEngine();
    gantt = new Gantt(host, {
      tasks: [{ id: 'a', name: 'A', start: T0, duration: 2 * DAY, end: T0 + 2 * DAY }],
      engine,
      projectStart: T0,
    });
    const store = (gantt as unknown as { _store: TreeStore<TaskModel> })._store;
    recalcCount = 0;
    // One genuine external edit.
    store.update('a', { name: 'Renamed' });
    // The guard ensures the write-back echo does not recursively re-trigger
    // onStoreChange; recalc runs a small bounded number of times (not unbounded).
    expect(recalcCount).toBeGreaterThan(0);
    expect(recalcCount).toBeLessThanOrEqual(2);
    expect(gantt.getTask('a')!.name).toBe('Renamed');
  });

  it('reschedules dependents + recomputes critical path on a constraint change', () => {
    const paths: ReadonlyArray<unknown>[] = [];
    gantt = new Gantt(host, {
      tasks: [
        { id: 'a', name: 'A', start: T0, duration: 2 * DAY, end: T0 + 2 * DAY },
        { id: 'b', name: 'B', start: T0 + 2 * DAY, duration: 2 * DAY, end: T0 + 4 * DAY },
      ],
      dependencies: [{ id: 'l1', fromId: 'a', toId: 'b', type: 'FS' }],
      projectStart: T0,
    });
    gantt.on('criticalPathChange', ({ path }) => paths.push(path));
    const bStartBefore = gantt.getTask('b')!.start;
    // Push A later via a constraint; the FS-dependent B must move with it.
    const floor = T0 + 5 * DAY;
    gantt.applyConstraint('a', 'startNoEarlierThan', floor);
    expect(gantt.getTask('a')!.start).toBe(floor);
    expect(gantt.getTask('b')!.start).toBeGreaterThan(bStartBefore);
    expect(gantt.getTask('b')!.start).toBe(gantt.getTask('a')!.end);
    // The critical path was recomputed (event fired with the new path).
    expect(paths.length).toBeGreaterThan(0);
    expect(gantt.getCriticalPath().length).toBeGreaterThan(0);
  });

  it('shades non-working bands from the project calendar (custom Mon–Sat week)', () => {
    const NINE_TO_FIVE = [{ from: 9 * 60, to: 17 * 60 }];
    gantt = new Gantt(host, {
      tasks: [{ id: 'a', name: 'A', start: T0, duration: 2 * DAY, end: T0 + 2 * DAY }],
      projectStart: T0,
      calendars: [
        {
          id: 'six-day',
          // Mon–Sat working; only Sunday off.
          week: [1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, intervals: NINE_TO_FIVE })),
        },
      ],
      defaultCalendarId: 'six-day',
    });
    // The backdrop renders non-working shading derived from the real calendar.
    expect(gantt.el.querySelectorAll('.jects-gantt__nonworking').length).toBeGreaterThan(0);
  });
});
