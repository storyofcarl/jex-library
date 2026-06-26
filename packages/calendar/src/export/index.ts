/**
 * `@jects/calendar/export` — ICS (RFC-5545) / CSV / print export surface, as a
 * standalone ESM subpath.
 *
 * This barrel re-exports the package's `../export.ts` module. That module depends
 * only on the type-only public `contract` and the recurrence module's `toRRule`
 * (which itself pulls only `date-utils`) — it does NOT import the `Calendar`
 * widget or any other part of the package hub. Importing this subpath pulls ONLY
 * the export + recurrence-serializer area, not the whole bundle.
 */
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
} from '../export.js';
