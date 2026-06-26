/**
 * `installResourceLayer` — the additive auto-install seam that wires the resource
 * data layer into a `Gantt` from `GanttOptions`. It is the single integration
 * point the `Gantt` widget calls in `setup()`:
 *
 *   - If a `ResourceManager` is ALREADY installed (the consumer passed one via
 *     `GanttOptions.plugins` or called `gantt.use(new ResourceManager(...))`), it
 *     is adopted as the active `ResourceApi` and nothing new is created — the
 *     consumer's explicit manager wins.
 *   - Otherwise, when `GanttOptions` carries `resources` and/or `assignments`, a
 *     `ResourceManager` is constructed from them and installed via the public
 *     `api.use(...)` seam (so it tracks/disposes with the Gantt like any feature).
 *   - When neither is present the resource layer stays inert and `api.resources`
 *     reads `undefined`.
 *
 * This keeps the wiring contract-pure: it only touches the `GanttApi` (`features`,
 * `use`) and the `ResourceManager` — zero reach into Gantt internals. It is split
 * into its own module so the `Gantt` class hook is a single additive call.
 */

import type { Model } from '@jects/core';
import type { GanttApi } from '../contract.js';
import type { ResourceApi, ResourceOptions } from './resource-contract.js';
import { ResourceManager } from './resource-manager.js';

/** The feature name a `ResourceManager` registers under (its `name` field). */
export const RESOURCE_MANAGER_FEATURE = 'resourceManager';

/**
 * Resolve (and, if needed, auto-install) the resource layer for a Gantt.
 *
 * @param api      the host Gantt's public API (used only for `features`/`use`).
 * @param options  the resource-relevant slice of `GanttOptions`.
 * @returns the active `ResourceApi`, or `undefined` when no resource layer is wired.
 */
export function installResourceLayer<T extends Model = Model, R extends Model = Model>(
  api: GanttApi<T, R>,
  options: ResourceOptions<R>,
): ResourceApi<T, R> | undefined {
  // 1. Adopt an already-installed ResourceManager (consumer-provided plugin).
  const existing = api.features.get(RESOURCE_MANAGER_FEATURE);
  if (existing && isResourceApi<T, R>(existing)) return existing;

  // 2. Auto-install from GanttOptions.resources / .assignments when present.
  const hasResources = Array.isArray(options.resources) && options.resources.length > 0;
  const hasAssignments = Array.isArray(options.assignments) && options.assignments.length > 0;
  if (!hasResources && !hasAssignments) return undefined;

  const manager = new ResourceManager<T, R>({
    ...(options.resources ? { resources: options.resources } : {}),
    ...(options.assignments ? { assignments: options.assignments } : {}),
  });
  // `api.use` runs `manager.init(api)` and tracks `manager.destroy()` on the Gantt.
  api.use(manager);
  return manager;
}

/** Structural guard: a feature that also implements the `ResourceApi` reads. */
function isResourceApi<T extends Model, R extends Model>(
  value: unknown,
): value is ResourceApi<T, R> & { name: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { getResources?: unknown }).getResources === 'function' &&
    typeof (value as { assign?: unknown }).assign === 'function'
  );
}
