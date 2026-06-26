/**
 * @jects/calendar — export surfaces: ICS (iCalendar / RFC-5545), CSV/Excel, and
 * print.
 *
 * The string builders (`toIcs`, `toCsv`) are pure and unit-testable in jsdom; the
 * browser side effects (file download / print window) are isolated in the small
 * helpers at the bottom and no-op when there is no `document`. This mirrors the
 * Bryntum/DHTMLX "Export / Print" parity surface: every event becomes one VEVENT
 * (with `RRULE` when the event recurs) / one CSV row.
 *
 * The ICS writer is a minimal port of `@jects/scheduler`'s `export/ics.ts`,
 * adapted to the calendar's native-`Date` event model (the scheduler stores
 * epoch-ms). We do NOT depend on the scheduler package.
 */

import type { CalendarEvent } from './contract.js';
import { toRRule } from './recurrence.js';

const CRLF = '\r\n';

/** Options controlling ICS serialization. */
export interface IcsExportOptions {
  /** `PRODID` written into the VCALENDAR header. Default `-//Jects UI//Calendar//EN`. */
  prodId?: string;
  /** `X-WR-CALNAME` calendar display name. Optional. */
  calendarName?: string;
  /** `DTSTAMP` epoch ms (creation time). Default `Date.now()` captured once. */
  now?: number;
}

/** Escape a TEXT value per RFC-5545 §3.3.11. */
export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/** Fold a content line to ≤75 octets per RFC-5545 §3.1 (continuations start with a space). */
export function foldLine(line: string): string {
  if (line.length <= 75) return line;
  const parts: string[] = [line.slice(0, 75)];
  let rest = line.slice(75);
  while (rest.length > 0) {
    parts.push(' ' + rest.slice(0, 74));
    rest = rest.slice(74);
  }
  return parts.join(CRLF);
}

/** Format a Date as a UTC basic-format iCalendar timestamp (`YYYYMMDDTHHMMSSZ`). */
export function formatIcsUtc(d: Date): string {
  const p2 = (n: number): string => String(n).padStart(2, '0');
  return (
    String(d.getUTCFullYear()).padStart(4, '0') +
    p2(d.getUTCMonth() + 1) +
    p2(d.getUTCDate()) +
    'T' +
    p2(d.getUTCHours()) +
    p2(d.getUTCMinutes()) +
    p2(d.getUTCSeconds()) +
    'Z'
  );
}

/** Format a Date as a date-only iCalendar value (`YYYYMMDD`) for all-day events. */
export function formatIcsDate(d: Date): string {
  const p2 = (n: number): string => String(n).padStart(2, '0');
  return String(d.getFullYear()).padStart(4, '0') + p2(d.getMonth() + 1) + p2(d.getDate());
}

function uidOf(ev: CalendarEvent): string {
  const id = String(ev.id);
  return id.includes('@') ? id : `${id}@jects`;
}

/** Serialize one event to its (unfolded) VEVENT lines. */
export function eventToVEvent(ev: CalendarEvent, now: number): string[] {
  const lines: string[] = ['BEGIN:VEVENT'];
  lines.push(`UID:${escapeIcsText(uidOf(ev))}`);
  lines.push(`DTSTAMP:${formatIcsUtc(new Date(now))}`);
  if (ev.allDay) {
    lines.push(`DTSTART;VALUE=DATE:${formatIcsDate(ev.start)}`);
    lines.push(`DTEND;VALUE=DATE:${formatIcsDate(ev.end)}`);
  } else {
    lines.push(`DTSTART:${formatIcsUtc(ev.start)}`);
    lines.push(`DTEND:${formatIcsUtc(ev.end)}`);
  }
  lines.push(`SUMMARY:${escapeIcsText(ev.title)}`);
  if (ev.description) lines.push(`DESCRIPTION:${escapeIcsText(ev.description)}`);
  if (ev.location) lines.push(`LOCATION:${escapeIcsText(ev.location)}`);
  if (ev.recurrence) lines.push(`RRULE:${toRRule(ev.recurrence)}`);
  if (ev.recurrence?.exDates?.length) {
    for (const ex of ev.recurrence.exDates) {
      lines.push(ev.allDay ? `EXDATE;VALUE=DATE:${formatIcsDate(ex)}` : `EXDATE:${formatIcsUtc(ex)}`);
    }
  }
  if (ev.categoryId) lines.push(`CATEGORIES:${escapeIcsText(ev.categoryId)}`);
  if (ev.resourceId != null) lines.push(`X-JECTS-RESOURCE:${escapeIcsText(String(ev.resourceId))}`);
  lines.push('END:VEVENT');
  return lines;
}

