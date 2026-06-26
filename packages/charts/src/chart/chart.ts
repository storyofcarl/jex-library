/**
 * Chart — the framework-agnostic charting Widget.
 *
 * Supports line/spline/bar/horizontalBar/area/splineArea/pie/donut/radar/
 * scatter/treemap/heatmap, linear/log/category/time scales, dual axes, legend,
 * tooltips, stacking, per-series combination types, and large-data averaging.
 *
 * Chrome (axes/legend/tooltip) is styled token-pure via chart.css. Data-series
 * fills come from the house CMYK ramp tokens, resolved in JS so Canvas works too.
 */
import { Widget, createEl, register, sanitizeHtml } from '@jects/core';

import type {
  ChartConfig,
  ChartEvents,
  ChartPoint,
  GradientFill,
  Insets,
  TooltipContext,
  AxisConfig,
} from './types.js';
import {
  resolveSeries,
  applyStacking,
  valueDomain,
  axisInUse,
  isCartesian,
  type ResolvedSeries,
} from './series-math.js';
import { computeLayout, type PlotRect } from './layout.js';
import {
  LinearScale,
  LogScale,
  BandScale,
  TimeScale,
  type NumericScale,
} from '../scale/index.js';
import {
  linePath,
  splinePath,
  areaPath,
  pieSlices,
  arcPath,
  polarToCartesian,
  radarPoints,
  radarGridRing,
  squarify,
  type Pt,
} from '../geometry/index.js';
import { resolveSeriesColor, resolveTokenColor, seriesColor } from '../color/palette.js';
import { averagePoints, minMaxDownsample, type XY } from '../data/aggregate.js';
import { createRenderer, pngDataUrlToPdf, type FillStyle, type GradientSpec, type Renderer } from '../renderer/index.js';

const DEFAULT_PADDING: Insets = { top: 12, right: 12, bottom: 12, left: 12 };
const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Unified X positioner over a band (category) X or a numeric (linear/log/time) X.
 * Category is the default (back-compat). Numeric kicks in when `xAxis.type` is
 * `linear`/`log`/`time`, mapping each series' explicit `xs` value (from
 * {@link ChartPoint}). Honors the zoom window: a band X is built over the visible
 * category slice (offset `i0`); a numeric X is built over the windowed domain.
 */
class CartesianX {
  constructor(
    readonly kind: 'category' | 'numeric',
    readonly band: BandScale | null,
    readonly numeric: NumericScale | null,
    readonly bandwidth: number,
    /** First original category index visible (band zoom window start). */
    readonly i0: number,
    private readonly rng: readonly [number, number],
  ) {}

  /** Original point indices to draw for series `s` (band window-aware). */
  indices(s: ResolvedSeries): number[] {
    const n = s.data.length;
    const out: number[] = [];
    if (this.band) {
      const lo = Math.max(0, this.i0);
      const hi = Math.min(n, this.i0 + this.band.domain.length);
      for (let i = lo; i < hi; i++) out.push(i);
    } else {
      for (let i = 0; i < n; i++) out.push(i);
    }
    return out;
  }

  /** Pixel center for point `i` of series `s`. */
  at(s: ResolvedSeries, i: number): number {
    if (this.band) return this.band.scale(i - this.i0);
    const xv = s.xs ? s.xs[i] ?? i : i;
    return this.numeric!.scale(xv);
  }

  /** Pixel for an axis VALUE (category index for band, data value for numeric). */
  atValue(value: number): number {
    if (this.numeric) return this.numeric.scale(value);
    return this.band!.scale(value - this.i0);
  }

  /** Left edge of the band for point `i` (bars). Numeric: centered slot. */
  left(s: ResolvedSeries, i: number): number {
    if (this.band) return this.band.bandLeft(i - this.i0);
    return this.at(s, i) - this.bandwidth / 2;
  }

  /** Is a pixel within the plot's horizontal extent (cheap clip for zoom)? */
  contains(px: number): boolean {
    return Number.isFinite(px) && px >= this.rng[0] - 0.5 && px <= this.rng[1] + 0.5;
  }

  /** Fraction [0..1] of a pixel across the (current, windowed) pixel range. */
  fractionOf(px: number): number {
    const [r0, r1] = this.rng;
    return r1 === r0 ? 0 : (px - r0) / (r1 - r0);
  }
}

/** Hit-test record for a drawn data point/slice (math-space for canvas). */
interface HitTarget {
  x: number;
  y: number;
  /** Radius for circular hit (pie/scatter); rect bounds for bars/cells. */
  radius?: number;
  rect?: { x: number; y: number; w: number; h: number };
  context: TooltipContext;
}

export class Chart extends Widget<ChartConfig, ChartEvents> {
  // NOTE: `declare` prevents TS (useDefineForClassFields) from emitting a field
  // initializer that would run AFTER super() and wipe values assigned inside
  // buildEl()/render() (both invoked by the base Widget constructor).
  declare private renderer: Renderer;
  declare private plotEl: HTMLElement;
  declare private tooltipEl: HTMLElement;
  declare private legendEl: HTMLElement;
  /**
   * Visually-hidden data table mirroring the plotted series/point values — the
   * accessible, keyboard-reachable equivalent of the hover tooltip (Quality Gate
   * Q2 / WCAG 1.1.1). Pointer-only tooltips never reach AT or keyboard users, so
   * the same data is exposed here as a real <table> a screen reader can read and
   * a keyboard user can tab to.
   */
  declare private dataTableEl: HTMLElement;
  declare private hits: HitTarget[];
  declare private resolved: ResolvedSeries[];
  /**
   * Overlay surface for interaction chrome that must NOT be wiped by a renderer
   * `clear()` and is backend-agnostic (works over both the SVG and canvas
   * surfaces): the crosshair guide lines and the drag-to-zoom selection rect.
   * It shares the renderer's logical viewBox so coordinates line up exactly.
   */
  declare private overlayEl: SVGSVGElement;
  /** The "reset zoom" affordance, shown while a zoom/pan window is active. */
  declare private resetBtn: HTMLButtonElement;
  // ---- interaction state (declared, not field-initialized: see `declare` note) --
  /** Visible X window as fractions [0..1] of the full domain (null = all). */
  declare private zoomX: [number, number] | null;
  /** Visible Y window as fractions [0..1] of the full domain (null = all). */
  declare private zoomY: [number, number] | null;
  /** In-progress drag gesture (zoom selection or pan), or null. */
  declare private drag:
    | { mode: 'zoom' | 'pan'; x0: number; y0: number; lastX: number; lastY: number }
    | null;
  /** Last drawn plot rect / scales — kept for pointer-driven interactions. */
  declare private plotRect: PlotRect | null;
  declare private xScale: CartesianX | null;
  declare private yScaleLeft: NumericScale | null;
  declare private cartesian: boolean;

  protected override defaults(): Partial<ChartConfig> {
    return {
      type: 'line',
      renderer: 'svg',
      height: 320,
      legend: { show: true, position: 'bottom' },
      tooltip: { show: true },
      stacked: false,
    };
  }

  protected buildEl(): HTMLElement {
    const root = createEl('div', {
      // The chart container is a labeled `figure` grouping (it legitimately
      // wraps interactive chrome — legend buttons, tooltip). The inner graphic
      // surface (svg/canvas) carries role="img" + the same accessible name so a
      // screen reader announces the data-visualization itself. `role="img"` on
      // the root would be invalid (an img role must have no focusable
      // descendants — axe `nested-interactive`).
      className: 'jects-chart',
      attrs: { role: 'figure' },
    });
    this.plotEl = createEl('div', { className: 'jects-chart__plot' });
    this.legendEl = createEl('div', { className: 'jects-chart__legend' });
    this.tooltipEl = createEl('div', {
      className: 'jects-chart__tooltip',
      attrs: { role: 'tooltip', 'aria-hidden': 'true', hidden: true },
    });
    // The accessible data alternative: a visually-hidden region populated with a
    // real <table> of every series/point value on each render. Keyboard users
    // can tab into it; screen readers announce the same numbers the sighted
    // tooltip shows. `tabindex=0` makes the region itself reachable.
    this.dataTableEl = createEl('div', {
      className: 'jects-chart__data',
      attrs: { tabindex: '0' },
    });
    // Backend-agnostic interaction overlay (crosshair + zoom-selection), drawn in
    // the renderer's logical coordinate space. pointer-events:none so it never
    // intercepts the gestures handled on the renderer surface beneath it.
    this.overlayEl = document.createElementNS(SVG_NS, 'svg');
    this.overlayEl.setAttribute('class', 'jects-chart__overlay');
    this.overlayEl.setAttribute('aria-hidden', 'true');
    this.resetBtn = createEl('button', {
      className: 'jects-chart__zoom-reset',
      text: 'Reset zoom',
      attrs: { type: 'button', hidden: true, 'aria-label': 'Reset zoom' },
    }) as HTMLButtonElement;
    this.plotEl.append(this.overlayEl, this.resetBtn);
    // Interaction state lives here (assigned during super() construction, before
    // any field initializer could clobber it).
    this.zoomX = null;
    this.zoomY = null;
    this.drag = null;
    this.plotRect = null;
    this.xScale = null;
    this.yScaleLeft = null;
    this.cartesian = false;
    root.append(this.plotEl, this.legendEl, this.tooltipEl, this.dataTableEl);
    return root;
  }

