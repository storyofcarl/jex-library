/**
 * `@jects/booking/timezone` — DST-correct IANA timezone math as a standalone,
 * tree-shakeable entry.
 *
 * Re-exports ONLY the `timezone.ts` module, which is fully self-contained
 * (`Intl`-only, zero internal imports). This chunk pulls nothing else from the
 * package — no slot engine, no `Booking` widget, no `@jects/widgets`, no CSS.
 */

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
} from '../booking/timezone.js';
