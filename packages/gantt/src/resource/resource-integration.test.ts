/**
 * jsdom unit tests for the resource INTEGRATION helpers — the additive wiring
 * that adopts the Gantt-auto-installed `ResourceManager`, folds the `ResourceApi`
 * onto the instance, and bridges runtime assign/unassign to the effort engine so
 * effort-driven durations reflow live.
 *
 * Covers:
 *   - `installResourceManagement` adopts the auto-installed manager (idempotent),
 *     folds `gantt.assign(...)` / reads, exposes `gantt.resourceManager`.
 *   - the folded `assign`/`unassign`/`getAssignmentsFor`/over-allocation reads.
 *   - resource events fire through the host (`gantt.on('assign'|'unassign')`).
 *   - the effort-reflow bridge: assigning a SECOND full-time resource to an
 *     effort-driven task halves its duration; unassigning restores it; a 50%
 *     assignment doubles it.
 *   - `createResourceGanttEngine` builds a resource-aware engine; `withResources`
 *     injects one.
 *   - clean destroy via the Gantt feature lifecycle.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Gantt } from '../ui/gantt.js';
import {
  installResourceManagement,
  bridgeResourceEffort,
  createResourceGanttEngine,
  isResourceAwareEngine,
  getResourceManager,
  withResources,
} from './resource-integration.js';
import { ResourceManager } from './resource-manager.js';
import type { TaskModel } from '../contract.js';
import type { ResourceModel } from './resource-contract.js';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 5); // Monday

let host: HTMLElement;
let gantt: Gantt | null = null;

function fixedTasks(): TaskModel[] {
  return [
    { id: 'a', name: 'Design', start: T0, duration: 4 * DAY, end: T0 + 4 * DAY },
    { id: 'b', name: 'Build', start: T0 + 4 * DAY, duration: 2 * DAY, end: T0 + 6 * DAY },
  ];
}

function effortTask(): TaskModel[] {
  return [
    {
      id: 'a',
      name: 'Effort task',
      start: T0,
      duration: 4 * DAY,
      end: T0 + 4 * DAY,
      effortDriven: true,
    } as TaskModel,
  ];
}

function resources(): ResourceModel[] {
  return [
    { id: 'r1', name: 'Ada', hourlyCost: 100, capacity: 1 },
    { id: 'r2', name: 'Boris', hourlyCost: 50, capacity: 1 },
    { id: 'team', name: 'QA Team', capacity: 3 },
  ];
}

function makeGantt(opts: Record<string, unknown>): Gantt {
  return new Gantt(host, {
    projectStart: T0,
    engine: createResourceGanttEngine(),
    resources: resources(),
    ...opts,
  } as never);
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

describe('installResourceManagement', () => {
  it('adopts the auto-installed ResourceManager and folds the ResourceApi', () => {
    gantt = makeGantt({
      tasks: fixedTasks(),
      assignments: [{ id: 'as1', taskId: 'a', resourceId: 'r1', units: 100 }],
    });
    expect(getResourceManager(gantt)).toBeInstanceOf(ResourceManager);

    const api = installResourceManagement(gantt);
    expect(api.resourceManager).toBeInstanceOf(ResourceManager);
    // Folded reads work through the instance.
    expect(api.getResources().map((r) => r.id)).toEqual(['r1', 'r2', 'team']);
    expect(api.getAssignmentsFor('a')).toHaveLength(1);
  });

  it('folds assign / unassign with task.resourceIds mirror', () => {
    gantt = makeGantt({ tasks: fixedTasks() });
    const api = installResourceManagement(gantt);

    const assignment = api.assign('a', 'r1', 100);
    expect(assignment).toBeDefined();
    expect(api.getAssignmentsFor('a').map((r) => r.assignment.resourceId)).toEqual(['r1']);
    expect(gantt.getTask('a')!.resourceIds).toEqual(['r1']);

    expect(api.unassign('a', 'r1')).toBe(true);
    expect(api.getAssignmentsFor('a')).toHaveLength(0);
  });

  it('detects over-allocation across tasks (percentage capacity)', () => {
    gantt = makeGantt({ tasks: fixedTasks() });
    const api = installResourceManagement(gantt);

    api.assign('a', 'r1', 100);
    api.assign('b', 'r1', 75); // 175% across two tasks; capacity 1 (=100%)
    expect(api.allocationOf('r1')).toBe(175);
    expect(api.isOverAllocated('r1')).toBe(true);

    api.assign('a', 'team', 200); // capacity 3 (=300%) — fine.
    expect(api.isOverAllocated('team')).toBe(false);
  });

  it('routes resource events through the host Gantt emitter', () => {
    gantt = makeGantt({ tasks: fixedTasks() });
    const api = installResourceManagement(gantt);

    const seen: string[] = [];
    gantt.on('beforeAssign' as never, () => void seen.push('beforeAssign'));
    gantt.on('assign' as never, () => void seen.push('assign'));
    gantt.on('unassign' as never, () => void seen.push('unassign'));

    api.assign('a', 'r1', 60);
    api.unassign('a', 'r1');
    expect(seen).toEqual(['beforeAssign', 'assign', 'unassign']);
  });

  it('beforeAssign veto (through the host) cancels the assignment', () => {
    gantt = makeGantt({ tasks: fixedTasks() });
    const api = installResourceManagement(gantt);
    gantt.on('beforeAssign' as never, () => false as never);

    expect(api.assign('a', 'r1')).toBeUndefined();
    expect(api.getAssignmentsFor('a')).toHaveLength(0);
  });

  it('is idempotent — a second install returns the same manager', () => {
    gantt = makeGantt({ tasks: fixedTasks() });
    const a = installResourceManagement(gantt);
    const b = installResourceManagement(gantt);
    expect(b.resourceManager).toBe(a.resourceManager);
    expect(gantt.features.get('resourceManager')).toBe(a.resourceManager);
  });

  it('does NOT double-bridge: a second install reflows the engine ONCE per assign', () => {
    gantt = makeGantt({ tasks: effortTask() });
    installResourceManagement(gantt);

    // The reflow path calls effortEngine.setAssignments() exactly once per
    // assign/unassign event; a duplicate listener set would call it twice.
    const eng = gantt.effortEngine!;
    let seedCalls = 0;
    const realSetAssignments = eng.setAssignments.bind(eng);
    eng.setAssignments = ((a: never) => {
      seedCalls += 1;
      return realSetAssignments(a);
    }) as typeof eng.setAssignments;

    // Re-install (simulating a consumer calling it after the Gantt auto-install).
    const api = installResourceManagement(gantt);

    seedCalls = 0;
    api.assign('a', 'r1', 100);
    expect(seedCalls).toBe(1); // one reflow, not two

    seedCalls = 0;
    api.assign('a', 'r2', 100);
    expect(seedCalls).toBe(1);

    seedCalls = 0;
    api.unassign('a', 'r2');
    expect(seedCalls).toBe(1);
  });

  it('bridgeResourceEffort returns the SAME disposer on re-entry (no new listeners)', () => {
    gantt = makeGantt({ tasks: effortTask() });
    installResourceManagement(gantt);
    const mgr = getResourceManager(gantt)!;
    const first = bridgeResourceEffort(gantt, mgr);
    const second = bridgeResourceEffort(gantt, mgr);
    expect(second).toBe(first);
  });

  it('re-bridging after disposal installs a fresh bridge', () => {
    gantt = makeGantt({ tasks: effortTask() });
    const mgr = getResourceManager(gantt)!;
    const first = bridgeResourceEffort(gantt, mgr);
    first(); // dispose clears the per-Gantt marker
    const second = bridgeResourceEffort(gantt, mgr);
    expect(second).not.toBe(first);
    // The fresh bridge still reflows correctly.
    const api = installResourceManagement(gantt);
    api.assign('a', 'r1', 100);
    api.assign('a', 'r2', 100);
    expect(gantt.getTask('a')!.duration).toBe(2 * DAY);
    second();
  });
});

describe('effort-reflow bridge', () => {
  it('createResourceGanttEngine builds a resource-aware engine', () => {
    expect(isResourceAwareEngine(createResourceGanttEngine())).toBe(true);
  });

  it('assigning a second full-time resource halves an effort-driven duration', () => {
    gantt = makeGantt({ tasks: effortTask() });
    const api = installResourceManagement(gantt);

    // First full-time resource: effort seeded from duration → unchanged.
    api.assign('a', 'r1', 100);
    expect(gantt.getTask('a')!.duration).toBe(4 * DAY);

    // Second full-time resource: Σunits = 200% (2 FTE) → duration halves.
    api.assign('a', 'r2', 100);
    expect(gantt.getTask('a')!.duration).toBe(2 * DAY);

    // Removing it restores the 4-day duration.
    api.unassign('a', 'r2');
    expect(gantt.getTask('a')!.duration).toBe(4 * DAY);
  });

  it('a 50% assignment doubles an effort-driven duration', () => {
    gantt = makeGantt({ tasks: effortTask() });
    const api = installResourceManagement(gantt);

    api.assign('a', 'r1', 100);
    expect(gantt.getTask('a')!.duration).toBe(4 * DAY);
    api.assign('a', 'r1', 50); // re-unit to 50% → 4d / 0.5 = 8 days.
    expect(gantt.getTask('a')!.duration).toBe(8 * DAY);
  });

  it('non-effort-driven tasks keep their authored duration when staffed', () => {
    gantt = makeGantt({ tasks: fixedTasks() });
    const api = installResourceManagement(gantt);

    api.assign('a', 'r1', 100);
    api.assign('a', 'r2', 100);
    expect(gantt.getTask('a')!.duration).toBe(4 * DAY);
  });
});

describe('withResources convenience', () => {
  it('injects an effort-driven engine and installs in one flow', () => {
    const { options, install } = withResources({
      tasks: effortTask(),
      projectStart: T0,
      resources: resources(),
    } as never);
    expect(isResourceAwareEngine(options.engine!)).toBe(true);

    gantt = new Gantt(host, options as never);
    const api = install(gantt);
    api.assign('a', 'r1', 100);
    api.assign('a', 'r2', 100);
    expect(gantt.getTask('a')!.duration).toBe(2 * DAY);
  });

  it('preserves a caller-supplied engine', () => {
    const engine = createResourceGanttEngine();
    const { options } = withResources({
      tasks: fixedTasks(),
      engine,
      resources: resources(),
    } as never);
    expect(options.engine).toBe(engine);
  });
});

describe('cleanup', () => {
  it('destroying the Gantt tears down the resource feature', () => {
    gantt = makeGantt({ tasks: fixedTasks() });
    const api = installResourceManagement(gantt);
    const manager = api.resourceManager;
    gantt.destroy();
    gantt = null;
    expect(() => manager.destroy()).not.toThrow();
  });
});
