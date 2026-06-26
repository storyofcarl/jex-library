/**
 * Event/bar positioning helpers on the time axis.
 *
 * Pure geometry over the FROZEN contract: given a `TimeAxis` projection and the
 * contract's `TimeSpan` / `EventBar` types, compute pixel boxes, terminal anchor
 * points (for dependency endpoints), edge-zone hit-testing (for resize handles),
 * and pointer→bar hit-testing. No DOM, no engine internals — both the renderer
 * and the drag/resize/router primitives in this folder build on these.
 */

import type { Model } from '@jects/core';
import type {
  TimeAxis,
  TimeSpan,
  TimeMs,
  EventBar,
  DependencyTerminal,
} from '../contract.js';

/** A pixel box in axis/row content coordinates. */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A point in axis/row content coordinates. */
export interface Point {
  x: number;
  y: number;
}

/** Which part of a bar a pointer is over (drives the cursor + gesture). */
export type BarZone = 'start' | 'body' | 'end';

/** Project a time span to its horizontal `{ x, width }` box via the axis. */
export function spanBox(axis: TimeAxis, span: TimeSpan): { x: number; width: number } {
  return axis.spanToBox(span);
}

/**
 * Full pixel box of a bar: the axis projection of its span (horizontal) combined
 * with the row-relative `y`/`height` the layout assigned. Width is floored at 0.
 */
export function barBox<E extends Model>(axis: TimeAxis, bar: EventBar<E>): Box {
  const { x, width } = axis.spanToBox(bar.event.span);
  return { x, y: bar.y, width: Math.max(0, width), height: bar.height };
}

/**
 * The anchor point of a bar terminal in content coordinates — where a dependency
 * line attaches. `'start'` anchors at the left-center, `'end'` at the
 * right-center. `rowOffset` is the row's absolute top in content space (the
 * caller adds it so the point lands in viewport/content coords, not row-local).
 */
export function terminalPoint<E extends Model>(
  axis: TimeAxis,
  bar: EventBar<E>,
  side: DependencyTerminal,
  rowOffset = 0,
): Point {
  const box = barBox(axis, bar);
  const cy = rowOffset + box.y + box.height / 2;
  const cx = side === 'start' ? box.x : box.x + box.width;
  return { x: cx, y: cy };
}

/**
 * Hit-test a content-space x against a bar's horizontal extent, returning which
 * zone the pointer is in. The leading/trailing `edge` px map to resize handles;
 * everything between is `body` (a move gesture). When the bar is narrower than
 * `2*edge`, the edges shrink proportionally so a tiny bar still splits 3 ways.
 */
export function zoneAtX<E extends Model>(
  axis: TimeAxis,
  bar: EventBar<E>,
  contentX: number,
  edge = 6,
): BarZone | null {
  const { x, width } = barBox(axis, bar);
  if (contentX < x || contentX > x + width) return null;
  if (width <= 0) return 'body';
  const e = Math.min(edge, width / 2);
  if (contentX <= x + e) return 'start';
  if (contentX >= x + width - e) return 'end';
  return 'body';
}

/** Does a content-space point fall within a bar's box? */
export function barContains<E extends Model>(
  axis: TimeAxis,
  bar: EventBar<E>,
  point: Point,
  rowOffset = 0,
): boolean {
  const box = barBox(axis, bar);
  const top = rowOffset + box.y;
  return (
    point.x >= box.x &&
    point.x <= box.x + box.width &&
    point.y >= top &&
    point.y <= top + box.height
  );
}

/**
 * Topmost bar (last in paint order) whose box contains the point. Bars later in
 * the array paint above earlier ones, so we scan back-to-front. `rowOffsets`
 * maps a bar's `rowId` to its absolute top; omit for row-local hit-testing.
 */
export function barAtPoint<E extends Model>(
  axis: TimeAxis,
  bars: ReadonlyArray<EventBar<E>>,
  point: Point,
  rowOffsets?: ReadonlyMap<unknown, number>,
): EventBar<E> | undefined {
  for (let i = bars.length - 1; i >= 0; i--) {
    const bar = bars[i]!;
    const off = rowOffsets?.get(bar.event.rowId) ?? 0;
    if (barContains(axis, bar, point, off)) return bar;
  }
  return undefined;
}

/**
 * Map a content-space x back to a time, snapped to the axis tick grid when
 * `snap` is true. Convenience over `axis.toTime` + `axis.snap` used by the
 * drag-create primitive while sweeping out a new bar.
 */
export function timeAtX(axis: TimeAxis, contentX: number, snap = false): TimeMs {
  const t = axis.toTime(contentX);
  return snap ? axis.snap(t) : t;
}

/**
 * Normalize an open-ended sweep (anchor + current x) into an ordered span so a
 * drag-create works in either direction. Both ends optionally snap to ticks.
 */
export function sweepSpan(
  axis: TimeAxis,
  anchorX: number,
  currentX: number,
  snap = false,
): TimeSpan {
  const a = timeAtX(axis, anchorX, snap);
  const b = timeAtX(axis, currentX, snap);
  return a <= b ? { start: a, end: b } : { start: b, end: a };
}
