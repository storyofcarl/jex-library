/**
 * Large-data point averaging (downsampling).
 *
 * When a series has far more points than pixels, plotting every point is wasted
 * work and visually muddy. We reduce to roughly `targetBuckets` points by
 * averaging within evenly-sized index buckets, preserving the first and last
 * point so the line still spans the full domain.
 */

export interface XY {
  x: number;
  y: number;
}

/**
 * Average `points` down to ~`targetBuckets` points by bucketing on index.
 * Returns the input unchanged when it's already small enough.
 */
export function averagePoints(points: readonly XY[], targetBuckets: number): XY[] {
  const n = points.length;
  if (targetBuckets <= 0 || n <= targetBuckets || n <= 2) return points.slice();

  const out: XY[] = [];
  // Always keep the first point.
  out.push({ ...points[0]! });

  // Interior buckets between the fixed endpoints.
  const interiorBuckets = Math.max(targetBuckets - 2, 1);
  const innerCount = n - 2; // exclude first & last
  for (let b = 0; b < interiorBuckets; b++) {
    const start = 1 + Math.floor((b * innerCount) / interiorBuckets);
    const end = 1 + Math.floor(((b + 1) * innerCount) / interiorBuckets);
    if (end <= start) continue;
    let sx = 0;
    let sy = 0;
    for (let i = start; i < end; i++) {
      sx += points[i]!.x;
      sy += points[i]!.y;
    }
    const len = end - start;
    out.push({ x: sx / len, y: sy / len });
  }

  // Always keep the last point.
  out.push({ ...points[n - 1]! });
  return out;
}

/**
 * LTTB-style min/max bucketing isn't required here, but we also offer a
 * peak-preserving variant that keeps the min and max within each bucket — useful
 * for spiky time series where averaging would flatten extremes.
 */
export function minMaxDownsample(points: readonly XY[], targetBuckets: number): XY[] {
  const n = points.length;
  if (targetBuckets <= 0 || n <= targetBuckets || n <= 2) return points.slice();

  const out: XY[] = [{ ...points[0]! }];
  const buckets = Math.max(Math.floor(targetBuckets / 2), 1);
  const innerCount = n - 2;
  for (let b = 0; b < buckets; b++) {
    const start = 1 + Math.floor((b * innerCount) / buckets);
    const end = 1 + Math.floor(((b + 1) * innerCount) / buckets);
    if (end <= start) continue;
    let min = points[start]!;
    let max = points[start]!;
    for (let i = start; i < end; i++) {
      if (points[i]!.y < min.y) min = points[i]!;
      if (points[i]!.y > max.y) max = points[i]!;
    }
    // Emit in index order to preserve the x-progression.
    const a = points.indexOf(min) <= points.indexOf(max) ? min : max;
    const c = a === min ? max : min;
    out.push({ ...a }, { ...c });
  }
  out.push({ ...points[n - 1]! });
  return out;
}
