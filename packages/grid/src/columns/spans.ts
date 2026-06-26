/**
 * Cell spans — column-span and row-span resolution. A consumer declares a span
 * function per column (or via `column.meta.span`); this module resolves, for a
 * window of rows × columns, which cells are span "origins" (rendered, possibly
 * enlarged) and which are "covered" (hidden because an origin overlaps them).
 *
 * Framework-free: pure geometry over a `SpanHost` adapter that yields the
 * declared span for an origin cell. The engine consumes the resolved map to size
 * origin cells (colSpan→width sum, rowSpan→height sum) and skip covered cells.
 */

import type { Model } from '@jects/core';
import type { CellAddress, ColumnDef } from '../contract.js';

/** A declared span at an origin cell. `1`/`1` means no span. */
export interface CellSpan {
  /** Number of columns the cell occupies (≥1). */
  colSpan: number;
  /** Number of rows the cell occupies (≥1). */
  rowSpan: number;
}

/** Context passed to a span provider for one origin cell. */
export interface SpanContext<Row extends Model = Model> {
  row: Row;
  value: unknown;
  column: ColumnDef<Row>;
  rowIndex: number;
  colIndex: number;
}

/** A function returning the span for a candidate origin cell. */
export type SpanProvider<Row extends Model = Model> = (
  ctx: SpanContext<Row>,
) => CellSpan | number | void;

/** Adapter the engine supplies so span resolution can read cells. */
export interface SpanHost<Row extends Model = Model> {
  rowCount(): number;
  colCount(): number;
  /** Row model at a view index. */
  rowAt(rowIndex: number): Row | undefined;
  /** Column def at a visible column index. */
  columnAt(colIndex: number): ColumnDef<Row> | undefined;
  /** Cell value at an address. */
  valueAt(cell: CellAddress): unknown;
}

/** Normalize a provider result to a `CellSpan` with sane minimums. */
export function normalizeSpan(result: CellSpan | number | void): CellSpan {
  if (result == null) return { colSpan: 1, rowSpan: 1 };
  if (typeof result === 'number') {
    return { colSpan: Math.max(1, Math.floor(result)), rowSpan: 1 };
  }
  return {
    colSpan: Math.max(1, Math.floor(result.colSpan ?? 1)),
    rowSpan: Math.max(1, Math.floor(result.rowSpan ?? 1)),
  };
}

/** Read the effective span provider for a column (per-column meta wins). */
export function spanProviderFor<Row extends Model>(
  column: ColumnDef<Row>,
): SpanProvider<Row> | undefined {
  return (column.meta as { span?: SpanProvider<Row> } | undefined)?.span;
}

const key = (r: number, c: number): string => `${r}:${c}`;

/** One resolved span origin (the cell that actually renders). */
export interface SpanOrigin {
  rowIndex: number;
  colIndex: number;
  colSpan: number;
  rowSpan: number;
}

/** The resolved span map for a region. */
export interface SpanMap {
  /** Renderable origin cells *inside the window*, keyed by `"row:col"`. */
  origins: Map<string, SpanOrigin>;
  /** Covered (hidden) cells *inside the window* keyed by `"row:col"` → covering origin key. */
  covered: Map<string, string>;
  /**
   * Origins that live *outside* the window but whose span reaches into it (e.g.
   * a row/col-span origin scrolled above/left of the current overscan). The
   * engine uses these to know a window cell is covered (so it skips rendering a
   * duplicate) even though the origin itself is not painted.
   */
  clippedOrigins: Map<string, SpanOrigin>;
  /** True if any span > 1 exists (engine can skip span handling otherwise). */
  hasSpans: boolean;
}

/**
 * Resolve spans for the painted window [rowStart,rowEnd) × [colStart,colEnd).
 *
 * Correctness under virtualization: a span origin can scroll above/left of
 * the window while the cells it covers remain inside it; conversely an origin
 * inside the window can span below/right of it. Therefore origins are
 * discovered against the **data** bounds — we scan from row/column 0 up to the
 * window end so any origin whose span reaches into the window is found — and the
 * span extent is clamped only to the data bounds, never to the window. The
 * `origins`/`covered` maps returned are then *intersected with the window* so the
 * renderer only sees cells it actually paints (an origin scrolled out of view is
 * reported via `clippedOrigins` so the engine can still size/skip correctly).
 */