  // ---- public API ---------------------------------------------------------

  /** Serialize the current chart as an SVG string. */
  svg(): string {
    return this.renderer.toSVG();
  }

  /** Rasterize the current chart to a PNG data URL. */
  png(): Promise<string> {
    return this.renderer.toPNG();
  }

  /**
   * Export the current chart as a single-page PDF `Blob` (image of the chart on
   * the page). Rasterizes via {@link png} unless a `pngDataUrl` is supplied
   * (handy for headless callers that already have the raster, and for tests).
   */
  async pdf(pngDataUrl?: string): Promise<Blob> {
    const url = pngDataUrl ?? (await this.png());
    const { width, height } = this.dims();
    return pngDataUrlToPdf(url, width, height);
  }

  /** Alias of {@link pdf}. */
  toPdf(pngDataUrl?: string): Promise<Blob> {
    return this.pdf(pngDataUrl);
  }

  /**
   * Streaming / real-time: append a point to a series and redraw. `series` is a
   * series index or name. `point` is a Y value (category/index series) or an
   * explicit {@link ChartPoint} (numeric/time X). With `shift`, the oldest point
   * is dropped first (a fixed-window live feed). Mutates the series in place and
   * triggers a single redraw — no config rebuild.
   */
  addPoint(
    series: number | string,
    point: number | ChartPoint,
    opts?: { shift?: boolean },
  ): this {
    const list = this.config.series ?? (this.config.data ? [{ data: this.config.data }] : []);
    if (!this.config.series && this.config.data) {
      // Promote the `data` convenience to a real series so we can mutate it.
      this.config.series = list;
      delete this.config.data;
    }
    const idx =
      typeof series === 'number'
        ? series
        : list.findIndex((s) => (s.name ?? '') === series);
    const target = list[idx];
    if (!target) return this;

    if (typeof point === 'number') {
      target.data = [...(target.data ?? []), point];
      if (opts?.shift) target.data.shift();
    } else {
      const pts = [...(target.points ?? []), point];
      if (opts?.shift) pts.shift();
      target.points = pts;
      target.data = pts.map((p) => p.y);
    }

    // Keep category labels in step with the new length (category X only).
    if (this.config.categories) {
      const maxLen = Math.max(0, ...list.map((s) => (s.points ?? s.data ?? []).length));
      const cats = this.config.categories.slice();
      if (opts?.shift) cats.shift();
      while (cats.length < maxLen) cats.push(cats.length + 1);
      this.config.categories = cats;
    }

    this.render();
    return this;
  }

  /** Drop the oldest point from every series and redraw (sliding-window feed). */
  shiftData(): this {
    const list = this.config.series ?? [];
    for (const s of list) {
      if (s.points && s.points.length) {
        s.points = s.points.slice(1);
        s.data = s.points.map((p) => p.y);
      } else if (s.data && s.data.length) {
        s.data = s.data.slice(1);
      }
    }
    if (this.config.categories) this.config.categories = this.config.categories.slice(1);
    this.render();
    return this;
  }

  /**
   * Programmatically set the zoom window (fractions [0..1] of the full domain).
   * `null` on an axis resets it. Wheel/drag gestures funnel through here.
   */
  zoomTo(opts: { x?: [number, number] | null; y?: [number, number] | null }): this {
    if ('x' in opts) this.zoomX = normalizeWindow(opts.x ?? null);
    if ('y' in opts) this.zoomY = normalizeWindow(opts.y ?? null);
    this.render();
    this.emit('zoom', { x: this.zoomX, y: this.zoomY });
    return this;
  }

  /** Reset any zoom/pan window (show all data). */
  resetZoom(): this {
    if (!this.zoomX && !this.zoomY) return this;
    this.zoomX = null;
    this.zoomY = null;
    this.render();
    this.emit('zoom', { x: null, y: null });
    return this;
  }

  /** Pan the current window by a fraction of its span on each axis. */
  panBy(delta: { x?: number; y?: number }): this {
    if (delta.x) this.zoomX = shiftWindow(this.zoomX, delta.x);
    if (delta.y) this.zoomY = shiftWindow(this.zoomY, delta.y);
    this.render();
    this.emit('zoom', { x: this.zoomX, y: this.zoomY });
    return this;
  }

  /** Toggle a series' visibility (as the legend does). */
  toggleSeries(index: number, hidden?: boolean): this {
    const series = this.config.series;
    if (!series || !series[index]) return this;
    const next = hidden ?? !series[index]!.hidden;
    series[index]!.hidden = next;
    this.emit('legendToggle', { seriesIndex: index, hidden: next });
    this.render();
    return this;
  }

  // ---- normalization ------------------------------------------------------

  /** Build the effective series list (handles the `data` convenience). */
  private effectiveSeries() {
    const cfg = this.config;
    if (cfg.series && cfg.series.length) return cfg.series;
    if (cfg.data && cfg.data.length) return [{ data: cfg.data }];
    return [];
  }

  private dims(): { width: number; height: number } {
    const cfg = this.config;
    const measured = this.el.clientWidth || this.host.clientWidth || 0;
    const width = cfg.width ?? (measured > 0 ? measured : 480);
    const height = cfg.height ?? 320;
    return { width, height };
  }

  private color(s: ResolvedSeries): string {
    if (s.color) return s.color;
    return resolveSeriesColor(s.index, this.el);
  }

  // ---- render -------------------------------------------------------------

  protected override render(): void {
    const { width, height } = this.dims();

    // (Re)build the renderer if backend or size changed.
    const kind = this.config.renderer ?? 'svg';
    if (!this.renderer || this.renderer.kind !== kind) {
      this.plotEl.replaceChildren();
      this.renderer = createRenderer(kind, width, height);
      this.plotEl.appendChild(this.renderer.node);
      this.attachPointer();
    } else {
      this.renderer.resize(width, height);
    }
    this.renderer.clear();
    this.hits = [];

    const rawSeries = this.effectiveSeries();
    const defaultType = this.config.type ?? 'line';
    this.resolved = resolveSeries(rawSeries, defaultType, this.config.stacked ?? false);
    applyStacking(this.resolved);

    // Give the graphic surface (and root) an accessible name + description so a
    // screen reader announces a labeled image rather than an empty graphic.
    this.applyA11y(defaultType);

    // Route by the dominant chart type. Cartesian types share an axes plot;
    // radial/special types render full-canvas.
    const primary = this.resolved[0]?.type ?? defaultType;
    this.cartesian = isCartesian(primary);
    // Non-cartesian frames carry no plot/scale state for pointer interactions.
    this.plotRect = null;
    this.xScale = null;
    this.yScaleLeft = null;
    this.clearCrosshair();

    if (primary === 'pie' || primary === 'donut') {
      this.drawPie(width, height, primary === 'donut');
    } else if (primary === 'radar') {
      this.drawRadar(width, height);
    } else if (primary === 'treemap') {
      this.drawTreemap(width, height);
    } else if (primary === 'heatmap') {
      this.drawHeatmap(width, height);
    } else {
      this.drawCartesian(width, height);
    }

    this.syncOverlay(width, height);
    this.renderLegend();
    // Build the accessible data table from the just-drawn points (this.hits now
    // holds every series/point value the tooltip would surface on hover).
    this.renderDataTable();
    this.emit('draw', { chart: this });
    this.emit('render' as never, { widget: this } as never);
  }

  // ---- cartesian (line/spline/bar/area/scatter + combination + dual axes) --

  private buildAxisScale(
    cfg: AxisConfig | undefined,
    axis: 'left' | 'right',
    range: [number, number],
  ): NumericScale | null {
    if (!axisInUse(this.resolved, axis)) return null;
    const dom = valueDomain(this.resolved, axis);
    if (!dom) return null;
    let min = cfg?.min ?? dom.min;
    let max = cfg?.max ?? dom.max;
    // Apply the Y zoom window (a sub-range of the data domain).
    const win = this.zoomY;
    if (win) {
      const span = max - min;
      const lo = min + win[0] * span;
      const hi = min + win[1] * span;
      min = lo;
      max = hi;
    }
    const type = cfg?.type ?? 'linear';
    // A zoomed window is exact; skip nice-rounding so the extent matches it.
    const nice = !win;
    if (type === 'log') return new LogScale({ domain: [min, max], range, tickCount: cfg?.ticks, format: cfg?.format });
    if (type === 'time') return new TimeScale({ domain: [min, max], range, tickCount: cfg?.ticks, format: cfg?.format });
    return new LinearScale({
      domain: [min, max] as [number, number],
      range,
      nice,
      tickCount: cfg?.ticks ?? 5,
      format: cfg?.format,
    });
  }

  private yAxisConfig(side: 'left' | 'right'): AxisConfig | undefined {
    const ya = this.config.yAxis;
    if (!ya) return undefined;
    if (Array.isArray(ya)) return side === 'left' ? ya[0] : ya[1];
    return side === 'left' ? ya : undefined;
  }

