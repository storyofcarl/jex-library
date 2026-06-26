import { describe, it, expect, vi } from 'vitest';
import { ResourceManager, createResourceManager } from './resource-manager.js';
import type { GanttApi, TaskModel } from '../contract.js';
import type { ResourceModel, AssignmentModel } from './resource-contract.js';

const HOUR = 3_600_000;

/**
 * Minimal fake `GanttApi` covering only the methods `ResourceManager` calls:
 * `getTask`, `updateTask`, `emit`, `track`. `emit` honors the veto convention
 * (a `false` return cancels) so `beforeAssign` can be tested.
 */
function fakeApi(tasks: TaskModel[]): GanttApi & {
  emitted: Array<{ event: string; payload: unknown }>;
  vetoNext?: string;
} {
  const byId = new Map(tasks.map((t) => [t.id, { ...t }]));
  const emitted: Array<{ event: string; payload: unknown }> = [];
  const api: Partial<GanttApi> & {
    emitted: typeof emitted;
    vetoNext?: string;
  } = {
    emitted,
    getTask: (id) => byId.get(id),
    updateTask: (id, patch) => {
      const t = byId.get(id);
      if (!t) return false;
      Object.assign(t, patch);
      return true;
    },
    emit: (event: string, payload: unknown) => {
      emitted.push({ event, payload });
      return api.vetoNext === event ? false : true;
    },
    track: () => {},
  };
  return api as GanttApi & { emitted: typeof emitted; vetoNext?: string };
}

const resources = (): ResourceModel[] => [
  { id: 'r1', name: 'Ada', hourlyCost: 100, capacity: 1 },
  { id: 'r2', name: 'Boris', hourlyCost: 50, capacity: 1 },
  { id: 'r3', name: 'Team', hourlyCost: 0, capacity: 3 },
];

