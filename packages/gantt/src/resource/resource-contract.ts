/**
 * `@jects/gantt` — RESOURCE CONTRACT (types & interfaces only; no implementation).
 *
 * Sibling to `../contract.ts`. This file freezes the resource-management data
 * layer the way `contract.ts` freezes the scheduling layer: the `Resource` and
 * `Assignment` model shapes, the typed store events, and the resource-side
 * additions to `GanttOptions`/`GanttApi`. It deliberately imports NOTHING that
 * builds DOM or runtime logic — only framework-free types from `@jects/core` and
 * the existing Gantt contract.
 *
 * Bryntum / DHTMLX parity model:
 *   - A `ResourceModel` is a person, a piece of equipment, or a pure cost line. It
 *     carries a working **calendar** (so its availability follows working time), a
 *     **capacity** (max simultaneous units it can supply, default 1 = one FTE), and
 *     an **hourly cost** used by cost rollups.
 *   - An `AssignmentModel` is the many-to-many edge linking ONE task to ONE
 *     resource, carrying the allocation as **units** (a percentage, 100 = full
 *     time) plus a derived **effort share**. A task may have many resources; a
 *     resource may be assigned to many tasks (over-allocation is detectable by
 *     summing a resource's concurrent units > capacity·100).
 *
 * All times are epoch milliseconds (UTC); durations are milliseconds — same as the
 * scheduling contract.
 */

import type { Model, RecordId } from '@jects/core';
import type { DurationMs } from '@jects/timeline-core';
import type { TaskModel } from '../contract.js';

/* ═══════════════════════════════════════════════════════════════════════════
   1. RESOURCE MODEL
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * What kind of resource this is. `work` resources (people) consume calendar
 * time; `material`/`equipment` are consumable/limited; `cost` is a pure money
 * line with no time component (capacity is ignored for cost resources).
 */
export type ResourceType = 'work' | 'equipment' | 'material' | 'cost';

/**
 * A schedulable resource (person / equipment / material / cost). Resources are a
 * FLAT collection (no tree); grouping is done by `group`. The `calendarId` ties a
 * resource's availability to a working-time `CalendarModel` from the scheduling
 * contract, so resource availability honors the same weekends/holidays as tasks.
 */
export interface ResourceModel<Extra extends Model = Model> extends Model {
  /** Stable resource id. */
  id: RecordId;
  /** Display name. */
  name?: string;
  /** Resource kind. Default `'work'`. */
  type?: ResourceType;
  /**
   * Maximum simultaneous capacity in FTE-equivalents. `1` = a single full-time
   * unit (the default). A team of 3 ⇒ `3`. Used to detect over-allocation: a
   * resource is over-allocated when its concurrent assigned units exceed
   * `capacity * 100` (units are a percentage). Ignored for `cost` resources.
   */
  capacity?: number;
  /** Cost per working hour (project currency). Drives cost rollups. */
  hourlyCost?: number;
  /** Calendar id governing this resource's availability (defaults to project cal). */
  calendarId?: string;
  /** Optional grouping bucket (department/role) for the resource view. */
  group?: string;
  /** Optional avatar/image url for the resource view. */
  image?: string;
  /**
   * Maximum allocation in PERCENT used by the simple (units-summed) over-allocation
   * check in the UI assignment store. Defaults to `100` (one full-time unit). This
   * is the percent-expressed twin of `capacity` (`capacity * 100`); when both are
   * set, the assignment-layer reads `maxUnits`. Ignored for `cost` resources.
   */
  maxUnits?: number;
  /* ── display hints (consumed by the resource-view / assignment UI) ──────── */
  /**
   * Initials shown in the avatar chip when no `image` is set. Derived from `name`
   * when omitted (first letter of up to the first two words).
   */
  initials?: string;
  /**
   * Explicit avatar colour token NAME (e.g. `'cmyk-cyan'`), resolved to
   * `oklch(var(--jects-<token>))`. When omitted a deterministic token is chosen
   * from the id so every resource gets a stable, theme-driven colour.
   */
  colorToken?: string;
  /** Role / discipline label (shown in the editor list / chips, optional). */
  role?: string;
  /** Arbitrary consumer fields. */
  data?: Extra;
}

/* ═══════════════════════════════════════════════════════════════════════════
   2. ASSIGNMENT MODEL (task ↔ resource, many-to-many)
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * A single task↔resource link. `units` is the allocation **percentage** the
 * resource gives this task (100 = full time, 50 = half time, 200 = two units of a
 * high-capacity resource). The pair (`taskId`,`resourceId`) is unique — there is
 * at most one assignment per task/resource combination.
 */