  /** Full X value-domain for a numeric/time X (from explicit `xs`). */
  private xValueDomain(len: number): [number, number] {
    let min = Infinity;
    let max = -Infinity;
    let any = false;
    for (const s of this.resolved) {
      if (s.hidden || !isCartesian(s.type) || !s.xs) continue;
      for (const x of s.xs) {
        if (Number.isFinite(x)) {
          any = true;
          min = Math.min(min, x);
          max = Math.max(max, x);
        }
      }
    }
    if (!any) return [0, Math.max(0, len - 1)];
    if (min === max) {
      min -= 1;
      max += 1;
    }
    return [min, max];
  }

  /**
   * Build the X positioner. Honors `xAxis.type`: `linear`/`log`/`time` yield a
   * numeric X (true scatter / time-series, driven by series `points`), while the
   * default (`category`/unset) keeps the band scale for back-compat. Both honor
   * the current zoom window.
   */
  private buildXScale(plot: PlotRect, cats: string[]): CartesianX {
    const range: [number, number] = [plot.x, plot.x + plot.width];
    const xType = this.config.xAxis?.type;
    const numeric = xType === 'linear' || xType === 'log' || xType === 'time';

    if (!numeric) {
      const N = cats.length;
      let i0 = 0;
      let i1 = N;
      if (this.zoomX && N > 0) {
        i0 = Math.max(0, Math.floor(this.zoomX[0] * N));
        i1 = Math.min(N, Math.max(i0 + 1, Math.ceil(this.zoomX[1] * N)));
      }
      const band = new BandScale({ domain: cats.slice(i0, i1), range, padding: 0.2 });
      return new CartesianX('category', band, null, band.bandwidth, i0, range);
    }

    let [min, max] = this.xValueDomain(cats.length);
    // Honor explicit numeric-X bounds (previously declared-but-unconsumed).
    const xcfg = this.config.xAxis;
    if (xcfg?.min !== undefined) min = xcfg.min;
    if (xcfg?.max !== undefined) max = xcfg.max;
    if (this.zoomX) {
      const span = max - min;
      const lo = min + this.zoomX[0] * span;
      const hi = min + this.zoomX[1] * span;
      min = lo;
      max = hi;
    }
    const ticks = this.config.xAxis?.ticks;
    const fmt = this.config.xAxis?.format;
    let scale: NumericScale;
    if (xType === 'log') scale = new LogScale({ domain: [min, max], range, tickCount: ticks, format: fmt });
    else if (xType === 'time') scale = new TimeScale({ domain: [min, max], range, tickCount: ticks, format: fmt });
    else scale = new LinearScale({ domain: [min, max], range, nice: !this.zoomX, tickCount: ticks ?? 5, format: fmt });
    const n = Math.max(cats.length, 1);
    const bandw = n > 1 ? (plot.width / n) * 0.8 : plot.width * 0.4;
    return new CartesianX('numeric', null, scale, bandw, 0, range);
  }

  private drawCartesian(width: number, height: number): void {
    const categories = (this.config.categories ?? []).map(String);
    const seriesLen = Math.max(0, ...this.resolved.map((s) => s.data.length));
    const cats =
      categories.length >= seriesLen
        ? categories
        : Array.from({ length: seriesLen }, (_, i) => categories[i] ?? String(i + 1));

    const hasLeft = axisInUse(this.resolved, 'left');
    const hasRight = axisInUse(this.resolved, 'right');
    const legend = this.legendPos();

    const layout = computeLayout({
      width,
      height,
      padding: this.padding(),
      hasLeftAxis: hasLeft && !this.yAxisConfig('left')?.hidden,
      hasRightAxis: hasRight && !this.yAxisConfig('right')?.hidden,
      hasXAxis: !this.config.xAxis?.hidden,
      hasTitle: !!this.config.title,
      legend,
    });
    const plot = layout.plot;
    // Publish plot/scale state for pointer-driven interactions (zoom/crosshair).
    this.plotRect = plot;

    const x = this.buildXScale(plot, cats);
    const yLeft = this.buildAxisScale(this.yAxisConfig('left'), 'left', [
      plot.y + plot.height,
      plot.y,
    ]);
    const yRight = this.buildAxisScale(this.yAxisConfig('right'), 'right', [
      plot.y + plot.height,
      plot.y,
    ]);
    this.xScale = x;
    this.yScaleLeft = yLeft ?? yRight;

    if (this.config.title) this.drawTitle(layout.titleRect, this.config.title);

    // Grid + y axis ticks (left preferred).
    const gridY = yLeft ?? yRight;
    if (gridY && !this.yAxisConfig('left')?.hidden) {
      for (const t of gridY.ticks()) {
        this.renderer.line(plot.x, t.position, plot.x + plot.width, t.position, {
          color: this.chrome('border'),
          width: 1,
          opacity: 0.5,
        });
        this.renderer.text(t.label, plot.x - 6, t.position, {
          color: this.chrome('muted-foreground'),
          size: 11,
          align: 'end',
          baseline: 'middle',
        });
      }
    }
    if (yRight && !this.yAxisConfig('right')?.hidden) {
      for (const t of yRight.ticks()) {
        this.renderer.text(t.label, plot.x + plot.width + 6, t.position, {
          color: this.chrome('muted-foreground'),
          size: 11,
          align: 'start',
          baseline: 'middle',
        });
      }
    }

    // X axis baseline + labels (numeric ticks vs category bands).
    const baseY = plot.y + plot.height;
    this.renderer.line(plot.x, baseY, plot.x + plot.width, baseY, {
      color: this.chrome('border'),
      width: 1,
    });
    if (!this.config.xAxis?.hidden) {
      if (x.numeric) {
        for (const t of x.numeric.ticks()) {
          if (!x.contains(t.position)) continue;
          this.renderer.text(t.label, t.position, baseY + 16, {
            color: this.chrome('muted-foreground'),
            size: 11,
            align: 'middle',
            baseline: 'middle',
          });
        }
      } else {
        const visible = x.indices({ data: cats } as unknown as ResolvedSeries);
        for (const i of visible) {
          this.renderer.text(cats[i] ?? String(i + 1), x.atValue(i), baseY + 16, {
            color: this.chrome('muted-foreground'),
            size: 11,
            align: 'middle',
            baseline: 'middle',
          });
        }
      }
    }
    // Axis titles (previously declared-but-unconsumed config).
    this.drawAxisTitles(plot);

    // Annotations / target lines sit above the grid, below the series markers.
    this.drawAnnotations(x, gridY, plot);

    // Count bar series per stack/point to position grouped bars.
    const barSeries = this.resolved.filter(
      (s) => !s.hidden && (s.type === 'bar' || s.type === 'horizontalBar'),
    );
    const stackedBars = barSeries.some((s) => s.stack);
    const barGroups = stackedBars ? 1 : Math.max(barSeries.length, 1);

    let barSlot = 0;
    for (const s of this.resolved) {
      if (s.hidden) continue;
      const yScale = s.axis === 'right' ? (yRight ?? yLeft) : yLeft;
      if (isCartesian(s.type) && !yScale) continue;
      const col = this.color(s);
      switch (s.type) {
        case 'line':
        case 'spline':
          this.drawLineSeries(s, x, yScale!, col, s.type === 'spline');
          break;
        case 'area':
        case 'splineArea':
          this.drawAreaSeries(s, x, yScale!, col, s.type === 'splineArea', baseY);
          break;
        case 'scatter':
          this.drawScatterSeries(s, x, yScale!, col);
          break;
        case 'bubble':
          this.drawBubbleSeries(s, x, yScale!, col);
          break;
        case 'bar':
          this.drawBarSeries(s, x, yScale!, col, barGroups, stackedBars ? 0 : barSlot++, baseY);
          break;
        case 'horizontalBar':
          this.drawHBarSeries(s, x, col, barGroups, stackedBars ? 0 : barSlot++, plot);
          break;
      }
    }
  }

  /**
   * Compute pixel render points for a cartesian series, honoring the zoom window
   * (via `x.indices`) and large-data downsampling. When reduced, the returned
   * points no longer map 1:1 to `idx` (they are bucket-averaged / min-max).
   */
  private computePoints(
    s: ResolvedSeries,
    x: CartesianX,
    y: NumericScale,
  ): { pts: Pt[]; idx: number[]; reduced: boolean } {
    const idx = x.indices(s);
    const xy: XY[] = idx.map((i) => {
      const v = s.data[i];
      return { x: x.at(s, i), y: v !== undefined && Number.isFinite(v) ? y.scale(v) : NaN };
    });
    const r = this.downsampleXY(xy);
    return { pts: r.pts, idx, reduced: r.changed };
  }

  /**
   * Apply downsampling to a pixel-point array. `downsample:'minmax'` preserves
   * spiky extremes; `'average'` (and the legacy `maxPoints` path) smooths buckets.
   * With `downsample` set but no `maxPoints`, targets ~one point per 2px of width.
   */
  private downsampleXY(xy: XY[]): { pts: XY[]; changed: boolean } {
    const mode = this.config.downsample;
    const max = this.config.maxPoints ?? 0;
    const fn = mode === 'minmax' ? minMaxDownsample : averagePoints;
    if (max > 0 && xy.length > max) return { pts: fn(xy, max), changed: true };
    if (mode && xy.length > 2) {
      const target = Math.max(2, Math.min(xy.length, Math.round(this.renderer.width / 2)));
      if (xy.length > target) return { pts: fn(xy, target), changed: true };
    }
    return { pts: xy.slice(), changed: false };
  }

