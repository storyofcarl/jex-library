/**
 * `GanttExportXlsx` — wires the task-grid **Excel (XLSX) export**
 * ({@link tasksToXlsx} / {@link serializeTasks}) onto the live `Gantt` widget,
 * surfacing it as `gantt.exportXlsx()`.
 *
 * The pure serializer + OOXML writer ({@link ./serialize.ts}, {@link
 * ./export-xlsx.ts}, {@link ./zip.ts}) are framework-free: they take a
 * {@link TaskTreeSource} plus two resolver callbacks (`predecessorsOf` /
 * `resourcesOf`) so they never reach into the scheduling engine or the resource
 * layer themselves. This feature is the bridge: it supplies those resolvers from
 * the live engine + assignment store, walks the *current* (scheduled) task tree
 * through the public `GanttApi`, and exposes the result as `gantt.exportXlsx()` —
 * bringing the Excel export onto the public parity surface (matching the
 * Bryntum/DHTMLX "export to Excel" behaviour). It is the XLSX twin of
 * `GanttExportCsv`, sharing the exact same live-model resolver wiring so the two
 * exports are byte-for-byte consistent column-for-column.
 *
 * Design (concurrency-safe, contract-pure — mirrors `GanttExportCsv` and the
 * Progress-line / Indicators features):
 *   - It is a `GanttFeature`: installed via `gantt.use(new GanttExportXlsx())` or
 *     `new Gantt(el, { plugins: [new GanttExportXlsx()] })`. It touches ONLY the
 *     public `GanttApi` (engine reads, `getConfig().tasks` for tree STRUCTURE,
 *     `gantt.resources` for assignment labels, `getDependenciesFor` for
 *     predecessor notation, `track` for disposal). It never edits the Gantt
 *     class, the timeline renderer, the contract, or the package barrel.
 *   - The tree SOURCE comes from the original `tasks` config (for the parent⇄child
 *     STRUCTURE + outline order) but every node is re-resolved through the engine
 *     (`api.getTask(id)`) so the exported start/end/duration/percentDone reflect
 *     the CURRENT schedule, not the stale construction-time values.
 *   - Everything is DOM-free up to the optional `download()` helper (a transient
 *     `<a download>` blob click; a no-op under jsdom).
 *
 * All times are epoch milliseconds (UTC), matching the rest of the Gantt contract.
 */

import type { Model, RecordId } from '@jects/core';
import type { GanttApi, GanttFeature, DependencyModel } from '../contract.js';
import {
  tasksToXlsx,
  bytesToXlsxBlob,
  downloadXlsx,
  XLSX_MIME,
  type XlsxExportOptions,
} from './export-xlsx.js';
import { serializeTasks, type ExportTable, type TaskTreeSource } from './serialize.js';

const MS_PER_DAY = 86_400_000;

/* ═══════════════════════════════════════════════════════════════════════════
   1. CONFIG
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Configuration for {@link GanttExportXlsx}. Extends the pure
 * {@link XlsxExportOptions} (sheet name / columns / outline / freeze / masks /
 * indent / includeSummaryRows) — but the two resolver callbacks
 * (`predecessorsOf` / `resourcesOf`) are SUPPLIED by the feature from the live
 * model, so callers normally never set them. A caller MAY still override either
 * to customise the rendered notation.
 */
export interface GanttExportXlsxConfig<T extends Model = Model>
  extends XlsxExportOptions<T> {
  /**
   * Default filename used by {@link GanttExportXlsx.download} when none is
   * passed. Default `"gantt.xlsx"`.
   */
  fileName?: string;
  /**
   * Working hours/day used to convert effort-ms → person-days in the Effort
   * column. When omitted the feature reads it from the live engine (if it
   * exposes `getHoursPerDay()`), else falls back to the serializer default (8).
   */
  hoursPerDay?: number;
}

const DEFAULT_FILE_NAME = 'gantt.xlsx';

/* ═══════════════════════════════════════════════════════════════════════════
   2. LIVE-MODEL ADAPTERS (engine + resource layer → serializer inputs)
   ═══════════════════════════════════════════════════════════════════════════ */

