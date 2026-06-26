/**
 * `@jects/timeline-core` — axis area barrel.
 *
 * The horizontal time ⇄ pixel projection engine and its supporting geometry:
 * the {@link DefaultTimeAxis} (TimeAxis), built-in {@link ViewPreset}s + the zoom
 * ladder, the {@link DefaultRowVirtualizer} (RowVirtualizer over core
 * `computeWindow`/`OffsetIndex`), the {@link DefaultTimelineViewport}
 * (TimelineViewport), and the time-range / non-working-time / column-line
 * backdrop geometry. All framework-free, token-pure, implemented against
 * `../contract.ts`.
 *
 * Importing this module also pulls in the area's side-effect CSS.
 */

import './axis.css';

/* ── calendar arithmetic ─────────────────────────────────────────────── */
export {
  isFixedUnit,
  fixedUnitMs,
  floorToUnit,
  addUnits,
  daysInMonth,
  unitSpanMs,
  unitCount,
  weekday,
} from './time-units.js';

/* ── view presets + zoom ladder ──────────────────────────────────────── */
export {
  DEFAULT_ZOOM_LEVELS,
  HOUR_AND_DAY,
  WEEK_AND_DAY,
  MONTH_AND_WEEK,
  YEAR_AND_MONTH,
  YEAR_AND_QUARTER,
  PRESET_LADDER,
  BUILT_IN_PRESETS,
  getPreset,
  finestBand,
  clampZoom,
  zoomInStep,
  zoomOutStep,
  type ZoomStep,
} from './presets.js';

/* ── time axis ───────────────────────────────────────────────────────── */
export { DefaultTimeAxis, type TimeAxisConfig } from './time-axis.js';

/* ── row virtualizer ─────────────────────────────────────────────────── */
export {
  DefaultRowVirtualizer,
  type RowProvider,
  type RowVirtualizerConfig,
} from './row-virtualizer.js';

/* ── viewport ────────────────────────────────────────────────────────── */
export {
  DefaultTimelineViewport,
  type ViewportHost,
  type TimelineViewportConfig,
} from './viewport.js';

/* ── time ranges / shading / column lines ────────────────────────────── */
export {
  projectTimeRanges,
  computeNonWorkingSpans,
  projectNonWorkingSpans,
  mergeSpans,
  computeColumnLines,
  type TimeRange,
  type TimeRangeKind,
  type TimeRangeBox,
  type WorkingTimeCalendar,
  type ColumnLine,
} from './time-ranges.js';