export interface AssignmentModel<Extra extends Model = Model> extends Model {
  /** Stable assignment id. */
  id: RecordId;
  /** The task this assignment is for. */
  taskId: RecordId;
  /** The resource being assigned. */
  resourceId: RecordId;
  /**
   * Allocation as a percentage. `100` = full-time on the task. Default `100`.
   * Negative/NaN values are clamped to `0` by the store.
   */
  units?: number;
  /** Arbitrary consumer fields. */
  data?: Extra;
}

/**
 * A derived (read-only) view of an assignment with the resolved resource and the
 * computed share of the task's effort it represents. Produced by the
 * `AssignmentStore`/`ResourceManager`; never stored.
 */
export interface ResolvedAssignment<R extends Model = Model> {
  /** The underlying assignment record. */
  assignment: AssignmentModel;
  /** The resolved resource (if it still exists). */
  resource: ResourceModel<R> | undefined;
  /** This assignment's units. */
  units: number;
  /**
   * This assignment's fraction (0..1) of the total units assigned to the task —
   * i.e. how much of the task's effort this resource shoulders. Equal-units
   * assignments split evenly.
   */
  effortShare: number;
  /** Effort (working ms) this resource contributes, given the task's total effort. */
  effort: DurationMs;
  /** Cost (currency) this resource contributes, given `effort` and `hourlyCost`. */
  cost: number;
}

/* ═══════════════════════════════════════════════════════════════════════════
   3. STORE EVENTS (typed)
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Extra events the `AssignmentStore` emits on top of the base `StoreEvents`:
 * fired whenever the set of assignments touching a particular task/resource
 * changes, so resource views can repaint a single row cheaply.
 */
export interface AssignmentStoreEvents extends Record<string, unknown> {
  /** A task gained or lost an assignment (payload = affected ids). */
  assignmentsChange: { taskId?: RecordId; resourceId?: RecordId };
}

/* ═══════════════════════════════════════════════════════════════════════════
   4. RESOURCE-SIDE GANTT OPTIONS / API EXTENSIONS
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Resource-management options merged into `GanttOptions`. Additive: existing
 * Gantt consumers that pass none get an empty resource layer.
 */
export interface ResourceOptions<R extends Model = Model> {
  /** Resource records (people / equipment / cost). */
  resources?: ResourceModel<R>[];
  /** Assignment records linking tasks↔resources. */
  assignments?: AssignmentModel[];
}

/**
 * The resource-management surface the Gantt exposes to features/consumers. This
 * is the contract every other resource feature (histogram, utilization,
 * allocation editor) builds against — it never reaches into store internals.
 */
export interface ResourceApi<T extends Model = Model, R extends Model = Model> {
  /** All resources. */
  getResources(): ReadonlyArray<ResourceModel<R>>;
  /** A resource by id. */
  getResource(id: RecordId): ResourceModel<R> | undefined;
  /** Resolved assignments for a task (with resource + effort share). */
  getAssignmentsFor(taskId: RecordId): ReadonlyArray<ResolvedAssignment<R>>;
  /** Resolved assignments a resource holds (across all tasks). */
  getAssignmentsOf(resourceId: RecordId): ReadonlyArray<ResolvedAssignment<R>>;
  /** Tasks a resource is assigned to. */
  getResourceTasks(resourceId: RecordId): ReadonlyArray<TaskModel<T>>;
  /**
   * Assign a resource to a task (or update its units if already assigned).
   * Returns the resulting assignment, or `undefined` if vetoed. `units` defaults
   * to 100 (full time).
   */
  assign(taskId: RecordId, resourceId: RecordId, units?: number): AssignmentModel | undefined;
  /** Remove a resource from a task. Returns `true` if an assignment was removed. */
  unassign(taskId: RecordId, resourceId: RecordId): boolean;
  /**
   * Sum of a resource's assigned units across the tasks it works on (a coarse
   * over-allocation signal: `> capacity * 100` ⇒ over-allocated). For a precise
   * per-instant figure the histogram feature intersects task spans.
   */
  allocationOf(resourceId: RecordId): number;
  /** Whether a resource's summed units exceed its capacity (over-allocated). */
  isOverAllocated(resourceId: RecordId): boolean;
}

/** Veto/notify events the resource layer adds to the Gantt event map. */
export interface ResourceEvents<R extends Model = Model> extends Record<string, unknown> {
  /** Vetoable: a resource is about to be assigned to a task. */
  beforeAssign: { taskId: RecordId; resourceId: RecordId; units: number };
  /** A resource was assigned (or its units updated). */
  assign: { assignment: AssignmentModel };
  /** A resource was unassigned from a task. */
  unassign: { taskId: RecordId; resourceId: RecordId };
  /** A resource's data changed. */
  resourceChange: { resource: ResourceModel<R> };
}
