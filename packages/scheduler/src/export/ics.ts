/**
 * ICS (iCalendar / RFC-5545) export + import for @jects/scheduler.
 *
 * Serializes scheduler {@link EventModel} records to a `.ics` (VCALENDAR /
 * VEVENT) document — including the recurrence `RRULE` carried on
 * `event.recurrenceRule` — and parses a `.ics` document back into event
 * records that can be added to the scheduler's event store.
 *
 * This is the Bryntum/DHTMLX "Export / import: ICS" parity feature. It matches
 * the behaviour those products expose: each scheduler event maps to one VEVENT
 * with `UID`, `DTSTART`/`DTEND`, `SUMMARY`, and (when present) `RRULE`; a
 * resource lane is preserved via a non-standard `X-JECTS-RESOURCE` property so a
 * round-trip keeps the event on its lane. Times are emitted as UTC
 * (`...Z`) basic-format timestamps, matching timeline-core's epoch-ms / UTC
 * convention.
 *
 * The string builders (`toIcs`, `eventToVEvent`) and the parser (`parseIcs`)
 * are pure and unit-testable in jsdom; the browser side effects (file download /
 * file-input import) live in {@link IcsExporter} / {@link IcsImporter} and the
 * convenience `downloadIcs` helper.
 *
 * No DOM is built here and nothing is registered with the factory — this is a
 * data module. It hooks into the scheduler via the small `IcsExporter` /
 * `IcsImporter` classes that take an {@link EventStore} (see wireNotes).
 */

import type { RecordId } from '@jects/core';
import type { EventModel } from '../contract.js';
import { normalizeEvent, type EventStore } from '../stores/stores.js';

/* ═══════════════════════════════════════════════════════════════════════════
   Public options / result types
   ═══════════════════════════════════════════════════════════════════════════ */

/** Options controlling ICS serialization. */
export interface IcsExportOptions {
  /**
   * `PRODID` written into the VCALENDAR header. Default
   * `-//Jects UI//Scheduler//EN`.
   */
  prodId?: string;
  /** `X-WR-CALNAME` calendar display name written into the header. Optional. */
  calendarName?: string;
  /**
   * Resolve a stable per-event `UID`. Default: the event id, suffixed with
   * `@jects` when it has no `@`. UIDs must be globally unique per RFC-5545.
   */
  uid?: (event: EventModel) => string;
  /**
   * Resolve the `SUMMARY` (title) line. Default: `event.name` or
   * `Event {id}`.
   */
  summary?: (event: EventModel) => string;
  /**
   * Timestamp (epoch ms) written as the calendar's `DTSTAMP` / each VEVENT's
   * `DTSTAMP` (creation time). Default: `Date.now()` captured once per export.
   */
  now?: number;
  /**
   * Preserve the resource lane via the `X-JECTS-RESOURCE` property so an import
   * round-trips onto the same lane. Default `true`.
   */
  includeResource?: boolean;
  /** File name (without extension) used by the download helper. Default `'schedule'`. */
  fileName?: string;
}

/** Options controlling ICS parsing/import. */
export interface IcsImportOptions {
  /**
   * Resource lane assigned to imported events that carry no `X-JECTS-RESOURCE`
   * property. Default `''` (caller should re-home these). Ignored when the
   * VEVENT already names a resource.
   */
  defaultResourceId?: RecordId;
  /**
   * Generate an id for an imported event. Default: the VEVENT `UID` (with a
   * trailing `@…` host stripped), falling back to a synthetic `ics-{n}` id.
   */
  idFromUid?: (uid: string, index: number) => RecordId;
  /**
   * When importing into a store, skip events whose generated id already exists
   * (instead of letting the store throw / overwrite). Default `true`.
   */
  skipExisting?: boolean;
}

/** One parsed VEVENT, normalized into an {@link EventModel}. */
export interface ParsedIcsEvent {
  event: EventModel;
  /** The raw VEVENT `UID`, if any. */
  uid?: string;
}

/** Result of parsing a full ICS document. */
export interface ParsedIcs {
  /** The calendar `X-WR-CALNAME`, if present. */
  calendarName?: string;
  /** The parsed VEVENTs. */
  events: ParsedIcsEvent[];
}

/* ═══════════════════════════════════════════════════════════════════════════
   Low-level helpers (line folding / escaping / time formatting)
   ═══════════════════════════════════════════════════════════════════════════ */

const CRLF = '\r\n';

