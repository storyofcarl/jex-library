/**
 * Column layout — pure geometry resolution for grid columns.
 *
 * Resolves an ordered list of {@link ColumnDef}s into laid-out columns with
 * stable ids, pixel widths (honoring fixed/min/max/flex), left offsets, and a
 * partition into frozen-left / scrolling / frozen-right groups. DOM-free and
 * deterministic so it can be unit-tested without a renderer.
 */

import type { Model } from '@jects/core';
import type { ColumnDef, FrozenSide } from '../contract.js';

/** Default fallback width for a column with no `width`/`flex`. */
export const DEFAULT_COLUMN_WIDTH = 150;
/** Default floor when resizing/flexing. */
export const DEFAULT_MIN_COLUMN_WIDTH = 40;

/** A resolved, positioned column ready for painting. */
export interface LaidOutColumn<Row extends Model = Model> {
  /** The source column definition. */
  def: ColumnDef<Row>;
  /** Stable id (def.id ?? def.field ?? generated). */
  id: string;
  /** Index in the *visible* (non-hidden) ordered list. */
  index: number;
  /** Resolved pixel width. */
  width: number;
  /** Left offset (px) within its band (scroll band positions are absolute). */
  left: number;
  /** Pin side, if any. */
  frozen?: FrozenSide;
}

/** Full resolved geometry for one paint. */
export interface ColumnLayout<Row extends Model = Model> {
  /** All visible columns in display order (left-frozen, scrolling, right-frozen). */
  columns: LaidOutColumn<Row>[];
  /** Frozen-left columns. */
  left: LaidOutColumn<Row>[];
  /** Scrolling columns. */
  center: LaidOutColumn<Row>[];
  /** Frozen-right columns. */
  right: LaidOutColumn<Row>[];
  /** Total width of all visible columns (px). */
  totalWidth: number;
  /** Sum of frozen-left widths (px). */
  leftWidth: number;
  /** Sum of frozen-right widths (px). */
  rightWidth: number;
}

/** Stable id for a column: explicit `id`, else `field`, else positional. */
export function columnId<Row extends Model>(def: ColumnDef<Row>, fallbackIndex: number): string {
  return def.id ?? def.field ?? `col-${fallbackIndex}`;
}

function clampWidth(w: number, minWidth?: number, maxWidth?: number): number {
  let width = w;
  if (minWidth != null) width = Math.max(width, minWidth);
  else width = Math.max(width, DEFAULT_MIN_COLUMN_WIDTH);
  if (maxWidth != null) width = Math.min(width, maxWidth);
  return width;
}

/**
 * Resolve column geometry.
 *
 * @param defs        ordered column definitions (hidden columns are skipped)
 * @param available   container content width in px (for flex distribution); 0 disables flex growth
 */
export function resolveColumns<Row extends Model = Model>(
  defs: ReadonlyArray<ColumnDef<Row>>,
  available = 0,
): ColumnLayout<Row> {
  const visible = defs
    .map((def, i) => ({ def, srcIndex: i }))
    .filter(({ def }) => !def.hidden);

  // First pass: base widths and total flex weight.
  let fixedTotal = 0;
  let flexTotal = 0;
  const base = visible.map(({ def, srcIndex }) => {
    const hasFlex = typeof def.flex === 'number' && def.flex > 0;
    const width = hasFlex
      ? clampWidth(def.minWidth ?? DEFAULT_MIN_COLUMN_WIDTH, def.minWidth, def.maxWidth)
      : clampWidth(def.width ?? DEFAULT_COLUMN_WIDTH, def.minWidth, def.maxWidth);
    if (hasFlex) flexTotal += def.flex as number;
    else fixedTotal += width;
    return { def, srcIndex, width, flex: hasFlex ? (def.flex as number) : 0 };
  });

  // Second pass: distribute leftover space across flex columns.
  const leftover = Math.max(0, available - fixedTotal);
  if (flexTotal > 0 && leftover > 0) {
    for (const col of base) {
      if (col.flex > 0) {
        const share = (leftover * col.flex) / flexTotal;
        col.width = clampWidth(share, col.def.minWidth, col.def.maxWidth);
      }
    }
  }

  // Partition by frozen side, preserving display order within each band.
  const left: LaidOutColumn<Row>[] = [];
  const center: LaidOutColumn<Row>[] = [];
  const right: LaidOutColumn<Row>[] = [];

  base.forEach((col, visIndex) => {
    const laid: LaidOutColumn<Row> = {
      def: col.def,
      id: columnId(col.def, col.srcIndex),
      index: visIndex,
      width: col.width,
      left: 0,
      ...(col.def.frozen ? { frozen: col.def.frozen } : {}),
    };
    if (col.def.frozen === 'left') left.push(laid);
    else if (col.def.frozen === 'right') right.push(laid);
    else center.push(laid);
  });

  // Assign left offsets per band.
  let leftWidth = 0;
  for (const c of left) {
    c.left = leftWidth;
    leftWidth += c.width;
  }
  let centerX = 0;
  for (const c of center) {
    c.left = centerX;
    centerX += c.width;
  }
  let rightWidth = 0;
  for (const c of right) {
    c.left = rightWidth;
    rightWidth += c.width;
  }

  const ordered = [...left, ...center, ...right];
  // Re-stamp `index` to the final display order so colIndex is stable.
  ordered.forEach((c, i) => {
    c.index = i;
  });

  return {
    columns: ordered,
    left,
    center,
    right,
    totalWidth: leftWidth + centerX + rightWidth,
    leftWidth,
    rightWidth,
  };
}

/**
 * Horizontal column window for very wide grids. Returns the inclusive index
 * range of *center* (scrolling) columns intersecting the viewport, plus
 * overscan. Frozen columns always render.
 */
export function computeColumnWindow<Row extends Model = Model>(
  center: ReadonlyArray<LaidOutColumn<Row>>,
  scrollLeft: number,
  viewportWidth: number,
  overscan = 1,
): { start: number; end: number } {
  if (center.length === 0) return { start: 0, end: -1 };
  let start = 0;
  let end = center.length - 1;
  for (let i = 0; i < center.length; i++) {
    const c = center[i]!;
    if (c.left + c.width > scrollLeft) {
      start = Math.max(0, i - overscan);
      break;
    }
  }
  const rightEdge = scrollLeft + viewportWidth;
  for (let i = start; i < center.length; i++) {
    const c = center[i]!;
    if (c.left >= rightEdge) {
      end = Math.min(center.length - 1, i + overscan);
      break;
    }
  }
  return { start, end };
}
