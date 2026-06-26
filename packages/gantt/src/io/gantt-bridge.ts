/**
 * `@jects/gantt` — MS Project (MSPDI) ⇄ Gantt glue.
 *
 * `io/msproject.ts` is a pure, framework-free MSPDI XML codec: it turns a
 * {@link MsProjectBundle} into MS Project XML and back. What it deliberately does
 * NOT do is touch the `Gantt` widget — it is a data codec, not UI. This module is
 * the missing seam between that codec and the live component:
 *
 *   - {@link fromMsProject} — build {@link GanttOptions} from an imported
 *     `MsProjectBundle` (or directly from raw MSPDI/`.mpp`-XML text), so
 *     `new Gantt(el, fromMsProject(bundle))` reconstructs the project (tasks +
 *     WBS tree + dependencies + lag + calendars + constraints + resources +
 *     assignments) exactly as MS Project authored it.
 *   - {@link toMsProject} — gather a `MsProjectBundle` out of a *live* `Gantt`
 *     (reading only its PUBLIC `GanttApi` surface — engine task spans, the
 *     dependency set, the resolved config calendars, and the resource layer), so
 *     `exportMsProject(toMsProject(gantt))` produces XML MS Project opens.
 *   - {@link importMsProjectAsOptions} / {@link ganttToMsProjectXml} — the two
 *     one-call round-trip conveniences that bracket the public codec functions.
 *
 * Discipline (matches `export/` and `resource/install.ts`): this module reaches
 * into the `Gantt` ONLY through the frozen `GanttApi` contract — it never imports
 * the concrete `Gantt` class, builds no DOM, and registers nothing. That keeps it
 * additive and side-effect-free, and lets it live alongside the codec without
 * coupling to the widget's internals.
 *
 * All times are epoch ms (UTC); durations are working ms — the scheduling
 * contract's units, identical to the codec's.
 */

import type { Model, RecordId } from '@jects/core';
import type {
  GanttApi,
  GanttOptions,
  TaskModel,
  DependencyModel,
  CalendarModel,
  Baseline,
} from '../contract.js';
import type {
  ResourceModel,
  AssignmentModel,
  ResourceApi,
} from '../resource/resource-contract.js';
import {
  importMsProject,
  importMsProjectFile,
  exportMsProject,
  type MsProjectBundle,
  type MsProjectImportOptions,
  type MsProjectImportWarning,
  type MsProjectExportOptions,
} from './msproject.js';

/* ═══════════════════════════════════════════════════════════════════════════
   1. BUNDLE → GanttOptions
   ═══════════════════════════════════════════════════════════════════════════ */

/** Tuning for {@link fromMsProject}. */
export interface FromMsProjectOptions<T extends Model = Model, R extends Model = Model> {
  /**
   * Extra `GanttOptions` to shallow-merge OVER the ones derived from the bundle
   * (e.g. `columns`, `treeWidth`, `preset`, `plugins`). Bundle-derived data
   * fields (`tasks`/`dependencies`/`calendars`/`resources`/`assignments`/
   * `projectStart`/`defaultCalendarId`) win unless overridden here.
   */
  overrides?: Partial<GanttOptions<T, R>>;
}

/**
 * Build {@link GanttOptions} from an imported {@link MsProjectBundle}.
 *
 * The bundle's flat task list already carries `parentId` (the codec reconstructs
 * the WBS tree from `OutlineLevel`), so it is passed straight through as the
 * `tasks` array — the `Gantt` widget builds its `TreeStore` from it. Dependencies
 * (with FS/SS/FF/SF type + lag), calendars, the default calendar id, the project
 * start anchor, resources, and assignments all map 1:1 onto the corresponding
 * `GanttOptions` fields. Baselines are NOT a construction option (the engine
 * captures them at runtime); they are surfaced separately via the bundle.
 *
 * The result is a plain options object — feed it to `new Gantt(el, options)`.
 */
export function fromMsProject<T extends Model = Model, R extends Model = Model>(
  bundle: MsProjectBundle<T, R>,
  options: FromMsProjectOptions<T, R> = {},
): GanttOptions<T, R> {
  const defaultCalendarId =
    bundle.defaultCalendarId ?? bundle.calendars[0]?.id ?? undefined;

  const opts: GanttOptions<T, R> = {
    // Pass the flat task list through — `parentId` already encodes the tree.
    tasks: bundle.tasks.map((t) => ({ ...t })),
    dependencies: bundle.dependencies.map((d) => ({ ...d })),
    calendars: bundle.calendars.map((c) => ({ ...c })),
  };

  if (defaultCalendarId !== undefined) opts.defaultCalendarId = defaultCalendarId;
  if (bundle.projectStart !== undefined) opts.projectStart = bundle.projectStart;
  if (bundle.resources.length) opts.resources = bundle.resources.map((r) => ({ ...r }));
  if (bundle.assignments.length) {
    opts.assignments = bundle.assignments.map((a) => ({ ...a }));
  }

  return options.overrides ? { ...opts, ...options.overrides } : opts;
}