/**
 * Escape a TEXT value per RFC-5545 §3.3.11: backslash, semicolon, comma, and
 * newlines are escaped. (Colons are NOT escaped in property values.)
 */
export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/** Reverse of {@link escapeIcsText}. */
export function unescapeIcsText(value: string): string {
  let out = '';
  for (let i = 0; i < value.length; i++) {
    const ch = value[i]!;
    if (ch === '\\' && i + 1 < value.length) {
      const next = value[++i]!;
      out += next === 'n' || next === 'N' ? '\n' : next;
    } else {
      out += ch;
    }
  }
  return out;
}

/**
 * Fold a content line to ≤75 octets per RFC-5545 §3.1: continuation lines start
 * with a single space. We fold on a conservative character count (ASCII-heavy
 * scheduler data), which is correct for the common case and never produces an
 * invalid line.
 */
export function foldLine(line: string): string {
  if (line.length <= 75) return line;
  const parts: string[] = [];
  let rest = line;
  // First chunk: 75 chars. Continuations: a leading space + 74 chars.
  parts.push(rest.slice(0, 75));
  rest = rest.slice(75);
  while (rest.length > 0) {
    parts.push(' ' + rest.slice(0, 74));
    rest = rest.slice(74);
  }
  return parts.join(CRLF);
}

/** Format an epoch-ms time as a UTC basic-format iCalendar timestamp. */
export function formatIcsUtc(time: number): string {
  const d = new Date(time);
  const p2 = (n: number) => String(n).padStart(2, '0');
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

/**
 * Parse an iCalendar date-time value to epoch ms. Handles UTC (`...Z`), basic
 * date-only (`YYYYMMDD`), local date-time without zone (treated as UTC, matching
 * timeline-core), and ISO-8601 fallbacks.
 */
export function parseIcsDate(raw: string): number | null {
  const value = raw.trim();
  // YYYYMMDD[THHMMSS[Z]]
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2}))?(Z)?$/.exec(value);
  if (m) {
    const [, y, mo, d, hh, mm, ss] = m;
    return Date.UTC(
      Number(y),
      Number(mo) - 1,
      Number(d),
      hh ? Number(hh) : 0,
      mm ? Number(mm) : 0,
      ss ? Number(ss) : 0,
    );
  }
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : t;
}

/* ═══════════════════════════════════════════════════════════════════════════
   Serialization (events → ICS)
   ═══════════════════════════════════════════════════════════════════════════ */

interface ResolvedExport {
  prodId: string;
  calendarName?: string;
  uid: (e: EventModel) => string;
  summary: (e: EventModel) => string;
  now: number;
  includeResource: boolean;
  fileName: string;
}

function resolveExport(options: IcsExportOptions = {}): ResolvedExport {
  return {
    prodId: options.prodId ?? '-//Jects UI//Scheduler//EN',
    ...(options.calendarName != null ? { calendarName: options.calendarName } : {}),
    uid:
      options.uid ??
      ((e) => {
        const id = String(e.id);
        return id.includes('@') ? id : `${id}@jects`;
      }),
    summary: options.summary ?? ((e) => e.name ?? `Event ${String(e.id)}`),
    now: options.now ?? Date.now(),
    includeResource: options.includeResource ?? true,
    fileName: options.fileName ?? 'schedule',
  };
}

/**
 * Normalize an `RRULE` carried on an event into a single `RRULE:...` content
 * line. Accepts a bare rule body (`FREQ=DAILY;INTERVAL=2`) or a prefixed one
 * (`RRULE:FREQ=...`); returns the canonical `RRULE:`-prefixed, upper-cased form,
 * or `null` when there is no rule.
 */
export function normalizeRRuleLine(rule: string | undefined): string | null {
  if (!rule) return null;
  const body = rule.replace(/^RRULE:/i, '').trim();
  if (!body) return null;
  return `RRULE:${body}`;
}

/**
 * Serialize one event to its VEVENT lines (unfolded). Exported for testing /
 * composition; {@link toIcs} folds + joins these into the document.
 */
