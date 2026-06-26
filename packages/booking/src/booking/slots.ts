/**
 * Pure slot-math helpers for the appointment booking widget. Dependency-free and
 * timezone-naive (operates on local-time minute-of-day integers). Not exported
 * from the package barrel — these are private to the booking component but are
 * unit-tested directly.
 */

/** A half-open time-of-day window expressed as `HH:MM` 24h strings. */
export interface WorkingHours {
  /** Inclusive start, e.g. `'09:00'`. */
  start: string;
  /** Exclusive end, e.g. `'17:00'`. */
  end: string;
}

/** An existing booking that blocks one or more generated slots. */
export interface ExistingBooking {
  /** `YYYY-MM-DD` local day the booking falls on. */
  date: string;
  /** `HH:MM` 24h start time of the booking. */
  time: string;
  /** Optional duration in minutes; defaults to the configured slot duration. */
  duration?: number;
  /** Optional resource/service id this booking occupies (for multi-resource). */
  resourceId?: string;
}

/** A generated slot for a given day. */
export interface Slot {
  /** Minute-of-day the slot starts (0..1439). */
  startMinutes: number;
  /** Minute-of-day the slot ends (exclusive). */
  endMinutes: number;
  /** `HH:MM` 24h label of the start. */
  time: string;
  /** Whether the slot is at/over capacity (or is in the past). */
  booked: boolean;
  /** Whether the slot is selectable (capacity left, not past/too soon/too far). */
  available: boolean;
  /** True when the slot is wholly before "now" on today's date. */
  past: boolean;
  /** True when the slot starts within the minimum-advance-notice window. */
  tooSoon?: boolean;
  /** True when the slot's day is beyond the maximum booking horizon. */
  tooFar?: boolean;
  /** Total seats for the slot (only set when capacity is configured). */
  seatsTotal?: number;
  /** Seats already taken by existing bookings. */
  seatsBooked?: number;
  /** Seats remaining (only set when capacity is configured). */
  seatsRemaining?: number;
}

