/**
 * i18n — externalised, overridable message catalog for the booking widget.
 *
 * Every user-facing string the widget renders flows through a `BookingMessages`
 * object. `defaultMessages` is the English baseline; `resolveMessages()` merges
 * caller overrides on top so a host can ship a single key or a whole locale.
 * Dependency-free and unit-tested directly.
 */

/** The complete set of user-facing strings the booking widget renders. */
export interface BookingMessages {
  /** Accessible name for the whole widget. */
  widgetLabel: string;
  /** Heading above the slot grid. */
  selectTime: string;
  /** Confirm button text in the reservation form. */
  confirmBooking: string;
  /** Shown when a day has no bookable times. */
  noTimes: string;
  /** Accessible label for the empty slot grid. */
  noTimesShort: string;
  /** Slot state suffixes used in `aria-label`. */
  stateAvailable: string;
  stateBooked: string;
  stateUnavailable: string;
  stateFull: string;
  /** Resource/service selector accessible name. */
  selectService: string;
  /** Reservation form accessible name. */
  reservationDetails: string;
  /** Field labels. */
  fieldName: string;
  fieldEmail: string;
  fieldNotes: string;
  /** Timezone selector label. */
  timezone: string;
  /** "{n} seats left" — `{n}` is substituted. */
  seatsLeft: string;
  /** Singular variant "1 seat left". */
  seatLeftOne: string;
  /** Join the waitlist (slot full). */
  joinWaitlist: string;
  /** Confirmation banner after a successful booking. `{date}`/`{time}` subbed. */
  confirmationMessage: string;
  /** Waitlist confirmation. */
  waitlistedMessage: string;
  /** Manage panel heading + actions. */
  manageHeading: string;
  reschedule: string;
  cancel: string;
  undo: string;
  redo: string;
  deleteSelected: string;
  selectAll: string;
  /** Status labels. */
  statusPending: string;
  statusConfirmed: string;
  statusCancelled: string;
  /** Export the booked appointment as an .ics file. */
  exportIcs: string;
  /** Calendar (month/week) view toggle labels. */
  viewSlots: string;
  viewCalendar: string;
  /** Heading above the month/week booking overview (`showCalendarView`). */
  overviewHeading: string;
  /** Recurrence summary prefixes (used by `describeRule`). */
  recurDaily: string;
  recurWeekly: string;
  recurMonthly: string;
  recurYearly: string;
  recurEvery: string;
  recurTimes: string;
  recurUntil: string;
}

/** The English baseline. Frozen so a stray mutation can't corrupt the default. */
export const defaultMessages: BookingMessages = Object.freeze({
  widgetLabel: 'Book an appointment',
  selectTime: 'Select a time',
  confirmBooking: 'Confirm booking',
  noTimes: 'No times available for this day.',
  noTimesShort: 'No available times',
  stateAvailable: 'available',
  stateBooked: 'booked',
  stateUnavailable: 'unavailable',
  stateFull: 'full',
  selectService: 'Select a service',
  reservationDetails: 'Reservation details',
  fieldName: 'Name',
  fieldEmail: 'Email',
  fieldNotes: 'Notes',
  timezone: 'Timezone',
  seatsLeft: '{n} seats left',
  seatLeftOne: '1 seat left',
  joinWaitlist: 'Join waitlist',
  confirmationMessage: 'Booked for {date} at {time}.',
  waitlistedMessage: 'Added to the waitlist for {date} at {time}.',
  manageHeading: 'Your bookings',
  reschedule: 'Reschedule',
  cancel: 'Cancel',
  undo: 'Undo',
  redo: 'Redo',
  deleteSelected: 'Delete selected',
  selectAll: 'Select all',
  statusPending: 'Pending',
  statusConfirmed: 'Confirmed',
  statusCancelled: 'Cancelled',
  exportIcs: 'Add to calendar',
  viewSlots: 'Times',
  viewCalendar: 'Calendar',
  overviewHeading: 'Bookings overview',
  recurDaily: 'day',
  recurWeekly: 'week',
  recurMonthly: 'month',
  recurYearly: 'year',
  recurEvery: 'Every',
  recurTimes: 'times',
  recurUntil: 'until',
});

/**
 * Merge `overrides` onto the English baseline, returning a complete catalog.
 * Unknown keys are ignored; missing keys fall back to `defaultMessages`.
 */
export function resolveMessages(overrides?: Partial<BookingMessages> | undefined): BookingMessages {
  if (!overrides) return defaultMessages;
  return { ...defaultMessages, ...overrides };
}

/**
 * Substitute `{token}` placeholders in a message with the supplied values.
 * Unmatched tokens are left intact; values are coerced to strings.
 */
export function formatMessage(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) =>
    key in values ? String(values[key]) : whole,
  );
}
