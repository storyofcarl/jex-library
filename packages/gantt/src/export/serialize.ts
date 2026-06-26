/**
 * `@jects/gantt` — task-grid export SERIALIZER (pure, framework-free).
 *
 * The shared core under the CSV and XLSX writers: it walks the project's task
 * tree (a `@jects/core` `TreeStore`, or any structurally compatible tree source),
 * resolves the standard project columns — name / WBS / start / end / duration /
 * %% done / predecessors / resources / effort — preserving the outline hierarchy
 * (each row carries its tree `depth` + outline `wbs` number), and produces a
 * neutral, typed {@link ExportTable} that BOTH writers serialize.
 *
 * This mirrors the Bryntum/DHTMLX "export grid + schedule to Excel/CSV" behaviour:
 *   - The exported columns and their order match the on-screen task-tree columns
 *     (defaulting to the package's {@link DEFAULT_EXPORT_COLUMNS} when none given).
 *   - Hierarchy is preserved two ways at once: a textual indent on the Name cell
 *     (so a flat CSV still reads as an outline) AND a machine outline level the
 *     XLSX writer turns into native Excel row grouping (`outlineLevel`).
 *   - Each column declares a *type* (`text | number | date | duration | percent`)
 *     so the XLSX writer can apply the right cell type + number-format mask, and
 *     the CSV writer can emit ISO dates / plain numbers rather than display chrome.
 *
 * It is DOM-free and dependency-free: it takes data + a small set of resolver
 * callbacks (predecessors-of, resources-of, units-of) so it never reaches into the
 * scheduling engine or the resource layer directly — the Gantt widget supplies
 * those when it wires the export feature (see the feature module + wire notes).
 *
 * All times are epoch milliseconds (UTC); durations are working-ms.
 */

import type { Model, RecordId } from '@jects/core';
import type { TaskModel } from '../contract.js';

const MS_PER_DAY = 86_400_000;
const MS_PER_HOUR = 3_600_000;

/* ═══════════════════════════════════════════════════════════════════════════
   1. COLUMN MODEL
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * The value-type of an export column. Drives how each writer renders the cell:
 *   - `text`     → a string cell.
 *   - `number`   → a numeric cell (no format mask).
 *   - `date`     → an ISO date in CSV; an Excel serial date (with a date mask) in XLSX.
 *   - `duration` → a working-day count (e.g. `5` days), shown with a `"d"` suffix.
 *   - `percent`  → a 0..1 fraction shown as a percentage (XLSX uses a `0%` mask).
 */
export type ExportColumnType = 'text' | 'number' | 'date' | 'duration' | 'percent';

/**
 * A single column in the export. `field` is one of the well-known task fields the
 * serializer knows how to resolve (`name | wbs | start | end | duration |
 * percentDone | predecessors | resources | effort`), or any task model key for a
 * plain passthrough. `header` is the column title; `type` selects the cell
 * rendering (defaulted from the field when omitted).
 */
export interface ExportColumn {
  /** Task field / well-known export key. */
  field: string;
  /** Column header label (defaults to a humanized `field`). */
  header?: string;
  /** Cell value-type (defaults to the well-known type for `field`, else `text`). */
  type?: ExportColumnType;
  /** Preferred column width in characters (XLSX). Optional cosmetic hint. */
  width?: number;
}

/**
 * The default export column set — the standard Bryntum/DHTMLX project grid:
 * name / WBS / start / end / duration / %% done / predecessors / resources / effort.
 */
export const DEFAULT_EXPORT_COLUMNS: ReadonlyArray<ExportColumn> = [
  { field: 'name', header: 'Name', type: 'text', width: 32 },
  { field: 'wbs', header: 'WBS', type: 'text', width: 10 },
  { field: 'start', header: 'Start', type: 'date', width: 12 },
  { field: 'end', header: 'Finish', type: 'date', width: 12 },
  { field: 'duration', header: 'Duration', type: 'duration', width: 10 },
  { field: 'percentDone', header: '% Done', type: 'percent', width: 9 },
  { field: 'predecessors', header: 'Predecessors', type: 'text', width: 16 },
  { field: 'resources', header: 'Resources', type: 'text', width: 22 },
  { field: 'effort', header: 'Effort', type: 'duration', width: 10 },
];

/** Well-known field → default column type. */
const FIELD_TYPE: Readonly<Record<string, ExportColumnType>> = {
  name: 'text',
  wbs: 'text',
  start: 'date',
  end: 'date',
  duration: 'duration',
  percentDone: 'percent',
  predecessors: 'text',
  resources: 'text',
  effort: 'duration',
};

/* ═══════════════════════════════════════════════════════════════════════════
   2. RESOLVED TABLE MODEL (writer-neutral)
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * A resolved cell value. The serializer normalizes every task field to one of
 * these neutral shapes so each writer can serialize without re-deriving anything:
 *   - `text`     → `{ kind: 'text', value }`
 *   - `number`   → `{ kind: 'number', value }`
 *   - `date`     → `{ kind: 'date', value: epoch-ms }`
 *   - `duration` → `{ kind: 'duration', days }` (whole working days)
 *   - `percent`  → `{ kind: 'percent', fraction }` (0..1)
 *   - `empty`    → `{ kind: 'empty' }`
 */
