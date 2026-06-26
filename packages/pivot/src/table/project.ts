/**
 * Project a {@link PivotResult} onto @jects/grid `ColumnDef[]` + row records.
 *
 * The pivot matrix is rendered by REUSING the Grid: row-header fields become
 * leading frozen text columns, and each column leaf becomes a numeric column
 * keyed by the leaf's stable key. Each matrix row becomes a flat Grid row
 * record carrying its header labels + cell values + metadata used for styling
 * (depth, total flag) and custom templates.
 */

import { createEl } from '@jects/core';
import type { Model } from '@jects/core';
import type { ColumnDef, CellRenderContext } from '@jects/grid';
import type { PivotResult, PivotColumnLeaf, PivotMatrixRow } from '../engine/index.js';
import {
  buildColumnStats,
  evaluateConditional,
  type ConditionalFormat,
  type ColumnStats,
  type CellStyle,
} from '../engine/index.js';

/** Metadata carried on each projected grid row (under reserved keys). */
export const PIVOT_META = {
  depth: '__pivotDepth',
  total: '__pivotTotal',
  key: '__pivotKey',
  headers: '__pivotHeaders',
} as const;

/** A flat grid row record produced from a pivot matrix row. */
export type PivotGridRow = Model & {
  [PIVOT_META.depth]: number;
  [PIVOT_META.total]: boolean;
  [PIVOT_META.key]: string;
  [PIVOT_META.headers]: string[];
};

/** A custom cell template for projected value cells. */
export interface PivotCellTemplate {
  (ctx: {
    value: number | null;
    leaf: PivotColumnLeaf;
    row: PivotMatrixRow;
    el: HTMLElement;
  }): string | HTMLElement | void;
}

export interface ProjectOptions {
  /** Header labels for the leading row-field columns. */
  rowFieldLabels?: string[];
  /** Format a numeric value cell for display. */
  formatValue?: (value: number | null, leaf: PivotColumnLeaf) => string;
  /** Width (px) of each row-header column. Default 160. */
  rowHeaderWidth?: number;
  /** Width (px) of each value column. Default 120. */
  valueWidth?: number;
  /** Freeze the row-header columns to the left. Default `true`. */
  freezeRowHeaders?: boolean;
  /** Per-cell custom template. */
  cellTemplate?: PivotCellTemplate;
  /** Indentation (px) per tree depth applied to the first row-header column. */
  indent?: number;
  /**
   * Conditional cell formatting — a callback or declarative rules applied to
   * value cells (see {@link ConditionalFormat}). The resolved class/style is
   * added to the cell `<td>`.
   */
  conditionalFormat?: ConditionalFormat;
  /**
   * Invoked when a collapsible row-header toggle is activated. The widget wires
   * this to flip the node's collapse state and recompute.
   */
  onToggle?: (nodeKey: string, collapsed: boolean) => void;
}

const defaultFormat = (value: number | null): string => (value == null ? '' : String(value));

/** Build the Grid column definitions for a pivot result. */
export function projectColumns(
  result: PivotResult,
  options: ProjectOptions = {},
): ColumnDef<PivotGridRow>[] {
  const rowLabels = options.rowFieldLabels ?? [];
  const rowHeaderWidth = options.rowHeaderWidth ?? 160;
  const valueWidth = options.valueWidth ?? 120;
  const freeze = options.freezeRowHeaders ?? true;
  const format = options.formatValue ?? defaultFormat;
  const indent = options.indent ?? 16;

  const cols: ColumnDef<PivotGridRow>[] = [];
  const rowFieldCount = Math.max(result.rowFieldCount, 1);

  // Per-column min/max over non-total data rows — the domain color scales and
  // data bars interpolate within. Computed once so per-cell eval stays O(1).
  const stats: ColumnStats | undefined = options.conditionalFormat
    ? buildColumnStats(
        result.columnLeaves.filter((l) => !l.isTotal).map((l) => l.key),
        result.matrix.filter((r) => !r.isTotal).map((r) => r.cells),
      )
    : undefined;

  for (let i = 0; i < rowFieldCount; i++) {
    const headerKey = `__h${i}`;
    cols.push({
      id: headerKey,
      field: headerKey,
      header: rowLabels[i] ?? (rowFieldCount === 1 ? '' : `Level ${i + 1}`),
      width: rowHeaderWidth,
      type: 'template',
      align: 'start',
      ...(freeze ? { frozen: 'left' as const } : {}),
      renderer: (ctx: CellRenderContext<PivotGridRow>) => {
        const row = ctx.row;
        const depth = (row[PIVOT_META.depth] as number) ?? 0;
        const isTotal = (row[PIVOT_META.total] as boolean) ?? false;
        const text = String(ctx.value ?? '');
        ctx.el.classList.toggle('jects-pivot__cell--total', isTotal);
        if (i === 0 && depth > 0) {
          ctx.el.style.paddingInlineStart = `${depth * indent}px`;
        }
        // Collapse toggle on the first row-header column for collapsible nodes.
        const matrixRow = row['__row'] as PivotMatrixRow | undefined;
        if (i === 0 && matrixRow?.collapsible && matrixRow.nodeKey) {
          return collapseToggleCell(text, matrixRow, options.onToggle);
        }
        return text;
      },
    });
  }

  for (const leaf of result.columnLeaves) {
    cols.push({
      id: leaf.key,
      field: leaf.key,
      header: leafHeader(leaf),
      width: valueWidth,
      type: 'number',
      align: 'end',
      ...(leaf.isTotal ? { meta: { pivotTotal: true } } : {}),
      renderer: (ctx: CellRenderContext<PivotGridRow>) => {
        const value = (ctx.value as number | null) ?? null;
        const matrixRow = ctx.row['__row'] as PivotMatrixRow | undefined;
        const isTotal =
          ((ctx.row[PIVOT_META.total] as boolean) ?? false) || !!leaf.isTotal;
        ctx.el.classList.toggle('jects-pivot__cell--total', isTotal);
        // Conditional formatting: resolve a class/style decoration and apply it.
        if (options.conditionalFormat) {
          const style = evaluateConditional(
            options.conditionalFormat,
            {
              value,
              ...(leaf.valueField ? { field: leaf.valueField } : {}),
              rowKey: matrixRow?.keyPath ?? [],
              colKey: leaf.keyPath,
              leaf,
              isTotal,
            },
            stats,
          );
          applyCellStyle(ctx.el, style);
        }
        if (options.cellTemplate) {
          const r = matrixRow ?? ({ cells: {} } as PivotMatrixRow);
          return options.cellTemplate({ value, leaf, row: r, el: ctx.el });
        }
        return format(value, leaf);
      },
    });
  }

  return cols;
}

