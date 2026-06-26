/**
 * `@jects/gantt` — CSV export FEATURE: the public, Gantt-level surface over the
 * orphaned {@link tasksToCsv} / {@link serializeTasks} task-grid serializer.
 *
 * The pure RFC-4180 task-grid serializer (`./serialize` + `./export-csv`) is
 * DOM-free and engine-free by design: it takes a `TaskTreeSource` plus a couple
 * of resolver callbacks (predecessors-of / resources-of) and returns a string.
 * This module is the missing wiring that turns that into the Bryntum/DHTMLX
 * "Export to CSV" behaviour on a live `Gantt`:
 *
 *   - {@link GanttCsvExporter} — a disposable controller (same feature/mixin
 *     shape as `GanttPrintController`) that, given the live `GanttApi`, derives
 *     the project's `TaskTreeSource` (the Gantt's `TreeStore`), wires the
 *     **predecessors** resolver (Gantt dependency notation, e.g. `"2FS+1d"`) and
 *     the **resources** resolver (assigned-resource labels off the resource
 *     layer), serializes to CSV, and downloads it as a `text/csv` Blob.
 *   - {@link GanttCsvExportFeature} — the additive `GanttFeature` plugin that
 *     installs `exportCsv()` / `csvExporter` onto a Gantt via `gantt.use(...)`
 *     WITHOUT editing the widget class, and {@link installCsvExport} /
 *     {@link createGanttCsvExport} convenience factories.
 *
 * It also re-exports the pure CSV API ({@link tasksToCsv}, {@link serializeTasks},
 * {@link tableToCsv}, the {@link ExportTable} model, …) so a single import reaches
 * both the low-level serializer and the high-level feature.
 *
 * Token-pure: this module ships no colour and no component CSS — it produces a
 * string + a download. The only DOM it touches is a transient `<a download>` to
 * trigger the browser save (gated behind a real-DOM check so it is a no-op in
 * jsdom, returning the CSV string regardless so callers can assert it).
 *
 * Contract-pure: it interacts with the Gantt ONLY through the public `GanttApi`
 * (and one structural read of the store as a `TaskTreeSource`, with a config
 * override). Zero edits to the Gantt class, the contract, or the package barrel.
 */

import { EventEmitter, type Model, type RecordId } from '@jects/core';
import type { GanttApi, TaskModel } from '../contract.js';
import {
  tasksToCsv,
  tableToCsv,
  escapeCsvField,
  sanitizeCsvField,
  type CsvExportOptions,
} from './export-csv.js';
import {
  serializeTasks,
  resolveColumns,
  cellToText,
  isoDate,
  DEFAULT_EXPORT_COLUMNS,
  type ExportColumn,
  type ExportColumnType,
  type ExportCell,
  type ExportRow,
  type ExportTable,
  type ExportResolvers,
  type SerializeOptions,
  type TaskTreeSource,
} from './serialize.js';

/* Re-export the pure CSV/serializer API so a single import reaches both layers.
   (The package barrel additionally re-exports these from the root; see wireNotes.) */
export {
  tasksToCsv,
  tableToCsv,
  escapeCsvField,
  sanitizeCsvField,
  serializeTasks,
  resolveColumns,
  cellToText,
  isoDate,
  DEFAULT_EXPORT_COLUMNS,
};
export type {
  CsvExportOptions,
  ExportColumn,
  ExportColumnType,
  ExportCell,
  ExportRow,
  ExportTable,
  ExportResolvers,
  SerializeOptions,
  TaskTreeSource,
};

const MS_PER_DAY = 86_400_000;
const DEFAULT_CSV_FILENAME = 'gantt.csv';

/* ═══════════════════════════════════════════════════════════════════════════
   1. CONFIG / EVENTS
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Options for a single {@link GanttCsvExporter.exportCsv} call. Extends the pure
 * {@link CsvExportOptions} (delimiter / eol / bom / indent / columns / resolver
 * overrides) with the download-side concerns the feature owns.
 */
