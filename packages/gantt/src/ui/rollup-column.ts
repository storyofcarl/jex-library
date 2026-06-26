/**
 * `@jects/gantt` — the **'rollup' task-tree column type** (Bryntum/DHTMLX parity).
 *
 * PARITY lists a `rollup` column among the Gantt's task-tree column types. The
 * package already ships the *visual* bar-rollup layer (`ui/rollups.ts` /
 * `ui/rollup-markers.ts`) that projects child bars onto a collapsed parent; this
 * module is the orthogonal **grid column** that surfaces the rollup *data* inside
 * the left task-tree pane — exactly what Bryntum's `column type: 'rollup'` and
 * DHTMLX's rollup grid column do:
 *
 *   1. **Boolean / check mode** (`kind: 'flag'`, the default) — renders the task's
 *      own `rollup` flag as a check glyph, and (when `editable`) lets the user
 *      toggle it from the grid, just like Bryntum's checkbox-style rollup column.
 *      Toggling the flag is what tells the *visual* rollup layer to project this
 *      leaf onto its ancestors, so the data column and the bar overlay stay in
 *      lockstep through a single source of truth: `task.rollup`.
 *
 *   2. **Summary-value mode** (`kind: 'summary'`) — for a summary (parent) row,
 *      renders an aggregate **rolled up from the descendant leaves** of a chosen
 *      numeric/boolean source field (sum / avg / min / max / count / any / all),
 *      mirroring DHTMLX's rollup/summary columns. Leaf rows show their own value.
 *
 * Design (concurrency-safe, contract-pure):
 *   - Everything heavy lives HERE, in a standalone module, as **pure functions**
 *     (`resolveRollupCell`, `aggregateRollup`, `formatRollupCell`) plus a tiny DOM
 *     cell builder (`buildRollupCell`) and a column factory (`rollupColumn`). None
 *     of it imports the Gantt widget or the timeline; it only needs the task tree
 *     shape (`RollupTreeSource`) the task-tree pane already has.
 *   - The task-tree pane (`ui/task-tree.ts`) delegates its `'rollup'` field case to
 *     this module via additive branches — no destructive edits to the switch.
 *   - Token-pure CSS in `rollup-column.css` (`@layer jects.components`).
 *
 * The `rollup` flag is read off the model directly or under `task.data` (matching
 * `ui/rollups.ts`'s `readFlag`), so the data column, the editor, and the visual
 * overlay all agree on one flag.
 */

import './rollup-column.css';
import { createEl, type Model, type RecordId } from '@jects/core';
import type { TaskModel, GanttColumnConfig } from '../contract.js';

/* ═══════════════════════════════════════════════════════════════════════════
   1. CONFIG / TYPES
   ═══════════════════════════════════════════════════════════════════════════ */

/** The canonical field id the task-tree switch matches for this column type. */
export const ROLLUP_COLUMN_FIELD = 'rollup';
/** Default header label. */
export const ROLLUP_COLUMN_HEADER = 'Rollup';

/**
 * How a rollup cell derives its value:
 *   - `'flag'`     — the task's own boolean `rollup` flag (check glyph; editable).
 *   - `'summary'`  — an aggregate rolled up from descendant leaves of a source
 *                    numeric/boolean field (sum/avg/min/max/count/any/all).
 */
export type RollupColumnKind = 'flag' | 'summary';

/**
 * Aggregation applied in `'summary'` mode over the descendant-leaf values of the
 * source field. `'any'`/`'all'` treat values as booleans; the rest are numeric.
 * `'count'` counts leaves with a non-nullish source value.
 */
export type RollupAggregation = 'sum' | 'avg' | 'min' | 'max' | 'count' | 'any' | 'all';

