/**
 * `@jects/booking/availability` — availability-rule resolution as a standalone,
 * tree-shakeable entry.
 *
 * Re-exports ONLY the availability-rules area (weekly hours, date overrides,
 * blackouts, per-resource scoping → resolved time-of-day ranges) plus the slot
 * primitives it depends on. This chunk imports `availability-rules.ts` and
 * `slots.ts` only — it never pulls the `Booking` widget, `@jects/widgets`, or
 * the package CSS, so consumers who just need availability math ship none of the
 * UI tree.
 */

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
} from '../booking/availability-rules.js';

export {
  generateSlots,
  formatHM,
  formatHM12,
  parseHM,
  type Slot,
  type WorkingHours,
  type ExistingBooking,
  type GenerateSlotsOptions,
} from '../booking/slots.js';
