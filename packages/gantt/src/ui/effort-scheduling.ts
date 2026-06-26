/**
 * `@jects/gantt` — effort-driven scheduling UI wiring.
 *
 * This module is the UI-side glue that connects the headless
 * {@link EffortDrivenEngine} decorator (in `engine/effort.ts`) into the Gantt's
 * **default engine path**, plus the small presentation helpers the editor and
 * the task-tree column use to surface `effort` / `units`.
 *
 * It is ADDITIVE: it builds NOTHING that the inner scheduling engine doesn't
 * already expose, and exports pure helpers + a type guard the `Gantt` widget
 * uses to decide whether to wrap its engine. The `Gantt` widget wraps its
 * (default or injected) `SchedulingEngine` in an `EffortDrivenEngine` whenever
 * effort-driven scheduling is requested — i.e. the consumer passed `resources`,
 * `assignments`, or any task carries `effort` / `effortDriven`. When wrapped,
 * assigning/unassigning resources or changing units reflows effort-driven
 * durations through the engine and re-propagates to dependents (the wrapper's
 * `assignResource` / `unassignResource` / `setAssignmentUnits`).
 *
 * Units convention here mirrors the engine: a fraction where `1.0` = one
 * full-time resource (100%). `effort` and `duration` are working-ms.
 */

import type { Model, RecordId } from '@jects/core';
import type { DurationMs } from '@jects/timeline-core';
import type { SchedulingEngine, TaskModel, GanttColumnConfig } from '../contract.js';
import {
  EffortDrivenEngine,
  isEffortDriven,
  effortToPersonDays,
  DEFAULT_HOURS_PER_DAY,
  type ResourceModel,
  type AssignmentModel,
  type ResourceAwareEngine,
} from '../engine/effort.js';

export type {
  ResourceModel as EffortResourceModel,
  AssignmentModel as EffortAssignmentModel,
  ResourceAwareEngine,
};

const MS_PER_HOUR = 3_600_000;

/* ═══════════════════════════════════════════════════════════════════════════
   1. ENGINE WIRING
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Structural type guard: is this `SchedulingEngine` resource-aware (i.e. an
 * {@link EffortDrivenEngine}-shaped wrapper)? The Gantt uses this to surface the
 * resource-mutation API only when effort-driven scheduling is active.
 */
export function isResourceAwareEngine<T extends Model = Model>(
  engine: SchedulingEngine<T> | ResourceAwareEngine<T>,
): engine is ResourceAwareEngine<T> {
  const e = engine as Partial<ResourceAwareEngine<T>>;
  return (
    typeof e.assignResource === 'function' &&
    typeof e.unassignResource === 'function' &&
    typeof e.setAssignmentUnits === 'function' &&
    typeof e.getAssignmentsFor === 'function'
  );
}

/**
 * Decide whether a Gantt should run effort-driven scheduling for the given
 * inputs. True when the consumer wired resources/assignments OR any task carries
 * an `effort` value or the `effortDriven` flag — in which case the engine path
 * must read effort. (Passing an already resource-aware engine also counts.)
 */
export function shouldUseEffortScheduling<T extends Model = Model>(input: {
  engine?: SchedulingEngine<T> | ResourceAwareEngine<T>;
  resources?: ReadonlyArray<ResourceModel> | undefined;
  assignments?: ReadonlyArray<AssignmentModel> | undefined;
  tasks: ReadonlyArray<TaskModel<T>>;
}): boolean {
  if (input.engine && isResourceAwareEngine(input.engine)) return true;
  if (input.resources && input.resources.length > 0) return true;
  if (input.assignments && input.assignments.length > 0) return true;
  for (const t of input.tasks) {
    if (isEffortDriven(t)) return true;
    if (typeof t.effort === 'number' && t.effort > 0) return true;
  }
  return false;
}