export function eventToVEvent(event: EventModel, options: IcsExportOptions = {}): string[] {
  const r = resolveExport(options);
  const lines: string[] = ['BEGIN:VEVENT'];
  lines.push(`UID:${escapeIcsText(r.uid(event))}`);
  lines.push(`DTSTAMP:${formatIcsUtc(r.now)}`);
  lines.push(`DTSTART:${formatIcsUtc(Number(event.startDate))}`);
  lines.push(`DTEND:${formatIcsUtc(Number(event.endDate))}`);
  lines.push(`SUMMARY:${escapeIcsText(r.summary(event))}`);
  if (event.percentDone != null) {
    // RFC-5545 PERCENT-COMPLETE is 0..100 integer.
    const pct = Math.round(Math.max(0, Math.min(1, Number(event.percentDone))) * 100);
    lines.push(`PERCENT-COMPLETE:${pct}`);
  }
  const rrule = normalizeRRuleLine(event.recurrenceRule);
  if (rrule) lines.push(rrule);
  if (r.includeResource && event.resourceId != null) {
    lines.push(`X-JECTS-RESOURCE:${escapeIcsText(String(event.resourceId))}`);
  }
  if (event.eventColor != null) {
    lines.push(`X-JECTS-COLOR:${escapeIcsText(String(event.eventColor))}`);
  }
  lines.push('END:VEVENT');
  return lines;
}

/**
 * Serialize a list of events to a complete, RFC-5545-compliant ICS document
 * string (CRLF line endings, folded lines).
 */
export function toIcs(events: readonly EventModel[], options: IcsExportOptions = {}): string {
  const r = resolveExport(options);
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${escapeIcsText(r.prodId)}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];
  if (r.calendarName) lines.push(`X-WR-CALNAME:${escapeIcsText(r.calendarName)}`);
  for (const event of events) {
    for (const l of eventToVEvent(event, options)) lines.push(l);
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join(CRLF) + CRLF;
}

/* ═══════════════════════════════════════════════════════════════════════════
   Parsing (ICS → events)
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Unfold an ICS document into logical content lines (RFC-5545 §3.1: a line
 * beginning with a space or tab is a continuation of the previous line).
 */
export function unfoldLines(text: string): string[] {
  const physical = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const logical: string[] = [];
  for (const line of physical) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && logical.length > 0) {
      logical[logical.length - 1] += line.slice(1);
    } else {
      logical.push(line);
    }
  }
  return logical.filter((l) => l.length > 0);
}

/** Split a content line into `{ name, params, value }` (params after `;`). */
interface ContentLine {
  name: string;
  params: Map<string, string>;
  value: string;
}

function splitContentLine(line: string): ContentLine | null {
  const colon = line.indexOf(':');
  if (colon === -1) return null;
  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const segs = head.split(';');
  const name = segs[0]!.trim().toUpperCase();
  const params = new Map<string, string>();
  for (let i = 1; i < segs.length; i++) {
    const eq = segs[i]!.indexOf('=');
    if (eq !== -1) {
      params.set(segs[i]!.slice(0, eq).trim().toUpperCase(), segs[i]!.slice(eq + 1).trim());
    }
  }
  return { name, params, value };
}

function defaultIdFromUid(uid: string, index: number): RecordId {
  const stripped = uid.includes('@') ? uid.slice(0, uid.indexOf('@')) : uid;
  return stripped.length > 0 ? stripped : `ics-${index}`;
}

/**
 * Parse a full ICS document into a {@link ParsedIcs} (calendar name + events).
 * Malformed VEVENTs (missing a usable DTSTART) are skipped rather than throwing,
 * so a partially-valid file still imports what it can.
 */
