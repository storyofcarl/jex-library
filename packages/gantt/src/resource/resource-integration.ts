/**
 * `@jects/gantt` — RESOURCE INTEGRATION HELPERS (additive, public-surface only).
 *
 * The Gantt widget already auto-installs a {@link ResourceManager} from
 * `GanttOptions.resources`/`.assignments` and decorates its engine with the
 * effort-driven scheduler at construction (see `resource/install.ts` +
 * `ui/gantt.ts`). This module adds two small, NON-destructive conveniences on
 * top of that wiring, both reachable through the public `GanttApi` only:
 *
 *   1. {@link bridgeResourceEffort} — closes the *runtime* effort-reflow gap.
 *      The auto-installed `ResourceManager` mutates the `AssignmentStore` on
 *      `assign`/`unassign`, but a separately-decorated effort engine keeps its
 *      OWN assignment set; without a bridge, assigning a resource at runtime does
 *      not reflow an effort-driven task's duration. This helper subscribes to the
 *      host's `assign`/`unassign`/`resourceChange` events, re-seeds the engine
 *      from the live stores, and reschedules — so adding a second full-time
 *      resource halves an effort-driven duration live (Bryntum/DHTMLX parity).
 *
 *   2. {@link foldResourceApi} — folds the `ResourceApi` reads/mutations onto the
 *      Gantt instance as a typed shorthand (`gantt.assign(t, r, 50)` ≡
 *      `gantt.resources!.assign(t, r, 50)`), returning the host as a typed
 *      {@link ResourceGantt}.
 *
 * {@link installResourceManagement} wires both in one call and is idempotent: it
 * adopts the Gantt-installed manager rather than installing a second one. It also
 * works when the Gantt did NOT auto-install (e.g. resources added later) by
 * installing a manager via the public `use()` seam.
 *
 * Units: both layers use the SAME percentage convention (100 = one FTE), and the
 * engine models are structurally compatible with the resource-layer models, so
 * records feed straight through with no conversion.
 */

import type { Model } from '@jects/core';
import type {
  GanttApi,
  GanttOptions,
  GanttEvents,
  GanttFeature,
  SchedulingEngine,
} from '../contract.js';
import {
  EffortDrivenEngine,
  createEffortDrivenEngine,
  type ResourceAwareEngine,
  type ResourceModel as EngineResource,
  type AssignmentModel as EngineAssignment,
} from '../engine/effort.js';
import { DefaultGanttEngine } from '../ui/default-engine.js';
import { ResourceManager, type ResourceManagerConfig } from './resource-manager.js';
import { RESOURCE_MANAGER_FEATURE } from './install.js';
import type {
  ResourceModel,
  AssignmentModel,
  ResourceApi,
  ResourceEvents,
  ResourceOptions,
} from './resource-contract.js';

/* ═══════════════════════════════════════════════════════════════════════════
   1. PUBLIC SURFACE TYPES
   ═══════════════════════════════════════════════════════════════════════════ */

/** `GanttOptions` plus the resource-management options (additive). */
export type ResourceGanttOptions<T extends Model = Model, R extends Model = Model> =
  GanttOptions<T> & ResourceOptions<R>;

/** A `Gantt` with the `ResourceApi` folded onto it + the manager handle. */
export type ResourceGantt<T extends Model = Model, R extends Model = Model> =
  GanttApi<T> & ResourceApi<T, R> & {
    /** The active resource manager (advanced access to the two stores). */
    readonly resourceManager: ResourceManager<T, R>;
  };

/** The merged event map: Gantt events plus the resource events. */
export type ResourceGanttEvents<T extends Model = Model, R extends Model = Model> =
  GanttEvents<T> & ResourceEvents<R>;

/** Options for {@link installResourceManagement}. */
export interface InstallResourceOptions<R extends Model = Model>
  extends ResourceManagerConfig<R> {
  /**
   * Also fold the `ResourceApi` methods onto the Gantt instance as a shorthand
   * (`gantt.assign(...)`). Default `true`.
   */
  fold?: boolean;
  /**
   * Bridge resource events to the effort engine so runtime assign/unassign
   * reflows effort-driven durations. Default `true`.
   */
  bridge?: boolean;
}

/* ═══════════════════════════════════════════════════════════════════════════
   2. ENGINE FACTORY
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Build an effort-driven, resource-aware engine to pass as `GanttOptions.engine`.
 * Wraps the package `DefaultGanttEngine` by default; pass a custom inner engine
 * (e.g. the CPM `CpmEngine`) to decorate it instead.
 */
export function createResourceGanttEngine<T extends Model = Model>(
  inner?: SchedulingEngine<T>,
): ResourceAwareEngine<T> {
  return createEffortDrivenEngine<T>(inner ?? new DefaultGanttEngine<T>());
}

