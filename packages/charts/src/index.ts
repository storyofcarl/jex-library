/**
 * @jects/charts — Jects UI data-visualization components built on @jects/core.
 *
 * Importing this module registers each chart component with the factory.
 * Side-effect CSS: `import '@jects/charts/style.css'`.
 */

import './styles.css';

// The Chart Widget + its config/event types.
export {
  Chart,
  type ChartConfig,
  type ChartEvents,
  type ChartType,
  type ChartPoint,
  type RendererKind,
  type AxisKind,
  type AxisSide,
  type AxisConfig,
  type SeriesConfig,
  type LegendConfig,
  type TooltipConfig,
  type TooltipContext,
  type Insets,
  type GradientStop,
  type GradientFill,
  type ZoomConfig,
  type PanConfig,
  type CrosshairConfig,
  type Annotation,
  type DataLabelsConfig,
  resolveSeries,
  applyStacking,
  valueDomain,
  axisInUse,
  isCartesian,
  isStackable,
  type ResolvedSeries,
  type Domain,
  computeLayout,
  LAYOUT_CONSTANTS,
  type ChartLayout,
  type PlotRect,
  type LayoutInput,
} from './chart/index.js';

// Scales (linear/log/category/time) + tick math.
export {
  type ScaleKind,
  type ScaleTick,
  type ScaleBase,
  type NumericScale,
  type CategoryScale,
  niceStep,
  niceTicks,
  niceBounds,
  defaultNumberFormat,
  LinearScale,
  type LinearScaleOptions,
  LogScale,
  type LogScaleOptions,
  BandScale,
  type CategoryScaleOptions,
  TimeScale,
  type TimeScaleOptions,
} from './scale/index.js';

// Geometry path/arc/radar/treemap builders (pure math).
export {
  type Pt,
  linePath,
  splinePath,
  areaPath,
  rectPath,
  type ArcSlice,
  pieSlices,
  polarToCartesian,
  arcPath,
  type RadarPoint,
  radarPoints,
  radarGridRing,
  type TreemapInput,
  type TreemapRect,
  squarify,
} from './geometry/index.js';

// Renderers (SVG + Canvas) and the factory.
export {
  type Renderer,
  type StrokeStyle,
  type FillStyle,
  type TextStyle,
  type GradientSpec,
  SvgRenderer,
  CanvasRenderer,
  svgStringToPng,
  createRenderer,
  pngDataUrlToPdf,
  pngDataUrlToPdfBytes,
} from './renderer/index.js';

// House CMYK categorical color ramp helpers.
export {
  RAMP_SIZE,
  RAMP_TOKENS,
  seriesColor,
  rampColor,
  tokenColor,
  resolveSeriesColor,
  resolveTokenColor,
} from './color/palette.js';

// Large-data averaging / downsampling.
export {
  type XY,
  averagePoints,
  minMaxDownsample,
} from './data/aggregate.js';
