/**
 * `@jects/calendar/recurrence` — recurrence engine + RRULE (RFC-5545 subset)
 * string interop, as a standalone ESM subpath.
 *
 * This barrel re-exports the package's recurrence module (`../recurrence.ts`),
 * which depends only on the type-only public `contract` and the pure
 * `date-utils` helpers — it does NOT import the `Calendar` widget or any other
 * part of the package hub. Importing this subpath therefore pulls ONLY the
 * recurrence area (plus those shared leaf utilities), not the whole bundle.
 */
export {
  expandEvent,
  expandEvents,
  describeRule,
  parseRRule,
  toRRule,
} from '../recurrence.js';