/**
 * Wrap a base {@link SchedulingEngine} into a resource-aware
 * {@link EffortDrivenEngine}, unless it is already one (idempotent). This is the
 * default-engine-path hook: the Gantt feeds its constructed engine through here
 * when effort-driven scheduling is requested.
 */
export function toEffortDrivenEngine<T extends Model = Model>(
  engine: SchedulingEngine<T> | ResourceAwareEngine<T>,
): ResourceAwareEngine<T> {
  if (isResourceAwareEngine(engine)) return engine;
  return new EffortDrivenEngine<T>(engine);
}

/* ═══════════════════════════════════════════════════════════════════════════
   2. PRESENTATION HELPERS (editor + column)
   ═══════════════════════════════════════════════════════════════════════════ */

/** Round to at most `dp` decimal places, dropping trailing zeros. */
function round(n: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

/**
 * Format a working-ms `effort` as a person-day string for a column / label,
 * e.g. `"8d"` or `"2.5d"`. Empty string when effort is absent.
 */
export function formatEffort(
  effort: DurationMs | undefined,
  hoursPerDay = DEFAULT_HOURS_PER_DAY,
): string {
  if (effort == null || !(effort >= 0)) return '';
  return `${round(effortToPersonDays(effort, hoursPerDay))}d`;
}

/**
 * Format an allocation **percentage** as a units string, e.g. `100` → `"100%"`,
 * `150` → `"150%"`, `0` → `"0%"`. (Units in the engine are percentages where
 * `100` = one full-time resource.) Empty string when units is undefined.
 */
export function formatUnits(unitsPercent: number | undefined): string {
  if (unitsPercent == null || !isFinite(unitsPercent)) return '';
  return `${round(unitsPercent, 0)}%`;
}

/** Convert person-days (editor input) to working-ms effort. */
export function personDaysToEffortMs(
  personDays: number,
  hoursPerDay = DEFAULT_HOURS_PER_DAY,
): DurationMs {
  const h = hoursPerDay > 0 ? hoursPerDay : DEFAULT_HOURS_PER_DAY;
  return Math.max(0, Math.round(personDays * h * MS_PER_HOUR));
}

/**
 * Normalize an allocation percentage the engine accepts (100 = full-time).
 * Clamps NaN/negatives to 0. Identity for valid percentages — provided so call
 * sites that take user "%" input have one obvious entry point.
 */
export function normalizeUnitsPercent(percent: number): number {
  if (!isFinite(percent) || percent < 0) return 0;
  return percent;
}

/**
 * The default task-tree **Effort** column config. Adds the column to a Gantt's
 * `columns` so effort is surfaced in the grid (Bryntum/DHTMLX "effort" column
 * parity). The Gantt's tree renders it via {@link formatEffort}.
 */
export const EFFORT_COLUMN: GanttColumnConfig = {
  field: 'effort',
  header: 'Effort',
  width: 80,
};

/** The default task-tree **Units** column config (assigned allocation %). */
export const UNITS_COLUMN: GanttColumnConfig = {
  field: 'units',
  header: 'Units',
  width: 70,
};

/**
 * Render the text for an effort/units task-tree cell. Returns `undefined` for
 * fields this helper does not own so callers can fall through to their own
 * formatting. `unitsOf` resolves a task's assigned units (Σ) when available.
 */
export function formatEffortCell<T extends Model = Model>(
  field: string,
  task: TaskModel<T>,
  opts?: { hoursPerDay?: number; unitsOf?: (id: RecordId) => number | undefined },
): string | undefined {
  if (field === 'effort') return formatEffort(task.effort, opts?.hoursPerDay);
  if (field === 'units') {
    const u = opts?.unitsOf?.(task.id);
    if (u != null) return formatUnits(u);
    // Fall back to deriving from resourceIds count at 100% each when no engine
    // resolution is available (each assigned resource ≈ one full-time unit).
    const n = task.resourceIds?.length ?? 0;
    return n > 0 ? formatUnits(n * 100) : '';
  }
  return undefined;
}