  private drawLineSeries(s: ResolvedSeries, x: CartesianX, y: NumericScale, col: string, smooth: boolean): void {
    const { pts, idx, reduced } = this.computePoints(s, x, y);
    const d = smooth ? splinePath(pts) : linePath(pts);
    this.renderer.path(d, { color: col, width: 2 });
    this.renderer.tag({ series: s.index });
    this.drawMarkers(s, x, y, col, pts, idx, reduced, { r: 3, hitR: 6, circle: true });
  }

  private drawAreaSeries(
    s: ResolvedSeries,
    x: CartesianX,
    y: NumericScale,
    col: string,
    smooth: boolean,
    baseY: number,
  ): void {
    const idx = x.indices(s);
    const fill = this.areaFill(s, col);
    if (s.base && s.top) {
      // Stacked area: top edge across base values (window-aware).
      const topPts: Pt[] = idx.map((i) => ({ x: x.at(s, i), y: y.scale(s.top![i]!) }));
      const basePts: Pt[] = idx.map((i) => ({ x: x.at(s, i), y: y.scale(s.base![i]!) }));
      const top = smooth ? splinePath(topPts) : linePath(topPts);
      const rev = [...basePts].reverse();
      const back = smooth ? splinePath(rev) : linePath(rev).replace(/^M/, 'L');
      this.renderer.path(`${top}${back}Z`, undefined, fill);
      this.renderer.path(top, { color: col, width: 2 });
      topPts.forEach((p, k) => {
        const i = idx[k]!;
        this.addHit({ x: p.x, y: p.y, radius: 6 }, s, i, s.data[i]!, col);
        this.maybeLabel(s, p.x, p.y, s.data[i]!, col, this.catLabel(i));
      });
    } else {
      const { pts, idx: pidx, reduced } = this.computePoints(s, x, y);
      this.renderer.path(areaPath(pts, baseY, smooth), undefined, fill);
      this.renderer.path(smooth ? splinePath(pts) : linePath(pts), { color: col, width: 2 });
      // Area has hits + labels but no per-point circle markers.
      this.drawMarkers(s, x, y, col, pts, pidx, reduced, { hitR: 6, circle: false });
    }
  }

  private drawScatterSeries(s: ResolvedSeries, x: CartesianX, y: NumericScale, col: string): void {
    const { pts, idx, reduced } = this.computePoints(s, x, y);
    if (reduced) {
      for (const p of pts) {
        if (!Number.isFinite(p.y) || !x.contains(p.x)) continue;
        const v = y.invert(p.y);
        this.renderer.circle(p.x, p.y, 4, { color: col, opacity: 0.85 });
        this.renderer.tag({ series: s.index });
        this.addHit({ x: p.x, y: p.y, radius: 7 }, s, this.nearestIndex(s, x, p.x), v, col);
        this.maybeLabel(s, p.x, p.y, v, col);
      }
      return;
    }
    pts.forEach((p, k) => {
      const i = idx[k]!;
      const v = s.data[i];
      if (v === undefined || !Number.isFinite(v) || !x.contains(p.x)) return;
      this.renderer.circle(p.x, p.y, 4, { color: col, opacity: 0.85 });
      this.renderer.tag({ series: s.index, point: i });
      this.addHit({ x: p.x, y: p.y, radius: 7 }, s, i, v, col);
      this.maybeLabel(s, p.x, p.y, v, col, this.catLabel(i));
    });
  }

  /**
   * Bubble: (x, y, size) — a scatter whose marker radius encodes a third
   * dimension. Magnitudes come from each {@link ChartPoint}'s `size`; the radius
   * is a sqrt-area mapping across the series' size range. The 13th chart type.
   */
  private drawBubbleSeries(s: ResolvedSeries, x: CartesianX, y: NumericScale, col: string): void {
    const sizes = s.sizes;
    let smin = Infinity;
    let smax = -Infinity;
    if (sizes) {
      for (const v of sizes) {
        if (Number.isFinite(v)) {
          smin = Math.min(smin, v);
          smax = Math.max(smax, v);
        }
      }
    }
    const minR = 4;
    const maxR = 24;
    const radius = (sz: number | undefined): number => {
      if (sz === undefined || !Number.isFinite(sz) || smax <= smin) return (minR + maxR) / 2;
      const t = (sz - smin) / (smax - smin);
      return minR + Math.sqrt(Math.max(0, t)) * (maxR - minR);
    };
    for (const i of x.indices(s)) {
      const v = s.data[i];
      if (v === undefined || !Number.isFinite(v)) continue;
      const px = x.at(s, i);
      const py = y.scale(v);
      if (!x.contains(px)) continue;
      const r = radius(sizes ? sizes[i] : undefined);
      this.renderer.circle(px, py, r, { color: col, opacity: 0.5 }, { color: col, width: 1 });
      this.renderer.tag({ series: s.index, point: i });
      this.addHit({ x: px, y: py, radius: Math.max(r, 6) }, s, i, v, col);
      this.maybeLabel(s, px, py, v, col, this.catLabel(i));
    }
  }

  private drawBarSeries(
    s: ResolvedSeries,
    x: CartesianX,
    y: NumericScale,
    col: string,
    groups: number,
    slot: number,
    baseY: number,
  ): void {
    const band = x.bandwidth;
    const gap = 2;
    const barW = (band - gap * (groups - 1)) / groups;
    for (const i of x.indices(s)) {
      const v = s.data[i];
      if (v === undefined || !Number.isFinite(v)) continue;
      const left = x.left(s, i) + slot * (barW + gap);
      let y0: number;
      let y1: number;
      if (s.base && s.top) {
        y0 = y.scale(s.base[i]!);
        y1 = y.scale(s.top[i]!);
      } else {
        y0 = baseY;
        y1 = y.scale(v);
      }
      const top = Math.min(y0, y1);
      const h = Math.abs(y1 - y0);
      this.renderer.rect(left, top, barW, h, this.barFill(s, col, left, top, barW, h));
      this.renderer.tag({ series: s.index, point: i });
      this.addHit({ x: 0, y: 0, rect: { x: left, y: top, w: barW, h } }, s, i, v, col);
      this.maybeLabel(s, left + barW / 2, top, v, col, this.catLabel(i));
    }
  }

  private drawHBarSeries(
    s: ResolvedSeries,
    x: CartesianX,
    col: string,
    groups: number,
    slot: number,
    plot: PlotRect,
  ): void {
    // Horizontal bars: categories along Y (use band on y), values along x.
    const band = x.bandwidth;
    const gap = 2;
    const barH = (band - gap * (groups - 1)) / groups;
    const x0 = plot.x; // value baseline at left
    for (const i of x.indices(s)) {
      const v = s.data[i];
      if (v === undefined || !Number.isFinite(v)) continue;
      const yTop = x.left(s, i) + slot * (barH + gap);
      // Map value through y-scale but along the horizontal axis: reuse plot width.
      const valX = mapToWidth(v, this.resolved, s.axis, plot);
      const left = Math.min(x0, valX);
      const w = Math.abs(valX - x0);
      this.renderer.rect(left, yTop, w, barH, this.barFill(s, col, left, yTop, w, barH));
      this.addHit({ x: 0, y: 0, rect: { x: left, y: yTop, w, h: barH } }, s, i, v, col);
      this.maybeLabel(s, left + w, yTop + barH / 2, v, col, this.catLabel(i));
    }
  }

  // ---- markers / labels / gradients / annotations (cartesian helpers) -----

  private catLabel(i: number): string | number | undefined {
    return (this.config.categories ?? [])[i];
  }