export function parseIcs(text: string, options: IcsImportOptions = {}): ParsedIcs {
  const idFromUid = options.idFromUid ?? defaultIdFromUid;
  const defaultResourceId = options.defaultResourceId ?? '';
  const lines = unfoldLines(text);

  let calendarName: string | undefined;
  const events: ParsedIcsEvent[] = [];

  let inEvent = false;
  let cur: {
    uid?: string;
    summary?: string;
    start?: number;
    end?: number;
    duration?: number;
    rrule?: string;
    resourceId?: string;
    color?: string;
    percent?: number;
  } = {};
  let index = 0;

  for (const raw of lines) {
    const cl = splitContentLine(raw);
    if (!cl) continue;
    const { name, value } = cl;

    if (name === 'BEGIN' && value.toUpperCase() === 'VEVENT') {
      inEvent = true;
      cur = {};
      continue;
    }
    if (name === 'END' && value.toUpperCase() === 'VEVENT') {
      inEvent = false;
      if (cur.start != null) {
        const id = idFromUid(cur.uid ?? '', index++);
        const base: Partial<EventModel> = {
          id,
          resourceId: cur.resourceId != null ? cur.resourceId : defaultResourceId,
          name: cur.summary ?? '',
          startDate: cur.start,
        };
        if (cur.end != null) base.endDate = cur.end;
        else if (cur.duration != null) base.duration = cur.duration;
        else base.endDate = cur.start; // normalizeEvent clamps to +1ms
        if (cur.rrule) base.recurrenceRule = cur.rrule;
        if (cur.color != null) base.eventColor = cur.color;
        if (cur.percent != null) base.percentDone = cur.percent;
        const parsed: ParsedIcsEvent = { event: normalizeEvent(base) };
        if (cur.uid != null) parsed.uid = cur.uid;
        events.push(parsed);
      }
      continue;
    }

    if (!inEvent) {
      if (name === 'X-WR-CALNAME') calendarName = unescapeIcsText(value);
      continue;
    }

    switch (name) {
      case 'UID':
        cur.uid = unescapeIcsText(value);
        break;
      case 'SUMMARY':
        cur.summary = unescapeIcsText(value);
        break;
      case 'DTSTART': {
        const t = parseIcsDate(value);
        if (t != null) cur.start = t;
        break;
      }
      case 'DTEND': {
        const t = parseIcsDate(value);
        if (t != null) cur.end = t;
        break;
      }
      case 'DURATION': {
        const ms = parseIcsDuration(value);
        if (ms != null) cur.duration = ms;
        break;
      }
      case 'RRULE':
        cur.rrule = `RRULE:${value.trim()}`;
        break;
      case 'X-JECTS-RESOURCE':
        cur.resourceId = unescapeIcsText(value);
        break;
      case 'X-JECTS-COLOR':
        cur.color = unescapeIcsText(value);
        break;
      case 'PERCENT-COMPLETE': {
        const n = parseInt(value, 10);
        if (Number.isFinite(n)) cur.percent = Math.max(0, Math.min(1, n / 100));
        break;
      }
      default:
        break;
    }
  }

  return calendarName != null ? { calendarName, events } : { events };
}

/**
 * Parse an RFC-5545 DURATION (`P[n]DT[n]H[n]M[n]S` / `PT…W`) to milliseconds.
 * Returns `null` for an unparseable value.
 */
export function parseIcsDuration(raw: string): number | null {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(
    raw.trim(),
  );
  if (!m) return null;
  const [, sign, w, d, h, min, s] = m;
  const ms =
    (Number(w ?? 0) * 7 * 86_400 +
      Number(d ?? 0) * 86_400 +
      Number(h ?? 0) * 3_600 +
      Number(min ?? 0) * 60 +
      Number(s ?? 0)) *
    1000;
  if (ms === 0 && !w && !d && !h && !min && !s) return null;
  return sign === '-' ? -ms : ms;
}

/* ═══════════════════════════════════════════════════════════════════════════
   Store-facing exporter / importer (thin, env-aware)
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Serializes a scheduler {@link EventStore} to ICS and (in a browser) triggers a
 * `.ics` file download. Pure-string `toIcs` is delegated to the module function;
 * this class binds it to a live store and the download side effect.
 */
export class IcsExporter {
  constructor(
    private readonly store: EventStore,
    private readonly options: IcsExportOptions = {},
  ) {}

  /** Serialize the store's current events to an ICS string. */
  toIcs(extra?: IcsExportOptions): string {
    return toIcs(this.store.toArray(), { ...this.options, ...extra });
  }

  /** Trigger a `.ics` file download in the browser. No-op outside a DOM. */
  download(fileName?: string): void {
    const name = fileName ?? this.options.fileName ?? 'schedule';
    triggerIcsDownload(this.toIcs(), `${name}.ics`);
  }
}

/**
 * Parses ICS text and merges the resulting events into a scheduler
 * {@link EventStore}. Returns the events that were actually added.
 */
export class IcsImporter {
  constructor(
    private readonly store: EventStore,
    private readonly options: IcsImportOptions = {},
  ) {}

  /** Parse ICS text without mutating the store. */
  parse(text: string): ParsedIcs {
    return parseIcs(text, this.options);
  }

