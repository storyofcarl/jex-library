/**
 * Scales — map data values from a domain into pixel/range space and back.
 *
 * Four kinds: linear, log, category (band), time. Each exposes a uniform
 * surface: `scale(value)` → pixel, `invert(pixel)` → value (where meaningful),
 * `ticks()` → nicely-rounded tick values, and `bandwidth` for category scales.
 *
 * These are pure math — no DOM — so they unit-test cleanly in jsdom/node.
 */

export type ScaleKind = 'linear' | 'log' | 'category' | 'time';

export interface ScaleTick {
  /** The underlying domain value of the tick. */
  value: number;
  /** Pixel position of the tick along the range. */
  position: number;
  /** Pre-formatted label. */
  label: string;
}

export interface ScaleBase {
  readonly kind: ScaleKind;
  /** Map a domain value to a pixel position in `range`. */
  scale(value: number): number;
  /** Generate display ticks across the domain. */
  ticks(count?: number): ScaleTick[];
  /** Format a single value for display. */
  format(value: number): string;
  /** The [min,max] pixel range. */
  range: readonly [number, number];
}

export interface NumericScale extends ScaleBase {
  /** Inverse mapping: pixel → domain value. */
  invert(pixel: number): number;
  domain: readonly [number, number];
}

export interface CategoryScale extends ScaleBase {
  readonly kind: 'category';
  /** Domain categories in order. */
  domain: readonly string[];
  /** Width of one band (after padding). */
  bandwidth: number;
  /** Center pixel of a category band (or NaN if absent). */
  scaleBand(category: string): number;
}

/* ----------------------------------------------------------------------- *
 * Nice ticks (Wilkinson-ish "nice numbers" used by d3 and most chart libs) *
 * ----------------------------------------------------------------------- */

/** Round a raw step up to a "nice" 1/2/5/10 multiple. */
export function niceStep(rawStep: number): number {
  if (rawStep <= 0 || !Number.isFinite(rawStep)) return 1;
  const exponent = Math.floor(Math.log10(rawStep));
  const magnitude = Math.pow(10, exponent);
  const fraction = rawStep / magnitude;
  let niceFraction: number;
  if (fraction <= 1) niceFraction = 1;
  else if (fraction <= 2) niceFraction = 2;
  else if (fraction <= 5) niceFraction = 5;
  else niceFraction = 10;
  return niceFraction * magnitude;
}

/** Compute evenly-spaced "nice" tick values across [min,max]. */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (count <= 0) return [];
  if (min === max) return [min];
  if (max < min) [min, max] = [max, min];
  const span = max - min;
  const step = niceStep(span / count);
  const start = Math.ceil(min / step) * step;
  const ticks: number[] = [];
  // Guard against float drift by computing from an integer index.
  for (let i = 0; ; i++) {
    const v = start + i * step;
    // Snap to avoid 0.30000000000004-style values.
    const snapped = Math.round(v / step) * step;
    if (snapped > max + step * 1e-9) break;
    ticks.push(cleanFloat(snapped));
    if (ticks.length > 1000) break; // safety
  }
  return ticks;
}

/** Expand [min,max] to nice round bounds enclosing the data. */
export function niceBounds(min: number, max: number, count = 5): [number, number] {
  if (min === max) {
    // Avoid a zero-width domain.
    const pad = Math.abs(min) > 0 ? Math.abs(min) * 0.1 : 1;
    return [min - pad, max + pad];
  }
  if (max < min) [min, max] = [max, min];
  const step = niceStep((max - min) / count);
  return [Math.floor(min / step) * step, Math.ceil(max / step) * step].map(cleanFloat) as [
    number,
    number,
  ];
}

function cleanFloat(n: number): number {
  // Strip tiny binary-float residue.
  return Math.abs(n) < 1e-12 ? 0 : parseFloat(n.toPrecision(12));
}

export function defaultNumberFormat(v: number): string {
  if (!Number.isFinite(v)) return String(v);
  const abs = Math.abs(v);
  if (abs !== 0 && (abs >= 1e6 || abs < 1e-4)) return v.toExponential(2);
  // Trim trailing zeros.
  return cleanFloat(v).toString();
}
