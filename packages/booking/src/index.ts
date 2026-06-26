/**
 * @jects/booking — an appointment-booking widget built on @jects/core.
 *
 * A date picker (reusing @jects/widgets MiniCalendar) + a time-slot grid showing
 * available / booked slots for the chosen day (configurable working hours, slot
 * duration, existing bookings, optional resource/service selection), then a
 * reservation FORM (reusing @jects/widgets Form: name / email / notes) to
 * confirm; emits a vetoable `beforeBook` then `book`.
 *
 * Importing this module registers the component with the factory under the type
 * `"booking"` (and pulls in @jects/widgets so MiniCalendar/Form are registered).
 *
 * Side-effect CSS: `import '@jects/booking/style.css'`.
 */

import './styles.css';
// Ensure the reused @jects/widgets controls (MiniCalendar, Form, fields) are
// registered with the factory before a Booking instance tries to create them.
import '@jects/widgets';

export {
  Booking,
  type BookingConfig,
  type BookingEvents,
  type BookingResource,
  type BookingResult,
  type ReservationDetails,
  type BookingFieldSchema,
  type TimeFormat,
} from './booking/booking.js';

export {
  generateSlots,
  formatHM,
  formatHM12,
  parseHM,
  type Slot,
  type WorkingHours,
  type ExistingBooking,
  type GenerateSlotsOptions,
} from './booking/slots.js';

// Availability rules (weekly hours, overrides, blackouts, per-resource).
export {
  resolveAvailableRanges,
  normalizeRanges,
  weekdayOf,
  isBlackout,
  rulesFromWorkingHours,
  type AvailabilityRules,
  type AvailabilitySchedule,
  type TimeRange,
  type DateOverride,
  type BlackoutDate,
  type Weekday,
} from './booking/availability-rules.js';

// Timezone math (DST-correct, Intl-only).
export {
  timeZoneOffsetMinutes,
  zonedParts,
  wallTimeToInstant,
  slotInstant,
  instantToZoned,
  localTimeZone,
  offsetLabel,
  commonTimeZones,
  type ZonedParts,
} from './booking/timezone.js';

// Capacity + waitlist.
export {
  WaitlistManager,
  slotKeyId,
  sameSlot,
  countSeatsBooked,
  seatsRemaining,
  type SlotKey,
  type WaitlistEntry,
} from './booking/capacity.js';

// Services / event types.
export {
  findService,
  serviceConstraints,
  formatPrice,
  type BookingService,
  type ServiceConstraints,
} from './booking/services.js';

// Recurring series (RRULE subset).
export {
  parseRRule,
  toRRule,
  expandRecurrence,
  generateSeries,
  validateSeries,
  describeRule,
  type RecurrenceRule,
  type RecurrenceFreq,
  type SeriesSlot,
  type SeriesSlotValidation,
} from './booking/recurring.js';

// Calendar overview views.
export {
  BookingCalendarView,
  monthMatrix,
  weekDays,
  summarizeByDay,
  type BookingCalendarConfig,
  type BookingCalendarEvents,
  type BookingCalendarMode,
} from './booking/calendar-views.js';

// Booking manager (status lifecycle, reschedule, cancel).
export {
  BookingManager,
  type ManagedBooking,
  type BookingStatus,
  type ReschedulePatch,
  type BookingManagerEvents,
} from './booking/booking-manager.js';

// Async data provider (REST + optional WebSocket).
export {
  AjaxBookingDataProvider,
  type BookingDataProvider,
  type AjaxBookingDataProviderConfig,
  type DateRange,
  type CreateBookingInput,
  type BookingSyncOp,
} from './booking/data-provider.js';

// Commands / undo-redo / multi-select.
export {
  CommandStack,
  SelectionModel,
  command,
  type Command,
  type CommandStackEvents,
  type SelectionEvents,
} from './booking/commands.js';

// ICS export.
export {
  bookingToIcs,
  eventToVEvent,
  escapeIcsText,
  formatIcsUtc,
  foldLine,
  downloadIcs,
  type IcsEvent,
  type IcsOptions,
} from './booking/ics.js';

// Notifications + reminders.
export {
  formatConfirmation,
  formatWaitlisted,
  ReminderScheduler,
  type Reminder,
  type ReminderEvents,
  type ReminderClock,
} from './booking/notifications.js';

// i18n message catalog.
export {
  defaultMessages,
  resolveMessages,
  formatMessage,
  type BookingMessages,
} from './booking/i18n.js';
