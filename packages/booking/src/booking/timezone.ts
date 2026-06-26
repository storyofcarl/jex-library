/**
 * timezone — DST-correct IANA timezone math using only `Intl` (no external libs),
 * mirroring the approach in `@jects/calendar`'s `tz.ts`. Slots are stored as UTC
 * instants and rendered in a chosen display zone.
 *
 * The linchpin is `timeZoneOffsetMinutes`: decompose a UTC instant into the
 * wall-clock fields of a zone via `Intl.DateTimeFormat.formatToParts`, reconstruct
 * those fields as if they were UTC, and the difference is the zone's offset at
 * that instant (DST included). The inverse (`wallTimeToInstant`) converges in two
 * passes, which is exact across DST transitions.
 */

/** Decomposed wall-clock fields in some target zone. */
export interface ZonedParts {
  year: number;
  month: number; // 1..12
  day: number; // 1..31
  hour: number; // 0..23
  minute: number;
  second: number;
}

const _partsFmtCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let fmt = _partsFmtCache.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    _partsFmtCache.set(timeZone, fmt);
  }
  return fmt;
}

/** Decompose an instant into the wall-clock fields of `timeZone`. */
export function zonedParts(instant: Date, timeZone: string): ZonedParts {
  const map: Record<string, string> = {};
  for (const p of partsFormatter(timeZone).formatToParts(instant)) {
    if (p.type !== 'literal') map[p.type] = p.value;
  }
  const hour = Number(map.hour ?? '0');
  return {
    year: Number(map.year ?? '1970'),
    month: Number(map.month ?? '1'),
    day: Number(map.day ?? '1'),
    hour: hour === 24 ? 0 : hour, // some engines emit '24' at midnight
    minute: Number(map.minute ?? '0'),
    second: Number(map.second ?? '0'),
  };
}

/** Offset (minutes) of `timeZone` at `instant`: (zone wall-clock − UTC). */
export function timeZoneOffsetMinutes(instant: Date, timeZone: string): number {
  const p = zonedParts(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - instant.getTime()) / 60_000);
}

/**
 * Convert wall-clock fields in `timeZone` into the UTC instant they denote.
 * Two-pass fixed point: the offset that applies at the *result* instant is the
 * correct one, which a second pass pins down across spring-forward/fall-back.
 */
export function wallTimeToInstant(
  year: number,
  month: number, // 1..12
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
  second = 0,
): Date {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second);
  let offset = timeZoneOffsetMinutes(new Date(utcGuess), timeZone);
  let instant = utcGuess - offset * 60_000;
  // Re-evaluate the offset at the candidate instant; correct once if it shifted.
  const offset2 = timeZoneOffsetMinutes(new Date(instant), timeZone);
  if (offset2 !== offset) {
    offset = offset2;
    instant = utcGuess - offset * 60_000;
  }
  return new Date(instant);
}

/** Parse `HH:MM` to `[hour, minute]`, defaulting to midnight on malformed input. */
function splitHM(time: string): [number, number] {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!m) return [0, 0];
  return [Number(m[1]), Number(m[2])];
}

/**
 * The UTC instant for a wall-clock `YYYY-MM-DD` + `HH:MM` *in* `timeZone`.
 * Used to anchor a generated slot as a real instant for storage/ICS/reminders.
 */
export function slotInstant(date: string, time: string, timeZone: string): Date {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  if (!dm) return new Date(NaN);
  const [h, min] = splitHM(time);
  return wallTimeToInstant(Number(dm[1]), Number(dm[2]), Number(dm[3]), h, min, timeZone);
}

/** Render an instant's `YYYY-MM-DD` + `HH:MM` (24h) wall clock in `timeZone`. */
export function instantToZoned(instant: Date, timeZone: string): { date: string; time: string } {
  const p = zonedParts(instant, timeZone);
  const date = `${String(p.year).padStart(4, '0')}-${String(p.month).padStart(2, '0')}-${String(
    p.day,
  ).padStart(2, '0')}`;
  const time = `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
  return { date, time };
}

/** The host's resolved IANA zone (e.g. `'America/New_York'`), or `'UTC'`. */
export function localTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** Short GMT-offset label for a zone at an instant, e.g. `'GMT-4'` / `'GMT+5:30'`. */
export function offsetLabel(timeZone: string, instant: Date = new Date()): string {
  const mins = timeZoneOffsetMinutes(instant, timeZone);
  const sign = mins < 0 ? '-' : '+';
  const abs = Math.abs(mins);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `GMT${sign}${h}${m ? `:${String(m).padStart(2, '0')}` : ''}`;
}

/**
 * A small curated list of common IANA zones for a selector. The runtime list
 * (`Intl.supportedValuesOf('timeZone')`) is huge; this keeps the UI usable while
 * always including the host's own zone first.
 */
export function commonTimeZones(): string[] {
  const curated = [
    'UTC',
    'America/Los_Angeles',
    'America/Denver',
    'America/Chicago',
    'America/New_York',
    'America/Sao_Paulo',
    'Europe/London',
    'Europe/Paris',
    'Europe/Berlin',
    'Europe/Moscow',
    'Africa/Johannesburg',
    'Asia/Dubai',
    'Asia/Kolkata',
    'Asia/Shanghai',
    'Asia/Tokyo',
    'Australia/Sydney',
    'Pacific/Auckland',
  ];
  const local = localTimeZone();
  const seen = new Set<string>();
  const out: string[] = [];
  for (const z of [local, ...curated]) {
    if (!seen.has(z)) {
      seen.add(z);
      out.push(z);
    }
  }
  return out;
}
