/**
 * Path geometry — pure functions that turn pixel points into SVG path data,
 * and a tiny adapter so the same path can be stroked/filled on a Canvas 2D ctx.
 *
 * All inputs are already in pixel space (post-scale). No DOM, no theming —
 * unit-testable in node/jsdom.
 */

export interface Pt {
  x: number;
  y: number;
}

/** A polyline through the points. Skips NaN points (gaps). */
export function linePath(points: readonly Pt[]): string {
  let d = '';
  let pen = false;
  for (const p of points) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) {
      pen = false;
      continue;
    }
    d += `${pen ? 'L' : 'M'}${fmt(p.x)},${fmt(p.y)}`;
    pen = true;
  }
  return d;
}

/**
 * A smooth (monotone-ish) cubic spline through the points using Catmull-Rom →
 * Bézier conversion with tension. Skips NaN points.
 */
export function splinePath(points: readonly Pt[], tension = 0.5): string {
  const pts = points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (pts.length === 0) return '';
  if (pts.length < 3) return linePath(pts);

  let d = `M${fmt(pts[0]!.x)},${fmt(pts[0]!.y)}`;
  const t = (1 - clamp01(tension)) / 6 + 1 / 6; // map tension→Catmull factor
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i]!;
    const p1 = pts[i]!;
    const p2 = pts[i + 1]!;
    const p3 = pts[i + 2] ?? p2;
    const c1x = p1.x + (p2.x - p0.x) * t;
    const c1y = p1.y + (p2.y - p0.y) * t;
    const c2x = p2.x - (p3.x - p1.x) * t;
    const c2y = p2.y - (p3.y - p1.y) * t;
    d += `C${fmt(c1x)},${fmt(c1y)} ${fmt(c2x)},${fmt(c2y)} ${fmt(p2.x)},${fmt(p2.y)}`;
  }
  return d;
}

/**
 * An area path: a (line or spline) top edge plus a baseline at `baseY`,
 * closed. `smooth` toggles spline vs straight top.
 */
export function areaPath(
  points: readonly Pt[],
  baseY: number,
  smooth = false,
): string {
  const pts = points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (pts.length === 0) return '';
  const top = smooth ? splinePath(pts) : linePath(pts);
  const last = pts[pts.length - 1]!;
  const first = pts[0]!;
  return `${top}L${fmt(last.x)},${fmt(baseY)}L${fmt(first.x)},${fmt(baseY)}Z`;
}

/** A rectangle as path data (for bar charts on Canvas/SVG parity). */
export function rectPath(x: number, y: number, w: number, h: number): string {
  return `M${fmt(x)},${fmt(y)}h${fmt(w)}v${fmt(h)}h${fmt(-w)}Z`;
}

function fmt(n: number): string {
  // Round to 2dp to keep path strings compact & deterministic for tests.
  return (Math.round(n * 100) / 100).toString();
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}
