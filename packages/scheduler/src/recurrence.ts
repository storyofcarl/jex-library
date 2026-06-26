/**
 * @jects/scheduler/recurrence — RRULE parsing + occurrence expansion.
 *
 * Subpath entry: `@jects/scheduler/recurrence`.
 *
 * The smallest, most reusable slice of the model layer: an iCalendar RRULE
 * parser and an occurrence-expansion function over a time window. Depends only
 * on `@jects/timeline-core` time types (externalized), so the built chunk is a
 * single self-contained module with no other package code. Also re-exported from
 * the package main entry; this subpath is additive.
 */

export {
  parseRRule,
  expandOccurrences,
  type RecurrenceRule,
} from './model/recurrence.js';
