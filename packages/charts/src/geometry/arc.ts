/**
 * Arc / pie geometry — turn a list of values into angular slices, and build
 * SVG arc path data for each slice (supporting donut inner radius).
 */

export interface ArcSlice {
  /** Source datum index. */
  index: number;
  value: number;
  startAngle: number; // radians, 0 = 12 o'clock, clockwise
  endAngle: number;
  /** Midpoint angle (for label/legend anchoring). */
  midAngle: number;
  /** Fraction of the total [0..1]. */
  fraction: number;
}

/** Compute slices from raw values. Negative/NaN values are treated as 0. */
export function pieSlices(values: readonly number[], startAngle = 0): ArcSlice[] {
  const clean = values.map((v) => (Number.isFinite(v) && v > 0 ? v : 0));
  const total = clean.reduce((a, b) => a + b, 0);
  const slices: ArcSlice[] = [];
  let angle = startAngle;
  const TAU = Math.PI * 2;
  for (let i = 0; i < clean.length; i++) {
    const fraction = total > 0 ? clean[i]! / total : 0;
    const start = angle;
    const end = angle + fraction * TAU;
    slices.push({
      index: i,
      value: values[i]!,
      startAngle: start,
      endAngle: end,
      midAngle: (start + end) / 2,
      fraction,
    });
    angle = end;
  }
  return slices;
}

/** Cartesian point on a circle. Angle 0 = top (12 o'clock), clockwise. */
export function polarToCartesian(
  cx: number,
  cy: number,
  radius: number,
  angle: number,
): { x: number; y: number } {
  // angle measured from top, clockwise → subtract PI/2 from standard math angle.
  const a = angle - Math.PI / 2;
  return { x: cx + radius * Math.cos(a), y: cy + radius * Math.sin(a) };
}

/**
 * SVG path data for one arc slice. `innerRadius > 0` makes a donut segment.
 */
export function arcPath(
  cx: number,
  cy: number,
  outerRadius: number,
  innerRadius: number,
  startAngle: number,
  endAngle: number,
): string {
  const fullCircle = endAngle - startAngle >= Math.PI * 2 - 1e-9;
  // SVG can't draw a full circle in one arc; split into two semicircles.
  if (fullCircle) {
    const mid = startAngle + Math.PI;
    return (
      arcPath(cx, cy, outerRadius, innerRadius, startAngle, mid - 1e-6) +
      arcPath(cx, cy, outerRadius, innerRadius, mid, endAngle - 1e-6)
    );
  }

  const oStart = polarToCartesian(cx, cy, outerRadius, startAngle);
  const oEnd = polarToCartesian(cx, cy, outerRadius, endAngle);
  const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;

  if (innerRadius <= 0) {
    // Solid wedge: center → outer start → arc → outer end → close.
    return [
      `M${f(cx)},${f(cy)}`,
      `L${f(oStart.x)},${f(oStart.y)}`,
      `A${f(outerRadius)},${f(outerRadius)} 0 ${largeArc} 1 ${f(oEnd.x)},${f(oEnd.y)}`,
      'Z',
    ].join('');
  }

  // Donut segment: outer arc forward, inner arc backward.
  const iEnd = polarToCartesian(cx, cy, innerRadius, endAngle);
  const iStart = polarToCartesian(cx, cy, innerRadius, startAngle);
  return [
    `M${f(oStart.x)},${f(oStart.y)}`,
    `A${f(outerRadius)},${f(outerRadius)} 0 ${largeArc} 1 ${f(oEnd.x)},${f(oEnd.y)}`,
    `L${f(iEnd.x)},${f(iEnd.y)}`,
    `A${f(innerRadius)},${f(innerRadius)} 0 ${largeArc} 0 ${f(iStart.x)},${f(iStart.y)}`,
    'Z',
  ].join('');
}

function f(n: number): string {
  return (Math.round(n * 100) / 100).toString();
}
