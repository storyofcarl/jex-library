/**
 * Geometry primitives for the diagram engine — pure, DOM-free math used by
 * routing, layout, and hit-testing. All coordinates are in diagram (model)
 * space.
 */

import type { Point, Rect, Size, ShapeModel } from '../contract.js';

/** A small epsilon for floating-point comparisons. */
export const EPS = 1e-6;

/** Clamp `v` into the inclusive range [`lo`, `hi`]. */
export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Euclidean distance between two points. */
export function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Squared distance (cheaper when only comparing). */
export function dist2(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

/** Approximate point equality. */
export function pointsEqual(a: Point, b: Point, eps = EPS): boolean {
  return Math.abs(a.x - b.x) <= eps && Math.abs(a.y - b.y) <= eps;
}

/** The axis-aligned bounding box of a shape (ignoring rotation). */
export function shapeRect(s: ShapeModel): Rect {
  return { x: s.x, y: s.y, width: s.w, height: s.h };
}

/** The center of a rect. */
export function rectCenter(r: Rect): Point {
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

/** Whether a point lies inside (or on) a rect. */
export function rectContains(r: Rect, p: Point, pad = 0): boolean {
  return (
    p.x >= r.x - pad &&
    p.x <= r.x + r.width + pad &&
    p.y >= r.y - pad &&
    p.y <= r.y + r.height + pad
  );
}

/** Whether two rects overlap (touching edges count as overlap when pad>0). */
export function rectsIntersect(a: Rect, b: Rect, pad = 0): boolean {
  return (
    a.x - pad < b.x + b.width &&
    a.x + a.width + pad > b.x &&
    a.y - pad < b.y + b.height &&
    a.y + a.height + pad > b.y
  );
}

/** Grow a rect by `pad` on every side. */
export function inflate(r: Rect, pad: number): Rect {
  return {
    x: r.x - pad,
    y: r.y - pad,
    width: r.width + pad * 2,
    height: r.height + pad * 2,
  };
}

/** Union of a list of rects (empty list → zero rect at origin). */
export function unionRects(rects: readonly Rect[]): Rect {
  if (rects.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of rects) {
    if (r.x < minX) minX = r.x;
    if (r.y < minY) minY = r.y;
    if (r.x + r.width > maxX) maxX = r.x + r.width;
    if (r.y + r.height > maxY) maxY = r.y + r.height;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * The closest point on a rect's perimeter to an external target point, plus
 * the side it lands on. Used to resolve a connector endpoint when no explicit
 * port is given.
 */
export function perimeterPoint(r: Rect, toward: Point): Point {
  const c = rectCenter(r);
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  if (Math.abs(dx) < EPS && Math.abs(dy) < EPS) {
    return { x: r.x + r.width, y: c.y };
  }
  const hw = r.width / 2;
  const hh = r.height / 2;
  // Scale the direction so it just reaches the rect boundary.
  const scaleX = dx !== 0 ? hw / Math.abs(dx) : Infinity;
  const scaleY = dy !== 0 ? hh / Math.abs(dy) : Infinity;
  const scale = Math.min(scaleX, scaleY);
  return { x: c.x + dx * scale, y: c.y + dy * scale };
}

/** Which side of the rect a perimeter point sits on. */
export type Side = 'top' | 'right' | 'bottom' | 'left';

export function sideOf(r: Rect, p: Point): Side {
  const dl = Math.abs(p.x - r.x);
  const dr = Math.abs(p.x - (r.x + r.width));
  const dt = Math.abs(p.y - r.y);
  const db = Math.abs(p.y - (r.y + r.height));
  const m = Math.min(dl, dr, dt, db);
  if (m === dl) return 'left';
  if (m === dr) return 'right';
  if (m === dt) return 'top';
  return 'bottom';
}

/** Outward unit normal for a side. */
export function sideNormal(side: Side): Point {
  switch (side) {
    case 'top':
      return { x: 0, y: -1 };
    case 'bottom':
      return { x: 0, y: 1 };
    case 'left':
      return { x: -1, y: 0 };
    case 'right':
      return { x: 1, y: 0 };
  }
}

/**
 * Distance from point `p` to the segment `a`→`b` (model units). Returns the
 * perpendicular distance, clamped to the segment endpoints.
 */
export function distToSegment(p: Point, a: Point, b: Point): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const wx = p.x - a.x;
  const wy = p.y - a.y;
  const len2 = vx * vx + vy * vy;
  if (len2 < EPS) return dist(p, a);
  let t = (wx * vx + wy * vy) / len2;
  t = clamp(t, 0, 1);
  const proj = { x: a.x + t * vx, y: a.y + t * vy };
  return dist(p, proj);
}

/** Minimum distance from `p` to a polyline of waypoints. */
export function distToPolyline(p: Point, pts: readonly Point[]): number {
  if (pts.length === 0) return Infinity;
  if (pts.length === 1) return dist(p, pts[0]!);
  let min = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const d = distToSegment(p, pts[i]!, pts[i + 1]!);
    if (d < min) min = d;
  }
  return min;
}

/** Does segment `a1`→`a2` properly intersect rect `r`? (for obstacle tests) */
export function segmentIntersectsRect(a1: Point, a2: Point, r: Rect): boolean {
  // Trivial: either endpoint inside.
  if (rectContains(r, a1) || rectContains(r, a2)) return true;
  // Test against the four edges.
  const tl = { x: r.x, y: r.y };
  const tr = { x: r.x + r.width, y: r.y };
  const br = { x: r.x + r.width, y: r.y + r.height };
  const bl = { x: r.x, y: r.y + r.height };
  return (
    segmentsIntersect(a1, a2, tl, tr) ||
    segmentsIntersect(a1, a2, tr, br) ||
    segmentsIntersect(a1, a2, br, bl) ||
    segmentsIntersect(a1, a2, bl, tl)
  );
}

function orient(a: Point, b: Point, c: Point): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

/** Do segments p1p2 and p3p4 intersect (proper or touching)? */
export function segmentsIntersect(p1: Point, p2: Point, p3: Point, p4: Point): boolean {
  const d1 = orient(p3, p4, p1);
  const d2 = orient(p3, p4, p2);
  const d3 = orient(p1, p2, p3);
  const d4 = orient(p1, p2, p4);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true;
  }
  if (Math.abs(d1) < EPS && onSegment(p3, p4, p1)) return true;
  if (Math.abs(d2) < EPS && onSegment(p3, p4, p2)) return true;
  if (Math.abs(d3) < EPS && onSegment(p1, p2, p3)) return true;
  if (Math.abs(d4) < EPS && onSegment(p1, p2, p4)) return true;
  return false;
}

function onSegment(a: Point, b: Point, p: Point): boolean {
  return (
    Math.min(a.x, b.x) - EPS <= p.x &&
    p.x <= Math.max(a.x, b.x) + EPS &&
    Math.min(a.y, b.y) - EPS <= p.y &&
    p.y <= Math.max(a.y, b.y) + EPS
  );
}

/** Collapse collinear / duplicate waypoints from an orthogonal polyline. */
export function simplifyPath(pts: readonly Point[]): Point[] {
  if (pts.length <= 2) return pts.map((p) => ({ ...p }));
  const out: Point[] = [{ ...pts[0]! }];
  for (let i = 1; i < pts.length - 1; i++) {
    const prev = out[out.length - 1]!;
    const cur = pts[i]!;
    const next = pts[i + 1]!;
    // drop duplicate
    if (pointsEqual(prev, cur)) continue;
    // drop collinear (horizontal or vertical run)
    const collinearH =
      Math.abs(prev.y - cur.y) < EPS && Math.abs(cur.y - next.y) < EPS;
    const collinearV =
      Math.abs(prev.x - cur.x) < EPS && Math.abs(cur.x - next.x) < EPS;
    if (collinearH || collinearV) continue;
    out.push({ ...cur });
  }
  const last = pts[pts.length - 1]!;
  if (!pointsEqual(out[out.length - 1]!, last)) out.push({ ...last });
  return out;
}

/** Round a point's coordinates to `places` decimals (serialization stability). */
export function roundPoint(p: Point, places = 2): Point {
  const f = 10 ** places;
  return { x: Math.round(p.x * f) / f, y: Math.round(p.y * f) / f };
}

/** A zero size. */
export const ZERO_SIZE: Size = { width: 0, height: 0 };