/** Build the Grid row records for a pivot result. */
export function projectRows(result: PivotResult): PivotGridRow[] {
  const rowFieldCount = Math.max(result.rowFieldCount, 1);
  return result.matrix.map((row, index) => {
    const record: PivotGridRow = {
      id: `${row.keyPath.join('') || 'row'}_${index}`,
      [PIVOT_META.depth]: row.depth,
      [PIVOT_META.total]: !!row.isTotal,
      [PIVOT_META.key]: row.keyPath.join('') || `row${index}`,
      [PIVOT_META.headers]: row.headers,
      __row: row,
    };
    for (let i = 0; i < rowFieldCount; i++) {
      record[`__h${i}`] = row.headers[i] ?? '';
    }
    for (const leaf of result.columnLeaves) {
      record[leaf.key] = row.cells[leaf.key] ?? null;
    }
    return record;
  });
}

/** Compose a column leaf's header label (member path + value field). */
export function leafHeader(leaf: PivotColumnLeaf): string {
  const parts = leaf.isTotal ? ['Total'] : [...leaf.path];
  if (leaf.valueLabel && leaf.valueLabel !== 'Value') parts.push(leaf.valueLabel);
  return parts.filter(Boolean).join(' · ') || leaf.valueLabel;
}

/* ── cell decoration helpers ───────────────────────────────────────────── */

/** Apply a resolved {@link CellStyle} (class + inline props) to a cell `<td>`. */
function applyCellStyle(el: HTMLElement, style: CellStyle | null): void {
  if (!style) return;
  if (style.class) {
    for (const cls of style.class.split(/\s+/)) if (cls) el.classList.add(cls);
  }
  if (style.style) {
    for (const [prop, value] of Object.entries(style.style)) {
      el.style.setProperty(toKebab(prop), value);
    }
  }
}

/** camelCase → kebab-case for inline CSS property names. */
function toKebab(prop: string): string {
  return prop.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}

/**
 * Build the first row-header cell content for a collapsible node: an expand /
 * collapse toggle button followed by the member label. Activating the toggle
 * invokes `onToggle(nodeKey, nextCollapsed)`.
 */
function collapseToggleCell(
  text: string,
  row: PivotMatrixRow,
  onToggle: ((nodeKey: string, collapsed: boolean) => void) | undefined,
): HTMLElement {
  const wrap = createEl('span', { className: 'jects-pivot__rowlabel' });
  const collapsed = !!row.collapsed;
  const btn = createEl('button', { className: 'jects-pivot__toggle' });
  btn.type = 'button';
  btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  btn.setAttribute('aria-label', `${collapsed ? 'Expand' : 'Collapse'} ${text}`);
  btn.textContent = collapsed ? '▸' : '▾';
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    onToggle?.(row.nodeKey!, !collapsed);
  });
  wrap.appendChild(btn);
  const label = createEl('span', { className: 'jects-pivot__rowlabel-text' });
  label.textContent = text;
  wrap.appendChild(label);
  return wrap;
}