export interface GanttCsvExportOptions<T extends Model = Model>
  extends CsvExportOptions<T> {
  /** Download file name. Default `"gantt.csv"`. */
  filename?: string;
  /**
   * Trigger a browser download of the produced CSV. Default `true`. When `false`
   * (or in a non-DOM host) the CSV string is still returned but no file is saved
   * — useful for piping the text elsewhere or for headless tests.
   */
  download?: boolean;
}

/**
 * The minimal structural shape this feature reads off the resource layer to label
 * a task's assigned resources. The Gantt's `ResourceApi` satisfies it structurally
 * (`getResources` / `getResource` / `getAssignmentsFor` returning resolved
 * assignments with `{ assignment, resource, units }`). Consumers can also pass
 * their own `resourcesOf` to bypass it entirely.
 */
interface ResourceLabelSource {
  getResources?(): ReadonlyArray<{ id: RecordId; name?: string }>;
  getResource?(id: RecordId): { id: RecordId; name?: string } | undefined;
  getAssignmentsFor?(taskId: RecordId): ReadonlyArray<{
    assignment?: { resourceId?: RecordId; units?: number };
    resource?: { id?: RecordId; name?: string } | undefined;
    units?: number;
  }>;
}

/** Events emitted by {@link GanttCsvExporter} (feature-local, typed emitter). */
export interface GanttCsvExportEvents extends Record<string, unknown> {
  /** Fired after a CSV string is produced (before any download). */
  csvExport: { csv: string; filename: string; rowCount: number };
}

/* ═══════════════════════════════════════════════════════════════════════════
   2. EXPORTER CONTROLLER
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Drives the Gantt → CSV export path. Disposable; holds no DOM and leaks nothing.
 *
 * It resolves three things from the live `GanttApi`, each overridable per call:
 *   - the {@link TaskTreeSource} — the Gantt's `TreeStore` (read structurally as
 *     `{ items, getChildren }`), or an explicit `taskSource` option;
 *   - the **predecessors** label — the standard Gantt notation built from the
 *     dependencies touching each task (`"<fromId><type?><±lag d?>"`, FS implicit),
 *     mirroring the left grid's Predecessors column;
 *   - the **resources** label — `"Name [units%], …"` off the resource layer.
 */
export class GanttCsvExporter<T extends Model = Model> {
  private readonly api: GanttApi<T>;
  private readonly defaults: GanttCsvExportOptions<T>;
  /** Explicit tree source override (else the Gantt store is read structurally). */
  private readonly taskSourceOverride: TaskTreeSource<T> | undefined;
  readonly events = new EventEmitter<GanttCsvExportEvents>();
  private destroyed = false;

  /**
   * @param api      the host Gantt's public API.
   * @param defaults default CSV options applied to every `exportCsv` call (a
   *                 per-call options object is shallow-merged over these).
   */
  constructor(
    api: GanttApi<T>,
    defaults: GanttCsvExportOptions<T> & { taskSource?: TaskTreeSource<T> } = {},
  ) {
    this.api = api;
    const { taskSource, ...rest } = defaults;
    this.taskSourceOverride = taskSource;
    this.defaults = rest;
  }

  /**
   * Serialize the project task tree to a CSV string and (by default) download it.
   * Returns the CSV string regardless of whether a download happened, so callers
   * and tests can inspect/forward it.
   */
  exportCsv(options: GanttCsvExportOptions<T> = {}): string {
    if (this.destroyed) return '';
    const opts: GanttCsvExportOptions<T> = { ...this.defaults, ...options };

    const source = this.taskSource();
    const serializeOpts = this.resolveSerializeOptions(opts);
    const table = serializeTasks<T>(source, serializeOpts);
    const csv = tableToCsv(table, opts);

    const filename = opts.filename ?? this.defaults.filename ?? DEFAULT_CSV_FILENAME;
    this.events.emit('csvExport', { csv, filename, rowCount: table.rows.length });

    if (opts.download !== false) downloadCsv(csv, filename);
    return csv;
  }

