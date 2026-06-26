/**
 * `@jects/calendar/timezone` — timezone projection + Intl locale label helpers,
 * as a standalone ESM subpath.
 *
 * This barrel re-exports the package's `../tz.ts` module, which has NO internal
 * imports at all (pure `Intl`-based helpers). Importing this subpath pulls ONLY
 * the timezone/locale area, never the package hub or the rest of the bundle.
 */
export {
  zonedTime,
  timeZoneOffsetMinutes,
  weekdayLabels,
  monthLabels,
  formatClock,
} from '../tz.js';
