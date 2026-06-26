/**
 * ics — a minimal RFC-5545 VEVENT writer for booked appointments, plus a browser
 * download helper. Mirrors the escaping/folding rules of `@jects/calendar`'s ICS
 * exporter but is self-contained (so the symbols are bundled into this package).
 */

const CRLF = '\r\n';

/** A single booked appointment to serialise. */
export interface IcsEvent {
  /** Stable UID. */
  uid: string;
  /** Start instant. */
  start: Date;
  /** End instant. */
  end: Date;
  /** Title / summary. */
  summary: string;
  /** Optional description, location. */
  description?: string;
  location?: string;
  /** Optional organizer/attendee email. */
  email?: string;
}

/** Options for the VCALENDAR wrapper. */
export interface IcsOptions {
  /** `PRODID`. Default `-//Jects UI//Booking//EN`. */
  prodId?: string;
  /** `DTSTAMP` epoch ms. Default `Date.now()`. */
  now?: number;
}

/** Escape text for an ICS value (RFC-5545 §3.3.11). */
export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/** Format a Date as a UTC `YYYYMMDDTHHMMSSZ` stamp. */
export function formatIcsUtc(d: Date): string {
  const p = (n: number, w = 2): string => String(n).padStart(w, '0');
  return (
    `${p(d.getUTCFullYear(), 4)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`
  );
}

/** Fold a content line to ≤75 octets (RFC-5545 §3.1) with leading-space continuation. */
export function foldLine(line: string): string {
  if (line.length <= 75) return line;
  const chunks: string[] = [];
  let rest = line;
  chunks.push(rest.slice(0, 75));
  rest = rest.slice(75);
  while (rest.length > 74) {
    chunks.push(' ' + rest.slice(0, 74));
    rest = rest.slice(74);
  }
  if (rest.length) chunks.push(' ' + rest);
  return chunks.join(CRLF);
}

/** Build the VEVENT lines for one appointment. */
export function eventToVEvent(ev: IcsEvent, now: number): string[] {
  const lines: string[] = ['BEGIN:VEVENT'];
  lines.push(`UID:${escapeIcsText(ev.uid)}`);
  lines.push(`DTSTAMP:${formatIcsUtc(new Date(now))}`);
  lines.push(`DTSTART:${formatIcsUtc(ev.start)}`);
  lines.push(`DTEND:${formatIcsUtc(ev.end)}`);
  lines.push(`SUMMARY:${escapeIcsText(ev.summary)}`);
  if (ev.description) lines.push(`DESCRIPTION:${escapeIcsText(ev.description)}`);
  if (ev.location) lines.push(`LOCATION:${escapeIcsText(ev.location)}`);
  if (ev.email) lines.push(`ORGANIZER:mailto:${escapeIcsText(ev.email)}`);
  lines.push('END:VEVENT');
  return lines;
}

/** Serialise one or more appointments into a complete VCALENDAR string. */
export function bookingToIcs(events: IcsEvent | IcsEvent[], options: IcsOptions = {}): string {
  const list = Array.isArray(events) ? events : [events];
  const now = options.now ?? Date.now();
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${escapeIcsText(options.prodId ?? '-//Jects UI//Booking//EN')}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];
  for (const ev of list) for (const l of eventToVEvent(ev, now)) lines.push(l);
  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join(CRLF) + CRLF;
}

/** Trigger a browser download of `content` as `fileName` (no-op when no DOM). */
export function downloadIcs(content: string, fileName = 'appointment.ics'): void {
  if (typeof document === 'undefined' || typeof URL === 'undefined' || !URL.createObjectURL) return;
  const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