export function resolveSpans<Row extends Model>(
  host: SpanHost<Row>,
  region: { rowStart: number; rowEnd: number; colStart: number; colEnd: number },
  providers: (col: ColumnDef<Row>) => SpanProvider<Row> | undefined = spanProviderFor,
): SpanMap {
  const origins = new Map<string, SpanOrigin>();
  const covered = new Map<string, string>();
  /** Origins discovered outside the window whose span reaches into it. */
  const clippedOrigins = new Map<string, SpanOrigin>();
  let hasSpans = false;

  const dataRows = host.rowCount();
  const dataCols = host.colCount();

  const winRowStart = Math.max(0, region.rowStart);
  const winRowEnd = Math.min(region.rowEnd, dataRows);
  const winColStart = Math.max(0, region.colStart);
  const winColEnd = Math.min(region.colEnd, dataCols);

  // Scan origins from the data start up to the window end. Starting at 0 means an
  // origin that scrolled above/left of the window is still discovered, so the
  // cells it covers inside the window are recorded (no visual duplication).
  const scanRowEnd = winRowEnd;
  const scanColEnd = winColEnd;

  const inWindow = (r: number, c: number): boolean =>
    r >= winRowStart && r < winRowEnd && c >= winColStart && c < winColEnd;

  for (let r = 0; r < scanRowEnd; r++) {
    const row = host.rowAt(r);
    for (let c = 0; c < scanColEnd; c++) {
      const k = key(r, c);
      if (covered.has(k)) continue; // covered by an earlier origin

      const column = host.columnAt(c);
      if (!column || row === undefined) {
        if (inWindow(r, c)) origins.set(k, { rowIndex: r, colIndex: c, colSpan: 1, rowSpan: 1 });
        continue;
      }
      const provider = providers(column);
      const span = normalizeSpan(
        provider?.({
          row,
          value: host.valueAt({ rowIndex: r, colIndex: c }),
          column,
          rowIndex: r,
          colIndex: c,
        }),
      );

      // Clamp to DATA bounds (not the window) so cross-window coverage survives.
      const colSpan = Math.min(span.colSpan, dataCols - c);
      const rowSpan = Math.min(span.rowSpan, dataRows - r);
      const origin: SpanOrigin = { rowIndex: r, colIndex: c, colSpan, rowSpan };

      const spans = colSpan > 1 || rowSpan > 1;
      if (spans) hasSpans = true;

      // Record the origin: in the window → `origins` (renderable); outside but
      // its span reaches in → `clippedOrigins` (for sizing/skip decisions).
      if (inWindow(r, c)) {
        origins.set(k, origin);
      } else if (spans && originReachesWindow(origin, winRowStart, winRowEnd, winColStart, winColEnd)) {
        clippedOrigins.set(k, origin);
      }

      if (spans) {
        for (let rr = r; rr < r + rowSpan; rr++) {
          for (let cc = c; cc < c + colSpan; cc++) {
            if (rr === r && cc === c) continue;
            // Only intersect the painted window: the renderer skips these cells.
            if (inWindow(rr, cc)) covered.set(key(rr, cc), k);
          }
        }
      }
    }
  }

  return { origins, covered, clippedOrigins, hasSpans };
}

/** True if an origin's (data-clamped) span rectangle intersects the window. */
function originReachesWindow(
  origin: SpanOrigin,
  winRowStart: number,
  winRowEnd: number,
  winColStart: number,
  winColEnd: number,
): boolean {
  const rEnd = origin.rowIndex + origin.rowSpan;
  const cEnd = origin.colIndex + origin.colSpan;
  return (
    origin.rowIndex < winRowEnd &&
    rEnd > winRowStart &&
    origin.colIndex < winColEnd &&
    cEnd > winColStart
  );
}

/** True if the cell is hidden (covered) under the resolved span map. */
export function isCovered(map: SpanMap, rowIndex: number, colIndex: number): boolean {
  return map.covered.has(key(rowIndex, colIndex));
}

/** The origin descriptor for a cell, if it is a rendered origin. */
export function originAt(map: SpanMap, rowIndex: number, colIndex: number): SpanOrigin | undefined {
  return map.origins.get(key(rowIndex, colIndex));
}