/**
 * Serialize events to a complete, RFC-5545-compliant ICS document string
 * (CRLF line endings, folded lines, one VEVENT per event including `RRULE`).
 */
export function toIcs(events: readonly CalendarEvent[], options: IcsExportOptions = {}): string {
  const now = options.now ?? Date.now();
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${escapeIcsText(options.prodId ?? '-//Jects UI//Calendar//EN')}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];
  if (options.calendarName) lines.push(`X-WR-CALNAME:${escapeIcsText(options.calendarName)}`);
  for (const ev of events) for (const l of eventToVEvent(ev, now)) lines.push(l);
  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join(CRLF) + CRLF;
}

/* ── CSV / "Excel" ─────────────────────────────────────────────────────────── */

const CSV_COLUMNS = [
  'id', 'title', 'start', 'end', 'allDay', 'location', 'description', 'categoryId', 'resourceId', 'rrule',
] as const;

/** Quote a CSV cell per RFC-4180 (double the quotes, wrap when needed). */
function csvCell(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

/**
 * Serialize events to a CSV document (the spreadsheet/"Excel" export). One header
 * row + one row per event; recurrence is flattened to its RRULE string.
 */
export function toCsv(events: readonly CalendarEvent[]): string {
  const rows: string[] = [CSV_COLUMNS.join(',')];
  for (const ev of events) {
    const cells: string[] = [
      String(ev.id),
      ev.title,
      ev.start.toISOString(),
      ev.end.toISOString(),
      ev.allDay ? 'true' : 'false',
      ev.location ?? '',
      ev.description ?? '',
      ev.categoryId ?? '',
      ev.resourceId != null ? String(ev.resourceId) : '',
      ev.recurrence ? toRRule(ev.recurrence) : '',
    ];
    rows.push(cells.map(csvCell).join(','));
  }
  return rows.join(CRLF) + CRLF;
}

/* ── Browser side effects (no-op without a DOM) ────────────────────────────── */

/** Trigger a file download of `content` with the given MIME type. */
export function downloadFile(content: string, fileName: string, mime: string): void {
  if (typeof document === 'undefined') return;
  // jsdom (and some non-browser hosts) lack Blob URL support — no-op there so the
  // pure string return value of the export methods is still usable in tests.
  if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return;
  const blob = new Blob([content], { type: `${mime};charset=utf-8;` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * Open a print-friendly window for the calendar's current view DOM and invoke
 * the browser print dialog. No-op outside a browser. Returns the opened window
 * (or null) so callers/tests can inspect/close it.
 */
export function printElement(source: HTMLElement, title = 'Calendar'): Window | null {
  if (typeof window === 'undefined' || typeof document === 'undefined') return null;
  const win = window.open('', '_blank', 'width=900,height=700');
  if (!win) return null;
  const styleHref = [...document.styleSheets]
    .map((s) => s.href)
    .filter((h): h is string => !!h)
    .map((h) => `<link rel="stylesheet" href="${h}">`)
    .join('');
  win.document.write(
    `<!doctype html><html><head><title>${title}</title>${styleHref}` +
      `<style>body{margin:16px;font-family:sans-serif;}</style></head>` +
      `<body>${source.outerHTML}</body></html>`,
  );
  win.document.close();
  win.focus();
  win.print();
  return win;
}