describe('ResourceManager', () => {
  it('builds stores from config', () => {
    const mgr = createResourceManager({
      resources: resources(),
      assignments: [{ id: 'a1', taskId: 't1', resourceId: 'r1', units: 100 }],
    });
    expect(mgr.getResources().map((r) => r.id)).toEqual(['r1', 'r2', 'r3']);
    expect(mgr.assignmentStore.getByTask('t1')).toHaveLength(1);
  });

  it('resolves assignments with effort share, effort and cost', () => {
    // task effort = 10h; two equal-units resources ⇒ 50/50 split.
    const mgr = new ResourceManager();
    const api = fakeApi([{ id: 't1', effort: 10 * HOUR } as TaskModel]);
    mgr.init(api);
    mgr.resourceStore.add(resources());
    mgr.assign('t1', 'r1', 100);
    mgr.assign('t1', 'r2', 100);

    const resolved = mgr.getAssignmentsFor('t1');
    expect(resolved).toHaveLength(2);
    const ada = resolved.find((r) => r.assignment.resourceId === 'r1')!;
    expect(ada.effortShare).toBeCloseTo(0.5);
    expect(ada.effort).toBeCloseTo(5 * HOUR);
    expect(ada.cost).toBeCloseTo(5 * 100); // 5h at $100/h
    const boris = resolved.find((r) => r.assignment.resourceId === 'r2')!;
    expect(boris.cost).toBeCloseTo(5 * 50);
  });

  it('splits effort proportionally by units', () => {
    const mgr = new ResourceManager();
    const api = fakeApi([{ id: 't1', effort: 12 * HOUR } as TaskModel]);
    mgr.init(api);
    mgr.resourceStore.add(resources());
    mgr.assign('t1', 'r1', 200); // 2/3
    mgr.assign('t1', 'r2', 100); // 1/3
    const resolved = mgr.getAssignmentsFor('t1');
    const r1 = resolved.find((r) => r.assignment.resourceId === 'r1')!;
    expect(r1.effort).toBeCloseTo(8 * HOUR);
  });

  it('syncs TaskModel.resourceIds on assign/unassign', () => {
    const mgr = new ResourceManager();
    const api = fakeApi([{ id: 't1', effort: HOUR } as TaskModel]);
    mgr.init(api);
    mgr.resourceStore.add(resources());
    mgr.assign('t1', 'r1');
    expect(api.getTask('t1')!.resourceIds).toEqual(['r1']);
    mgr.assign('t1', 'r2');
    expect(api.getTask('t1')!.resourceIds!.sort()).toEqual(['r1', 'r2']);
    mgr.unassign('t1', 'r1');
    expect(api.getTask('t1')!.resourceIds).toEqual(['r2']);
  });

  it('beforeAssign veto cancels the assignment', () => {
    const mgr = new ResourceManager();
    const api = fakeApi([{ id: 't1' } as TaskModel]);
    mgr.init(api);
    mgr.resourceStore.add(resources());
    api.vetoNext = 'beforeAssign';
    const result = mgr.assign('t1', 'r1');
    expect(result).toBeUndefined();
    expect(mgr.assignmentStore.getByTask('t1')).toEqual([]);
  });

  it('emits assign / unassign through the host', () => {
    const mgr = new ResourceManager();
    const api = fakeApi([{ id: 't1' } as TaskModel]);
    mgr.init(api);
    mgr.resourceStore.add(resources());
    mgr.assign('t1', 'r1', 80);
    mgr.unassign('t1', 'r1');
    const events = api.emitted.map((e) => e.event);
    expect(events).toContain('assign');
    expect(events).toContain('unassign');
  });

  it('detects over-allocation against capacity (ignores cost resources)', () => {
    const mgr = new ResourceManager();
    const api = fakeApi([{ id: 't1' } as TaskModel, { id: 't2' } as TaskModel]);
    mgr.init(api);
    mgr.resourceStore.add(resources());
    // r1 capacity 1 (=100 units). Assign 100 + 75 across two tasks ⇒ 175 > 100.
    mgr.assign('t1', 'r1', 100);
    mgr.assign('t2', 'r1', 75);
    expect(mgr.allocationOf('r1')).toBe(175);
    expect(mgr.isOverAllocated('r1')).toBe(true);
    // r3 capacity 3 (=300 units): 200 is fine.
    mgr.assign('t1', 'r3', 200);
    expect(mgr.isOverAllocated('r3')).toBe(false);
  });

  it('getResourceTasks returns the tasks a resource works on', () => {
    const mgr = new ResourceManager();
    const api = fakeApi([{ id: 't1' } as TaskModel, { id: 't2' } as TaskModel]);
    mgr.init(api);
    mgr.resourceStore.add(resources());
    mgr.assign('t1', 'r1');
    mgr.assign('t2', 'r1');
    expect(mgr.getResourceTasks('r1').map((t) => t.id).sort()).toEqual(['t1', 't2']);
  });

  it('destroy() is idempotent and unhooks', () => {
    const mgr = new ResourceManager();
    const api = fakeApi([{ id: 't1' } as TaskModel]);
    mgr.init(api);
    expect(() => {
      mgr.destroy();
      mgr.destroy();
    }).not.toThrow();
  });

  it('installs as a GanttFeature plugin (init/track)', () => {
    const track = vi.fn();
    const mgr = new ResourceManager({ resources: resources() });
    const api = fakeApi([{ id: 't1' } as TaskModel]);
    api.track = track;
    mgr.init(api);
    expect(track).toHaveBeenCalledTimes(1);
    expect(mgr.name).toBe('resourceManager');
  });

  it('seeds resourceIds from initial assignments on init', () => {
    const mgr = new ResourceManager({
      resources: resources(),
      assignments: [
        { id: 'a1', taskId: 't1', resourceId: 'r1' } as AssignmentModel,
        { id: 'a2', taskId: 't1', resourceId: 'r2' } as AssignmentModel,
      ],
    });
    const api = fakeApi([{ id: 't1' } as TaskModel]);
    mgr.init(api);
    expect(api.getTask('t1')!.resourceIds!.sort()).toEqual(['r1', 'r2']);
  });
});