/** Is this engine the effort-driven, resource-aware decorator? */
export function isResourceAwareEngine<T extends Model = Model>(
  engine: SchedulingEngine<T> | null | undefined,
): engine is ResourceAwareEngine<T> {
  return (
    engine instanceof EffortDrivenEngine ||
    typeof (engine as Partial<ResourceAwareEngine<T>> | null | undefined)?.assignResource ===
      'function'
  );
}

/**
 * Resolve the resource-aware (effort-driven) engine for a Gantt. The Gantt's
 * public `engine` getter unwraps to the BASE scheduler, so when effort
 * scheduling is active the wrapper is reachable via the structural `effortEngine`
 * getter; we probe that first, then fall back to `engine`.
 */
function resolveResourceAwareEngine<T extends Model = Model>(
  gantt: GanttApi<T>,
): ResourceAwareEngine<T> | undefined {
  const probe = (gantt as unknown as { effortEngine?: SchedulingEngine<T> | null }).effortEngine;
  if (isResourceAwareEngine<T>(probe)) return probe;
  const base = gantt.engine as SchedulingEngine<T>;
  return isResourceAwareEngine<T>(base) ? base : undefined;
}

/* ═══════════════════════════════════════════════════════════════════════════
   3. MODEL ADAPTERS (structurally compatible; same percentage convention)
   ═══════════════════════════════════════════════════════════════════════════ */

function toEngineResource(r: ResourceModel): EngineResource {
  const out: EngineResource = { id: r.id };
  if (r.name != null) out.name = r.name;
  if (typeof r.capacity === 'number' && Number.isFinite(r.capacity)) out.capacity = r.capacity;
  if (r.calendarId != null) out.calendarId = r.calendarId;
  if (typeof r.hourlyCost === 'number' && Number.isFinite(r.hourlyCost)) out.hourlyCost = r.hourlyCost;
  return out;
}

function toEngineAssignment(a: AssignmentModel): EngineAssignment {
  const out: EngineAssignment = { id: a.id, taskId: a.taskId, resourceId: a.resourceId };
  if (typeof a.units === 'number' && Number.isFinite(a.units)) out.units = a.units;
  return out;
}

/* ═══════════════════════════════════════════════════════════════════════════
   4. RESOURCE-MANAGER RESOLUTION
   ═══════════════════════════════════════════════════════════════════════════ */

/** The `ResourceManager` the Gantt installed, if any (reachable via `features`). */
export function getResourceManager<T extends Model = Model, R extends Model = Model>(
  gantt: GanttApi<T>,
): ResourceManager<T, R> | undefined {
  const feature = gantt.features.get(RESOURCE_MANAGER_FEATURE);
  return feature instanceof ResourceManager
    ? (feature as ResourceManager<T, R>)
    : undefined;
}

/* ═══════════════════════════════════════════════════════════════════════════
   5. EFFORT-REFLOW BRIDGE
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Per-Gantt record of the installed effort bridge so that {@link bridgeResourceEffort}
 * (and {@link installResourceManagement}, which calls it) are genuinely idempotent.
 * Keyed weakly by the Gantt instance so it never keeps a destroyed Gantt alive.
 * Stores the live disposer so a re-entry returns it instead of attaching a SECOND
 * full set of listeners (which would run reflow()/recalc()/reschedule() twice per
 * assign/unassign and accumulate listeners on every re-install).
 */
const BRIDGED_GANTTS = new WeakMap<object, () => void>();

/**
 * Bridge the resource layer to a resource-aware (effort-driven) engine so that
 * RUNTIME assign/unassign reflows effort-driven task durations. No-op when the
 * host engine is not resource-aware. Idempotent per Gantt: a second call (or a
 * re-install) returns the EXISTING disposer without attaching a second listener
 * set — see {@link BRIDGED_GANTTS}.
 *
 * It seeds the engine from the live stores, then on every `assign`/`unassign`/
 * `resourceChange` re-seeds the assignment set, recalculates, and reschedules so
 * the bars + tree repaint. Returns a disposer (also auto-disposed via the Gantt).
 */
export function bridgeResourceEffort<T extends Model = Model, R extends Model = Model>(
  gantt: GanttApi<T>,
  manager: ResourceManager<T, R> = getResourceManager<T, R>(gantt)!,
): () => void {
  // Idempotency guard: if a bridge is already installed for this Gantt, return
  // its disposer rather than wiring a second listener set (double-reflow bug).
  const existing = BRIDGED_GANTTS.get(gantt as unknown as object);
  if (existing) return existing;

  const engine = resolveResourceAwareEngine<T>(gantt);
  if (!manager || !engine) return () => {};

  const seedResources = (): void =>
    engine.setResources(manager.getResources().map(toEngineResource));
  const seedAssignments = (): void =>
    engine.setAssignments(manager.assignmentStore.toArray().map(toEngineAssignment));

  // Seed once so the engine matches the current model.
  seedResources();
  seedAssignments();

  const reflow = (): void => {
    seedAssignments();
    engine.recalc();
    gantt.reschedule();
  };

  const disposers = [
    gantt.on('assign' as keyof GanttEvents<T>, reflow as never),
    gantt.on('unassign' as keyof GanttEvents<T>, reflow as never),
    gantt.on('resourceChange' as keyof GanttEvents<T>, (() => {
      seedResources();
      reflow();
    }) as never),
    manager.resourceStore.events.on('change', () => {
      seedResources();
    }),
  ];
  let disposed = false;
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    BRIDGED_GANTTS.delete(gantt as unknown as object);
    for (const off of disposers) off();
  };
  BRIDGED_GANTTS.set(gantt as unknown as object, dispose);
  gantt.track(dispose);
  return dispose;
}

