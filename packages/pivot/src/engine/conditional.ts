/**
 * Conditional cell formatting for the pivot value cells.
 *
 * A {@link ConditionalFormat} is either a callback — evaluated per value cell
 * with its value + identity ({@link ConditionalContext}) — or a declarative
 * array of {@link ConditionalRule}s (cell-value thresholds, color scales, data
 * bars). Both resolve to a {@link CellStyle} (a CSS class and/or inline style
 * map) that the projection applies to the rendered `<td>`. Rules are evaluated
 * in order; later rules merge over earlier ones (last write wins per property).
 *
 * Framework-free: this module produces plain class/style descriptors and never
 * touches the DOM, so it is unit-testable in node and reusable by export.
 */

import type { PivotColumnLeaf } from './engine.js';

/** Context passed to a conditional-format callback / rule evaluation. */
export interface ConditionalContext {
  /** The aggregated cell value (`null` for empty cells). */
  value: number | null;
  /** The value field id this cell measures (`undefined` for count-only). */
  field?: string;
  /** The row member key path identifying the cell's matrix row. */
  rowKey: string[];
  /** The column member key path identifying the cell's column leaf. */
  colKey: string[];
  /** The column leaf descriptor (value index, total flag, …). */
  leaf: PivotColumnLeaf;
  /** Whether the cell belongs to a subtotal / grand-total row or column. */
  isTotal: boolean;
}

/** A resolved cell decoration: an optional class + inline style properties. */
export interface CellStyle {
  /** Space-separated class names to add to the cell. */
  class?: string;
  /** Inline CSS properties (camelCase keys → values) to set on the cell. */
  style?: Record<string, string>;
}

/** A callback form: full control over the produced decoration. */
export type ConditionalCallback = (ctx: ConditionalContext) => CellStyle | null | undefined | void;

/**
 * Highlight cells whose value satisfies a comparison against `value`. Emits the
 * given `class` and/or `style` when the predicate holds.
 */
export interface CellValueRule {
  kind: 'cellValue';
  /** Comparison operator. */
  op: 'eq' | 'ne' | 'lt' | 'lte' | 'gt' | 'gte' | 'between';
  /** Threshold (or lower bound for `between`). */
  value: number;
  /** Upper bound for `between` (inclusive). */
  value2?: number;
  /** Restrict the rule to one value field id. */
  field?: string;
  /** Class to add when the predicate holds. */
  class?: string;
  /** Inline style to set when the predicate holds. */
  style?: Record<string, string>;
}

/**
 * Two/three-point color scale mapping the value's position within the column's
 * observed min..max range to a background color (linear RGB interpolation).
 */
export interface ColorScaleRule {
  kind: 'colorScale';
  /** Color at the minimum (CSS color). */
  min: string;
  /** Color at the maximum (CSS color). */
  max: string;
  /** Optional midpoint color (placed at the median of the range). */
  mid?: string;
  /** Restrict the rule to one value field id. */
  field?: string;
  /** CSS property to set. Default `'background-color'`. */
  property?: string;
}

/**
 * Data bar: render a horizontal gradient bar whose width is proportional to the
 * value's position within the column's observed min..max range.
 */
export interface DataBarRule {
  kind: 'dataBar';
  /** Bar color (CSS color). */
  color: string;
  /** Restrict the rule to one value field id. */
  field?: string;
}

/** A declarative conditional-format rule. */
export type ConditionalRule = CellValueRule | ColorScaleRule | DataBarRule;

/** A conditional format: a callback or a list of declarative rules. */
export type ConditionalFormat = ConditionalCallback | ConditionalRule[];

/* ── per-column statistics (for scales / bars) ─────────────────────────── */

/** Observed numeric extent of a value field across the data rows of a column. */
export interface ColumnStat {
  min: number;
  max: number;
}

/**
 * The min/max of every column leaf's non-total data cells — the domain color
 * scales and data bars interpolate within. Computed once per result so the
 * per-cell evaluation is O(1).
 */
export type ColumnStats = Map<string, ColumnStat>;

/**
 * Build per-column min/max over the supplied (non-total) cell values. `rows`
 * yields, for each data row, a `key → value` cell map; totals should be
 * excluded by the caller so scales reflect the data, not the totals.
 */