  /**
   * Parse ICS text and add its events to the store. Existing ids are skipped
   * when `skipExisting` (default) is on. Returns the added events.
   */
  import(text: string): EventModel[] {
    const skipExisting = this.options.skipExisting ?? true;
    const parsed = parseIcs(text, this.options);
    const toAdd: EventModel[] = [];
    for (const { event } of parsed.events) {
      if (skipExisting && this.store.getById(event.id) != null) continue;
      toAdd.push(event);
    }
    if (toAdd.length > 0) this.store.add(toAdd);
    return toAdd;
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   Browser helpers
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Trigger a `.ics` download for an arbitrary ICS string. Exposed so callers
 * that already have a string (not a store) can download it directly. No-op when
 * there is no `document`.
 */
export function triggerIcsDownload(content: string, fileName = 'schedule.ics'): void {
  if (typeof document === 'undefined') return;
  const blob = new Blob([content], { type: 'text/calendar;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName.endsWith('.ics') ? fileName : `${fileName}.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Convenience factory for an {@link IcsExporter}. */
export function icsExporter(store: EventStore, options?: IcsExportOptions): IcsExporter {
  return new IcsExporter(store, options);
}

/** Convenience factory for an {@link IcsImporter}. */
export function icsImporter(store: EventStore, options?: IcsImportOptions): IcsImporter {
  return new IcsImporter(store, options);
}

/* ═══════════════════════════════════════════════════════════════════════════
   Optional themed toolbar (export / import buttons)
   ═══════════════════════════════════════════════════════════════════════════ */

/** Handle returned by {@link mountIcsToolbar}. */
export interface IcsToolbar {
  /** The toolbar root element (already appended to the host). */
  readonly el: HTMLElement;
  /** Remove the toolbar and its listeners. */
  destroy(): void;
}

/** Options for {@link mountIcsToolbar}. */
export interface IcsToolbarOptions {
  /** Export options forwarded to the {@link IcsExporter}. */
  exportOptions?: IcsExportOptions;
  /** Import options forwarded to the {@link IcsImporter}. */
  importOptions?: IcsImportOptions;
  /** Visible toolbar label. Default `'iCalendar'`. */
  label?: string;
  /** Called with the events added after a successful import. */
  onImport?: (added: EventModel[]) => void;
}

/**
 * Mount a small, token-pure, accessible Export/Import .ics toolbar bound to an
 * event store. This is an OPTIONAL convenience surface — the feature itself is
 * headless and works without it. The buttons are real `<button>`s with an
 * `aria-label`-bearing toolbar role; the file input is visually hidden but
 * focusable via its label.
 *
 * No `@jects/widgets` dependency is required, keeping this module importable on
 * its own; integrators who prefer Toolbar/Button widgets can wire those instead
 * (see wireNotes).
 */
export function mountIcsToolbar(
  host: HTMLElement,
  store: EventStore,
  options: IcsToolbarOptions = {},
): IcsToolbar {
  const doc = host.ownerDocument;
  const exporter = new IcsExporter(store, options.exportOptions);
  const importer = new IcsImporter(store, options.importOptions);

  const root = doc.createElement('div');
  root.className = 'jects-scheduler-ics';
  root.setAttribute('role', 'toolbar');
  root.setAttribute('aria-label', 'iCalendar export and import');

  const label = doc.createElement('span');
  label.className = 'jects-scheduler-ics__label';
  label.textContent = options.label ?? 'iCalendar';
  root.appendChild(label);

  const exportBtn = doc.createElement('button');
  exportBtn.type = 'button';
  exportBtn.className = 'jects-scheduler-ics__btn jects-scheduler-ics__btn--primary';
  exportBtn.textContent = 'Export .ics';
  const onExport = () => exporter.download();
  exportBtn.addEventListener('click', onExport);
  root.appendChild(exportBtn);

  const importLabel = doc.createElement('label');
  importLabel.className = 'jects-scheduler-ics__btn';
  importLabel.textContent = 'Import .ics';
  const fileInput = doc.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = '.ics,text/calendar';
  fileInput.className = 'jects-scheduler-ics__file';
  fileInput.setAttribute('aria-label', 'Import iCalendar file');
  const onChange = async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    const text = await file.text();
    const added = importer.import(text);
    options.onImport?.(added);
    fileInput.value = '';
  };
  fileInput.addEventListener('change', onChange);
  importLabel.appendChild(fileInput);
  root.appendChild(importLabel);

  host.appendChild(root);

  return {
    el: root,
    destroy() {
      exportBtn.removeEventListener('click', onExport);
      fileInput.removeEventListener('change', onChange);
      root.remove();
    },
  };
}
