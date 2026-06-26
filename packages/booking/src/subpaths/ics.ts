/**
 * `@jects/booking/ics` — minimal RFC-5545 VEVENT writer (+ browser download) as a
 * standalone, tree-shakeable entry.
 *
 * Re-exports ONLY the `ics.ts` module, which is fully self-contained (zero
 * internal imports). This chunk pulls nothing else from the package — no
 * `Booking` widget, no `@jects/widgets`, no CSS.
 */

export {
  bookingToIcs,
  eventToVEvent,
  escapeIcsText,
  formatIcsUtc,
  foldLine,
  downloadIcs,
  type IcsEvent,
  type IcsOptions,
} from '../booking/ics.js';