export function buildColumnStats(
  leafKeys: string[],
  rows: Array<Record<string, number | null>>,
): ColumnStats {
  const stats: ColumnStats = new Map();
  for (const key of leafKeys) {
    let min = Infinity;
    let max = -Infinity;
    for (const row of rows) {
      const v = row[key];
      if (v == null || !Number.isFinite(v)) continue;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    if (min !== Infinity) stats.set(key, { min, max });
  }
  return stats;
}

/* ── rule evaluation ───────────────────────────────────────────────────── */

function ruleApplies(field: string | undefined, ctxField: string | undefined): boolean {
  return field === undefined || field === ctxField;
}

function comparePasses(rule: CellValueRule, v: number): boolean {
  switch (rule.op) {
    case 'eq':
      return v === rule.value;
    case 'ne':
      return v !== rule.value;
    case 'lt':
      return v < rule.value;
    case 'lte':
      return v <= rule.value;
    case 'gt':
      return v > rule.value;
    case 'gte':
      return v >= rule.value;
    case 'between':
      return v >= rule.value && v <= (rule.value2 ?? rule.value);
    default:
      return false;
  }
}

/** Parse a `#rgb` / `#rrggbb` hex string to an `[r,g,b]` triple (0 on failure). */
function parseHex(color: string): [number, number, number] {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return [0, 0, 0];
  let hex = m[1]!;
  if (hex.length === 3) hex = hex[0]! + hex[0]! + hex[1]! + hex[1]! + hex[2]! + hex[2]!;
  return [
    parseInt(hex.slice(0, 2), 16),
    parseInt(hex.slice(2, 4), 16),
    parseInt(hex.slice(4, 6), 16),
  ];
}

function lerp(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

function mixColors(from: string, to: string, t: number): string {
  const [r1, g1, b1] = parseHex(from);
  const [r2, g2, b2] = parseHex(to);
  return `rgb(${lerp(r1, r2, t)}, ${lerp(g1, g2, t)}, ${lerp(b1, b2, t)})`;
}

/** Position of `v` within `[min,max]`, clamped to `[0,1]` (0.5 when flat). */
function fraction(v: number, stat: ColumnStat): number {
  if (stat.max === stat.min) return 0.5;
  const t = (v - stat.min) / (stat.max - stat.min);
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

function mergeStyle(into: CellStyle, add: CellStyle | null | undefined): void {
  if (!add) return;
  if (add.class) into.class = into.class ? `${into.class} ${add.class}` : add.class;
  if (add.style) into.style = { ...(into.style ?? {}), ...add.style };
}

/**
 * Evaluate a conditional format for one cell, returning the merged decoration
 * (or `null` when nothing applies). `stats` is required for `colorScale` /
 * `dataBar` rules; pass it from {@link buildColumnStats}.
 */
export function evaluateConditional(
  format: ConditionalFormat,
  ctx: ConditionalContext,
  stats?: ColumnStats,
): CellStyle | null {
  if (typeof format === 'function') {
    return format(ctx) ?? null;
  }

  const out: CellStyle = {};
  let touched = false;
  const v = ctx.value;

  for (const rule of format) {
    if (!ruleApplies(rule.field, ctx.field)) continue;
    if (rule.kind === 'cellValue') {
      if (v == null || !Number.isFinite(v) || !comparePasses(rule, v)) continue;
      mergeStyle(out, { ...(rule.class ? { class: rule.class } : {}), ...(rule.style ? { style: rule.style } : {}) });
      touched = true;
    } else if (rule.kind === 'colorScale') {
      if (v == null || !Number.isFinite(v)) continue;
      const stat = stats?.get(ctx.leaf.key);
      if (!stat) continue;
      const t = fraction(v, stat);
      const color =
        rule.mid !== undefined
          ? t <= 0.5
            ? mixColors(rule.min, rule.mid, t * 2)
            : mixColors(rule.mid, rule.max, (t - 0.5) * 2)
          : mixColors(rule.min, rule.max, t);
      mergeStyle(out, { style: { [rule.property ?? 'background-color']: color } });
      touched = true;
    } else if (rule.kind === 'dataBar') {
      if (v == null || !Number.isFinite(v)) continue;
      const stat = stats?.get(ctx.leaf.key);
      if (!stat) continue;
      const pct = Math.round(fraction(v, stat) * 100);
      // A left-anchored gradient: solid color up to `pct%`, transparent after.
      mergeStyle(out, {
        style: {
          backgroundImage: `linear-gradient(to right, ${rule.color} 0%, ${rule.color} ${pct}%, transparent ${pct}%, transparent 100%)`,
          backgroundRepeat: 'no-repeat',
        },
      });
      touched = true;
    }
  }
  return touched ? out : null;
}
