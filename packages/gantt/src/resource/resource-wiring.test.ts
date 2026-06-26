/**
 * jsdom unit tests for the RESOURCE-LAYER WIRING into the Gantt — the feature
 * that exports + integrates the (previously orphaned) resource data layer:
 *
 *   - `GanttOptions` now accepts `resources` / `assignments` (merged
 *     `ResourceOptions`); the `Gantt` widget auto-installs a `ResourceManager`
 *     from them and exposes it on `gantt.resources` (the `ResourceApi` surface).
 *   - A consumer-provided `ResourceManager` (via `plugins`) is ADOPTED rather
 *     than duplicated.
 *   - `installResourceLayer` is the headless seam doing the wiring; it stays
 *     inert when no resource config is present.
 *   - The unified `ResourceModel` (one model, re-exported by the UI module) is
 *     consistent across the contract and the assignment UI.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Gantt } from '../ui/gantt.js';
import { ResourceManager } from './resource-manager.js';
import { installResourceLayer, RESOURCE_MANAGER_FEATURE } from './install.js';
import type { TaskModel } from '../contract.js';
import type { ResourceModel, AssignmentModel, GanttApi } from '../index.js';

const DAY = 86_400_000;
const HOUR = 3_600_000;
const T0 = Date.UTC(2026, 0, 5);

function plan(): TaskModel[] {
  return [
    { id: 'p', name: 'Release' },
    { id: 'a', name: 'Design', parentId: 'p', start: T0, duration: 4 * DAY, end: T0 + 4 * DAY, effort: 32 * HOUR },
    { id: 'b', name: 'Build', parentId: 'p', start: T0 + 4 * DAY, duration: 5 * DAY, end: T0 + 9 * DAY, effort: 40 * HOUR },
  ];
}

const resources: ResourceModel[] = [
  { id: 'ada', name: 'Ada Lovelace', hourlyCost: 120, capacity: 1, group: 'Engineering' },
  { id: 'boris', name: 'Boris Becker', hourlyCost: 90, capacity: 1 },
];

const assignments: AssignmentModel[] = [
  { id: 'as1', taskId: 'a', resourceId: 'ada', units: 100 },
  { id: 'as2', taskId: 'b', resourceId: 'ada', units: 100 },
  { id: 'as3', taskId: 'b', resourceId: 'boris', units: 50 },
];

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

describe('Gantt resource-layer auto-install (GanttOptions.resources/assignments)', () => {
  it('auto-installs a ResourceManager and exposes it on gantt.resources', () => {
    gantt = new Gantt(host, { tasks: plan(), projectStart: T0, resources, assignments });
    const api = gantt.resources;
    expect(api).toBeDefined();
    expect(api!.getResources().map((r) => r.id)).toEqual(['ada', 'boris']);
    expect(api!.getResource('ada')?.name).toBe('Ada Lovelace');
    // The manager is registered as a Gantt feature.
    expect(gantt.features.has(RESOURCE_MANAGER_FEATURE)).toBe(true);
  });

  it('resolves assignments for a task with effort share + cost', () => {
    gantt = new Gantt(host, { tasks: plan(), projectStart: T0, resources, assignments });
    const forB = gantt.resources!.getAssignmentsFor('b');
    expect(forB.map((a) => a.assignment.resourceId).sort()).toEqual(['ada', 'boris']);
    // ada 100 + boris 50 ⇒ ada shoulders 100/150 of B's 40h effort.
    const ada = forB.find((a) => a.assignment.resourceId === 'ada')!;
    expect(ada.effortShare).toBeCloseTo(100 / 150, 5);
    expect(ada.cost).toBeGreaterThan(0);
  });

  it('flags an over-allocated resource (ada full-time on two overlapping tasks)', () => {
    gantt = new Gantt(host, { tasks: plan(), projectStart: T0, resources, assignments });
    // ada: 100 (a) + 100 (b) = 200 > capacity 100 ⇒ over-allocated.
    expect(gantt.resources!.allocationOf('ada')).toBe(200);
    expect(gantt.resources!.isOverAllocated('ada')).toBe(true);
    expect(gantt.resources!.isOverAllocated('boris')).toBe(false);
  });

  it('mirrors assignments into TaskModel.resourceIds (engine sees them)', () => {
    gantt = new Gantt(host, { tasks: plan(), projectStart: T0, resources, assignments });
    const taskB = gantt.getTask('b');
    expect(taskB?.resourceIds).toBeDefined();
    expect([...(taskB!.resourceIds ?? [])].sort()).toEqual(['ada', 'boris']);
  });

  it('assign / unassign through the API update the live surface', () => {
    gantt = new Gantt(host, { tasks: plan(), projectStart: T0, resources });
    const api = gantt.resources!;
    expect(api.getAssignmentsFor('a')).toHaveLength(0);
    api.assign('a', 'ada', 80);
    expect(api.getAssignmentsFor('a').map((r) => r.assignment.resourceId)).toEqual(['ada']);
    expect(api.getAssignmentsFor('a')[0]!.units).toBe(80);
    expect(api.unassign('a', 'ada')).toBe(true);
    expect(api.getAssignmentsFor('a')).toHaveLength(0);
  });

  it('stays inert when no resource config is present', () => {
    gantt = new Gantt(host, { tasks: plan(), projectStart: T0 });
    expect(gantt.resources).toBeUndefined();
    expect(gantt.features.has(RESOURCE_MANAGER_FEATURE)).toBe(false);
  });

  it('adopts a consumer-provided ResourceManager plugin (no duplicate)', () => {
    const mgr = new ResourceManager({ resources, assignments });
    gantt = new Gantt(host, { tasks: plan(), projectStart: T0, plugins: [mgr] });
    // The plugin instance IS the exposed resource API.
    expect(gantt.resources).toBe(mgr);
    expect(gantt.features.get(RESOURCE_MANAGER_FEATURE)).toBe(mgr);
  });

  it('clears the resource surface on destroy', () => {
    gantt = new Gantt(host, { tasks: plan(), projectStart: T0, resources, assignments });
    expect(gantt.resources).toBeDefined();
    gantt.destroy();
    expect(gantt.resources).toBeUndefined();
    gantt = null;
  });
});

describe('installResourceLayer (headless seam)', () => {
  function fakeApi(): GanttApi & { used: ResourceManager[] } {
    const features = new Map<string, unknown>();
    const used: ResourceManager[] = [];
    const tasks = new Map<string, TaskModel>([
      ['a', { id: 'a', name: 'A', effort: 8 * HOUR }],
    ]);
    const api = {
      features,
      getTask: (id: unknown) => tasks.get(String(id)),
      updateTask: (id: unknown, patch: Partial<TaskModel>) => {
        const t = tasks.get(String(id));
        if (t) Object.assign(t, patch);
        return !!t;
      },
      emit: () => true,
      track: () => {},
      use: (f: ResourceManager) => {
        features.set(f.name, f);
        f.init(api as unknown as GanttApi);
        used.push(f);
        return f;
      },
      used,
    } as unknown as GanttApi & { used: ResourceManager[] };
    return api;
  }

  it('returns undefined and installs nothing when config is empty', () => {
    const api = fakeApi();
    const result = installResourceLayer(api, {});
    expect(result).toBeUndefined();
    expect(api.used).toHaveLength(0);
  });

  it('auto-installs a manager from resources/assignments via api.use', () => {
    const api = fakeApi();
    const result = installResourceLayer(api, { resources, assignments });
    expect(result).toBeInstanceOf(ResourceManager);
    expect(api.used).toHaveLength(1);
    expect(result!.getResources().map((r) => r.id)).toEqual(['ada', 'boris']);
  });

  it('adopts an already-installed manager instead of creating a second', () => {
    const api = fakeApi();
    const existing = new ResourceManager({ resources });
    api.use(existing); // pre-install (as plugins would)
    const result = installResourceLayer(api, { resources, assignments });
    expect(result).toBe(existing);
    // No NEW manager created — only the pre-installed one was used.
    expect(api.used).toHaveLength(1);
  });
});
