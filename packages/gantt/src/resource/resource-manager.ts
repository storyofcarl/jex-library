/**
 * `ResourceManager` — the runtime that wires `ResourceStore` + `AssignmentStore`
 * into the `ResourceApi`, computing the derived figures (effort share, effort,
 * cost) that the resource views need. It is a `GanttFeature` so it installs
 * NON-DESTRUCTIVELY via `gantt.use(new ResourceManager({ resources, assignments }))`
 * or `new Gantt(el, { plugins: [...] })` — zero edits to the `Gantt` class.
 *
 * What it owns:
 *   - the two stores (created from config or injected),
 *   - the `ResourceApi` surface (reads + `assign`/`unassign`),
 *   - keeping each `TaskModel.resourceIds` in sync with its assignments (so the
 *     existing task model field stays authoritative for renderers that read it),
 *   - vetoable `beforeAssign` and notify `assign`/`unassign`/`resourceChange`
 *     events emitted through the host Gantt's emitter.
 *
 * It touches the Gantt ONLY through the public `GanttApi` (`getTask`,
 * `updateTask`, `emit`, `track`) — the contract-pure feature discipline.
 */

import { EventEmitter, type Model, type RecordId } from '@jects/core';
import type { GanttApi, GanttFeature, TaskModel } from '../contract.js';
import {
  type ResourceModel,
  type AssignmentModel,
  type ResolvedAssignment,
  type ResourceApi,
  type ResourceEvents,
  type ResourceOptions,
} from './resource-contract.js';
import { ResourceStore } from './resource-store.js';
import { AssignmentStore, normalizeUnits } from './assignment-store.js';

const MS_PER_HOUR = 3_600_000;
const FULL_UNITS = 100;

export interface ResourceManagerConfig<R extends Model = Model> extends ResourceOptions<R> {
  /** Inject an existing resource store instead of building one from `resources`. */
  resourceStore?: ResourceStore<R>;
  /** Inject an existing assignment store instead of building one from `assignments`. */
  assignmentStore?: AssignmentStore;
  /**
   * Keep each `TaskModel.resourceIds` in sync with assignment changes (default
   * `true`). When the host Gantt's tasks are read-only snapshots, set `false`.
   */
  syncResourceIds?: boolean;
}