  /**
   * Resolve the writer-neutral {@link ExportTable} without serializing to CSV —
   * useful for previewing the export (e.g. an accessible HTML table) or feeding a
   * different writer. Honours the same column/resolver options as
   * {@link exportCsv}.
   */
  toTable(options: GanttCsvExportOptions<T> = {}): ExportTable {
    const opts: GanttCsvExportOptions<T> = { ...this.defaults, ...options };
    return serializeTasks<T>(this.taskSource(), this.resolveSerializeOptions(opts));
  }

  /* ── resolution ──────────────────────────────────────────────────────── */

  /**
   * The project {@link TaskTreeSource}. Prefers an explicit `taskSource` override,
   * else reads the Gantt's `TreeStore` structurally (it already exposes the
   * `{ items, getChildren }` shape the serializer needs). Falls back to a flat
   * single-level source built from the engine when no store is reachable.
   */
  private taskSource(): TaskTreeSource<T> {
    if (this.taskSourceOverride) return this.taskSourceOverride;
    const store = (this.api as unknown as { _store?: unknown })._store;
    if (isTaskTreeSource<T>(store)) return store;
    return this.fallbackSource();
  }

  /**
   * Last-resort tree source when the concrete store is not reachable: walk from
   * the engine via the public `getChildren` reads. We can't enumerate roots from
   * the public API alone, so this returns an empty-roots source (a real `Gantt`
   * always exposes its store; this guard keeps the controller usable against a
   * minimal/mock `GanttApi`).
   */
  private fallbackSource(): TaskTreeSource<T> {
    const api = this.api;
    return {
      items: [],
      getChildren: (node) => {
        const id = typeof node === 'object' ? node.id : node;
        return api.getChildren(id) as ReadonlyArray<
          TaskModel<T> & { children?: TaskModel<T>[] }
        >;
      },
    };
  }

  /** Merge the call options with the auto-wired predecessors/resources resolvers. */
  private resolveSerializeOptions(
    opts: GanttCsvExportOptions<T>,
  ): SerializeOptions<T> {
    const out: SerializeOptions<T> = {};
    if (opts.columns) out.columns = opts.columns;
    if (opts.includeSummaryRows !== undefined) {
      out.includeSummaryRows = opts.includeSummaryRows;
    }
    if (opts.hoursPerDay !== undefined) out.hoursPerDay = opts.hoursPerDay;
    // Predecessors: honour an explicit override, else build Gantt notation.
    out.predecessorsOf = opts.predecessorsOf ?? ((id) => this.predecessorsLabel(id));
    // Resources: honour an explicit override, else label off the resource layer.
    out.resourcesOf = opts.resourcesOf ?? ((id) => this.resourcesLabel(id));
    return out;
  }

  /**
   * Build the standard Gantt predecessors notation for a task from the public
   * `getDependenciesFor` read: each ACTIVE dependency whose `toId` is this task is
   * rendered as `<fromId><type?><±lagDays d?>` (FS is implicit). Mirrors the
   * left-grid Predecessors column.
   */
  predecessorsLabel(taskId: RecordId): string {
    const labels: string[] = [];
    for (const d of this.api.getDependenciesFor(taskId)) {
      if (d.toId !== taskId || d.active === false) continue;
      const type = d.type && d.type !== 'FS' ? d.type : '';
      const lag =
        d.lag != null && d.lag !== 0
          ? `${d.lag >= 0 ? '+' : ''}${Math.round(d.lag / MS_PER_DAY)}d`
          : '';
      labels.push(`${String(d.fromId)}${type}${lag}`);
    }
    return labels.join(', ');
  }