/** Parse `HH:MM` (24h) to minute-of-day, or `null` when malformed. */
export function parseHM(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** Format a minute-of-day as `HH:MM` (24h). */
export function formatHM(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Format a minute-of-day as `h:MM AM/PM` (12h). */
export function formatHM12(minutes: number): string {
  const h24 = Math.floor(minutes / 60);
  const m = minutes % 60;
  const period = h24 < 12 ? 'AM' : 'PM';
  let h = h24 % 12;
  if (h === 0) h = 12;
  return `${h}:${String(m).padStart(2, '0')} ${period}`;
}

/** Two half-open ranges [aStart,aEnd) and [bStart,bEnd) overlap? */
function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/** A half-open time-of-day window expressed as minute-of-day pairs. */
interface MinuteRange {
  start: number;
  end: number;
}

/** Options controlling slot generation for one day. */
export interface GenerateSlotsOptions {
  /** `YYYY-MM-DD` day to generate slots for. */
  date: string;
  /** Working-hours window. Ignored when `ranges` is supplied. */
  hours: WorkingHours;
  /**
   * Multiple availability windows (`HH:MM` ranges) for the day. When present,
   * these REPLACE `hours` — letting the availability-rules engine drive split
   * shifts, date overrides and per-resource hours. Empty array ⇒ no slots.
   */
  ranges?: WorkingHours[];
  /** Slot length in minutes. */
  slotDuration: number;
  /** Gap (minutes) inserted between consecutive slots. Default 0. */
  slotGap?: number;
  /** Existing bookings (any day; filtered to `date` internally). */
  bookings?: ExistingBooking[];
  /** Resource id to scope availability to (multi-resource). */
  resourceId?: string;
  /** "Now" reference for past-slot marking. Defaults to `new Date()`. */
  now?: Date;
  /** Padding (minutes) reserved BEFORE each existing booking. Default 0. */
  bufferBefore?: number;
  /** Padding (minutes) reserved AFTER each existing booking. Default 0. */
  bufferAfter?: number;
  /** Minimum advance notice (minutes from `now`) a slot must start after. */
  minNotice?: number;
  /**
   * Maximum booking horizon in days from `now` (inclusive). Slots on days beyond
   * this are marked `tooFar`/unavailable.
   */
  maxHorizonDays?: number;
  /** Seats per slot (group/class bookings). Default 1. */
  capacity?: number;
}

/**
 * Generate the ordered list of slots for a day. Slots that overlap an existing
 * booking (for the same resource, when scoped) — or that lie wholly in the past
 * relative to `now` on the same calendar day — are marked unavailable.
 */
export function generateSlots(opts: GenerateSlotsOptions): Slot[] {
  const { date, slotDuration } = opts;
  const gap = Math.max(0, opts.slotGap ?? 0);
  if (slotDuration <= 0) return [];

  // Resolve the day's availability windows. `ranges` (from the rules engine)
  // wins; otherwise fall back to the single `hours` window (legacy path).
  const windows: MinuteRange[] = [];
  if (opts.ranges) {
    for (const r of opts.ranges) {
      const s = parseHM(r.start);
      const e = parseHM(r.end);
      if (s != null && e != null && e > s) windows.push({ start: s, end: e });
    }
  } else {
    const s = parseHM(opts.hours.start);
    const e = parseHM(opts.hours.end);
    if (s != null && e != null && e > s) windows.push({ start: s, end: e });
  }
  if (windows.length === 0) return [];
  windows.sort((a, b) => a.start - b.start);

  const capacity = Math.max(1, Math.floor(opts.capacity ?? 1));
  const capacityConfigured = opts.capacity != null;
  const bufBefore = Math.max(0, opts.bufferBefore ?? 0);
  const bufAfter = Math.max(0, opts.bufferAfter ?? 0);

  // Existing bookings on this day for the relevant resource, expanded by buffers.
  const dayBookings = (opts.bookings ?? []).filter(
    (b) =>
      b.date === date &&
      (opts.resourceId == null || b.resourceId == null || b.resourceId === opts.resourceId),
  );
  const blocked = dayBookings
    .map((b) => {
      const s = parseHM(b.time);
      if (s == null) return null;
      const dur = b.duration && b.duration > 0 ? b.duration : slotDuration;
      return [s - bufBefore, s + dur + bufAfter] as const;
    })
    .filter((r): r is readonly [number, number] => r != null);

  // Past cutoff: minute-of-day if `now` is on `date`, else -Infinity (none past).
  const now = opts.now ?? new Date();
  const nowISO = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate(),
  ).padStart(2, '0')}`;
  const sameDay = nowISO === date;
  const nowMinutes = sameDay ? now.getHours() * 60 + now.getMinutes() : -Infinity;

  // Minimum-notice cutoff as a minute-of-day on THIS day. A slot at minute `s`
  // is too soon when (daysAhead*1440 + s) − nowAbsolute < minNotice, i.e.
  // s < minNotice + nowMinutes − daysAhead*1440. Past days ⇒ +Infinity (all too
  // soon); far-future days drive the cutoff negative ⇒ none too soon.
  let noticeCutoff = -Infinity;
  if (opts.minNotice != null && opts.minNotice > 0) {
    if (date < nowISO) noticeCutoff = Infinity;
    else noticeCutoff = opts.minNotice + nowMinutesFor(now) - daysBetween(nowISO, date) * 1440;
  }

  // Maximum-horizon: whole-day flag.
  let tooFarDay = false;
  if (opts.maxHorizonDays != null && opts.maxHorizonDays >= 0) {
    tooFarDay = daysBetween(nowISO, date) > opts.maxHorizonDays;
  }

  const slots: Slot[] = [];
  for (const w of windows) {
    for (let s = w.start; s + slotDuration <= w.end; s += slotDuration + gap) {
      const e = s + slotDuration;
      const seatsBooked = blocked.reduce((n, [bs, be]) => (overlaps(s, e, bs, be) ? n + 1 : n), 0);
      const full = seatsBooked >= capacity;
      const past = e <= nowMinutes;
      const tooSoon = s < noticeCutoff;
      const booked = full;
      const slot: Slot = {
        startMinutes: s,
        endMinutes: e,
        time: formatHM(s),
        booked,
        past,
        available: !booked && !past && !tooSoon && !tooFarDay,
      };
      if (tooSoon) slot.tooSoon = true;
      if (tooFarDay) slot.tooFar = true;
      if (capacityConfigured) {
        slot.seatsTotal = capacity;
        slot.seatsBooked = seatsBooked;
        slot.seatsRemaining = Math.max(0, capacity - seatsBooked);
      }
      slots.push(slot);
    }
  }
  return slots;
}

/** Minute-of-day for a Date. */
function nowMinutesFor(now: Date): number {
  return now.getHours() * 60 + now.getMinutes();
}

/** Whole-day difference `to - from` for `YYYY-MM-DD` strings (timezone-naive). */
function daysBetween(from: string, to: string): number {
  const fa = /^(\d{4})-(\d{2})-(\d{2})$/.exec(from);
  const ta = /^(\d{4})-(\d{2})-(\d{2})$/.exec(to);
  if (!fa || !ta) return 0;
  const f = Date.UTC(Number(fa[1]), Number(fa[2]) - 1, Number(fa[3]));
  const t = Date.UTC(Number(ta[1]), Number(ta[2]) - 1, Number(ta[3]));
  return Math.round((t - f) / 86_400_000);
}