/**
 * One-call import: parse MSPDI XML (or `.mpp`-as-XML) text straight into
 * {@link GanttOptions} plus the import warnings and the underlying bundle.
 *
 * Binary `.mpp` (OLE2) is rejected by {@link importMsProjectFile} with a clear
 * error — re-export from MS Project as XML first. Malformed XML does NOT throw:
 * it yields empty options and a `malformedXml` warning (the codec is tolerant),
 * so a UI can surface the problem without a crash.
 */
export function importMsProjectAsOptions<T extends Model = Model, R extends Model = Model>(
  xml: string,
  options: FromMsProjectOptions<T, R> & { import?: MsProjectImportOptions } = {},
): {
  options: GanttOptions<T, R>;
  warnings: MsProjectImportWarning[];
  bundle: MsProjectBundle<T, R>;
} {
  const { bundle, warnings } = importMsProjectFile<T, R>(xml, options.import);
  const ganttOptions = fromMsProject<T, R>(bundle, options);
  return { options: ganttOptions, warnings, bundle };
}

/* ═══════════════════════════════════════════════════════════════════════════
   2. live Gantt → BUNDLE
   ═══════════════════════════════════════════════════════════════════════════ */

/** The subset of a live `Gantt`'s resolved config {@link toMsProject} reads. */
interface GanttConfigSnapshot<R extends Model> {
  tasks: unknown;
  dependencies?: DependencyModel[];
  calendars?: CalendarModel[];
  defaultCalendarId?: string;
  projectStart?: number;
  resources?: ResourceModel<R>[];
  assignments?: AssignmentModel[];
  name?: string;
}

/** A live `Gantt` as seen by {@link toMsProject}: the public API + `getConfig`. */
export type LiveGantt<T extends Model = Model, R extends Model = Model> = GanttApi<T, R> & {
  getConfig(): Readonly<GanttOptions<T, R>>;
};

/** Tuning for {@link toMsProject}. */
export interface ToMsProjectOptions {
  /**
   * Captured baselines to embed in the bundle. The live `GanttApi` exposes no
   * enumerator for previously-captured baselines (capture returns the snapshot to
   * the caller), so pass the baselines you wish to round-trip here. Defaults to
   * none.
   */
  baselines?: Baseline[];
  /** Project name override (otherwise the resolved config name, if any). */
  name?: string;
}

/** A minimal "has getItems()" duck-type for a `TreeStore`. */
function hasGetItems<T>(x: unknown): x is { getItems(): T[] } {
  return (
    typeof x === 'object' &&
    x !== null &&
    typeof (x as { getItems?: unknown }).getItems === 'function'
  );
}

/**
 * Resolve the flat task list from a config `tasks` value, which may be either a
 * `TreeStore` (`.getItems()` → flat depth-first) or a plain array.
 */
function resolveTaskList<T extends Model>(tasks: unknown): TaskModel<T>[] {
  if (hasGetItems<TaskModel<T>>(tasks)) return tasks.getItems().slice();
  if (Array.isArray(tasks)) return tasks.slice() as TaskModel<T>[];
  return [];
}

/**
 * Gather a {@link MsProjectBundle} out of a LIVE `Gantt`, reading only its public
 * `GanttApi` surface so it is decoupled from the widget's internals.
 *
 *   - **Tasks** come from the resolved config's task list (which preserves the
 *     authored WBS order + `parentId`), each refreshed with the engine's CURRENT
 *     start/end/duration/percentDone — i.e. the post-scheduling spans, not the
 *     stale authored ones — so an export reflects what is on screen.
 *   - **Dependencies** are de-duplicated by id across every task's
 *     `getDependenciesFor`, recovering the full link set from the per-task reads.
 *   - **Calendars / default calendar / project start / name** come from the
 *     resolved config.
 *   - **Resources / assignments** come from the resource layer (`gantt.resources`)
 *     when one is wired, falling back to the resolved config otherwise. The
 *     resource layer is the source of truth for live edits.
 *   - **Baselines** are taken from {@link ToMsProjectOptions.baselines} (the API
 *     has no enumerator — capture hands them back to the caller).
 *
 * The returned bundle feeds {@link exportMsProject} (or {@link ganttToMsProjectXml}).
 */