  /**
   * Build a comma-joined resource label for a task off the resource layer
   * (`"Alice [50%], Bob"`). Reads assignments+units when the layer exposes them,
   * else the task's own `resourceIds` against the resource names. Returns `""`
   * when no resource layer / no assignments — the serializer then falls back to
   * the task's `resourceIds` count.
   */
  resourcesLabel(taskId: RecordId): string {
    const layer = this.api.resources as unknown as ResourceLabelSource | undefined;
    const nameOf = (id: RecordId): string => {
      const r = layer?.getResource?.(id);
      if (r?.name) return r.name;
      const all = layer?.getResources?.();
      const hit = all?.find((x) => x.id === id);
      return hit?.name ?? String(id);
    };

    // Preferred path: resolved assignments (carry the resource + per-task units).
    const assignments = layer?.getAssignmentsFor?.(taskId);
    if (assignments && assignments.length > 0) {
      return assignments
        .map((a) => {
          const resourceId = a.resource?.id ?? a.assignment?.resourceId;
          const name = a.resource?.name ?? (resourceId != null ? nameOf(resourceId) : '');
          // `units` is a percentage (100 = full-time) on the resolved assignment
          // (fall back to the raw assignment's units). Omit the common "100%".
          const rawUnits = a.units ?? a.assignment?.units;
          const pct =
            rawUnits == null
              ? null
              : rawUnits <= 1
                ? Math.round(rawUnits * 100)
                : Math.round(rawUnits);
          return pct != null && pct !== 100 ? `${name} [${pct}%]` : name;
        })
        .filter((s) => s.length > 0)
        .join(', ');
    }

    // Fallback: the task's own resourceIds (no units available).
    const task = this.api.getTask(taskId);
    const ids = task?.resourceIds;
    if (ids && ids.length > 0) return ids.map(nameOf).join(', ');
    return '';
  }

