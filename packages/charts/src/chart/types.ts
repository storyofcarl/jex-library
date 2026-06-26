/**
 * Public chart types — the configuration surface of the Chart Widget.
 */
import type { WidgetConfig, WidgetEvents } from '@jects/core';

export type ChartType =
  | 'line'
  | 'spline'
  | 'bar'
  | 'horizontalBar'
  | 'area'
  | 'splineArea'
  | 'pie'
  | 'donut'
  | 'radar'
  | 'scatter'
  | 'treemap'
  | 'heatmap'
  | 'bubble';

/**
 * An explicit (x, y[, size]) data point. Supplied via {@link SeriesConfig.points}
 * to plot against a numeric/time X axis (`xAxis.type` of `linear`/`log`/`time`)
 * or to encode a third dimension on a `bubble` chart (`size`). Series that only
 * provide `data` (Y values) keep the index-based category X behaviour.
 */
export interface ChartPoint {
  /** X value (numeric, or epoch-ms for a `time` axis). */
  x: number;
  /** Y value. */
  y: number;
  /** Bubble magnitude (third dimension). Ignored by non-bubble types. */
  size?: number;
}

/** A single gradient color stop (offset 0..1). */
export interface GradientStop {
  offset: number;
  color: string;
  opacity?: number;
}

/**
 * A linear gradient fill spec. Either give an explicit `stops` list, or the
 * `from`/`to` shorthand (a two-stop 0→1 ramp). `direction` orients the ramp
 * across the filled region (default `vertical`).
 */
export interface GradientFill {
  direction?: 'vertical' | 'horizontal';
  from?: string;
  to?: string;
  stops?: GradientStop[];
}

/** Zoom interaction config. Windows the axis domain(s) in response to gestures. */
export interface ZoomConfig {
  /** Axes to zoom. `'x'` (default) zooms the X domain; `'xy'` zooms both. */
  type?: 'x' | 'xy';
  /** Enable mouse-wheel zoom (default true when `zoom` is set). */
  wheel?: boolean;
  /** Enable drag-rectangle zoom (default true when `zoom` is set). */
  drag?: boolean;
}

/** Pan interaction config. Drag (with the modifier, or always when `drag` zoom is off) shifts the window. */
export interface PanConfig {
  /** Enable panning the zoomed window. Default true when `pan` is set. */
  enabled?: boolean;
}

/** Crosshair (pointer-tracking guide lines) config. */
export interface CrosshairConfig {
  /** Draw the vertical (x) guide line. Default true. */
  x?: boolean;
  /** Draw the horizontal (y) guide line. Default true. */
  y?: boolean;
  /** Snap the guides to the nearest data point. Default true. */
  snap?: boolean;
}

/**
 * An annotation / plot line / target line drawn across the plot at a fixed
 * value on one axis (e.g. a budget line at y=100, or an event marker at x=5).
 */
export interface Annotation {
  /** The axis value to anchor the line at. */
  value: number;
  /** Which axis the `value` is on. Default `'y'` (a horizontal target line). */
  axis?: 'x' | 'y';
  /** Optional label drawn at the line. */
  label?: string;
  /** Line color (CSS). Default a muted chrome token. */
  color?: string;
  /** Dash pattern. Default `[4, 4]`. */
  dash?: number[];
}

/** Per-point data label config. */
export interface DataLabelsConfig {
  /** Render value labels at each plotted point. */
  show?: boolean;
  /** Formatter for the label text. Default `String(value)`. */
  format?: (ctx: TooltipContext) => string;
}

export type RendererKind = 'canvas' | 'svg';

export type AxisKind = 'linear' | 'log' | 'category' | 'time';

export type AxisSide = 'left' | 'right' | 'bottom' | 'top';

export interface AxisConfig {
  /** Scale kind. Default inferred: 'category' for x of cartesian, else 'linear'. */
  type?: AxisKind;
  /** Forced minimum (else derived from data). */
  min?: number;
  /** Forced maximum (else derived from data). */
  max?: number;
  /** Suggested tick count. Default 5. */
  ticks?: number;
  /** Axis title. */
  title?: string;
  /** Hide this axis' line/labels/grid. */
  hidden?: boolean;
  /** Value formatter override. */
  format?: (value: number) => string;
  /** Which side this y-axis lives on (dual axes). Default 'left'. */
  side?: 'left' | 'right';
}