export function toMsProject<T extends Model = Model, R extends Model = Model>(
  gantt: LiveGantt<T, R>,
  options: ToMsProjectOptions = {},
): MsProjectBundle<T, R> {
  const cfg = gantt.getConfig() as unknown as GanttConfigSnapshot<R>;

  /* ── tasks: authored order, live spans ─────────────────────────────────── */
  const baseTasks = resolveTaskList<T>(cfg.tasks);
  const tasks: TaskModel<T>[] = baseTasks.map((t) => {
    const live = gantt.getTask(t.id);
    if (!live) return { ...t };
    // Live engine spans win; keep authored metadata (name/constraint/calendar/…).
    const merged: TaskModel<T> = { ...t, ...live };
    return merged;
  });

  /* ── dependencies: dedupe across per-task reads ────────────────────────── */
  const depById = new Map<RecordId, DependencyModel>();
  for (const t of tasks) {
    for (const d of gantt.getDependenciesFor(t.id)) {
      if (!depById.has(d.id)) depById.set(d.id, { ...d });
    }
  }
  // Also fold in any config-declared deps (covers links whose endpoints both
  // fell outside the resolved task list, e.g. a filtered view).
  for (const d of cfg.dependencies ?? []) {
    if (!depById.has(d.id)) depById.set(d.id, { ...d });
  }
  const dependencies = [...depById.values()];

  /* ── calendars / project metadata ──────────────────────────────────────── */
  const calendars: CalendarModel[] = (cfg.calendars ?? []).map((c) => ({ ...c }));

  /* ── resources + assignments: prefer the live resource layer ───────────── */
  const { resources, assignments } = gatherResources<T, R>(gantt.resources, cfg);

  const bundle: MsProjectBundle<T, R> = {
    tasks,
    dependencies,
    calendars,
    resources,
    assignments,
    baselines: options.baselines ? options.baselines.slice() : [],
  };

  const name = options.name ?? cfg.name;
  if (name !== undefined) bundle.name = name;
  if (cfg.projectStart !== undefined) bundle.projectStart = cfg.projectStart;

  const defaultCalendarId = cfg.defaultCalendarId ?? calendars[0]?.id;
  if (defaultCalendarId !== undefined) bundle.defaultCalendarId = defaultCalendarId;

  return bundle;
}

/**
 * Resolve resources + assignments, preferring the live resource layer
 * (`gantt.resources`) and falling back to the resolved config. The resource API
 * exposes resources directly and assignments only per-resource, so assignments
 * are gathered by walking each resource and de-duplicating by id.
 */
function gatherResources<T extends Model, R extends Model>(
  api: ResourceApi<T, R> | undefined,
  cfg: GanttConfigSnapshot<R>,
): { resources: ResourceModel<R>[]; assignments: AssignmentModel[] } {
  if (api) {
    const resources = api.getResources().map((r) => ({ ...r }));
    const asgById = new Map<RecordId, AssignmentModel>();
    for (const r of resources) {
      for (const resolved of api.getAssignmentsOf(r.id)) {
        const a = resolved.assignment;
        if (!asgById.has(a.id)) asgById.set(a.id, { ...a });
      }
    }
    return { resources, assignments: [...asgById.values()] };
  }
  return {
    resources: (cfg.resources ?? []).map((r) => ({ ...r })),
    assignments: (cfg.assignments ?? []).map((a) => ({ ...a })),
  };
}

/**
 * One-call export: gather a live `Gantt` into a bundle and serialise it to MSPDI
 * XML in a single step. Pass-through for {@link exportMsProject} options
 * (`pretty`, `hoursPerDay`, `name`).
 */
export function ganttToMsProjectXml<T extends Model = Model, R extends Model = Model>(
  gantt: LiveGantt<T, R>,
  options: ToMsProjectOptions & MsProjectExportOptions = {},
): string {
  const bundle = toMsProject<T, R>(gantt, options);
  return exportMsProject<T, R>(bundle, options);
}

/* ═══════════════════════════════════════════════════════════════════════════
   3. round-trip helper (bundle → xml → bundle), useful in tests + tooling
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Round-trip a bundle through MSPDI XML and back — `import(export(bundle))`.
 * Handy for verifying losslessness and for normalising a hand-built bundle to the
 * codec's canonical shape (stable UIDs, derived ends, etc.).
 */
export function roundTripMsProject<T extends Model = Model, R extends Model = Model>(
  bundle: MsProjectBundle<T, R>,
  exportOptions?: MsProjectExportOptions,
  importOptions?: MsProjectImportOptions,
): { xml: string; bundle: MsProjectBundle<T, R>; warnings: MsProjectImportWarning[] } {
  const xml = exportMsProject<T, R>(bundle, exportOptions);
  const { bundle: reimported, warnings } = importMsProject<T, R>(xml, importOptions);
  return { xml, bundle: reimported, warnings };
}
