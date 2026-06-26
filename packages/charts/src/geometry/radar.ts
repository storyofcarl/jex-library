/**
 * Radar geometry — map a series of values onto axes radiating from a center.
 */

export interface RadarPoint {
  x: number;
  y: number;
  /** Axis index. */
  axis: number;
  value: number;
}

/**
 * Compute the pixel points for one radar series.
 *
 * @param values    one value per axis
 * @param axisCount number of axes (>= values.length)
 * @param cx,cy     center
 * @param radius    radius for `max`
 * @param min,max   value domain mapped to [0, radius]
 */
export function radarPoints(
  values: readonly number[],
  axisCount: number,
  cx: number,
  cy: number,
  radius: number,
  min: number,
  max: number,
): RadarPoint[] {
  const n = Math.max(axisCount, 1);
  const span = max - min || 1;
  const out: RadarPoint[] = [];
  for (let i = 0; i < values.length; i++) {
    const v = Number.isFinite(values[i]!) ? values[i]! : min;
    const t = clamp01((v - min) / span);
    const r = t * radius;
    // Axis 0 points up (12 o'clock); go clockwise.
    const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
    out.push({
      x: cx + r * Math.cos(angle),
      y: cy + r * Math.sin(angle),
      axis: i,
      value: v,
    });
  }
  return out;
}

/** The outer vertices of the radar grid polygon at a given radius fraction. */
export function radarGridRing(
  axisCount: number,
  cx: number,
  cy: number,
  radius: number,
): Array<{ x: number; y: number }> {
  const n = Math.max(axisCount, 1);
  const out: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < n; i++) {
    const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
    out.push({ x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) });
  }
  return out;
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}
