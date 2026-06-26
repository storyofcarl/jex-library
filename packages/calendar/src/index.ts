/**
 * @jects/calendar — event calendar with switchable Day/Week/Month/Year/Agenda/
 * Resource views, recurring + multi-day + all-day events, drag create/move/resize,
 * a mini-calendar navigator, an event editor (reusing @jects/widgets Window),
 * and category + resource filtering.
 *
 * Importing this module registers the Calendar with the factory
 * (`create({ type: 'calendar', ... })`) and pulls in the package's side-effect CSS.
 * Side-effect CSS: `import '@jects/calendar/style.css'`.
 */

import './styles.css';

/* ── Calendar widget (value + types) ─────────────────────────────────── */
export { Calendar } from './calendar.js';

/* ── EventStore ──────────────────────────────────────────────────────── */
export { EventStore, normalizeEvent } from './event-store.js';

/* ── Recurrence engine + RRULE string interop ────────────────────────── */
export {
  expandEvent,
  expandEvents,
  describeRule,
  parseRRule,
  toRRule,
} from './recurrence.js';

/* ── Timezone + Intl locale helpers ──────────────────────────────────── */
export {
  zonedTime,
  timeZoneOffsetMinutes,
  weekdayLabels,
  monthLabels,
  formatClock,
} from './tz.js';

/* ── Export: ICS / CSV / print ───────────────────────────────────────── */
export {
  toIcs,
  toCsv,
  eventToVEvent,
  escapeIcsText,
  foldLine,
  formatIcsUtc,
  formatIcsDate,
  downloadFile,
  printElement,
  type IcsExportOptions,
} from './export.js';

/* ── Undo / redo history ─────────────────────────────────────────────── */
export { CalendarHistory, type HistoryState } from './history.js';

/* ── Time-grid overlap layout ────────────────────────────────────────── */
export { layoutDay, type LaidOutOccurrence } from './layout.js';

/* ── Event editor ────────────────────────────────────────────────────── */
export { openEventEditor, type EditorOptions, type EditorResult } from './editor.js';

/* ── Date utilities ──────────────────────────────────────────────────── */
export {
  MS_PER_MINUTE,
  MS_PER_HOUR,
  MS_PER_DAY,
  startOfDay,
  endOfDay,
  addDays,
  addWeeks,
  addMonths,
  addYears,
  addMinutes,
  daysInMonth,
  isSameDay,
  isSameMonth,
  diffDays,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  startOfYear,
  monthGrid,
  weekDays,
  isoWeek,
  minutesIntoDay,
  atMinutes,
  clampDate,
  rangesOverlap,
  dayKey,
  timeLabel24,
  parseLocal,
  toLocalInput,
  toDateInput,
  type Weekday,
} from './date-utils.js';

/* ── Frozen public contract (types) ──────────────────────────────────── */
export type {
  RecurrenceFreq,
  RecurrenceRule,
  CalendarEvent,
  EventOccurrence,
  CalendarCategory,
  CalendarResource,
  CalendarViewType,
  CalendarDataSource,
  CalendarConfig,
  CalendarEvents,
  DraftRange,
  CalendarViewContext,
  CalendarView,
  CalendarInstance,
} from './contract.js';