export type ExportCell =
  | { kind: 'text'; value: string }
  | { kind: 'number'; value: number }
  | { kind: 'date'; value: number }
  | { kind: 'duration'; days: number }
  | { kind: 'percent'; fraction: number }
  | { kind: 'empty' };

/** A resolved export row: one task, its outline depth, and its resolved cells. */
export interface ExportRow {
  /** Source task id (for callers that round-trip). */
  id: RecordId;
  /** Tree depth (0 = root) — drives the Name indent + XLSX outline level. */
  depth: number;
  /** Outline number ("1.2.1"). */
  wbs: string;
  /** Whether this task has children (a summary row). */
  summary: boolean;
  /** Resolved cells, one per column (same order/length as the columns). */
  cells: ExportCell[];
}

/** The fully-resolved, writer-neutral export table. */
export interface ExportTable {
  /** The resolved columns (order preserved). */
  columns: ExportColumn[];
  /** The resolved rows, in visible/outline order (depth-first). */
  rows: ExportRow[];
}

/* ═══════════════════════════════════════════════════════════════════════════
   3. SERIALIZER INPUT
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * The minimal tree-source shape the serializer needs. A `@jects/core` `TreeStore`
 * satisfies this structurally; tests (and non-store callers) can pass any object
 * exposing `items` (roots) + `getChildren`. Accepting the structural shape keeps
 * the serializer decoupled from the concrete store class.
 */
export interface TaskTreeSource<T extends Model = Model> {
  /** Root tasks (top-level). */
  readonly items: ReadonlyArray<TaskModel<T> & { children?: TaskModel<T>[] }>;
  /** Direct children of a node. */
  getChildren(
    node: (TaskModel<T> & { children?: TaskModel<T>[] }) | RecordId,
  ): ReadonlyArray<TaskModel<T> & { children?: TaskModel<T>[] }>;
}

/** Resolver callbacks the Gantt widget supplies when wiring the export. */
export interface ExportResolvers {
  /**
   * Render a task's predecessors as the standard Gantt notation
   * (e.g. `"2FS+1d, 3SS"`). When omitted, the predecessors column is empty.
   */
  predecessorsOf?(taskId: RecordId): string;
  /**
   * Render a task's assigned resources as a comma-joined label
   * (e.g. `"Alice [50%], Bob"`). When omitted, falls back to the task's
   * `resourceIds` count.
   */
  resourcesOf?(taskId: RecordId): string;
  /** Working hours/day used to convert effort-ms → person-days. Default 8. */
  hoursPerDay?: number;
}

/** Options for {@link serializeTasks}. */
export interface SerializeOptions<_T extends Model = Model> extends ExportResolvers {
  /** The columns to export (defaults to {@link DEFAULT_EXPORT_COLUMNS}). */
  columns?: ReadonlyArray<ExportColumn>;
  /**
   * Whether to include summary (parent) rows. Default `true`. When `false`, only
   * leaf tasks are exported (still preserving WBS numbering of the leaves).
   */
  includeSummaryRows?: boolean;
}

const DEFAULT_HOURS_PER_DAY = 8;

/* ═══════════════════════════════════════════════════════════════════════════
   4. SERIALIZER
   ═══════════════════════════════════════════════════════════════════════════ */

/** Humanize a field key into a header ("percentDone" → "Percent Done"). */
function humanize(field: string): string {
  return field
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, (c) => c.toUpperCase());
}

/** Resolve a column's effective type (explicit → well-known → text). */
function columnType(col: ExportColumn): ExportColumnType {
  return col.type ?? FIELD_TYPE[col.field] ?? 'text';
}

/** Normalize the supplied/default columns to a fully-typed, header-bearing set. */
export function resolveColumns(
  columns: ReadonlyArray<ExportColumn> | undefined,
): ExportColumn[] {
  const src = columns && columns.length > 0 ? columns : DEFAULT_EXPORT_COLUMNS;
  return src.map((c) => {
    const col: ExportColumn = {
      field: c.field,
      header: c.header ?? humanize(c.field),
      type: columnType(c),
    };
    if (c.width !== undefined) col.width = c.width;
    return col;
  });
}

/** Whole working days for a duration-ms (rounded), or `undefined` if absent. */
function toDays(ms: number | undefined): number | undefined {
  if (ms == null || !Number.isFinite(ms)) return undefined;
  return Math.round(ms / MS_PER_DAY);
}

/** Person-days for an effort-ms given hours/day, or `undefined` if absent. */
function effortToDays(ms: number | undefined, hoursPerDay: number): number | undefined {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return undefined;
  const h = hoursPerDay > 0 ? hoursPerDay : DEFAULT_HOURS_PER_DAY;
  return Math.round((ms / MS_PER_HOUR / h) * 100) / 100;
}

/**
 * Resolve one task field to a writer-neutral {@link ExportCell}. `wbs` is passed
 * in (it is positional, not stored on the task). `opts` supplies the resolvers.
 */
