/**
 * @jects/widgets/datetime — date/time widgets and date utilities.
 *
 * Additive subpath barrel. Importing this entry pulls in ONLY the `datetime`
 * family code (plus the shared anchored-panel positioning leaf the popovers
 * reference), never the whole widget kit. Side-effect CSS still lives in
 * `@jects/widgets/style.css`.
 */

export {
  DatePicker,
  type DatePickerConfig,
  type DatePickerEvents,
} from './datetime/date-picker.js';

export {
  TimePicker,
  type TimePickerConfig,
  type TimePickerEvents,
} from './datetime/time-picker.js';

export {
  DateTimeField,
  type DateTimeFieldConfig,
  type DateTimeFieldEvents,
} from './datetime/date-time-field.js';

export {
  MiniCalendar,
  type MiniCalendarConfig,
  type MiniCalendarEvents,
} from './datetime/mini-calendar.js';

export {
  type WeekStart,
  type TimeValue,
  MONTH_NAMES,
  WEEKDAY_NAMES,
  WEEKDAY_ABBR,
  startOfDay,
  isSameDay,
  isSameMonth,
  addDays,
  addMonths,
  daysInMonth,
  clampDate,
  isDisabledDay,
  buildMonthMatrix,
  weekdayHeaders,
  parseISODate,
  formatISODate,
  pad2,
  formatTime24,
  formatTime12,
  parseTime,
  snapMinutes,
} from './datetime/date-utils.js';
