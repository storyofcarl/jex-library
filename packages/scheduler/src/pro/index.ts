/**
 * @jects/scheduler — PRO feature barrel.
 *
 * The scheduling engine (auto forward/backward scheduling on dependency change,
 * constraints, multi-level working-time calendars) plus the Resource Histogram
 * and Resource Utilization views. All framework-free / token-pure, built over
 * the same contract + timeline-core primitives as the core scheduler.
 */

export {
  schedule,
  DAY_MS,
  type ScheduleInput,
  type ScheduleDirection,
  type ScheduledSpan,
} from './scheduling-engine.js';

export { WorkingCalendar } from './calendar.js';

export {
  computeHistograms,
  computeUtilization,
  type HistogramInput,
  type HistogramBucket,
  type ResourceHistogram,
  type UtilizationSummary,
} from './histogram.js';

export {
  HistogramView,
  UtilizationView,
  type HistogramViewConfig,
  type UtilizationViewConfig,
} from './histogram-view.js';

export {
  travelMargins,
  hasTravel,
  coreSpan,
  travelSpan,
  travelOverlaps,
  findTravelOverlaps,
  packWithTravel,
  travelZoneBoxes,
  renderTravelZones,
  type TravelAxis,
  type TravelMargins,
  type TravelOverlap,
  type TravelPlacement,
  type TravelZoneBoxes,
} from './travel-time.js';

export {
  bufferMargins,
  bufferedSpan,
  requiredGap,
  findBufferViolations,
  isBufferSatisfied,
  clearBufferStart,
  bufferZoneBoxes,
  renderBufferZones,
  type BufferAxis,
  type BufferConfig,
  type BufferMargins,
  type BufferableEvent,
  type BufferedEventExtras,
  type BufferViolation,
  type BufferZoneBoxes,
} from './event-buffer.js';
