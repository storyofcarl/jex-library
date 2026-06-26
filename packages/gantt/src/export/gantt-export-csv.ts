/**
 * `GanttExportCsv` — wires the orphaned task-grid CSV export
 * ({@link tasksToCsv} / {@link serializeTasks}) onto the live `Gantt` widget.
 *
 * The pure serializer + RFC-4180 writer ({@link ./serialize.ts}, {@link
 * ./export-csv.ts}) are framework-free: they take a `TaskTreeSource` plus two
 * resolver callbacks (`predecessorsOf` / `resourcesOf`) so they never reach into
 * the scheduling engine or the resource layer themselves. This feature is the
 * MISSING bridge: it supplies those resolvers from the live engine + assignment
 * store, walks the *current* (scheduled) task tree through the public `GanttApi`,
 * and exposes the result as `gantt.exportCsv()` — bringing the CSV export onto
 * the public parity surface (matching Bryntum/DHTMLX "export to CSV").
 *
 * Design (concurrency-safe, contract-pure — mirrors the Progress-line/Indicators
 * features):
 *   - It is a `GanttFeature`: installed via `gantt.use(new GanttExportCsv())` or
 *     `new Gantt(el, { plugins: [new GanttExportCsv()] })`. It touches ONLY the
 *     public `GanttApi` (engine reads, `getConfig().tasks` for tree structure,
 *     `gantt.resources` for assignment labels, `getDependenciesFor` for
 *     predecessor notation, events, `track`). It never edits the Gantt class, the
 *     timeline renderer, or the package barrel.
 *   - The tree SOURCE comes from the original `tasks` config (for the parent⇄child
 *     STRUCTURE + outline order) but every node is re-resolved through the engine
 *     (`api.getTask(id)`) so the exported start/end/duration/percentDone reflect
 *     the CURRENT schedule, not the stale construction-time values.
 *   - `predecessorsOf` renders the standard Gantt predecessor notation
 *     (`"2FS+1d, 3SS"`) from the live dependency set; `resourcesOf` renders the
 *     assigned resources (`"Alice [50%], Bob"`) from the live `ResourceApi`.
 *   - Everything is DOM-free up to the optional `download()` helper, which is the
 *     only browser-touching path (a transient `<a download>` blob click).
 *
 * All times are epoch milliseconds (UTC), matching the rest of the Gantt contract.
 */

import type { Model, RecordId } from '@jects/core';
import type { GanttApi, GanttFeature, TaskModel, DependencyModel } from '../contract.js';
import {
  tasksToCsv,
  type CsvExportOptions,
} from './export-csv.js';
import {
  serializeTasks,
  type ExportColumn,
  type ExportTable,
  type TaskTreeSource,
} from './serialize.js';

const MS_PER_DAY = 86_400_000;

/* ═══════════════════════════════════════════════════════════════════════════
   1. CONFIG
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Configuration for {@link GanttExportCsv}. Extends the pure
 * {@link CsvExportOptions} (delimiter / eol / bom / indent / columns /
 * includeSummaryRows) — but the two resolver callbacks (`predecessorsOf` /
 * `resourcesOf`) are SUPPLIED by the feature from the live model, so callers
 * normally never set them. A caller MAY still override either to customise the
 * rendered notation.
 */
export interface GanttExportCsvConfig<T extends Model = Model>
  extends CsvExportOptions<T> {
  /**
   * Default filename used by {@link GanttExportCsv.download} when none is passed.
   * Default `"gantt.csv"`.
   */
  fileName?: string;
  /**
   * Working hours/day used to convert effort-ms → person-days in the Effort
   * column. When omitted the feature reads it from the live engine (if it exposes
   * `getHoursPerDay()`), else falls back to the serializer default (8).
   */
  hoursPerDay?: number;
}

const DEFAULT_FILE_NAME = 'gantt.csv';

/* ═══════════════════════════════════════════════════════════════════════════
   2. LIVE-MODEL ADAPTERS (engine + resource layer → serializer inputs)
   ═══════════════════════════════════════════════════════════════════════════ */

/** A node in the structural tree the feature walks (id + nested children). */
interface StructNode<T extends Model> extends TaskModel<T> {
  children?: StructNode<T>[];
}

/**
 * Build a {@link TaskTreeSource} that preserves the original parent⇄child
 * STRUCTURE/order from the construction-time `tasks` config, but resolves every
 * node's live fields through `api.getTask(id)` so the export reflects the CURRENT
 * schedule. Accepts either the nested `children` form or a flat `parentId` array
 * (both are valid `GanttOptions.tasks` shapes).
 */
function buildLiveTreeSource<T extends Model>(
  api: GanttApi<T>,
  tasksConfig: unknown,
): TaskTreeSource<T> {
  const roots = normalizeRoots<T>(tasksConfig);

  // Resolve a structural node to its live engine task (falling back to the
  // structural record if the engine has dropped it), keeping the structural
  // children for the walk.
  const live = (node: StructNode<T>): StructNode<T> => {
    const current = api.getTask(node.id);
    const base = (current ?? node) as TaskModel<T>;
    return { ...base, children: node.children } as StructNode<T>;
  };

  const liveRoots = roots.map(live);

  return {
    items: liveRoots,
    getChildren(node) {
      if (typeof node !== 'object') return [];
      const kids = (node as StructNode<T>).children ?? [];
      return kids.map(live);
    },
  };
}

