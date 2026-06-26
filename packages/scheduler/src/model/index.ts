/**
 * @jects/scheduler/model — the pure, framework-free model layer.
 *
 * Subpath entry: `@jects/scheduler/model`.
 *
 * This barrel re-exports ONLY the headless model utilities — event lane layout,
 * recurrence (RRULE) expansion, dependency-link projection, time-range
 * projection, infinite-scroll planning, and assignment resolution. It pulls in
 * NO view code (no `Scheduler` widget, no editors, no DOM), so importing it gives
 * you the scheduling math without the rendered component. Every symbol here is
 * also re-exported from the package main entry (`@jects/scheduler`); this subpath
 * is purely additive and lets a consumer take just the model layer.
 */

export {
  layoutLane,
  type LaneLayoutInput,
  type LaneLayoutResult,
} from './event-layout.js';

export {
  parseRRule,
  expandOccurrences,
  type RecurrenceRule,
} from './recurrence.js';

export { toLink, toLinks, terminalsFor } from './dependencies.js';

export {
  projectTimeRangeConfigs,
  projectResourceTimeRangeConfigs,
  type TimeRangeConfig,
  type ResourceTimeRangeConfig,
  type TimeRangeBox,
  type ResourceTimeRangeBox,
} from './time-ranges.js';

export {
  planInfiniteScroll,
  type InfiniteScrollInput,
  type InfiniteScrollPlan,
} from './infinite-scroll.js';

export {
  DEFAULT_ASSIGNMENT_UNITS,
  buildAssignmentIndex,
  resolveUnits,
  resolveRowAssignedEvents,
  type ResolvedAssignedEvent,
  type EventLookup,
  type AssignmentLookup,
  type AssignmentIndex,
} from './assignments.js';