  /** Find the original point index whose X pixel is nearest `px` (for reduced markers). */
  private nearestIndex(s: ResolvedSeries, x: CartesianX, px: number): number {
    const idx = x.indices(s);
    let best = idx[0] ?? 0;
    let bestD = Infinity;
    for (const i of idx) {
      const d = Math.abs(x.at(s, i) - px);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  /** Draw per-point markers + hit targets (+ optional data labels) for a series. */
  private drawMarkers(
    s: ResolvedSeries,
    x: CartesianX,
    y: NumericScale,
    col: string,
    pts: Pt[],
    idx: number[],
    reduced: boolean,
    opts: { r?: number; hitR: number; circle: boolean },
  ): void {
    if (reduced) {
      for (const p of pts) {
        if (!Number.isFinite(p.y) || !x.contains(p.x)) continue;
        const v = y.invert(p.y);
        if (opts.circle) this.renderer.circle(p.x, p.y, opts.r ?? 3, { color: col });
        this.addHit({ x: p.x, y: p.y, radius: opts.hitR }, s, this.nearestIndex(s, x, p.x), v, col);
        this.maybeLabel(s, p.x, p.y, v, col);
      }
      return;
    }
    pts.forEach((p, k) => {
      const i = idx[k]!;
      const v = s.data[i];
      if (v === undefined || !Number.isFinite(v) || !x.contains(p.x)) return;
      if (opts.circle) this.renderer.circle(p.x, p.y, opts.r ?? 3, { color: col });
      this.addHit({ x: p.x, y: p.y, radius: opts.hitR }, s, i, v, col);
      this.maybeLabel(s, p.x, p.y, v, col, this.catLabel(i));
    });
  }

  /** Render a per-point value label when `dataLabels.show` is set. */
  private maybeLabel(
    s: ResolvedSeries,
    px: number,
    py: number,
    value: number,
    col: string,
    category?: string | number,
  ): void {
    const dl = this.config.dataLabels;
    if (!dl?.show) return;
    const ctx: TooltipContext = {
      seriesIndex: s.index,
      seriesName: s.name,
      pointIndex: 0,
      category: category ?? '',
      value,
      color: col,
    };
    const text = dl.format ? dl.format(ctx) : String(value);
    this.renderer.text(text, px, py - 8, {
      color: this.chrome('foreground'),
      size: 10,
      weight: 600,
      align: 'middle',
      baseline: 'bottom',
    });
  }

  /** Resolve a series' gradient color stops, falling back to its flat color. */
  private gradStops(g: GradientFill, fallback: string): GradientSpec['stops'] {
    if (g.stops && g.stops.length) return g.stops;
    return [
      { offset: 0, color: g.from ?? fallback },
      { offset: 1, color: g.to ?? fallback },
    ];
  }

  /** Fill for a bar: a flat color, or a gradient when configured. */
  private barFill(s: ResolvedSeries, col: string, x: number, y: number, w: number, h: number): FillStyle {
    const g = s.gradient ?? this.config.fillGradient;
    if (!g) return { color: col };
    const vertical = (g.direction ?? 'vertical') === 'vertical';
    const spec: GradientSpec = {
      direction: g.direction ?? 'vertical',
      stops: this.gradStops(g, col),
      x1: x,
      y1: y,
      x2: vertical ? x : x + w,
      y2: vertical ? y + h : y,
    };
    return { color: col, gradient: spec };
  }

  /** Fill for an area: translucent flat color, or a plot-spanning gradient. */
  private areaFill(s: ResolvedSeries, col: string): FillStyle {
    const g = s.gradient ?? this.config.fillGradient;
    const plot = this.plotRect;
    if (!g || !plot) return { color: col, opacity: 0.3 };
    const vertical = (g.direction ?? 'vertical') === 'vertical';
    const spec: GradientSpec = {
      direction: g.direction ?? 'vertical',
      stops: this.gradStops(g, col),
      x1: plot.x,
      y1: plot.y,
      x2: vertical ? plot.x : plot.x + plot.width,
      y2: vertical ? plot.y + plot.height : plot.y,
    };
    return { color: col, opacity: 1, gradient: spec };
  }

  /** Draw axis titles (consumes the previously-unwired `xAxis/yAxis.title`). */
  private drawAxisTitles(plot: PlotRect): void {
    const xt = this.config.xAxis?.title;
    if (xt && !this.config.xAxis?.hidden) {
      this.renderer.text(xt, plot.x + plot.width / 2, plot.y + plot.height + 30, {
        color: this.chrome('muted-foreground'),
        size: 12,
        weight: 600,
        align: 'middle',
        baseline: 'middle',
      });
    }
    const yt = this.yAxisConfig('left')?.title;
    if (yt && !this.yAxisConfig('left')?.hidden) {
      this.renderer.text(yt, plot.x + 2, plot.y - 4, {
        color: this.chrome('muted-foreground'),
        size: 12,
        weight: 600,
        align: 'start',
        baseline: 'bottom',
      });
    }
  }

  /** Draw annotation / target / plot lines across the plot at fixed axis values. */
  private drawAnnotations(x: CartesianX, y: NumericScale | null, plot: PlotRect): void {
    const anns = this.config.annotations;
    if (!anns || !anns.length) return;
    for (const a of anns) {
      const axis = a.axis ?? 'y';
      const color = a.color ?? this.chrome('muted-foreground');
      const dash = a.dash ?? [4, 4];
      if (axis === 'y') {
        if (!y) continue;
        const py = y.scale(a.value);
        if (py < plot.y - 0.5 || py > plot.y + plot.height + 0.5) continue;
        this.renderer.line(plot.x, py, plot.x + plot.width, py, { color, width: 1.5, dash });
        if (a.label) {
          this.renderer.text(a.label, plot.x + plot.width - 4, py - 4, {
            color,
            size: 11,
            align: 'end',
            baseline: 'bottom',
          });
        }
      } else {
        const px = x.atValue(a.value);
        if (!x.contains(px)) continue;
        this.renderer.line(px, plot.y, px, plot.y + plot.height, { color, width: 1.5, dash });
        if (a.label) {
          this.renderer.text(a.label, px + 4, plot.y + 4, {
            color,
            size: 11,
            align: 'start',
            baseline: 'top',
          });
        }
      }
    }
  }

  // ---- pie / donut --------------------------------------------------------

  private drawPie(width: number, height: number, donut: boolean): void {
    const series = this.resolved[0];
    if (!series) return;
    const legend = this.legendPos();
    const layout = computeLayout({
      width,
      height,
      padding: this.padding(),
      hasLeftAxis: false,
      hasRightAxis: false,
      hasXAxis: false,
      hasTitle: !!this.config.title,
      legend,
    });
    if (this.config.title) this.drawTitle(layout.titleRect, this.config.title);
    const plot = layout.plot;
    const cx = plot.x + plot.width / 2;
    const cy = plot.y + plot.height / 2;
    const radius = Math.max(Math.min(plot.width, plot.height) / 2 - 4, 0);
    const inner = donut ? radius * (this.config.innerRadius ?? 0.6) : 0;
    const labels = (this.config.categories ?? []).map(String);

    const slices = pieSlices(series.data);
    for (const slice of slices) {
      if (slice.fraction <= 0) continue;
      const col = series.color ?? resolveSeriesColor(slice.index, this.el);
      this.renderer.path(arcPath(cx, cy, radius, inner, slice.startAngle, slice.endAngle), {
        color: this.chrome('background'),
        width: 1,
      }, { color: col });
      this.renderer.tag({ series: 0, point: slice.index });
      const mid = polarToCartesian(cx, cy, (radius + inner) / 2, slice.midAngle);
      this.addHit(
        { x: mid.x, y: mid.y, radius: (radius - inner) / 2 },
        series,
        slice.index,
        slice.value,
        col,
        labels[slice.index] ?? String(slice.index + 1),
      );
    }
  }

  // ---- radar --------------------------------------------------------------

  private drawRadar(width: number, height: number): void {
    const legend = this.legendPos();
    const layout = computeLayout({
      width,
      height,
      padding: this.padding(),
      hasLeftAxis: false,
      hasRightAxis: false,
      hasXAxis: false,
      hasTitle: !!this.config.title,
      legend,
    });
    if (this.config.title) this.drawTitle(layout.titleRect, this.config.title);
    const plot = layout.plot;
    const cx = plot.x + plot.width / 2;
    const cy = plot.y + plot.height / 2;
    const radius = Math.max(Math.min(plot.width, plot.height) / 2 - 16, 0);
    const axes = Math.max(0, ...this.resolved.map((s) => s.data.length));
    if (axes === 0) return;

    // Domain across all visible series.
    let max = -Infinity;
    let min = Infinity;
    for (const s of this.resolved) {
      if (s.hidden) continue;
      for (const v of s.data) {
        if (Number.isFinite(v)) {
          max = Math.max(max, v);
          min = Math.min(min, v);
        }
      }
    }
    if (max === -Infinity) return;
    min = Math.min(min, 0);

    // Grid rings + spokes.
    const rings = 4;
    for (let r = 1; r <= rings; r++) {
      const ring = radarGridRing(axes, cx, cy, (radius * r) / rings);
      const d = ring.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join('') + 'Z';
      this.renderer.path(d, { color: this.chrome('border'), width: 1, opacity: 0.5 });
    }
    const outer = radarGridRing(axes, cx, cy, radius);
    const labels = (this.config.categories ?? []).map(String);
    outer.forEach((p, i) => {
      this.renderer.line(cx, cy, p.x, p.y, { color: this.chrome('border'), width: 1, opacity: 0.4 });
      if (labels[i]) {
        this.renderer.text(labels[i]!, p.x, p.y, {
          color: this.chrome('muted-foreground'),
          size: 11,
          align: 'middle',
          baseline: 'middle',
        });
      }
    });

    for (const s of this.resolved) {
      if (s.hidden) continue;
      const col = this.color(s);
      const pts = radarPoints(s.data, axes, cx, cy, radius, min, max);
      const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join('') + 'Z';
      this.renderer.path(d, { color: col, width: 2 }, { color: col, opacity: 0.2 });
      pts.forEach((p, i) => {
        this.renderer.circle(p.x, p.y, 3, { color: col });
        this.addHit({ x: p.x, y: p.y, radius: 6 }, s, i, s.data[i]!, col, labels[i] ?? String(i + 1));
      });
    }
  }

  // ---- treemap ------------------------------------------------------------

  private drawTreemap(width: number, height: number): void {
    const series = this.resolved[0];
    if (!series) return;
    const layout = computeLayout({
      width,
      height,
      padding: this.padding(),
      hasLeftAxis: false,
      hasRightAxis: false,
      hasXAxis: false,
      hasTitle: !!this.config.title,
      legend: 'none',
    });
    if (this.config.title) this.drawTitle(layout.titleRect, this.config.title);
    const plot = layout.plot;
    const labels = (this.config.categories ?? []).map(String);
    const rects = squarify(
      series.data.map((v, i) => ({ index: i, value: v })),
      plot.x,
      plot.y,
      plot.width,
      plot.height,
    );
    for (const r of rects) {
      const col = resolveSeriesColor(r.index, this.el);
      this.renderer.rect(r.x, r.y, r.width, r.height, { color: col }, {
        color: this.chrome('background'),
        width: 2,
      });
      this.renderer.tag({ series: 0, point: r.index });
      const label = labels[r.index];
      if (label && r.width > 40 && r.height > 18) {
        this.renderer.text(label, r.x + 6, r.y + 16, {
          color: this.chrome('background'),
          size: 11,
          weight: 600,
          align: 'start',
          baseline: 'middle',
        });
      }
      this.addHit(
        { x: 0, y: 0, rect: { x: r.x, y: r.y, w: r.width, h: r.height } },
        series,
        r.index,
        r.value,
        col,
        label ?? String(r.index + 1),
      );
    }
  }

  // ---- heatmap ------------------------------------------------------------

  private drawHeatmap(width: number, height: number): void {
    const series = this.resolved[0];
    if (!series) return;
    const matrix = series.matrix ?? this.resolved.map((s) => s.data);
    const rows = matrix.length;
    const cols = Math.max(0, ...matrix.map((r) => r.length));
    if (rows === 0 || cols === 0) return;

    const layout = computeLayout({
      width,
      height,
      padding: this.padding(),
      hasLeftAxis: false,
      hasRightAxis: false,
      hasXAxis: !this.config.xAxis?.hidden,
      hasTitle: !!this.config.title,
      legend: 'none',
    });
    if (this.config.title) this.drawTitle(layout.titleRect, this.config.title);
    const plot = layout.plot;
    let min = Infinity;
    let max = -Infinity;
    for (const row of matrix)
      for (const v of row) {
        if (Number.isFinite(v)) {
          min = Math.min(min, v);
          max = Math.max(max, v);
        }
      }
    const span = max - min || 1;
    const cw = plot.width / cols;
    const ch = plot.height / rows;
    const cats = (this.config.categories ?? []).map(String);

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const v = matrix[r]![c];
        if (v === undefined || !Number.isFinite(v)) continue;
        const t = (v - min) / span;
        // Use the primary CMYK token, varying alpha by intensity for a ramp.
        const col = resolveTokenColor('cmyk-cyan', this.el, 0.15 + 0.8 * t);
        const cx = plot.x + c * cw;
        const cy = plot.y + r * ch;
        this.renderer.rect(cx, cy, cw - 1, ch - 1, { color: col });
        this.addHit(
          { x: 0, y: 0, rect: { x: cx, y: cy, w: cw, h: ch } },
          series,
          r * cols + c,
          v,
          col,
          cats[c] ?? `${r},${c}`,
        );
      }
    }
  }