/**
 * Normalize the `GanttOptions.tasks` value (a `TreeStore`, a nested-children
 * array, or a flat `parentId` array) into nested root nodes. We read the SHAPE
 * only — live values are re-resolved per node — so a structural copy is fine.
 */
function normalizeRoots<T extends Model>(tasksConfig: unknown): StructNode<T>[] {
  // A `@jects/core` TreeStore exposes `items` (roots) + `getChildren`.
  if (
    tasksConfig &&
    typeof tasksConfig === 'object' &&
    'getItems' in tasksConfig &&
    typeof (tasksConfig as { getItems?: unknown }).getItems === 'function'
  ) {
    const store = tasksConfig as unknown as {
      items?: ReadonlyArray<StructNode<T>>;
      getChildren(node: StructNode<T> | RecordId): ReadonlyArray<StructNode<T>>;
    };
    const fromStore = (node: StructNode<T>): StructNode<T> => ({
      ...node,
      children: store.getChildren(node).map(fromStore),
    });
    return (store.items ?? []).map(fromStore);
  }

  const arr = Array.isArray(tasksConfig) ? (tasksConfig as StructNode<T>[]) : [];
  if (arr.length === 0) return [];

  // Nested-children form: at least one node carries a `children` array.
  const hasNested = arr.some((t) => Array.isArray(t.children) && t.children.length > 0);
  if (hasNested) {
    return arr.filter((t) => t.parentId == null);
  }

  // Flat parentId form: rebuild the nesting.
  const byId = new Map<RecordId, StructNode<T>>();
  for (const t of arr) byId.set(t.id, { ...t, children: [] });
  const roots: StructNode<T>[] = [];
  for (const t of byId.values()) {
    const parentId = (t.parentId ?? null) as RecordId | null;
    if (parentId != null && byId.has(parentId)) {
      byId.get(parentId)!.children!.push(t);
    } else {
      roots.push(t);
    }
  }
  return roots;
}

/**
 * Render a task's predecessors as the standard Gantt notation (`"2FS+1d, 3SS"`)
 * from the live dependency set. FS links omit the type suffix (the implicit
 * default); a non-zero lag is rendered as a `±Nd` working-day offset.
 */
function predecessorsLabel<T extends Model>(api: GanttApi<T>, taskId: RecordId): string {
  const labels: string[] = [];
  for (const d of api.getDependenciesFor(taskId) as ReadonlyArray<DependencyModel>) {
    if (d.toId !== taskId || d.active === false) continue;
    const lag =
      d.lag != null && d.lag !== 0
        ? `${d.lag >= 0 ? '+' : '-'}${Math.abs(Math.round(d.lag / MS_PER_DAY))}d`
        : '';
    const type = d.type && d.type !== 'FS' ? d.type : '';
    labels.push(`${d.fromId}${type}${lag}`);
  }
  return labels.join(', ');
}

/**
 * Render a task's assigned resources as a comma-joined label (`"Alice [50%],
 * Bob"`) from the live `ResourceApi`. A non-full-time (`≠ 100`) allocation is
 * annotated with its units percentage. Returns `""` when no resource layer is
 * wired (the serializer then falls back to the task's `resourceIds` count).
 */
function resourcesLabel<T extends Model>(api: GanttApi<T>, taskId: RecordId): string {
  const resources = api.resources;
  if (!resources) return '';
  const parts: string[] = [];
  for (const ra of resources.getAssignmentsFor(taskId)) {
    const name = ra.resource?.name ?? String(ra.resource?.id ?? ra.assignment.resourceId);
    const units = Math.round(ra.units);
    parts.push(units !== 100 ? `${name} [${units}%]` : name);
  }
  return parts.join(', ');
}

/* ═══════════════════════════════════════════════════════════════════════════
   3. THE FEATURE
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Wires the CSV export onto the Gantt. After install, `gantt.exportCsv()` returns
 * the project task-grid as an RFC-4180 CSV string, and `gantt.exportCsvDownload()`
 * triggers a browser download. The resolvers are supplied automatically from the
 * live engine + resource layer; per-call options can override columns, delimiter,
 * eol, bom, indent, and summary inclusion.
 */
export class GanttExportCsv<T extends Model = Model> implements GanttFeature<T> {
  readonly name = 'exportCsv';

  private readonly config: GanttExportCsvConfig<T>;
  private api: GanttApi<T> | null = null;
  private destroyed = false;

  constructor(config: GanttExportCsvConfig<T> = {}) {
    this.config = { ...config };
  }

  /* ── GanttFeature lifecycle ────────────────────────────────────────────── */

