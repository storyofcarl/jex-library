/**
 * @jects/calendar — timezone + Intl locale helpers.
 *
 * Two concerns live here, both framework-free and pure:
 *
 *  1. **Timezone projection.** Events are stored as native `Date` instants. To
 *     render them in a configured display timezone we project an instant into a
 *     "zoned" `Date` whose LOCAL fields (`getHours()`, `getDate()`, …) equal the
 *     wall-clock reading in that timezone. The rest of the calendar then keeps
 *     using its existing local-field date math unchanged — the projection is the
 *     only seam. Conversion uses `Intl.DateTimeFormat` (no offset tables shipped).
 *
 *  2. **Locale labels.** Weekday / month / clock labels are produced via `Intl`
 *     from the configured `locale` (+ `timeZone`), replacing the hard-coded
 *     English `WEEKDAY_NAMES` / `MONTH_NAMES` arrays.
 *
 * `Intl.DateTimeFormat` construction is comparatively costly, so formatters are
 * memoized by their cache key.
 */

/** Calendar-day + wall-clock fields read out of a timezone. */
interface ZonedParts {
  year: number;
  month: number; // 1..12
  day: number;
  hour: number; // 0..23
  minute: number;
  second: number;
}

const partFmtCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = partFmtCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    partFmtCache.set(timeZone, f);
  }
  return f;
}

/** Decompose an instant into the wall-clock fields of `timeZone`. */
function zonedParts(instant: Date, timeZone: string): ZonedParts {
  const map: Record<string, string> = {};
  for (const p of partsFormatter(timeZone).formatToParts(instant)) {
    if (p.type !== 'literal') map[p.type] = p.value;
  }
  // `h23` renders midnight as `00`, but some engines historically emitted `24`.
  const hour = Number(map.hour ?? '0');
  return {
    year: Number(map.year ?? '1970'),
    month: Number(map.month ?? '1'),
    day: Number(map.day ?? '1'),
    hour: hour === 24 ? 0 : hour,
    minute: Number(map.minute ?? '0'),
    second: Number(map.second ?? '0'),
  };
}

/**
 * Project an instant into a `Date` whose LOCAL getters yield the wall-clock time
 * in `timeZone`. The returned value is NOT the same instant — it is a display
 * proxy meant only for the calendar's local-field layout math. Returns a plain
 * clone when `timeZone` is undefined.
 */
export function zonedTime(instant: Date, timeZone: string | undefined): Date {
  if (!timeZone) return new Date(instant.getTime());
  const p = zonedParts(instant, timeZone);
  return new Date(p.year, p.month - 1, p.day, p.hour, p.minute, p.second, instant.getMilliseconds());
}

/** Offset (minutes) of `timeZone` at `instant`: (zone wall-clock − UTC). */
export function timeZoneOffsetMinutes(instant: Date, timeZone: string): number {
  const p = zonedParts(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - instant.getTime()) / 60_000);
}

/* ── Locale labels ───────────────────────────────────────────────────────── */

const labelCache = new Map<string, string[]>();

/**
 * Weekday labels indexed 0=Sun..6=Sat for the given `locale` + `format`. Built
 * from a reference week (2023-01-01 is a Sunday) so the array is locale-correct
 * regardless of the runtime's own week start.
 */
export function weekdayLabels(
  locale: string | undefined,
  format: 'narrow' | 'short' | 'long' = 'short',
): string[] {
  const key = `wd:${locale ?? ''}:${format}`;
  let out = labelCache.get(key);
  if (!out) {
    const dtf = new Intl.DateTimeFormat(locale, { weekday: format, timeZone: 'UTC' });
    out = [];
    for (let i = 0; i < 7; i++) out.push(dtf.format(new Date(Date.UTC(2023, 0, 1 + i, 12))));
    labelCache.set(key, out);
  }
  return out;
}

/** Month labels indexed 0=Jan..11=Dec for the given `locale` + `format`. */
export function monthLabels(
  locale: string | undefined,
  format: 'narrow' | 'short' | 'long' = 'long',
): string[] {
  const key = `mo:${locale ?? ''}:${format}`;
  let out = labelCache.get(key);
  if (!out) {
    const dtf = new Intl.DateTimeFormat(locale, { month: format, timeZone: 'UTC' });
    out = [];
    for (let m = 0; m < 12; m++) out.push(dtf.format(new Date(Date.UTC(2021, m, 15, 12))));
    labelCache.set(key, out);
  }
  return out;
}

const clockFmtCache = new Map<string, Intl.DateTimeFormat>();

/**
 * Format a (already display-projected) `Date`'s wall-clock time as a locale
 * `HH:MM`. The date is read in its LOCAL fields, so callers that have already
 * projected through {@link zonedTime} get the correct zone reading; pass no
 * `timeZone` here.
 */
export function formatClock(date: Date, locale: string | undefined): string {
  const key = `ck:${locale ?? ''}`;
  let f = clockFmtCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' });
    clockFmtCache.set(key, f);
  }
  return f.format(date);
}