  // ---- title --------------------------------------------------------------

  private drawTitle(rect: PlotRect | null, title: string): void {
    if (!rect) return;
    this.renderer.text(title, rect.x + rect.width / 2, rect.y + rect.height / 2, {
      color: this.chrome('foreground'),
      size: 15,
      weight: 600,
      align: 'middle',
      baseline: 'middle',
    });
  }

  // ---- legend (DOM, token-pure CSS) --------------------------------------

  private renderLegend(): void {
    const legendCfg = this.config.legend;
    if (!legendCfg?.show) {
      this.legendEl.replaceChildren();
      this.legendEl.hidden = true;
      return;
    }
    this.legendEl.hidden = false;
    this.legendEl.className = `jects-chart__legend jects-chart__legend--${this.legendPos()}`;

    const isCategorical =
      this.resolved[0] &&
      (this.resolved[0].type === 'pie' || this.resolved[0].type === 'donut');

    const items: Array<{ label: string; color: string; index: number; hidden: boolean }> = [];
    if (isCategorical) {
      const s = this.resolved[0]!;
      const labels = (this.config.categories ?? []).map(String);
      s.data.forEach((_, i) => {
        items.push({
          label: labels[i] ?? `Item ${i + 1}`,
          color: s.color ?? seriesColor(i),
          index: i,
          hidden: false,
        });
      });
    } else {
      this.resolved.forEach((s) => {
        items.push({
          label: s.name,
          color: s.color ?? seriesColor(s.index),
          index: s.index,
          hidden: s.hidden,
        });
      });
    }

    const frag = document.createDocumentFragment();
    items.forEach((it) => {
      const btn = createEl('button', {
        className: `jects-chart__legend-item${it.hidden ? ' jects-chart__legend-item--off' : ''}`,
        attrs: { type: 'button', 'aria-pressed': String(!it.hidden), 'data-series': it.index },
      });
      const swatch = createEl('span', {
        className: 'jects-chart__legend-swatch',
        attrs: { 'aria-hidden': 'true' },
        style: { backgroundColor: it.color },
      });
      const label = createEl('span', { className: 'jects-chart__legend-label', text: it.label });
      btn.append(swatch, label);
      frag.appendChild(btn);
    });
    this.legendEl.replaceChildren(frag);
  }

  // ---- accessible data table ---------------------------------------------

  /**
   * Populate the visually-hidden data region with a real `<table>` mirroring the
   * plotted values — the keyboard/AT-reachable equivalent of the hover tooltip
   * (Quality Gate Q2 / WCAG 1.1.1 & 2.1.1). Built from `this.hits`: every drawn
   * series/point carries a {@link TooltipContext} with the series name, category,
   * and value. The region is emptied + hidden from AT when there are no points.
   */
  private renderDataTable(): void {
    const host = this.dataTableEl;
    if (!this.hits.length) {
      host.replaceChildren();
      host.setAttribute('aria-hidden', 'true');
      return;
    }
    host.removeAttribute('aria-hidden');

    const table = createEl('table', { className: 'jects-chart__data-table' });
    const caption = createEl('caption', {
      text: this.el.getAttribute('aria-label') ?? 'Chart data',
    });
    const thead = createEl('thead');
    const headRow = createEl('tr');
    for (const label of ['Series', 'Category', 'Value']) {
      headRow.appendChild(createEl('th', { attrs: { scope: 'col' }, text: label }));
    }
    thead.appendChild(headRow);

    const tbody = createEl('tbody');
    for (const h of this.hits) {
      const ctx = h.context;
      const tr = createEl('tr');
      tr.append(
        createEl('td', { text: ctx.seriesName }),
        createEl('td', { text: formatCategory(ctx.category) }),
        createEl('td', { text: String(ctx.value) }),
      );
      tbody.appendChild(tr);
    }

    table.append(caption, thead, tbody);
    host.replaceChildren(table);
  }

  // ---- pointer / tooltip --------------------------------------------------

  private attachPointer(): void {
    const node = this.renderer.node as unknown as HTMLElement;
    const onMove = (e: PointerEvent) => this.handleMove(e);
    const onLeave = () => this.handleLeave();
    const onClick = (e: PointerEvent) => this.handleClick(e);
    const onDown = (e: PointerEvent) => this.handleDown(e);
    const onUp = (e: PointerEvent) => this.handleUp(e);
    const onWheel = (e: WheelEvent) => this.handleWheel(e);
    node.addEventListener('pointermove', onMove as EventListener);
    node.addEventListener('pointerleave', onLeave);
    node.addEventListener('click', onClick as EventListener);
    node.addEventListener('pointerdown', onDown as EventListener);
    node.addEventListener('pointerup', onUp as EventListener);
    node.addEventListener('wheel', onWheel as EventListener, { passive: false });
    this.track(() => node.removeEventListener('pointermove', onMove as EventListener));
    this.track(() => node.removeEventListener('pointerleave', onLeave));
    this.track(() => node.removeEventListener('click', onClick as EventListener));
    this.track(() => node.removeEventListener('pointerdown', onDown as EventListener));
    this.track(() => node.removeEventListener('pointerup', onUp as EventListener));
    this.track(() => node.removeEventListener('wheel', onWheel as EventListener));

    // Reset-zoom affordance.
    const resetBtn = this.resetBtn;
    const onReset = () => this.resetZoom();
    resetBtn.addEventListener('click', onReset);
    this.track(() => resetBtn.removeEventListener('click', onReset));

    // Legend toggling (delegated).
    this.on2('.jects-chart__legend-item', 'click', (_e, matched) => {
      const idx = Number(matched.getAttribute('data-series'));
      const isCategorical =
        this.resolved[0] &&
        (this.resolved[0].type === 'pie' || this.resolved[0].type === 'donut');
      if (isCategorical) return; // categorical slices aren't toggled
      this.toggleSeries(idx);
    });
  }

  private localPoint(e: { clientX: number; clientY: number }): { x: number; y: number } {
    const rect = (this.renderer.node as Element).getBoundingClientRect();
    // Hit targets are in the renderer's LOGICAL coordinate space (viewBox).
    // The node may be displayed at a different CSS size (responsive width:100%),
    // so scale client coords back into logical space.
    const sx = rect.width > 0 ? this.renderer.width / rect.width : 1;
    const sy = rect.height > 0 ? this.renderer.height / rect.height : 1;
    return { x: (e.clientX - rect.left) * sx, y: (e.clientY - rect.top) * sy };
  }