  init(api: GanttApi<T>): void {
    this.destroyed = false;
    this.api = api;

    // Expose the export methods on the live Gantt instance (additive — does not
    // shadow any existing member). Cast at the seam; the methods are typed below.
    const host = api as unknown as {
      exportCsv?: (options?: CsvExportOptions<T>) => string;
      exportCsvTable?: (options?: CsvExportOptions<T>) => ExportTable;
      exportCsvDownload?: (fileName?: string, options?: CsvExportOptions<T>) => void;
    };
    host.exportCsv = (options) => this.toCsv(options);
    host.exportCsvTable = (options) => this.toTable(options);
    host.exportCsvDownload = (fileName, options) => this.download(fileName, options);

    api.track(() => this.destroy());
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.api) {
      const host = this.api as unknown as Record<string, unknown>;
      delete host.exportCsv;
      delete host.exportCsvTable;
      delete host.exportCsvDownload;
    }
    this.api = null;
  }

  /* ── public API (also surfaced on the Gantt instance) ──────────────────── */

  /** Resolved serializer options merged from config + per-call options + resolvers. */
  private resolveOptions(options?: CsvExportOptions<T>): CsvExportOptions<T> {
    const api = this.requireApi();
    const merged: CsvExportOptions<T> = { ...this.config, ...options };
    // Always (re)bind the live resolvers unless the caller explicitly overrode them.
    if (merged.predecessorsOf === undefined) {
      merged.predecessorsOf = (id) => predecessorsLabel(api, id);
    }
    if (merged.resourcesOf === undefined) {
      merged.resourcesOf = (id) => resourcesLabel(api, id);
    }
    if (merged.hoursPerDay === undefined) {
      const hpd = (api.engine as { getHoursPerDay?: () => number }).getHoursPerDay?.();
      if (hpd != null && Number.isFinite(hpd)) merged.hoursPerDay = hpd;
    }
    return merged;
  }

  /** Build the live tree source from the construction-time config + engine. */
  private source(): TaskTreeSource<T> {
    const api = this.requireApi();
    const tasksConfig = (api as unknown as { getConfig?: () => { tasks?: unknown } })
      .getConfig?.().tasks;
    return buildLiveTreeSource(api, tasksConfig);
  }

  /**
   * Serialize the current project task grid to a writer-neutral {@link
   * ExportTable} (columns + resolved rows, hierarchy/WBS preserved). Useful when a
   * caller wants to feed another writer (XLSX) the same resolved table.
   */
  toTable(options?: CsvExportOptions<T>): ExportTable {
    return serializeTasks(this.source(), this.resolveOptions(options));
  }

  /**
   * Serialize the current project task grid to an RFC-4180 CSV string. Resolvers
   * (predecessors / resources / hours-per-day) are bound from the live model.
   */
  toCsv(options?: CsvExportOptions<T>): string {
    return tasksToCsv(this.source(), this.resolveOptions(options));
  }

  /**
   * Trigger a browser download of the CSV (a transient `<a download>` blob click).
   * No-op outside a DOM environment. Returns nothing; the CSV bytes are the same
   * as {@link toCsv}.
   */
  download(fileName?: string, options?: CsvExportOptions<T>): void {
    const csv = this.toCsv(options);
    const name = fileName ?? this.config.fileName ?? DEFAULT_FILE_NAME;
    if (typeof document === 'undefined' || typeof URL?.createObjectURL !== 'function') {
      return;
    }
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.style.display = 'none';
    document.body.append(a);
    a.click();
    a.remove();
    // Revoke on the next tick so the click has dispatched (guarded: some
    // environments expose `createObjectURL` without `revokeObjectURL`).
    setTimeout(() => {
      if (typeof URL?.revokeObjectURL === 'function') URL.revokeObjectURL(url);
    }, 0);
  }

  private requireApi(): GanttApi<T> {
    if (!this.api || this.destroyed) {
      throw new Error('[GanttExportCsv] not installed on a Gantt (call gantt.use(...) first).');
    }
    return this.api;
  }
}

/**
 * Convenience factory mirroring the other Gantt feature creators
 * (`createProgressLine`, `createMultiBaselineCompare`).
 */
export function createGanttExportCsv<T extends Model = Model>(
  config?: GanttExportCsvConfig<T>,
): GanttExportCsv<T> {
  return new GanttExportCsv<T>(config);
}

/**
 * Augment the `Gantt` instance type with the methods this feature installs, so
 * `gantt.exportCsv()` type-checks for consumers that install the feature. The
 * methods are present only AFTER `gantt.use(new GanttExportCsv())`.
 */
declare module '../contract.js' {
  interface GanttApi<T extends Model> {
    /** Serialize the project task grid to RFC-4180 CSV (after `GanttExportCsv` install). */
    exportCsv?(options?: CsvExportOptions<T>): string;
    /** Serialize the project task grid to a writer-neutral table (after install). */
    exportCsvTable?(options?: CsvExportOptions<T>): ExportTable;
    /** Download the project task grid as a CSV file (after install). */
    exportCsvDownload?(fileName?: string, options?: CsvExportOptions<T>): void;
  }
}

/** Re-export the supplied column shape for callers customising the export. */
export type { ExportColumn };
