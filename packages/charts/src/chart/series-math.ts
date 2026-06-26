/**
 * Series math — resolve config series into a normalized internal form, compute
 * stacking, and derive value domains. Pure (no DOM), heavily unit-tested.
 */
import type { ChartType, GradientFill, SeriesConfig } from './types.js';

export interface ResolvedSeries {
  index: number;
  name: string;
  type: ChartType;
  data: number[];
  /** Stacked baseline (lower edge) per point, when stacked. */
  base?: number[] | undefined;
  /** Stacked top (base + value) per point, when stacked. */
  top?: number[] | undefined;
  axis: 'left' | 'right';
  stack?: string | undefined;
  hidden: boolean;
  color?: string | undefined;
  matrix?: number[][] | undefined;
  /** Explicit X values per point (from `points`); undefined => index-based X. */
  xs?: number[] | undefined;
  /** Bubble magnitudes per point (from `points`), when present. */
  sizes?: number[] | undefined;
  /** Per-series gradient fill, when configured. */
  gradient?: GradientFill | undefined;
}

const CARTESIAN: ReadonlySet<ChartType> = new Set([
  'line',
  'spline',
  'bar',
  'horizontalBar',
  'area',
  'splineArea',
  'scatter',
  'bubble',
]);

export function isCartesian(type: ChartType): boolean {
  return CARTESIAN.has(type);
}

export function isStackable(type: ChartType): boolean {
  return type === 'bar' || type === 'horizontalBar' || type === 'area' || type === 'splineArea';
}

/**
 * Resolve raw config series into the internal {@link ResolvedSeries} form.
 * Applies the chart-level default type and stacked flag.
 */
export function resolveSeries(
  series: readonly SeriesConfig[],
  defaultType: ChartType,
  stackedAll: boolean,
): ResolvedSeries[] {
  return series.map((s, index) => {
    const type = s.type ?? defaultType;
    const stack = s.stack ?? (stackedAll && isStackable(type) ? '_default' : undefined);
    // When explicit (x,y[,size]) points are given, derive data/xs/sizes from them
    // (points win over a stale `data`); otherwise keep the index-based `data`.
    const hasPoints = !!(s.points && s.points.length);
    const data = hasPoints ? s.points!.map((p) => p.y) : s.data ?? [];
    const xs = hasPoints ? s.points!.map((p) => p.x) : undefined;
    const sizes = hasPoints && s.points!.some((p) => p.size !== undefined)
      ? s.points!.map((p) => p.size ?? 0)
      : undefined;
    return {
      index,
      name: s.name ?? `Series ${index + 1}`,
      type,
      data,
      axis: s.axis ?? 'left',
      stack,
      hidden: s.hidden ?? false,
      color: s.color,
      matrix: s.matrix,
      xs,
      sizes,
      gradient: s.gradient,
    };
  });
}

/**
 * Apply stacking: for each stack group (within the same axis), accumulate
 * positive and negative values separately so series stack from a shared 0
 * baseline. Mutates `base`/`top` on the resolved series in place.
 */
export function applyStacking(resolved: ResolvedSeries[]): void {
  // Group by `${axis}::${stack}`.
  const groups = new Map<string, ResolvedSeries[]>();
  for (const s of resolved) {
    if (!s.stack || s.hidden) continue;
    const key = `${s.axis}::${s.stack}`;
    const g = groups.get(key) ?? [];
    g.push(s);
    groups.set(key, g);
  }

  for (const group of groups.values()) {
    const len = group.reduce((m, s) => Math.max(m, s.data.length), 0);
    const posAcc = new Array<number>(len).fill(0);
    const negAcc = new Array<number>(len).fill(0);
    for (const s of group) {
      const base = new Array<number>(s.data.length);
      const top = new Array<number>(s.data.length);
      for (let i = 0; i < s.data.length; i++) {
        const v = Number.isFinite(s.data[i]!) ? s.data[i]! : 0;
        if (v >= 0) {
          base[i] = posAcc[i]!;
          top[i] = posAcc[i]! + v;
          posAcc[i] = top[i]!;
        } else {
          top[i] = negAcc[i]!;
          base[i] = negAcc[i]! + v;
          negAcc[i] = base[i]!;
        }
      }
      s.base = base;
      s.top = top;
    }
  }
}

export interface Domain {
  min: number;
  max: number;
}

/**
 * Compute the value (y) domain for one axis ('left'|'right') across all visible
 * cartesian series bound to it, honoring stacking. Returns null if no series.
 */
export function valueDomain(
  resolved: readonly ResolvedSeries[],
  axis: 'left' | 'right',
): Domain | null {
  let min = Infinity;
  let max = -Infinity;
  let any = false;
  for (const s of resolved) {
    if (s.hidden || s.axis !== axis || !isCartesian(s.type)) continue;
    any = true;
    if (s.stack && s.base && s.top) {
      for (let i = 0; i < s.top.length; i++) {
        if (Number.isFinite(s.top[i]!)) {
          min = Math.min(min, s.top[i]!, s.base![i]!);
          max = Math.max(max, s.top[i]!, s.base![i]!);
        }
      }
    } else {
      for (const v of s.data) {
        if (Number.isFinite(v)) {
          min = Math.min(min, v);
          max = Math.max(max, v);
        }
      }
    }
  }
  if (!any || min === Infinity) return null;
  // Include 0 in the domain for bar/area so baselines read correctly.
  const hasBarOrArea = resolved.some(
    (s) =>
      !s.hidden &&
      s.axis === axis &&
      (s.type === 'bar' || s.type === 'horizontalBar' || s.type === 'area' || s.type === 'splineArea'),
  );
  if (hasBarOrArea) {
    min = Math.min(min, 0);
    max = Math.max(max, 0);
  }
  return { min, max };
}

/** True if any visible series binds to the given axis. */
export function axisInUse(resolved: readonly ResolvedSeries[], axis: 'left' | 'right'): boolean {
  return resolved.some((s) => !s.hidden && s.axis === axis && isCartesian(s.type));
}