  /** Release the emitter. Idempotent. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.events.clear();
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   3. DOWNLOAD HELPER
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Save a CSV string as a `text/csv` file via a transient `<a download>`. A no-op
 * (returns silently) in hosts without the object-URL API (jsdom / SSR), so the
 * exporter's string result is still usable headless.
 */
export function downloadCsv(csv: string, filename = DEFAULT_CSV_FILENAME): void {
  if (
    typeof document === 'undefined' ||
    typeof URL === 'undefined' ||
    typeof URL.createObjectURL !== 'function'
  ) {
    return;
  }
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/* ═══════════════════════════════════════════════════════════════════════════
   4. ACCESSIBLE PREVIEW (HTML table)
   ═══════════════════════════════════════════════════════════════════════════ */

/** Options for {@link renderCsvPreview}. */
export interface CsvPreviewOptions {
  /** Indent unit applied to the Name cell per outline depth. Default two spaces. */
  indent?: string;
  /** Accessible caption for the preview table. Default `"CSV export preview"`. */
  caption?: string;
}

/**
 * Render a writer-neutral {@link ExportTable} as an accessible HTML `<table>` — a
 * faithful, semantic preview of exactly what the CSV download contains (same
 * columns, order, hierarchy indent, and display formatting via {@link cellToText}).
 *
 * The table is exposed as an ARIA `treegrid` so the outline hierarchy is
 * conveyed correctly: a `<caption>`, a header row of `columnheader` cells, and
 * data rows whose `aria-level` carries the outline depth (valid on `treegrid`
 * rows — and not on a plain `table`). Summary (parent) rows get a modifier class.
 * Token-pure: colour comes from the component stylesheet, never inline.
 */
export function renderCsvPreview(
  table: ExportTable,
  options: CsvPreviewOptions = {},
): HTMLTableElement {
  const indentUnit = options.indent ?? '  ';
  const nameCol = table.columns.findIndex((c) => c.field === 'name');

  const el = document.createElement('table');
  el.className = 'jects-gantt__csv-preview';
  // A treegrid: outline rows carry aria-level (a plain table role does not allow it).
  el.setAttribute('role', 'treegrid');

  const caption = document.createElement('caption');
  caption.className = 'jects-gantt__csv-preview-caption';
  caption.textContent = options.caption ?? 'CSV export preview';
  el.appendChild(caption);
  // Label the grid by its caption for assistive tech.
  const captionId = `jects-csv-preview-cap-${++previewSeq}`;
  caption.id = captionId;
  el.setAttribute('aria-labelledby', captionId);

  const thead = document.createElement('thead');
  const htr = document.createElement('tr');
  htr.setAttribute('role', 'row');
  for (const col of table.columns) {
    const th = document.createElement('th');
    th.setAttribute('role', 'columnheader');
    th.scope = 'col';
    th.textContent = col.header ?? col.field;
    htr.appendChild(th);
  }
  thead.appendChild(htr);
  el.appendChild(thead);

  const tbody = document.createElement('tbody');
  table.rows.forEach((row, rowIndex) => {
    const tr = document.createElement('tr');
    tr.setAttribute('role', 'row');
    tr.className = row.summary
      ? 'jects-gantt__csv-preview-row jects-gantt__csv-preview-row--summary'
      : 'jects-gantt__csv-preview-row';
    tr.dataset.taskId = String(row.id);
    // aria-level conveys outline depth (1-based); aria-posinset/-setsize complete
    // the treegrid row semantics.
    tr.setAttribute('aria-level', String(row.depth + 1));
    tr.setAttribute('aria-posinset', String(rowIndex + 1));
    tr.setAttribute('aria-setsize', String(table.rows.length));
    row.cells.forEach((cell, i) => {
      const td = document.createElement('td');
      td.setAttribute('role', 'gridcell');
      const indent =
        i === nameCol && indentUnit && row.depth > 0
          ? indentUnit.repeat(row.depth)
          : undefined;
      td.textContent = cellToText(cell, indent ? { indent } : undefined);
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  el.appendChild(tbody);
  return el;
}

/** Monotonic counter for unique caption ids across preview tables. */
let previewSeq = 0;

/* ═══════════════════════════════════════════════════════════════════════════
   5. FEATURE PLUGIN + INSTALLERS
   ═══════════════════════════════════════════════════════════════════════════ */

/** Feature name the CSV exporter registers under on `GanttApi.features`. */
export const GANTT_CSV_EXPORT_FEATURE = 'csvExport';

/** Config accepted by {@link GanttCsvExportFeature} (constructor form). */
export interface GanttCsvExportFeatureConfig<T extends Model = Model>
  extends GanttCsvExportOptions<T> {
  /** Explicit task tree source override (else the Gantt store is used). */
  taskSource?: TaskTreeSource<T>;
}

/**
 * The public CSV-export surface a Gantt gains once this feature is installed.
 * Surfaced both via `gantt.features.get('csvExport')` and (when the integrator
 * adds the thin delegating method described in wireNotes) as `gantt.exportCsv()`.
 */
export interface GanttCsvExportApi<T extends Model = Model> {
  /** Serialize the project to CSV and (by default) download it; returns the CSV. */
  exportCsv(options?: GanttCsvExportOptions<T>): string;
  /** Resolve the writer-neutral export table (no CSV serialization). */
  toCsvTable(options?: GanttCsvExportOptions<T>): ExportTable;
  /** Render an accessible HTML `<table>` preview of the CSV export. */
  previewCsv(options?: GanttCsvExportOptions<T> & CsvPreviewOptions): HTMLTableElement;
  /** The underlying disposable exporter (event subscriptions, advanced use). */
  readonly csvExporter: GanttCsvExporter<T>;
}

/** A Gantt with the CSV-export feature installed (structural helper type). */
export type GanttWithCsvExport<T extends Model = Model> = GanttApi<T> &
  GanttCsvExportApi<T>;

/**
 * Additive `GanttFeature` that wires CSV export onto a `Gantt` without touching
 * the widget class. Install via `gantt.use(new GanttCsvExportFeature())` or
 * `GanttOptions.plugins`. After install, `feature.exportCsv()` (and, with the
 * one-line delegation in wireNotes, `gantt.exportCsv()`) produces + downloads a
 * task-grid CSV exactly matching the on-screen tree columns.
 */
export class GanttCsvExportFeature<T extends Model = Model>
  implements GanttFeatureShape<T>, GanttCsvExportApi<T>
{
  readonly name = GANTT_CSV_EXPORT_FEATURE;
  private readonly config: GanttCsvExportFeatureConfig<T>;
  private exporter: GanttCsvExporter<T> | null = null;

  constructor(config: GanttCsvExportFeatureConfig<T> = {}) {
    this.config = config;
  }

  init(api: GanttApi<T>): void {
    this.exporter = new GanttCsvExporter<T>(api, this.config);
    // Track disposal with the host Gantt (leak-safe).
    api.track(() => this.destroy());
  }

  get csvExporter(): GanttCsvExporter<T> {
    if (!this.exporter) {
      throw new Error('GanttCsvExportFeature: not initialized (call gantt.use(...) first)');
    }
    return this.exporter;
  }

  exportCsv(options?: GanttCsvExportOptions<T>): string {
    return this.csvExporter.exportCsv(options);
  }

  toCsvTable(options?: GanttCsvExportOptions<T>): ExportTable {
    return this.csvExporter.toTable(options);
  }

  previewCsv(
    options: GanttCsvExportOptions<T> & CsvPreviewOptions = {},
  ): HTMLTableElement {
    const table = this.csvExporter.toTable(options);
    const previewOpts: CsvPreviewOptions = {};
    if (options.indent !== undefined) previewOpts.indent = options.indent;
    if (options.caption !== undefined) previewOpts.caption = options.caption;
    return renderCsvPreview(table, previewOpts);
  }

  destroy(): void {
    this.exporter?.destroy();
    this.exporter = null;
  }
}

/**
 * Construct a {@link GanttCsvExportFeature} (sugar for `new …(config)`), to pass
 * to `GanttOptions.plugins` or `gantt.use(...)`.
 */
export function createGanttCsvExport<T extends Model = Model>(
  config: GanttCsvExportFeatureConfig<T> = {},
): GanttCsvExportFeature<T> {
  return new GanttCsvExportFeature<T>(config);
}

/**
 * Install CSV export onto a live Gantt and return the feature (already added via
 * `api.use`, so it tracks/disposes with the Gantt). Mirrors `installImageExport`
 * / `installResourceLayer`: a single additive call the integrator can make from
 * the Gantt `setup()` (or a consumer can call directly).
 */
export function installCsvExport<T extends Model = Model>(
  api: GanttApi<T>,
  config: GanttCsvExportFeatureConfig<T> = {},
): GanttCsvExportFeature<T> {
  const existing = api.features.get(GANTT_CSV_EXPORT_FEATURE);
  if (existing && existing instanceof GanttCsvExportFeature) {
    return existing as GanttCsvExportFeature<T>;
  }
  const feature = new GanttCsvExportFeature<T>(config);
  api.use(feature as unknown as GanttFeatureShape<T>);
  return feature;
}

/* ── structural GanttFeature shape (avoids importing the type to keep this
   module decoupled from contract churn; matches the frozen interface) ──────── */
interface GanttFeatureShape<T extends Model = Model> {
  readonly name: string;
  init(api: GanttApi<T>): void;
  destroy(): void;
}

/* ── internal guards ───────────────────────────────────────────────────────── */

/** Structural guard: a value usable as a {@link TaskTreeSource}. */
function isTaskTreeSource<T extends Model>(value: unknown): value is TaskTreeSource<T> {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as { items?: unknown }).items) &&
    typeof (value as { getChildren?: unknown }).getChildren === 'function'
  );
}