export class ResourceManager<T extends Model = Model, R extends Model = Model>
  implements GanttFeature<T>, ResourceApi<T, R>
{
  readonly name = 'resourceManager';

  readonly resourceStore: ResourceStore<R>;
  readonly assignmentStore: AssignmentStore;

  /** Standalone emitter, used when not installed into a Gantt (engine reuse). */
  readonly events = new EventEmitter<ResourceEvents<R>>();

  private api: GanttApi<T> | null = null;
  private readonly syncResourceIds: boolean;
  private disposers: Array<() => void> = [];
  private destroyed = false;

  constructor(config: ResourceManagerConfig<R> = {}) {
    this.resourceStore =
      config.resourceStore ??
      new ResourceStore<R>(config.resources ? { data: config.resources } : {});
    this.assignmentStore =
      config.assignmentStore ??
      new AssignmentStore(config.assignments ? { data: config.assignments } : {});
    this.syncResourceIds = config.syncResourceIds ?? true;
  }

  /* ── GanttFeature ──────────────────────────────────────────────────────── */

  init(api: GanttApi<T>): void {
    this.destroyed = false;
    this.disposers = [];
    this.api = api;
    // Seed task.resourceIds from the initial assignment set.
    if (this.syncResourceIds) {
      const taskIds = new Set<RecordId>();
      for (const a of this.assignmentStore.toArray()) taskIds.add(a.taskId);
      for (const id of taskIds) this.syncTask(id);
    }
    api.track(() => this.destroy());
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const off of this.disposers) {
      try {
        off();
      } catch {
        /* best-effort */
      }
    }
    this.disposers = [];
    this.api = null;
  }

  /* ── ResourceApi: reads ────────────────────────────────────────────────── */

  getResources(): ReadonlyArray<ResourceModel<R>> {
    return this.resourceStore.getResources();
  }

  getResource(id: RecordId): ResourceModel<R> | undefined {
    return this.resourceStore.getById(id);
  }

  getAssignmentsFor(taskId: RecordId): ReadonlyArray<ResolvedAssignment<R>> {
    const assignments = this.assignmentStore.getByTask(taskId);
    return this.resolve(taskId, assignments);
  }

  getAssignmentsOf(resourceId: RecordId): ReadonlyArray<ResolvedAssignment<R>> {
    const assignments = this.assignmentStore.getByResource(resourceId);
    // Resolve each against its own task's total units.
    const out: ResolvedAssignment<R>[] = [];
    for (const a of assignments) {
      const [resolved] = this.resolve(a.taskId, [a]);
      if (resolved) out.push(resolved);
    }
    return out;
  }

  getResourceTasks(resourceId: RecordId): ReadonlyArray<TaskModel<T>> {
    const out: TaskModel<T>[] = [];
    const seen = new Set<RecordId>();
    for (const a of this.assignmentStore.getByResource(resourceId)) {
      if (seen.has(a.taskId)) continue;
      seen.add(a.taskId);
      const task = this.api?.getTask(a.taskId);
      if (task) out.push(task);
    }
    return out;
  }

  /* ── ResourceApi: mutations ────────────────────────────────────────────── */

  assign(taskId: RecordId, resourceId: RecordId, units = FULL_UNITS): AssignmentModel | undefined {
    const u = normalizeUnits(units);
    if (this.emit('beforeAssign', { taskId, resourceId, units: u }) === false) return undefined;
    const assignment = this.assignmentStore.assign(taskId, resourceId, u);
    this.syncTask(taskId);
    this.emit('assign', { assignment });
    return assignment;
  }

  unassign(taskId: RecordId, resourceId: RecordId): boolean {
    const removed = this.assignmentStore.unassign(taskId, resourceId);
    if (!removed) return false;
    this.syncTask(taskId);
    this.emit('unassign', { taskId, resourceId });
    return true;
  }

  /* ── ResourceApi: allocation / over-allocation ─────────────────────────── */

  allocationOf(resourceId: RecordId): number {
    return this.assignmentStore.totalUnitsOf(resourceId);
  }

  isOverAllocated(resourceId: RecordId): boolean {
    const resource = this.resourceStore.getById(resourceId);
    if (!resource || resource.type === 'cost') return false;
    const capacityUnits = (resource.capacity ?? 1) * FULL_UNITS;
    return this.allocationOf(resourceId) > capacityUnits;
  }

  /* ── derivation ────────────────────────────────────────────────────────── */

  /**
   * Resolve a set of a task's assignments into `ResolvedAssignment`s: split the
   * task's effort by units share and price each share against the resource's
   * hourly cost. Pure given the task + resource lookups.
   */
  private resolve(taskId: RecordId, assignments: AssignmentModel[]): ResolvedAssignment<R>[] {
    const task = this.api?.getTask(taskId);
    const taskEffort = effortOf(task);
    // Effort share is each assignment's units over the task's TOTAL units, so
    // multiple resources split the work proportionally (equal units ⇒ even split).
    const totalUnits = assignments.reduce((s, a) => s + normalizeUnits(a.units), 0);
    return assignments.map((assignment) => {
      const units = normalizeUnits(assignment.units);
      const resource = this.resourceStore.getById(assignment.resourceId);
      const effortShare = totalUnits > 0 ? units / totalUnits : 0;
      const effort = taskEffort * effortShare;
      const hourly = resource?.hourlyCost;
      const cost =
        typeof hourly === 'number' && Number.isFinite(hourly)
          ? (effort / MS_PER_HOUR) * hourly
          : 0;
      return { assignment, resource, units, effortShare, effort, cost };
    });
  }

  /** Mirror the task's current resource ids into `TaskModel.resourceIds`. */
  private syncTask(taskId: RecordId): void {
    if (!this.syncResourceIds || !this.api) return;
    const task = this.api.getTask(taskId);
    if (!task) return;
    const ids = this.assignmentStore.resourceIdsOf(taskId);
    // Avoid a redundant engine round-trip if nothing changed.
    if (sameIds(task.resourceIds, ids)) return;
    this.api.updateTask(taskId, { resourceIds: ids } as Partial<TaskModel<T>>);
  }

  /* ── events: route through the host Gantt when installed, else standalone ── */

  private emit<K extends keyof ResourceEvents<R>>(
    event: K,
    payload: ResourceEvents<R>[K],
  ): boolean {
    const local = this.events.emit(event, payload);
    if (this.api) {
      const hostOk = (this.api as unknown as {
        emit(event: string, payload: unknown): boolean;
      }).emit(event as string, payload);
      return local !== false && hostOk !== false;
    }
    return local;
  }

  on<K extends keyof ResourceEvents<R>>(
    event: K,
    fn: (payload: ResourceEvents<R>[K]) => unknown,
  ): () => void {
    return this.events.on(event, fn);
  }
}

/** Read a task's effort (working ms): explicit `effort`, else derived span. */
function effortOf(task: TaskModel | undefined): number {
  if (!task) return 0;
  if (typeof task.effort === 'number' && Number.isFinite(task.effort)) return task.effort;
  if (typeof task.duration === 'number' && Number.isFinite(task.duration)) return task.duration;
  if (typeof task.start === 'number' && typeof task.end === 'number') {
    return Math.max(0, task.end - task.start);
  }
  return 0;
}

function sameIds(a: RecordId[] | undefined, b: RecordId[]): boolean {
  if (!a || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Factory mirroring the other feature creators (e.g. `createMultiBaselineCompare`). */
export function createResourceManager<T extends Model = Model, R extends Model = Model>(
  config?: ResourceManagerConfig<R>,
): ResourceManager<T, R> {
  return new ResourceManager<T, R>(config);
}