/** A node in the structural tree the feature walks (id + nested children). */
interface StructNode<T extends Model> extends Model {
  id: RecordId;
  parentId?: RecordId | null;
  children?: StructNode<T>[];
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
  const hasNested = arr.some(
    (t) => Array.isArray(t.children) && t.children.length > 0,
  );
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
 * Build a {@link TaskTreeSource} that preserves the original parent⇄child
 * STRUCTURE/order from the construction-time `tasks` config, but resolves every
 * node's live fields through `api.getTask(id)` so the export reflects the
 * CURRENT schedule.
 */
function buildLiveTreeSource<T extends Model>(
  api: GanttApi<T>,
  tasksConfig: unknown,
): TaskTreeSource<T> {
  const roots = normalizeRoots<T>(tasksConfig);

  const live = (node: StructNode<T>): StructNode<T> => {
    const current = api.getTask(node.id) as Model | undefined;
    const base = (current ?? node) as Model;
    return { ...base, children: node.children } as StructNode<T>;
  };

  const liveRoots = roots.map(live);

  return {
    items: liveRoots as never,
    getChildren(node) {
      if (typeof node !== 'object') return [];
      const kids = (node as StructNode<T>).children ?? [];
      return kids.map(live) as never;
    },
  };
}

/**
 * Render a task's predecessors as the standard Gantt notation (`"2FS+1d, 3SS"`)
 * from the live dependency set. FS links omit the type suffix (the implicit
 * default); a non-zero lag is rendered as a `±Nd` working-day offset.
 */
function predecessorsLabel<T extends Model>(
  api: GanttApi<T>,
  taskId: RecordId,
): string {
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
function resourcesLabel<T extends Model>(
  api: GanttApi<T>,
  taskId: RecordId,
): string {
  const resources = api.resources;
  if (!resources) return '';
  const parts: string[] = [];
  for (const ra of resources.getAssignmentsFor(taskId)) {
    const name =
      ra.resource?.name ?? String(ra.resource?.id ?? ra.assignment.resourceId);
    const units = Math.round(ra.units);
    parts.push(units !== 100 ? `${name} [${units}%]` : name);
  }
  return parts.join(', ');
}

/* ═══════════════════════════════════════════════════════════════════════════
   3. THE FEATURE
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Wires the XLSX export onto the Gantt. After install, `gantt.exportXlsx()`
 * returns the project task-grid as raw `.xlsx` bytes (a `Uint8Array`),
 * `gantt.exportXlsxBlob()` returns a typed `.xlsx` Blob, and
 * `gantt.exportXlsxDownload()` triggers a browser download. The resolvers are
 * supplied automatically from the live engine + resource layer; per-call options
 * can override columns, sheet name, outline, freeze, masks, indent, and summary
 * inclusion.
 */
export class GanttExportXlsx<T extends Model = Model> implements GanttFeature<T> {
  readonly name = 'exportXlsx';

  private readonly config: GanttExportXlsxConfig<T>;
  private api: GanttApi<T> | null = null;
  private destroyed = false;

  constructor(config: GanttExportXlsxConfig<T> = {}) {
    this.config = { ...config };
  }

  /* ── GanttFeature lifecycle ────────────────────────────────────────────── */

  init(api: GanttApi<T>): void {
    this.destroyed = false;
    this.api = api;

    // Expose the export methods on the live Gantt instance (additive — does not
    // shadow any existing member). Cast at the seam; the methods are typed below.
    const host = api as unknown as {
      exportXlsx?: (options?: XlsxExportOptions<T>) => Uint8Array;
      exportXlsxBlob?: (options?: XlsxExportOptions<T>) => Blob;
      exportXlsxTable?: (options?: XlsxExportOptions<T>) => ExportTable;
      exportXlsxDownload?: (fileName?: string, options?: XlsxExportOptions<T>) => boolean;
    };
    host.exportXlsx = (options) => this.toXlsx(options);
    host.exportXlsxBlob = (options) => this.toBlob(options);
    host.exportXlsxTable = (options) => this.toTable(options);
    host.exportXlsxDownload = (fileName, options) => this.download(fileName, options);

    api.track(() => this.destroy());
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.api) {
      const host = this.api as unknown as Record<string, unknown>;
      delete host.exportXlsx;
      delete host.exportXlsxBlob;
      delete host.exportXlsxTable;
      delete host.exportXlsxDownload;
    }
    this.api = null;
  }

  /* ── public API (also surfaced on the Gantt instance) ──────────────────── */

  /** Resolved serializer options merged from config + per-call options + resolvers. */
  private resolveOptions(options?: XlsxExportOptions<T>): XlsxExportOptions<T> {
    const api = this.requireApi();
    const merged: XlsxExportOptions<T> = { ...this.config, ...options };
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
   * ExportTable} (columns + resolved rows, hierarchy/WBS preserved). The same
   * resolved table the XLSX bytes are built from.
   */
  toTable(options?: XlsxExportOptions<T>): ExportTable {
    return serializeTasks(this.source(), this.resolveOptions(options));
  }

  /**
   * Serialize the current project task grid to Excel `.xlsx` bytes. Resolvers
   * (predecessors / resources / hours-per-day) are bound from the live model.
   */
  toXlsx(options?: XlsxExportOptions<T>): Uint8Array {
    return tasksToXlsx(this.source(), this.resolveOptions(options));
  }

  /** Serialize the current project task grid to a typed `.xlsx` Blob. */
  toBlob(options?: XlsxExportOptions<T>): Blob {
    return bytesToXlsxBlob(this.toXlsx(options));
  }

  /**
   * Trigger a browser download of the workbook (a transient `<a download>` blob
   * click). No-op outside a DOM environment (returns `false` then). Returns
   * whether a download was actually offered; the bytes are the same as
   * {@link toXlsx}.
   */
  download(fileName?: string, options?: XlsxExportOptions<T>): boolean {
    const bytes = this.toXlsx(options);
    const name = fileName ?? this.config.fileName ?? DEFAULT_FILE_NAME;
    return downloadXlsx(bytes, name);
  }

  private requireApi(): GanttApi<T> {
    if (!this.api || this.destroyed) {
      throw new Error(
        '[GanttExportXlsx] not installed on a Gantt (call gantt.use(...) first).',
      );
    }
    return this.api;
  }
}

/**
 * Convenience factory mirroring the other Gantt feature creators
 * (`createGanttExportCsv`, `createProgressLine`, `createMultiBaselineCompare`).
 */
export function createGanttExportXlsx<T extends Model = Model>(
  config?: GanttExportXlsxConfig<T>,
): GanttExportXlsx<T> {
  return new GanttExportXlsx<T>(config);
}

/** Registry key for the feature (matches `feature.name`). */
export const GANTT_EXPORT_XLSX_FEATURE = 'exportXlsx';

/** The `.xlsx` MIME type, re-exported for consumers wiring their own download. */
export { XLSX_MIME };

/**
 * Augment the `Gantt` instance type with the methods this feature installs, so
 * `gantt.exportXlsx()` type-checks for consumers that install the feature. The
 * methods are present only AFTER `gantt.use(new GanttExportXlsx())`.
 */
declare module '../contract.js' {
  interface GanttApi<T extends Model> {
    /** Serialize the project task grid to Excel `.xlsx` bytes (after `GanttExportXlsx` install). */
    exportXlsx?(options?: XlsxExportOptions<T>): Uint8Array;
    /** Serialize the project task grid to a typed `.xlsx` Blob (after install). */
    exportXlsxBlob?(options?: XlsxExportOptions<T>): Blob;
    /** Serialize the project task grid to a writer-neutral table (after install). */
    exportXlsxTable?(options?: XlsxExportOptions<T>): ExportTable;
    /** Download the project task grid as an `.xlsx` file (after install); returns whether offered. */
    exportXlsxDownload?(fileName?: string, options?: XlsxExportOptions<T>): boolean;
  }
}
