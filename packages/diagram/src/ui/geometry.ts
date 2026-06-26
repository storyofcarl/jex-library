/**
 * Pure geometry helpers for the Diagram UI. Framework-free, no DOM. Operates on
 * the contract's {@link Point}/{@link Size}/{@link Rect} primitives so the
 * rendering, hit-testing, snapping, and alignment code share one math layer.
 */
import type { Point, Rect, Size, ShapeModel } from '../contract.js';

/** Axis-aligned bounding box of a shape (ignores rotation for layout math). */
export function shapeRect(s: Pick<ShapeModel, 'x' | 'y' | 'w' | 'h'>): Rect {
  return { x: s.x, y: s.y, width: s.w, height: s.h };
}

/** Center point of a rect. */
export function rectCenter(r: Rect): Point {
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

/** Whether a point lies inside (or on the edge of) a rect. */
export function pointInRect(p: Point, r: Rect): boolean {
  return p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;
}

/** Whether two rects overlap at all. */
export function rectsIntersect(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

/** Whether `inner` is fully contained by `outer`. */
export function rectContainsRect(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

/** Smallest rect that encloses all of `rects` (or null if empty). */
export function unionRects(rects: readonly Rect[]): Rect | null {
  if (rects.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of rects) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.width);
    maxY = Math.max(maxY, r.y + r.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Normalize a possibly-inverted drag rect to positive width/height. */
export function normalizeRect(a: Point, b: Point): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
}

/** Distance from a point to a line segment (for connector hit-testing). */
export function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Minimum distance from a point to a polyline (>=2 points). */
export function distToPolyline(p: Point, pts: readonly Point[]): number {
  if (pts.length === 0) return Infinity;
  const first = pts[0]!;
  if (pts.length === 1) return Math.hypot(p.x - first.x, p.y - first.y);
  let min = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    min = Math.min(min, distToSegment(p, pts[i]!, pts[i + 1]!));
  }
  return min;
}

/** Snap a scalar to the nearest multiple of `step` (no-op when step<=0). */
export function snapScalar(v: number, step: number): number {
  if (!step || step <= 0) return v;
  return Math.round(v / step) * step;
}

/** Snap a point to a grid step. */
export function snapPoint(p: Point, step: number): Point {
  return { x: snapScalar(p.x, step), y: snapScalar(p.y, step) };
}

/** Clamp a number to a range. */
export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Round a number to a small number of decimals (keeps SVG paths tidy). */
export function round(v: number, places = 2): number {
  const f = 10 ** places;
  return Math.round(v * f) / f;
}

export type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

export const RESIZE_HANDLES: readonly ResizeHandle[] = [
  'nw',
  'n',
  'ne',
  'e',
  'se',
  's',
  'sw',
  'w',
];

/** Position of a resize handle in 0..1 box-normalized space. */
export function handleAnchor(h: ResizeHandle): Point {
  switch (h) {
    case 'nw':
      return { x: 0, y: 0 };
    case 'n':
      return { x: 0.5, y: 0 };
    case 'ne':
      return { x: 1, y: 0 };
    case 'e':
      return { x: 1, y: 0.5 };
    case 'se':
      return { x: 1, y: 1 };
    case 's':
      return { x: 0.5, y: 1 };
    case 'sw':
      return { x: 0, y: 1 };
    case 'w':
      return { x: 0, y: 0.5 };
  }
}

/**
 * Apply a resize-handle drag to a rect. `dx`/`dy` are deltas in model space;
 * `min` is the minimum allowed size. Returns a new rect.
 */
export function resizeRect(
  r: Rect,
  h: ResizeHandle,
  dx: number,
  dy: number,
  min: Size = { width: 8, height: 8 },
): Rect {
  let { x, y, width, height } = r;
  const a = handleAnchor(h);
  if (a.x === 0) {
    width -= dx;
    x += dx;
  } else if (a.x === 1) {
    width += dx;
  }
  if (a.y === 0) {
    height -= dy;
    y += dy;
  } else if (a.y === 1) {
    height += dy;
  }
  if (width < min.width) {
    if (a.x === 0) x -= min.width - width;
    width = min.width;
  }
  if (height < min.height) {
    if (a.y === 0) y -= min.height - height;
    height = min.height;
  }
  return { x, y, width, height };
}