/** Typed configuration for the `'rollup'` task-tree column. */
export interface RollupColumnConfig<T extends Model = Model> {
  /** Header label. Default `'Rollup'`. */
  header?: string;
  /** Column width (px). Default 80. */
  width?: number;
  /** Cell derivation. Default `'flag'`. */
  kind?: RollupColumnKind;
  /**
   * In `'flag'` mode: allow toggling the task's `rollup` flag from the grid.
   * Default `true`. When `false` the check is read-only (presentational).
   */
  editable?: boolean;
  /**
   * In `'summary'` mode: the source task field aggregated across descendant
   * leaves (e.g. `'percentDone'`, `'effort'`, or a custom numeric field).
   * Default `'percentDone'`.
   */
  field?: string;
  /** In `'summary'` mode: the aggregation. Default `'sum'`. */
  aggregation?: RollupAggregation;
  /**
   * In `'summary'` mode: format the resolved aggregate for display. Defaults to
   * a compact number (≤2 dp, trailing zeros dropped); booleans render as a check.
   */
  format?(value: RollupValue, task: TaskModel<T>): string;
  /**
   * Override the resolved value for a task entirely (escape hatch). Returning
   * `undefined` falls back to the built-in derivation.
   */
  value?(task: TaskModel<T>, source: RollupTreeSource<T>): RollupValue | undefined;
}

/** A resolved rollup cell value: a boolean (flag/any/all), a number, or empty. */
export type RollupValue = boolean | number | null;

/**
 * The minimal task-tree shape this module needs to walk descendants. The
 * task-tree pane already exposes children via its `TreeStore`; this narrow
 * interface keeps the module decoupled from the store/grid build.
 */
export interface RollupTreeSource<T extends Model = Model> {
  /** Direct children of a task (empty for a leaf). */
  getChildren(taskId: RecordId): ReadonlyArray<TaskModel<T>>;
}

/* ═══════════════════════════════════════════════════════════════════════════
   2. FLAG READ / WRITE (single source of truth: task.rollup | data.rollup)
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Read the opt-in `rollup` flag off a task model (direct, else under `data`).
 * Matches `ui/rollups.ts`'s `readFlag` so the data column and the visual overlay
 * agree on one flag.
 */
export function readRollupFlag(task: Model): boolean {
  const direct = (task as { rollup?: unknown }).rollup;
  if (direct === true) return true;
  if (direct === false) return false;
  const data = (task as { data?: { rollup?: unknown } }).data;
  return data?.rollup === true;
}

/**
 * Produce the patch that sets a task's `rollup` flag. Writes the top-level field
 * (the model field the visual layer also reads first). Pure — the caller applies
 * the patch through its store/engine so the change re-propagates and repaints.
 */
export function rollupFlagPatch(on: boolean): { rollup: boolean } {
  return { rollup: on };
}

/* ═══════════════════════════════════════════════════════════════════════════
   3. VALUE RESOLUTION (pure)
   ═══════════════════════════════════════════════════════════════════════════ */

const MS_PER_DAY = 86_400_000;

/** Whether a task is a leaf (no children) per the tree source. */
function isLeaf<T extends Model>(task: TaskModel<T>, source: RollupTreeSource<T>): boolean {
  return source.getChildren(task.id).length === 0;
}

/** Depth-first descendant-leaf tasks of `task` (excludes the task itself). */
function descendantLeaves<T extends Model>(
  task: TaskModel<T>,
  source: RollupTreeSource<T>,
): TaskModel<T>[] {
  const out: TaskModel<T>[] = [];
  const seen = new Set<RecordId>();
  const walk = (node: TaskModel<T>): void => {
    for (const child of source.getChildren(node.id)) {
      if (seen.has(child.id)) continue; // cycle guard
      seen.add(child.id);
      if (source.getChildren(child.id).length === 0) out.push(child);
      else walk(child);
    }
  };
  walk(task);
  return out;
}

/** Read a numeric source field off a task (direct, else under `data`). */
function readNumber<T extends Model>(task: TaskModel<T>, field: string): number | null {
  const direct = (task as Record<string, unknown>)[field];
  if (typeof direct === 'number' && Number.isFinite(direct)) return direct;
  if (typeof direct === 'boolean') return direct ? 1 : 0;
  const data = (task as { data?: Record<string, unknown> }).data;
  const nested = data?.[field];
  if (typeof nested === 'number' && Number.isFinite(nested)) return nested;
  if (typeof nested === 'boolean') return nested ? 1 : 0;
  return null;
}

/**
 * Aggregate a list of leaf values per the aggregation. `'any'`/`'all'` return a
 * boolean; the numeric aggregations return a number (or `null` when there are no
 * contributing values, except `count`/`sum` which are `0`). Pure.
 */
