/**
 * Span host bridge — wires the headless {@link GridEngine} to the framework-free
 * span-resolution geometry in `../columns/spans.ts`.
 *
 * `spans.ts` resolves merged-cell origins/coverage over a {@link SpanHost}
 * adapter; this module supplies that adapter from a live engine and resolves a
 * {@link SpanMap} for a concrete {@link ViewportWindow}. It is the missing wire
 * that lets the renderer skip covered cells and enlarge origin cells across
 * `colSpan` widths / `rowSpan` heights.
 *
 * Pure + DOM-free: it only reads engine geometry/data and returns a `SpanMap`.
 * The span-aware renderer consumes the map; this keeps span math testable
 * without a renderer and reusable by a future canvas backend (D9).
 */

import type { Model } from '@jects/core';
import type { CellAddress, ColumnDef, ViewportWindow } from '../contract.js';
import {
  resolveSpans,
  spanProviderFor,
  type SpanHost,
  type SpanMap,
  type SpanProvider,
} from '../columns/spans.js';
import type { GridEngine } from './engine.js';

/**
 * Build a {@link SpanHost} over a {@link GridEngine}. The host addresses the
 * *full* (post sort/filter/group) data view by absolute row index and the
 * resolved, ordered visible columns by visible column index — exactly the index
 * space `resolveSpans` scans, so cross-window coverage (an origin scrolled
 * above/left of the painted window) resolves correctly.
 */
export function engineSpanHost<Row extends Model = Model>(
  engine: GridEngine<Row>,
): SpanHost<Row> {
  return {
    rowCount: () => engine.getRowCount(),
    colCount: () => engine.columns.length,
    rowAt: (rowIndex) => engine.getRow(rowIndex),
    columnAt: (colIndex) => engine.columns[colIndex]?.def,
    valueAt: (cell: CellAddress) => {
      const def = engine.columns[cell.colIndex]?.def;
      const row = engine.getRow(cell.rowIndex);
      if (!def || row === undefined || def.field == null) return undefined;
      return (row as Model)[def.field];
    },
  };
}

/**
 * Resolve the {@link SpanMap} for the rows/columns the renderer is about to
 * paint. The window's `startIndex`/`endIndex` are inclusive row bounds (the
 * renderer's convention); we translate them to the half-open `[rowStart,rowEnd)`
 * region `resolveSpans` expects. The column region spans every *visible* column
 * (`0 … engine.columns.length`) rather than only the window's `columns` slice,
 * because a column-virtualized window may omit a colSpan origin that scrolled
 * left of the band while the cells it covers are still painted — scanning all
 * columns keeps that coverage intact.
 *
 * @returns a {@link SpanMap}; `hasSpans === false` means no provider produced a
 *   span > 1 and the renderer can skip all span handling for this paint.
 */
export function computeWindowSpanMap<Row extends Model = Model>(
  engine: GridEngine<Row>,
  window: ViewportWindow,
  providers: (col: ColumnDef<Row>) => SpanProvider<Row> | undefined = spanProviderFor,
): SpanMap {
  const host = engineSpanHost<Row>(engine);
  const rowStart = Math.max(0, window.startIndex);
  // endIndex is inclusive → half-open end is +1. Empty windows (endIndex < start)
  // collapse to an empty region, yielding an empty map.
  const rowEnd = Math.max(rowStart, window.endIndex + 1);
  return resolveSpans<Row>(
    host,
    { rowStart, rowEnd, colStart: 0, colEnd: engine.columns.length },
    providers,
  );
}

/**
 * Whether any visible column declares a span provider (`column.meta.span`). A
 * cheap pre-check the renderer/widget can use to avoid building a `SpanHost` and
 * scanning at all when merged cells are not in play for this column set.
 */
export function hasSpanProviders<Row extends Model = Model>(
  engine: GridEngine<Row>,
): boolean {
  return engine.columns.some((c) => spanProviderFor(c.def) !== undefined);
}