  private hitTest(px: number, py: number): HitTarget | null {
    // Topmost first.
    for (let i = this.hits.length - 1; i >= 0; i--) {
      const h = this.hits[i]!;
      if (h.rect) {
        if (px >= h.rect.x && px <= h.rect.x + h.rect.w && py >= h.rect.y && py <= h.rect.y + h.rect.h)
          return h;
      } else if (h.radius !== undefined) {
        const dx = px - h.x;
        const dy = py - h.y;
        if (dx * dx + dy * dy <= h.radius * h.radius) return h;
      }
    }
    return null;
  }

  private handleMove(e: PointerEvent): void {
    const { x, y } = this.localPoint(e);

    // In-progress drag (zoom-select rect or pan).
    if (this.drag) {
      if (this.drag.mode === 'zoom') {
        this.drawSelection(this.drag.x0, this.drag.y0, x, y);
      } else {
        this.applyPanDrag(x, y);
      }
      this.drag.lastX = x;
      this.drag.lastY = y;
      return;
    }

    // Crosshair guide lines (independent of the tooltip).
    this.drawCrosshair(x, y);

    if (!this.config.tooltip?.show) return;
    const hit = this.hitTest(x, y);
    if (!hit) {
      this.hideTooltip();
      return;
    }
    this.showTooltip(hit, x, y);
    this.emit('pointerOver', { context: hit.context });
  }

  private handleLeave(): void {
    this.hideTooltip();
    this.clearCrosshair();
  }

  private handleClick(e: PointerEvent): void {
    const { x, y } = this.localPoint(e);
    const hit = this.hitTest(x, y);
    if (hit) this.emit('pointClick', { context: hit.context });
  }

  // ---- zoom / pan ---------------------------------------------------------

  private handleDown(e: PointerEvent): void {
    if (!this.cartesian || !this.plotRect) return;
    const { x, y } = this.localPoint(e);
    if (!this.inPlot(x, y)) return;
    const zoom = this.config.zoom;
    const pan = this.config.pan;
    // Shift (or an explicit pan-only config) pans; otherwise drag-select zooms.
    const wantPan = pan && (e.shiftKey || !zoom || zoom.drag === false);
    const wantZoom = zoom && zoom.drag !== false && !wantPan;
    if (!wantPan && !wantZoom) return;
    this.drag = { mode: wantPan ? 'pan' : 'zoom', x0: x, y0: y, lastX: x, lastY: y };
    const node = this.renderer.node as unknown as HTMLElement;
    if (typeof node.setPointerCapture === 'function') {
      try {
        node.setPointerCapture(e.pointerId);
      } catch {
        /* capture is best-effort */
      }
    }
  }

  private handleUp(e: PointerEvent): void {
    const drag = this.drag;
    this.drag = null;
    this.clearSelection();
    if (!drag || drag.mode !== 'zoom' || !this.plotRect || !this.xScale) return;
    const { x, y } = this.localPoint(e);
    const plot = this.plotRect;
    const ax = Math.max(plot.x, Math.min(plot.x + plot.width, Math.min(drag.x0, x)));
    const bx = Math.max(plot.x, Math.min(plot.x + plot.width, Math.max(drag.x0, x)));
    if (bx - ax < 4) return; // ignore tiny selections (treat as a click)
    const xType = this.config.zoom?.type ?? 'x';

    // Compose the selection (window-space fractions) into the absolute window.
    const f0x = this.xScale.fractionOf(ax);
    const f1x = this.xScale.fractionOf(bx);
    this.zoomX = composeWindow(this.zoomX, f0x, f1x);

    if (xType === 'xy') {
      const ay = Math.max(plot.y, Math.min(plot.y + plot.height, Math.min(drag.y0, y)));
      const by = Math.max(plot.y, Math.min(plot.y + plot.height, Math.max(drag.y0, y)));
      // Y pixels run top→bottom while the Y domain runs bottom→top: invert.
      const fy0 = 1 - (by - plot.y) / plot.height;
      const fy1 = 1 - (ay - plot.y) / plot.height;
      this.zoomY = composeWindow(this.zoomY, fy0, fy1);
    }
    this.render();
    this.emit('zoom', { x: this.zoomX, y: this.zoomY });
  }

  private handleWheel(e: WheelEvent): void {
    const zoom = this.config.zoom;
    if (!zoom || zoom.wheel === false || !this.cartesian || !this.plotRect || !this.xScale) return;
    const { x, y } = this.localPoint(e);
    if (!this.inPlot(x, y)) return;
    e.preventDefault();
    const factor = e.deltaY > 0 ? 1.2 : 1 / 1.2; // out / in
    const anchorX = clamp01(this.xScale.fractionOf(x));
    this.zoomX = zoomWindow(this.zoomX, anchorX, factor);
    if ((zoom.type ?? 'x') === 'xy') {
      const plot = this.plotRect;
      const anchorY = clamp01(1 - (y - plot.y) / plot.height);
      this.zoomY = zoomWindow(this.zoomY, anchorY, factor);
    }
    this.render();
    this.emit('zoom', { x: this.zoomX, y: this.zoomY });
  }

  private applyPanDrag(x: number, y: number): void {
    if (!this.drag || !this.plotRect) return;
    const plot = this.plotRect;
    const dxFrac = -(x - this.drag.lastX) / plot.width;
    const win = this.zoomX ?? [0, 1];
    this.zoomX = shiftWindow(this.zoomX, dxFrac * (win[1] - win[0]));
    if ((this.config.zoom?.type ?? 'x') === 'xy' || this.config.pan) {
      const dyFrac = (y - this.drag.lastY) / plot.height;
      const winY = this.zoomY ?? [0, 1];
      this.zoomY = shiftWindow(this.zoomY, dyFrac * (winY[1] - winY[0]));
    }
    this.render();
    this.emit('zoom', { x: this.zoomX, y: this.zoomY });
  }

  private inPlot(x: number, y: number): boolean {
    const p = this.plotRect;
    return !!p && x >= p.x && x <= p.x + p.width && y >= p.y && y <= p.y + p.height;
  }

  // ---- overlay (crosshair + zoom-selection), backend-agnostic -------------

  /** Resize the overlay SVG to the current logical frame and keep it on top. */
  private syncOverlay(width: number, height: number): void {
    this.overlayEl.setAttribute('width', String(width));
    this.overlayEl.setAttribute('height', String(height));
    this.overlayEl.setAttribute('viewBox', `0 0 ${width} ${height}`);
    this.overlayEl.setAttribute('preserveAspectRatio', 'none');
    // Re-append so the overlay + reset button stay above the renderer surface.
    this.plotEl.appendChild(this.overlayEl);
    this.plotEl.appendChild(this.resetBtn);
    const zoomed = !!(this.zoomX || this.zoomY);
    this.resetBtn.hidden = !zoomed;
  }

  private clearOverlayGroup(cls: string): void {
    const nodes = this.overlayEl.querySelectorAll(`.${cls}`);
    nodes.forEach((n) => n.remove());
  }

  private clearCrosshair(): void {
    if (this.overlayEl) this.clearOverlayGroup('jects-chart__crosshair');
  }

  private clearSelection(): void {
    if (this.overlayEl) this.clearOverlayGroup('jects-chart__zoom-rect');
  }

  private overlayLine(cls: string, x1: number, y1: number, x2: number, y2: number, color: string): void {
    const line = document.createElementNS(SVG_NS, 'line');
    line.setAttribute('class', cls);
    line.setAttribute('x1', String(x1));
    line.setAttribute('y1', String(y1));
    line.setAttribute('x2', String(x2));
    line.setAttribute('y2', String(y2));
    line.setAttribute('stroke', color);
    line.setAttribute('stroke-width', '1');
    line.setAttribute('stroke-dasharray', '3,3');
    this.overlayEl.appendChild(line);
  }

  private drawCrosshair(px: number, py: number): void {
    const cfg = this.config.crosshair;
    if (!cfg || !this.cartesian || !this.plotRect || !this.xScale) {
      this.clearCrosshair();
      return;
    }
    const plot = this.plotRect;
    if (!this.inPlot(px, py)) {
      this.clearCrosshair();
      return;
    }
    let cx = px;
    let cy = py;
    if (cfg.snap !== false) {
      const near = this.nearestHit(px, py);
      if (near) {
        cx = near.x;
        cy = near.y;
      }
    }
    this.clearCrosshair();
    const color = this.chrome('muted-foreground');
    if (cfg.x !== false) this.overlayLine('jects-chart__crosshair', cx, plot.y, cx, plot.y + plot.height, color);
    if (cfg.y !== false) this.overlayLine('jects-chart__crosshair', plot.x, cy, plot.x + plot.width, cy, color);
  }