export function aggregateRollup(
  values: ReadonlyArray<number | null>,
  aggregation: RollupAggregation,
): RollupValue {
  const present = values.filter((v): v is number => v != null && Number.isFinite(v));
  switch (aggregation) {
    case 'any':
      return present.some((v) => v !== 0);
    case 'all':
      return present.length > 0 && present.every((v) => v !== 0);
    case 'count':
      return present.length;
    case 'sum':
      return present.reduce((a, b) => a + b, 0);
    case 'avg':
      return present.length ? present.reduce((a, b) => a + b, 0) / present.length : null;
    case 'min':
      return present.length ? Math.min(...present) : null;
    case 'max':
      return present.length ? Math.max(...present) : null;
    default:
      return null;
  }
}

/**
 * Resolve the rollup cell value for one task. Pure: no DOM. In `'flag'` mode the
 * value is the task's own boolean `rollup` flag. In `'summary'` mode a summary
 * row aggregates the source field across its descendant leaves; a leaf row shows
 * its own source value. A `config.value` override wins when it returns non-`undefined`.
 */
export function resolveRollupCell<T extends Model = Model>(
  task: TaskModel<T>,
  source: RollupTreeSource<T>,
  config: RollupColumnConfig<T> = {},
): RollupValue {
  const override = config.value?.(task, source);
  if (override !== undefined) return override;

  const kind = config.kind ?? 'flag';
  if (kind === 'flag') {
    return readRollupFlag(task);
  }

  // summary mode
  const field = config.field ?? 'percentDone';
  const aggregation = config.aggregation ?? 'sum';
  if (isLeaf(task, source)) {
    return readNumber(task, field);
  }
  const leaves = descendantLeaves(task, source);
  return aggregateRollup(
    leaves.map((leaf) => readNumber(leaf, field)),
    aggregation,
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   4. FORMATTING (pure)
   ═══════════════════════════════════════════════════════════════════════════ */

const CHECK = '✓'; // ✓
const DASH = '—'; // — (empty/indeterminate)

/** Round to ≤`dp` decimals, dropping trailing zeros. */
function round(n: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

/**
 * Format a resolved {@link RollupValue} as accessible cell TEXT (used by the
 * task-tree's plain-text fallback and as the cell's accessible name). Booleans
 * render as a check / em-dash; numbers compactly; `null` as an em-dash.
 *
 * A `config.format` override (summary mode) wins. In flag mode the format is
 * always the check/dash so the toggle reads consistently.
 */
export function formatRollupCell<T extends Model = Model>(
  value: RollupValue,
  task: TaskModel<T>,
  config: RollupColumnConfig<T> = {},
): string {
  const kind = config.kind ?? 'flag';
  if (kind === 'summary' && config.format) return config.format(value, task);

  if (typeof value === 'boolean') return value ? CHECK : DASH;
  if (value == null) return DASH;
  // Percent-done style source: render fractions ≤1 as a percent.
  const field = config.field;
  if (kind === 'summary' && field === 'percentDone') {
    return `${round(value * 100, 0)}%`;
  }
  if (kind === 'summary' && (field === 'duration' || field === 'effort')) {
    return `${round(value / MS_PER_DAY)}d`;
  }
  return `${round(value)}`;
}

/* ═══════════════════════════════════════════════════════════════════════════
   5. DOM CELL (token-pure, accessible)
   ═══════════════════════════════════════════════════════════════════════════ */

const CELL = 'jects-gantt__rollup-cell';
const CHECKBOX = 'jects-gantt__rollup-check';

/** Result of building a rollup cell: the element + an optional toggle disposer. */
export interface RollupCellHandle {
  /** The cell's inner content element (append into the `<td>`). */
  el: HTMLElement;
  /** Removes any listeners the cell registered (call on row teardown). */
  dispose(): void;
}

/**
 * Build the rollup cell content for a task.
 *
 * - `'flag'` mode renders a real `role="checkbox"` toggle (keyboard + pointer
 *   operable when `editable`, else `aria-disabled`), whose checked state mirrors
 *   `task.rollup`. Toggling calls `onToggle(taskId, next)` so the caller applies
 *   the {@link rollupFlagPatch} through its store/engine.
 * - `'summary'` mode renders a static, labelled value span (booleans as a check).
 *
 * The cell is fully token-pure; CSS lives in `rollup-column.css`.
 */
export function buildRollupCell<T extends Model = Model>(
  task: TaskModel<T>,
  source: RollupTreeSource<T>,
  config: RollupColumnConfig<T> = {},
  onToggle?: (taskId: RecordId, next: boolean) => void,
): RollupCellHandle {
  const kind = config.kind ?? 'flag';
  const value = resolveRollupCell(task, source, config);
  const text = formatRollupCell(value, task, config);

  if (kind !== 'flag') {
    const span = createEl('span', { className: CELL });
    span.textContent = text;
    span.dataset.rollupValue = String(value);
    return { el: span, dispose: () => {} };
  }

  // Flag mode: a checkbox toggle.
  const editable = config.editable !== false;
  const checked = value === true;
  const box = createEl('span', { className: `${CHECKBOX}${checked ? ` ${CHECKBOX}--on` : ''}` });
  box.setAttribute('role', 'checkbox');
  box.setAttribute('aria-checked', String(checked));
  box.setAttribute('aria-label', `Roll up ${task.name ?? String(task.id)}`);
  box.dataset.rollupValue = String(checked);
  box.textContent = checked ? CHECK : '';

  if (!editable) {
    box.setAttribute('aria-disabled', 'true');
    return { el: box, dispose: () => {} };
  }

  box.tabIndex = 0;
  const toggle = (e: Event): void => {
    e.stopPropagation(); // don't trigger row activation
    onToggle?.(task.id, !checked);
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === ' ' || e.key === 'Enter' || e.key === 'Spacebar') {
      e.preventDefault();
      toggle(e);
    }
  };
  box.addEventListener('click', toggle);
  box.addEventListener('keydown', onKey);
  return {
    el: box,
    dispose: () => {
      box.removeEventListener('click', toggle);
      box.removeEventListener('keydown', onKey);
    },
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   6. COLUMN FACTORY + REGISTRY (additive wiring seam for the task-tree)
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Build the {@link GanttColumnConfig} for the rollup column. Add it to a Gantt's
 * `columns` (or `DEFAULT_GANTT_COLUMNS`) to surface the rollup data column:
 *
 *   columns: [...DEFAULT_GANTT_COLUMNS, rollupColumn()]
 *   columns: [...DEFAULT_GANTT_COLUMNS, rollupColumn({ kind: 'summary', field: 'percentDone', aggregation: 'avg', header: 'Avg %' })]
 *
 * The accompanying {@link RollupColumnConfig} is stashed on a registry keyed by
 * the column's `field` so the task-tree's `'rollup'` field case can recover it.
 */
export function rollupColumn<T extends Model = Model>(
  config: RollupColumnConfig<T> = {},
): GanttColumnConfig {
  const col: GanttColumnConfig = {
    field: ROLLUP_COLUMN_FIELD,
    header: config.header ?? ROLLUP_COLUMN_HEADER,
    width: config.width ?? 80,
  };
  registerRollupColumnConfig(config);
  return col;
}

/** The default rollup column config (flag/check, editable) — Bryntum default. */
export const ROLLUP_COLUMN: GanttColumnConfig = {
  field: ROLLUP_COLUMN_FIELD,
  header: ROLLUP_COLUMN_HEADER,
  width: 80,
};

/**
 * A process-wide registry of the most-recently-built rollup column config, keyed
 * by field. The task-tree reads it when it encounters a `'rollup'` column whose
 * config it wasn't handed directly. Kept tiny + last-write-wins; a Gantt that
 * needs per-instance configs should pass one explicitly to the task-tree.
 */
const ROLLUP_CONFIG_REGISTRY = new Map<string, RollupColumnConfig>();

/** Stash a rollup column config for later recovery by the task-tree. */
export function registerRollupColumnConfig(config: RollupColumnConfig): void {
  ROLLUP_CONFIG_REGISTRY.set(ROLLUP_COLUMN_FIELD, config);
}

/** Recover the registered rollup column config (or an empty default). */
export function getRollupColumnConfig(): RollupColumnConfig {
  return ROLLUP_CONFIG_REGISTRY.get(ROLLUP_COLUMN_FIELD) ?? {};
}