/* ═══════════════════════════════════════════════════════════════════════════
   6. FOLD THE ResourceApi ONTO THE GANTT
   ═══════════════════════════════════════════════════════════════════════════ */

const RESOURCE_API_METHODS = [
  'getResources',
  'getResource',
  'getAssignmentsFor',
  'getAssignmentsOf',
  'getResourceTasks',
  'assign',
  'unassign',
  'allocationOf',
  'isOverAllocated',
] as const;

/**
 * Fold the `ResourceApi` reads/mutations onto the Gantt instance as own methods
 * bound to the manager (`gantt.assign(...)`), and expose a `resourceManager`
 * handle. Returns the host typed as {@link ResourceGantt}.
 */
export function foldResourceApi<T extends Model = Model, R extends Model = Model>(
  gantt: GanttApi<T>,
  manager: ResourceManager<T, R>,
): ResourceGantt<T, R> {
  const target = gantt as unknown as Record<string, unknown>;
  const source = manager as unknown as Record<string, ((...args: unknown[]) => unknown) | undefined>;
  for (const name of RESOURCE_API_METHODS) {
    const fn = source[name];
    if (typeof fn !== 'function') continue;
    target[name] = (...args: unknown[]): unknown => fn.apply(manager, args);
  }
  if (!('resourceManager' in target)) {
    Object.defineProperty(target, 'resourceManager', {
      value: manager,
      enumerable: false,
      configurable: true,
    });
  }
  return gantt as unknown as ResourceGantt<T, R>;
}

/* ═══════════════════════════════════════════════════════════════════════════
   7. ONE-CALL INSTALL (adopts the auto-installed manager; idempotent)
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Ensure resource management is fully wired on a Gantt:
 *
 *   1. adopt the Gantt-auto-installed {@link ResourceManager} (from
 *      `GanttOptions.resources`/`.assignments`), or install one via `use()` if
 *      none exists yet (using `options.resources`/`.assignments`),
 *   2. fold the `ResourceApi` onto the instance (`gantt.assign(...)`), and
 *   3. bridge resource events to the effort engine so runtime assign/unassign
 *      reflows effort-driven durations.
 *
 * Idempotent: a second call returns the same surface without double-wiring.
 *
 * @returns the host typed as {@link ResourceGantt}.
 */
export function installResourceManagement<T extends Model = Model, R extends Model = Model>(
  gantt: GanttApi<T>,
  options: InstallResourceOptions<R> = {},
): ResourceGantt<T, R> {
  let manager = getResourceManager<T, R>(gantt);

  if (!manager) {
    const config: ResourceManagerConfig<R> = {};
    if (options.resources) config.resources = options.resources;
    if (options.assignments) config.assignments = options.assignments;
    if (options.resourceStore) config.resourceStore = options.resourceStore;
    if (options.assignmentStore) config.assignmentStore = options.assignmentStore;
    if (options.syncResourceIds != null) config.syncResourceIds = options.syncResourceIds;
    manager = new ResourceManager<T, R>(config);
    (gantt.use as (f: GanttFeature<T>) => GanttFeature<T>)(manager as unknown as GanttFeature<T>);
  }

  if (options.fold !== false) foldResourceApi<T, R>(gantt, manager);
  if (options.bridge !== false) bridgeResourceEffort<T, R>(gantt, manager);

  return gantt as unknown as ResourceGantt<T, R>;
}

/* ═══════════════════════════════════════════════════════════════════════════
   8. CONVENIENCE — resource-aware Gantt options
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Normalize {@link ResourceGanttOptions} into base `GanttOptions` (injecting an
 * effort-driven engine when none was supplied) plus an `install` closure that
 * folds + bridges once the Gantt is constructed.
 *
 *   const { options, install } = withResources({ tasks, resources, assignments });
 *   const gantt = new Gantt(el, options);
 *   const api = install(gantt);
 */
export function withResources<T extends Model = Model, R extends Model = Model>(
  opts: ResourceGanttOptions<T, R>,
): {
  options: ResourceGanttOptions<T, R>;
  install: (gantt: GanttApi<T>) => ResourceGantt<T, R>;
} {
  const options: ResourceGanttOptions<T, R> = {
    ...opts,
    engine: opts.engine ?? createResourceGanttEngine<T>(),
  };
  return {
    options,
    install: (gantt: GanttApi<T>) => installResourceManagement<T, R>(gantt, {}),
  };
}