function resolveCell<T extends Model>(
  col: ExportColumn,
  task: TaskModel<T>,
  wbs: string,
  opts: SerializeOptions<T>,
): ExportCell {
  const type = columnType(col);
  switch (col.field) {
    case 'name': {
      const v = task.name ?? String(task.id);
      return { kind: 'text', value: v };
    }
    case 'wbs':
      return { kind: 'text', value: wbs };
    case 'start':
      return task.start != null && Number.isFinite(task.start)
        ? { kind: 'date', value: task.start }
        : { kind: 'empty' };
    case 'end':
      return task.end != null && Number.isFinite(task.end)
        ? { kind: 'date', value: task.end }
        : { kind: 'empty' };
    case 'duration': {
      const d = toDays(task.duration);
      return d != null ? { kind: 'duration', days: d } : { kind: 'empty' };
    }
    case 'percentDone': {
      const p = task.percentDone;
      return p != null && Number.isFinite(p)
        ? { kind: 'percent', fraction: Math.max(0, Math.min(1, p)) }
        : { kind: 'empty' };
    }
    case 'predecessors': {
      const v = opts.predecessorsOf?.(task.id) ?? '';
      return v ? { kind: 'text', value: v } : { kind: 'empty' };
    }
    case 'resources': {
      let v = opts.resourcesOf?.(task.id) ?? '';
      if (!v) {
        const n = task.resourceIds?.length ?? 0;
        v = n > 0 ? `${n} resource${n === 1 ? '' : 's'}` : '';
      }
      return v ? { kind: 'text', value: v } : { kind: 'empty' };
    }
    case 'effort': {
      const d = effortToDays(task.effort, opts.hoursPerDay ?? DEFAULT_HOURS_PER_DAY);
      return d != null ? { kind: 'duration', days: d } : { kind: 'empty' };
    }
    default: {
      // Plain passthrough for arbitrary fields, typed by the column.
      const raw = (task as Record<string, unknown>)[col.field];
      if (raw == null) return { kind: 'empty' };
      if (type === 'number' && typeof raw === 'number' && Number.isFinite(raw)) {
        return { kind: 'number', value: raw };
      }
      if (type === 'date' && typeof raw === 'number' && Number.isFinite(raw)) {
        return { kind: 'date', value: raw };
      }
      if (type === 'percent' && typeof raw === 'number' && Number.isFinite(raw)) {
        return { kind: 'percent', fraction: Math.max(0, Math.min(1, raw)) };
      }
      return { kind: 'text', value: String(raw) };
    }
  }
}

/**
 * Walk the task tree depth-first and resolve every task into an {@link ExportRow}
 * with its outline `wbs` number, tree `depth`, summary flag, and resolved cells.
 * Preserves the on-screen hierarchy/order. Pure.
 *
 * @param source  The tree source (a `TreeStore` or any compatible shape).
 * @param options Columns + resolvers (see {@link SerializeOptions}).
 */
export function serializeTasks<T extends Model = Model>(
  source: TaskTreeSource<T>,
  options: SerializeOptions<T> = {},
): ExportTable {
  const columns = resolveColumns(options.columns);
  const includeSummary = options.includeSummaryRows !== false;
  const rows: ExportRow[] = [];

  const walk = (
    nodes: ReadonlyArray<TaskModel<T> & { children?: TaskModel<T>[] }>,
    depth: number,
    prefix: string,
  ): void => {
    nodes.forEach((node, i) => {
      const wbs = prefix ? `${prefix}.${i + 1}` : String(i + 1);
      const children = source.getChildren(node);
      const isSummary = children.length > 0;
      if (includeSummary || !isSummary) {
        rows.push({
          id: node.id,
          depth,
          wbs,
          summary: isSummary,
          cells: columns.map((c) => resolveCell(c, node, wbs, options)),
        });
      }
      if (isSummary) walk(children, depth + 1, wbs);
    });
  };

  walk(source.items, 0, '');
  return { columns, rows };
}

/* ═══════════════════════════════════════════════════════════════════════════
   5. DISPLAY HELPERS (shared by CSV + the a11y preview)
   ═══════════════════════════════════════════════════════════════════════════ */

/** Format an epoch-ms as an ISO date (`YYYY-MM-DD`, UTC). */
export function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Render a resolved cell as a plain *display string* (used by CSV and the
 * accessible HTML preview). Dates → ISO, durations → `"5d"`, percents → `"40%"`.
 * The `indent` is applied to the Name column when `applyIndent` is set (so a flat
 * CSV/preview still reads as an outline).
 */
export function cellToText(
  cell: ExportCell,
  opts?: { indent?: string },
): string {
  const indent = opts?.indent ?? '';
  switch (cell.kind) {
    case 'empty':
      return indent;
    case 'text':
      return indent + cell.value;
    case 'number':
      return String(cell.value);
    case 'date':
      return isoDate(cell.value);
    case 'duration':
      return `${cell.days}d`;
    case 'percent':
      return `${Math.round(cell.fraction * 100)}%`;
    default: {
      // Exhaustiveness guard.
      const _never: never = cell;
      return String(_never);
    }
  }
}