export interface SeriesConfig {
  /** Series display name (legend/tooltip). */
  name?: string;
  /** Y values (cartesian) or values (pie/donut/treemap/radar). */
  data: number[];
  /**
   * Per-series chart type for COMBINATION charts. Falls back to the chart-level
   * `type`. e.g. mix `bar` columns with a `line` overlay.
   */
  type?: ChartType;
  /** Override color (CSS string). Default: house ramp by series index. */
  color?: string;
  /** Which y-axis this series binds to (dual axes). Default 'left'. */
  axis?: 'left' | 'right';
  /** Stack group id; series sharing a group are stacked. */
  stack?: string;
  /** Hidden (toggled off via legend). */
  hidden?: boolean;
  /** For heatmap: 2-D matrix overrides `data`. */
  matrix?: number[][];
  /**
   * Explicit (x, y[, size]) points. When set, drives the X position against a
   * numeric/time X axis (and the magnitude on a `bubble` chart). `data` is
   * derived from the points' Y values, so existing `data`-only series are
   * unaffected.
   */
  points?: ChartPoint[];
  /** Per-series gradient fill (overrides the flat series color for area/bar fills). */
  gradient?: GradientFill;
}

export interface LegendConfig {
  show?: boolean;
  position?: 'top' | 'bottom' | 'left' | 'right';
}

export interface TooltipConfig {
  show?: boolean;
  /** Custom HTML formatter for the tooltip body. */
  format?: (ctx: TooltipContext) => string;
}

export interface TooltipContext {
  seriesIndex: number;
  seriesName: string;
  pointIndex: number;
  category: string | number;
  value: number;
  color: string;
}

export interface ChartConfig extends WidgetConfig {
  /** Default chart type for all series without an explicit `type`. */
  type?: ChartType;
  /** Render backend. Default 'svg'. */
  renderer?: RendererKind;
  /** Category labels along the x-axis (cartesian) or slice labels (pie). */
  categories?: Array<string | number>;
  /** The data series. */
  series?: SeriesConfig[];
  /** Single-series convenience: equivalent to `series: [{ data }]`. */
  data?: number[];
  /** Explicit pixel width (else measured from host). */
  width?: number;
  /** Explicit pixel height. Default 320. */
  height?: number;
  /** X axis config. */
  xAxis?: AxisConfig;
  /** Y axis config — single, or [left, right] for dual axes. */
  yAxis?: AxisConfig | [AxisConfig, AxisConfig];
  /** Stack all series with the same axis (shorthand for per-series stack). */
  stacked?: boolean;
  /** Legend config. */
  legend?: LegendConfig;
  /** Tooltip config. */
  tooltip?: TooltipConfig;
  /** Inner plot padding (px). */
  padding?: Partial<Insets>;
  /**
   * Downsample series with more than this many points by averaging.
   * Set 0 to disable. Default 0 (off) unless the renderer/perf wants it.
   */
  maxPoints?: number;
  /** Donut inner-radius fraction [0..1). Default 0.6 for 'donut'. */
  innerRadius?: number;
  /**
   * Downsampling strategy applied to dense cartesian series (line/area/scatter):
   * `'average'` smooths each bucket, `'minmax'` preserves spiky extremes. When
   * set without `maxPoints`, a sensible per-pixel target is used. Off by default.
   */
  downsample?: 'average' | 'minmax';
  /** Zoom interaction (drag-rect + wheel) windowing the axis domain. */
  zoom?: ZoomConfig;
  /** Pan interaction shifting the zoomed window. */
  pan?: PanConfig;
  /** Pointer-tracking crosshair guide lines. */
  crosshair?: CrosshairConfig;
  /** Plot lines / target lines drawn across the plot at fixed axis values. */
  annotations?: Annotation[];
  /** Per-point value labels. */
  dataLabels?: DataLabelsConfig;
  /** Global gradient fill applied to area/bar fills (per-series `gradient` wins). */
  fillGradient?: GradientFill;
  /** Chart title (rendered above the plot). */
  title?: string;
  /**
   * Accessible name for the chart graphic. Exposed as the `aria-label` /
   * `<title>` on the `role="img"` graphic surface for screen readers. Falls
   * back to `title` when omitted. Set to `''` to suppress (not recommended).
   */
  ariaLabel?: string;
  /**
   * Longer accessible description of what the chart conveys (trend/summary).
   * Exposed via `aria-describedby` → SVG `<desc>` / canvas fallback text.
   */
  description?: string;
}

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface ChartEvents extends WidgetEvents {
  /** Emitted after a render pass. */
  draw: { chart: unknown };
  /** Pointer entered a data point/slice. */
  pointerOver: { context: TooltipContext };
  /** Pointer left all data. */
  pointerOut: Record<string, never>;
  /** A data point/slice was clicked. */
  pointClick: { context: TooltipContext };
  /** A legend item was toggled. */
  legendToggle: { seriesIndex: number; hidden: boolean };
  /**
   * The zoom/pan window changed. `x`/`y` are the visible fractions [0..1] of the
   * full domain; `null` for an axis that is fully reset (showing all data).
   */
  zoom: { x: [number, number] | null; y: [number, number] | null };
}
