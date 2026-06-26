/**
 * @jects/gantt — scheduling engine entry point.
 *
 * Headless, framework-free project-scheduling math implementing the
 * {@link SchedulingEngine} contract: a calendar-aware Critical Path Method
 * scheduler with forward (ASAP) / backward (ALAP) passes, the 8 constraint
 * types, FS/SS/FF/SF dependencies with lag, working-time calendars, summary
 * roll-up, total/free slack, critical path, baselines, and incremental recalc.
 *
 * Pure logic — no DOM. The Gantt UI drives this through the contract; consumers
 * may use it standalone.
 */

export { CpmEngine, createSchedulingEngine } from './scheduler.js';
export {
  buildCalculator,
  calculatorFor,
  resolveCalendar,
  type CalendarCalculator,
} from './calendar.js';

/* ── Effort-driven, resource-aware scheduling (decorator) ─────────────────
   `EffortDrivenEngine` decorates ANY `SchedulingEngine` (the CPM engine, the
   UI default engine, or a custom one) to make **effort** a first-class
   scheduling input: an effort-driven task's working DURATION is derived from
   `effort / Σ(assigned resource units)` and reflows as resources are added/
   removed or their units change (and the inverse for fixed-duration tasks).
   Drop-in for `GanttOptions.engine` via `createEffortDrivenEngine(inner)`;
   usable standalone. PURE LOGIC — no DOM, no edit to the inner engine. */
export {
  EffortDrivenEngine,
  createEffortDrivenEngine,
  resolveEffort,
  isEffortDriven,
  assignmentUnits,
  resourceCapacity,
  totalUnits,
  unitsFraction,
  durationFromEffort,
  effortFromDuration,
  effortToPersonDays,
  personDaysToEffort,
  DEFAULT_HOURS_PER_DAY,
  FULL_TIME_UNITS,
  type ResourceModel as EffortResourceModel,
  type AssignmentModel as EffortAssignmentModel,
  type EffortDrivenTask,
  type EffortResolution,
  type ResourceAwareEngine,
} from './effort.js';

/* ── Split / segmented task span math (DOM-free) ──────────────────────────
   The pure span/working-time arithmetic backing the split-task UI feature:
   read/normalize segments, compute a segmented task's span + working duration +
   gaps, split a task into segments, join segments back, and move/reschedule a
   segment across the working calendar. Drives ui/segmented-tasks.ts; usable
   standalone. */
export {
  readSegments,
  isSplit,
  normalizeSegments,
  segmentsSpan,
  segmentsWorkingDuration,
  segmentGaps,
  splitTask,
  joinSegments,
  joinAll,
  moveSegment,
  rescheduleSegments,
  ONE_WORKING_DAY,
  MIN_SEGMENT_WORK,
} from './segments.js';
export type {
  TaskSegment,
  SegmentedTask,
  SegmentEditResult,
  SegmentDragMode,
} from './segments.js';