  private drawSelection(x0: number, y0: number, x1: number, y1: number): void {
    if (!this.plotRect) return;
    const plot = this.plotRect;
    this.clearSelection();
    const xType = this.config.zoom?.type ?? 'x';
    const ax = Math.max(plot.x, Math.min(plot.x + plot.width, Math.min(x0, x1)));
    const bx = Math.max(plot.x, Math.min(plot.x + plot.width, Math.max(x0, x1)));
    const ay = xType === 'xy' ? Math.max(plot.y, Math.min(plot.y + plot.height, Math.min(y0, y1))) : plot.y;
    const by = xType === 'xy' ? Math.max(plot.y, Math.min(plot.y + plot.height, Math.max(y0, y1))) : plot.y + plot.height;
    const rect = document.createElementNS(SVG_NS, 'rect');
    rect.setAttribute('class', 'jects-chart__zoom-rect');
    rect.setAttribute('x', String(ax));
    rect.setAttribute('y', String(ay));
    rect.setAttribute('width', String(Math.max(0, bx - ax)));
    rect.setAttribute('height', String(Math.max(0, by - ay)));
    rect.setAttribute('fill', this.chrome('primary'));
    rect.setAttribute('fill-opacity', '0.15');
    rect.setAttribute('stroke', this.chrome('primary'));
    rect.setAttribute('stroke-width', '1');
    this.overlayEl.appendChild(rect);
  }

  /** Nearest circular hit target to a pixel (for crosshair snapping). */
  private nearestHit(px: number, py: number): HitTarget | null {
    let best: HitTarget | null = null;
    let bestD = Infinity;
    for (const h of this.hits) {
      if (h.rect) continue;
      const dx = px - h.x;
      const dy = py - h.y;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = h;
      }
    }
    return best;
  }

  private showTooltip(hit: HitTarget, x: number, y: number): void {
    const ctx = hit.context;
    const fmt = this.config.tooltip?.format;
    if (fmt) {
      // A custom formatter returns author-controlled markup that may interpolate
      // untrusted series/category values (SECURITY.md surface #12). Treat it as
      // `html` and route it through the shared core sanitizer so injected
      // <script>/on*-handlers/js: URLs are stripped while legitimate formatting
      // (e.g. <b>, <span>) survives.
      this.tooltipEl.innerHTML = sanitizeHtml(fmt(ctx));
    } else {
      // Build the default tooltip via the DOM API (no HTML parsing). ctx.color is
      // user-supplied (SeriesConfig.color) — interpolating it into an
      // innerHTML attribute context would allow markup injection
      // (e.g. `red"></span><img src=x onerror=...>`). Setting it through
      // `style.backgroundColor` treats it purely as a CSS value, and the text
      // nodes carry the (already-typed) name/category/value safely.
      const swatch = createEl('span', {
        className: 'jects-chart__tooltip-swatch',
        attrs: { 'aria-hidden': 'true' },
        style: { backgroundColor: ctx.color },
      });
      const name = createEl('span', {
        className: 'jects-chart__tooltip-name',
        text: ctx.seriesName,
      });
      const value = createEl('span', {
        className: 'jects-chart__tooltip-value',
        text: `${formatCategory(ctx.category)}: ${String(ctx.value)}`,
      });
      this.tooltipEl.replaceChildren(swatch, name, value);
    }
    this.tooltipEl.hidden = false;
    this.tooltipEl.setAttribute('aria-hidden', 'false');
    // Position relative to the chart root (plot offset).
    const offsetX = this.plotEl.offsetLeft;
    const offsetY = this.plotEl.offsetTop;
    this.tooltipEl.style.left = `${offsetX + x + 12}px`;
    this.tooltipEl.style.top = `${offsetY + y + 12}px`;
  }

  private hideTooltip(): void {
    if (this.tooltipEl.hidden) return;
    this.tooltipEl.hidden = true;
    this.tooltipEl.setAttribute('aria-hidden', 'true');
    this.emit('pointerOut', {});
  }

  // ---- helpers ------------------------------------------------------------

  private addHit(
    geom: { x: number; y: number; radius?: number; rect?: { x: number; y: number; w: number; h: number } },
    s: ResolvedSeries,
    point: number,
    value: number,
    color: string,
    category?: string | number,
  ): void {
    const cats = this.config.categories ?? [];
    this.hits.push({
      ...geom,
      context: {
        seriesIndex: s.index,
        seriesName: s.name,
        pointIndex: point,
        category: category ?? cats[point] ?? point,
        value,
        color,
      },
    });
  }

  /**
   * Compute and apply the accessible name/description for the chart graphic.
   * Name resolution: `ariaLabel` → `title` → a generated "<type> chart"
   * summary listing the visible series. Applied to both the root and the inner
   * renderer surface (role="img" on each).
   */
  private applyA11y(defaultType: string): void {
    const cfg = this.config;
    const explicit = cfg.ariaLabel ?? cfg.title;
    const label = explicit && explicit.length ? explicit : this.generatedLabel(defaultType);
    const desc = cfg.description;

    this.el.setAttribute('aria-label', label);
    // Wire the inner surface (svg <title>/<desc>, canvas aria-label/fallback).
    // The longer description lives on the inner surface to avoid the root and
    // the surface announcing duplicate text.
    this.renderer.describe(label, desc);
  }

  /** Build a default accessible name from the chart type and series names. */
  private generatedLabel(defaultType: string): string {
    const type = this.resolved[0]?.type ?? defaultType;
    const names = this.resolved
      .filter((s) => !s.hidden && s.name)
      .map((s) => s.name);
    const seriesPart =
      names.length === 0
        ? ''
        : names.length === 1
          ? `: ${names[0]}`
          : ` with series ${names.join(', ')}`;
    return `${type} chart${seriesPart}`;
  }

  private padding(): Insets {
    const p = this.config.padding ?? {};
    return {
      top: p.top ?? DEFAULT_PADDING.top,
      right: p.right ?? DEFAULT_PADDING.right,
      bottom: p.bottom ?? DEFAULT_PADDING.bottom,
      left: p.left ?? DEFAULT_PADDING.left,
    };
  }

  private legendPos(): 'top' | 'bottom' | 'left' | 'right' | 'none' {
    const l = this.config.legend;
    if (!l?.show) return 'none';
    return l.position ?? 'bottom';
  }

  /** Resolve a chrome (UI) token to a concrete color for the renderer. */
  private chrome(token: string): string {
    return resolveTokenColor(token, this.el);
  }

  override destroy(): void {
    // Base Widget disposes tracked listeners/effects and removes el.
    super.destroy();
  }
}

/** Map a value to a horizontal pixel for horizontalBar using the axis domain. */
function mapToWidth(
  value: number,
  resolved: readonly ResolvedSeries[],
  axis: 'left' | 'right',
  plot: PlotRect,
): number {
  const dom = valueDomain(resolved, axis) ?? { min: 0, max: 1 };
  const lo = Math.min(dom.min, 0);
  const hi = Math.max(dom.max, 0);
  const span = hi - lo || 1;
  return plot.x + ((value - lo) / span) * plot.width;
}

function formatCategory(c: string | number): string {
  return String(c);
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Collapse a window to `null` when it covers (essentially) the full domain. */
function normalizeWindow(win: [number, number] | null): [number, number] | null {
  if (!win) return null;
  let [a, b] = win;
  a = clamp01(Math.min(a, b));
  b = clamp01(Math.max(win[0], win[1]));
  if (b - a < 0.0005) return null;
  if (a <= 0.0001 && b >= 0.9999) return null;
  return [a, b];
}

/** Shift a window by a fraction of the FULL domain, clamped to [0,1]. */
function shiftWindow(win: [number, number] | null, delta: number): [number, number] | null {
  const [a, b] = win ?? [0, 1];
  const span = b - a;
  let n0 = a + delta;
  let n1 = b + delta;
  if (n0 < 0) {
    n0 = 0;
    n1 = span;
  }
  if (n1 > 1) {
    n1 = 1;
    n0 = 1 - span;
  }
  return normalizeWindow([n0, n1]);
}

/**
 * Zoom a window about an anchor (a fraction WITHIN the current window). `factor`
 * > 1 zooms out, < 1 zooms in. Result is clamped to [0,1].
 */
function zoomWindow(win: [number, number] | null, anchorInWindow: number, factor: number): [number, number] | null {
  const [a, b] = win ?? [0, 1];
  const span = b - a;
  const newSpan = clamp01(span * factor);
  if (newSpan <= 0.005) return win; // don't zoom past a tiny floor
  const anchor = a + clamp01(anchorInWindow) * span;
  let n0 = anchor - clamp01(anchorInWindow) * newSpan;
  let n1 = n0 + newSpan;
  if (n0 < 0) {
    n1 -= n0;
    n0 = 0;
  }
  if (n1 > 1) {
    n0 -= n1 - 1;
    n1 = 1;
  }
  return normalizeWindow([Math.max(0, n0), Math.min(1, n1)]);
}

/**
 * Compose a sub-selection (fractions within the CURRENT window) into an absolute
 * [0,1] window over the full domain — used by drag-to-zoom which selects within
 * the already-zoomed view.
 */
function composeWindow(
  current: [number, number] | null,
  fracLo: number,
  fracHi: number,
): [number, number] | null {
  const [a, b] = current ?? [0, 1];
  const span = b - a;
  const lo = a + clamp01(Math.min(fracLo, fracHi)) * span;
  const hi = a + clamp01(Math.max(fracLo, fracHi)) * span;
  return normalizeWindow([lo, hi]);
}

register(
  'chart',
  Chart as unknown as new (host: HTMLElement | string, config?: Record<string, unknown>) => Chart,
);
