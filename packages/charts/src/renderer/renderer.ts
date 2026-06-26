/**
 * Renderer abstraction — a minimal vector surface the chart draws onto, with
 * two backends: SVG (DOM elements, theming-friendly) and Canvas (bitmap).
 *
 * The chart issues the SAME primitive calls regardless of backend; each backend
 * translates them. This keeps per-type drawing code backend-agnostic.
 */

export interface StrokeStyle {
  color: string;
  width?: number;
  dash?: number[];
  opacity?: number;
}

/**
 * A linear gradient fill spec in the renderer's logical (user-space) coordinates.
 * Both backends translate it: SVG emits a `<linearGradient>` in `<defs>`, canvas
 * builds a `createLinearGradient`. `color` on the owning {@link FillStyle} is kept
 * as a flat fallback.
 */
export interface GradientSpec {
  direction: 'vertical' | 'horizontal';
  stops: Array<{ offset: number; color: string; opacity?: number }>;
  /** Gradient axis endpoints in user space. */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface FillStyle {
  color: string;
  opacity?: number;
  /** When set, paint a linear gradient instead of the flat `color`. */
  gradient?: GradientSpec;
}

export interface TextStyle {
  color: string;
  size?: number;
  family?: string;
  weight?: string | number;
  align?: 'start' | 'middle' | 'end';
  baseline?: 'top' | 'middle' | 'bottom' | 'alphabetic';
}

export interface Renderer {
  readonly kind: 'svg' | 'canvas';
  /** The DOM node to mount (an <svg> or a <canvas>). */
  readonly node: SVGSVGElement | HTMLCanvasElement;
  /** Logical width/height in CSS px. */
  readonly width: number;
  readonly height: number;

  /** Resize the surface. */
  resize(width: number, height: number): void;
  /** Clear all drawn content (start a fresh frame). */
  clear(): void;

  /**
   * Set the accessible representation of the graphic surface. Marks the node as
   * `role="img"` with an accessible name (`label`) and optional long
   * description (`desc`), so a screen reader announces the data-visualization
   * rather than an unlabeled, contentless graphic.
   *
   * - SVG: writes `aria-label`, a `<title>` and (if `desc`) a `<desc>` child
   *   wired via `aria-labelledby`/`aria-describedby`.
   * - Canvas: writes `role="img"`, `aria-label`, and fallback text content.
   */
  describe(label: string, desc?: string): void;

  /** Stroke an SVG-style path. */
  path(d: string, stroke?: StrokeStyle, fill?: FillStyle): void;
  /** Filled (and optionally stroked) rectangle. */
  rect(x: number, y: number, w: number, h: number, fill?: FillStyle, stroke?: StrokeStyle): void;
  /** A straight line segment. */
  line(x1: number, y1: number, x2: number, y2: number, stroke: StrokeStyle): void;
  /** A filled/stroked circle (scatter points, markers). */
  circle(cx: number, cy: number, r: number, fill?: FillStyle, stroke?: StrokeStyle): void;
  /** Text. */
  text(s: string, x: number, y: number, style: TextStyle): void;
  /**
   * Attach metadata (series/point index) to the last-drawn primitive so the
   * chart can hit-test. No-op for canvas (the chart hit-tests in math space).
   */
  tag(meta: Record<string, string | number>): void;

  /** Serialize to an SVG string (both backends can, canvas via data-url image). */
  toSVG(): string;
  /** Rasterize to a PNG data URL. */
  toPNG(): Promise<string>;
}
