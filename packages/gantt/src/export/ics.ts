/**
 * `@jects/gantt` — ICS (iCalendar / RFC 5545) export.
 *
 * Serializes a project's tasks (and/or milestones) to an iCalendar `VCALENDAR`
 * with one `VEVENT` per task, so a Gantt schedule can be imported into Outlook,
 * Google Calendar, Apple Calendar, or any RFC-5545 client. This matches the
 * Bryntum/DHTMLX "export to ICS / iCal" behavior:
 *
 *   - One `VEVENT` per task. A zero-duration task (a milestone) is emitted as a
 *     point-in-time event (`DTSTART` == `DTEND`); a spanning task gets
 *     `DTSTART`/`DTEND` from its `start`/`end`.
 *   - The task `name` becomes `SUMMARY`; `percentDone` is written as the
 *     RFC-5545 `PERCENT-COMPLETE` property (0..100 integer) and reflected in
 *     `STATUS` (`COMPLETED` at 100%, `IN-PROCESS` when partially done, else
 *     `NEEDS-ACTION`).
 *   - Each assigned resource becomes an `ATTENDEE` line (`CN` = resource name,
 *     `mailto:` when an email is resolvable, else a generated `urn:` value), with
 *     `ROLE=REQ-PARTICIPANT` and `CUTYPE` derived from the resource type
 *     (`INDIVIDUAL` for work, `RESOURCE` for equipment/material, `UNKNOWN` for
 *     cost). The first assigned resource is also written as `ORGANIZER`.
 *   - Times are emitted in UTC (`…Z`, the RFC-5545 "form #2"). The default is
 *     UTC; passing a `tzid` emits floating local-form timestamps tagged with that
 *     `TZID` (the consumer's calendar resolves it).
 *   - Every property value is escaped per RFC 5545 §3.3.11 (`\` `;` `,` and
 *     newline) and every content line is folded at 75 octets per §3.1 with a
 *     leading space continuation, using a CRLF line break throughout.
 *
 * This module is DOM-free and dependency-free: it returns a `string`. The
 * download / UI wiring lives in the export feature module
 * (`./gantt-ics-export`), so this writer is unit-testable under jsdom and reusable
 * standalone.
 *
 * All times are epoch milliseconds (UTC).
 */

import type { Model, RecordId } from '@jects/core';
import type { TaskModel } from '../contract.js';
import type { TaskTreeSource } from './serialize.js';

/* ═══════════════════════════════════════════════════════════════════════════
   1. PUBLIC TYPES
   ═══════════════════════════════════════════════════════════════════════════ */

/** A resolved attendee for a task's `VEVENT` (one per assigned resource). */
export interface IcsAttendee {
  /** Stable id (resource id) — used to derive a deterministic CAL-ADDRESS. */
  id: RecordId;
  /** Display name (becomes the `CN` parameter). */
  name?: string;
  /** Email address (becomes a `mailto:` CAL-ADDRESS when present). */
  email?: string;
  /**
   * Calendar user type. Maps to the RFC-5545 `CUTYPE` parameter. Defaults to
   * `'INDIVIDUAL'`. Equipment/material resources should pass `'RESOURCE'`.
   */
  cutype?: 'INDIVIDUAL' | 'GROUP' | 'RESOURCE' | 'ROOM' | 'UNKNOWN';
  /** Participation role (`ROLE`). Default `'REQ-PARTICIPANT'`. */
  role?: 'CHAIR' | 'REQ-PARTICIPANT' | 'OPT-PARTICIPANT' | 'NON-PARTICIPANT';
}

/** Resolver callbacks the Gantt widget supplies when wiring the ICS export. */
export interface IcsResolvers<T extends Model = Model> {
  /**
   * Resolve the attendees (assigned resources) for a task. When omitted, the
   * task's `resourceIds` are emitted as bare `urn:` CAL-ADDRESS values with no
   * name (still valid ICS). Returning `[]` omits the attendee/organizer lines.
   */
  attendeesOf?(task: TaskModel<T>): ReadonlyArray<IcsAttendee>;
  /**
   * Per-task long description (`DESCRIPTION` property). When omitted no
   * description line is written.
   */
  descriptionOf?(task: TaskModel<T>): string | undefined;
  /**
   * Per-task location (`LOCATION` property). When omitted no location is written.
   */
  locationOf?(task: TaskModel<T>): string | undefined;
}

/** Options for {@link tasksToIcs} / {@link buildVCalendar}. */
export interface IcsExportOptions<T extends Model = Model> extends IcsResolvers<T> {
  /**
   * `PRODID` identifying the generating product. Default
   * `'-//Jects UI//Gantt//EN'`.
   */
  prodId?: string;
  /** Calendar display name (`X-WR-CALNAME`). Optional. */
  calendarName?: string;
  /**
   * Domain used to mint stable `UID`s (`<taskId>@<uidDomain>`). Default
   * `'jects.gantt'`.
   */
  uidDomain?: string;
  /**
   * Fixed `DTSTAMP` (creation time) for every event, epoch ms. Defaults to "now"
   * at call time. Passing a fixed value makes the output deterministic (used by
   * tests and for reproducible exports).
   */
  dtstamp?: number;
  /**
   * Emit floating local-time timestamps tagged with this IANA `TZID`
   * (e.g. `'Europe/Stockholm'`) instead of UTC `…Z` values. When omitted, all
   * timestamps are UTC. Note: the local wall-clock conversion is the consumer's
   * responsibility via the `TZID` — this writer formats the raw epoch as UTC
   * wall-clock under the tag, so prefer leaving this unset unless your epochs are
   * already expressed in the target zone.
   */
  tzid?: string;
  /**
   * Which tasks to include:
   *   - `'all'`     — every task (the default).
   *   - `'milestones'` — only zero-duration tasks / `milestone === true`.
   *   - `'leaf'`    — only leaf tasks (skip summary/parent rows).
   */
  include?: 'all' | 'milestones' | 'leaf';
  /**
   * Default per-event alarm lead time in minutes before `DTSTART`. When set
   * (> 0), a `VALARM` with `ACTION:DISPLAY` is emitted on each timed event.
   * Default: no alarm.
   */
  alarmMinutesBefore?: number;
}

/* ═══════════════════════════════════════════════════════════════════════════
   2. RFC-5545 PRIMITIVES (escape / fold / format)
   ═══════════════════════════════════════════════════════════════════════════ */

const CRLF = '\r\n';
const DEFAULT_PRODID = '-//Jects UI//Gantt//EN';
const DEFAULT_UID_DOMAIN = 'jects.gantt';
/** Max octets per content line before folding (RFC 5545 §3.1: 75 + CRLF). */
const FOLD_LIMIT = 75;

/** Matches any C0 control char or DEL (used to scrub parameter values). */
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\x00-\x1f\x7f]/g;
/** Matches any non-ASCII (multi-byte) code unit — triggers octet-aware folding. */
// eslint-disable-next-line no-control-regex
const NON_ASCII_RE = /[^\x00-\x7f]/;

/**
 * Escape a TEXT-typed property value per RFC 5545 §3.3.11: backslash, semicolon,
 * comma, and newlines are escaped; CR is dropped, LF becomes the literal `\n`.
 * The order matters — backslash MUST be escaped first.
 */
export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/**
 * Escape a property PARAMETER value (e.g. `CN`). Per RFC 5545 §3.2 a param value
 * containing `:`, `;`, or `,` must be DQUOTE-wrapped; an embedded DQUOTE is not
 * representable and is replaced with a single quote (the standard pragmatic
 * fallback). Control characters (incl. newlines) are stripped to a space.
 */
export function escapeIcsParam(value: string): string {
  const clean = value.replace(CONTROL_RE, ' ').replace(/"/g, "'");
  return /[:;,]/.test(clean) ? `"${clean}"` : clean;
}

/**
 * Fold a single (already-assembled) content line to <=75 octets per RFC 5545
 * §3.1: continuation lines start with a single space. Folding is by UTF-8 octet
 * count (not code units) so multi-byte characters are never split across a fold
 * boundary mid-sequence.
 */
export function foldIcsLine(line: string): string {
  // Fast path: a short pure-ASCII line needs no folding.
  if (line.length <= FOLD_LIMIT && !NON_ASCII_RE.test(line)) return line;

  const out: string[] = [];
  let current = '';
  let octets = 0;
  // First line allows FOLD_LIMIT octets; continuation lines reserve 1 octet for
  // the leading space, so they too cap content at FOLD_LIMIT (the space is the
  // 1st octet of a max-75 continuation line).
  for (const ch of line) {
    const chOctets = utf8Len(ch);
    if (octets + chOctets > FOLD_LIMIT) {
      out.push(current);
      current = ' ' + ch;
      octets = 1 + chOctets;
    } else {
      current += ch;
      octets += chOctets;
    }
  }
  if (current.length > 0) out.push(current);
  return out.join(CRLF);
}

/** UTF-8 byte length of a single code point. */
function utf8Len(ch: string): number {
  const cp = ch.codePointAt(0) ?? 0;
  if (cp < 0x80) return 1;
  if (cp < 0x800) return 2;
  if (cp < 0x10000) return 3;
  return 4;
}

/**
 * Format an epoch-ms as an RFC-5545 UTC DATE-TIME (form #2): `YYYYMMDDTHHMMSSZ`.
 * Always UTC, always with seconds, always the trailing `Z`.
 */
export function formatIcsUtc(ms: number): string {
  const d = new Date(ms);
  return (
    pad4(d.getUTCFullYear()) +
    pad2(d.getUTCMonth() + 1) +
    pad2(d.getUTCDate()) +
    'T' +
    pad2(d.getUTCHours()) +
    pad2(d.getUTCMinutes()) +
    pad2(d.getUTCSeconds()) +
    'Z'
  );
}

/**
 * Format an epoch-ms as a "floating" local DATE-TIME (no `Z`), the wall-clock
 * value to be tagged with a `TZID` parameter: `YYYYMMDDTHHMMSS`. (The epoch is
 * read in UTC wall-clock; see the `tzid` note on {@link IcsExportOptions}.)
 */
export function formatIcsLocal(ms: number): string {
  return formatIcsUtc(ms).slice(0, -1); // drop trailing 'Z'
}

function pad2(n: number): string {
  return n < 10 ? '0' + n : String(n);
}
function pad4(n: number): string {
  return n.toString().padStart(4, '0');
}

/* ═══════════════════════════════════════════════════════════════════════════
   3. EVENT MODEL → VEVENT LINES
   ═══════════════════════════════════════════════════════════════════════════ */

/** A normalized, writer-neutral calendar event (one per exported task). */
export interface IcsEvent {
  /** Stable id (becomes the local-part of the `UID`). */
  id: RecordId;
  /** Event summary (task name). */
  summary: string;
  /** Start, epoch ms. */
  start: number;
  /**
   * End, epoch ms. When equal to `start` the event is a point-in-time
   * (milestone) and is emitted with `DTSTART` == `DTEND`.
   */
  end: number;
  /** Completion percent 0..100 (integer). Undefined → no `PERCENT-COMPLETE`. */
  percentComplete?: number;
  /** Long description (`DESCRIPTION`). */
  description?: string;
  /** Location (`LOCATION`). */
  location?: string;
  /** Resolved attendees (assigned resources). */
  attendees?: ReadonlyArray<IcsAttendee>;
  /** Whether this event is a zero-duration milestone. */
  milestone?: boolean;
}

/** RFC-5545 `STATUS` derived from completion. */
function statusFor(percent: number | undefined): 'COMPLETED' | 'IN-PROCESS' | 'NEEDS-ACTION' {
  if (percent == null) return 'NEEDS-ACTION';
  if (percent >= 100) return 'COMPLETED';
  if (percent > 0) return 'IN-PROCESS';
  return 'NEEDS-ACTION';
}

/** Build a CAL-ADDRESS value for an attendee (mailto when possible, else urn). */
function calAddress(att: IcsAttendee): string {
  if (att.email && att.email.length > 0) return `mailto:${att.email}`;
  // Deterministic, valid URN fallback when no email is known.
  return `urn:jects:resource:${encodeURIComponent(String(att.id))}`;
}

/** Render one ATTENDEE (or ORGANIZER) line for an attendee. */
function attendeeLine(att: IcsAttendee, kind: 'ATTENDEE' | 'ORGANIZER'): string {
  const params: string[] = [];
  if (att.name) params.push(`CN=${escapeIcsParam(att.name)}`);
  if (kind === 'ATTENDEE') {
    params.push(`ROLE=${att.role ?? 'REQ-PARTICIPANT'}`);
    params.push(`CUTYPE=${att.cutype ?? 'INDIVIDUAL'}`);
    params.push('PARTSTAT=NEEDS-ACTION');
  }
  const prefix = params.length > 0 ? `${kind};${params.join(';')}` : kind;
  return `${prefix}:${calAddress(att)}`;
}

/**
 * Emit the (unfolded) property lines for a single `VEVENT`. Returns the raw
 * lines including the `BEGIN`/`END` wrappers; folding is applied by the caller.
 */
export function veventLines<_T extends Model = Model>(
  event: IcsEvent,
  ctx: {
    uidDomain: string;
    dtstamp: number;
    tzid?: string;
    alarmMinutesBefore?: number;
  },
): string[] {
  const lines: string[] = [];
  const dt = (ms: number): { prop: string; value: string } =>
    ctx.tzid
      ? { prop: `;TZID=${ctx.tzid}`, value: formatIcsLocal(ms) }
      : { prop: '', value: formatIcsUtc(ms) };

  lines.push('BEGIN:VEVENT');
  lines.push(`UID:${escapeIcsText(String(event.id))}@${ctx.uidDomain}`);
  lines.push(`DTSTAMP:${formatIcsUtc(ctx.dtstamp)}`);

  const start = dt(event.start);
  lines.push(`DTSTART${start.prop}:${start.value}`);
  const end = dt(event.end);
  lines.push(`DTEND${end.prop}:${end.value}`);

  lines.push(`SUMMARY:${escapeIcsText(event.summary)}`);

  if (event.description != null && event.description !== '') {
    lines.push(`DESCRIPTION:${escapeIcsText(event.description)}`);
  }
  if (event.location != null && event.location !== '') {
    lines.push(`LOCATION:${escapeIcsText(event.location)}`);
  }

  if (event.percentComplete != null && Number.isFinite(event.percentComplete)) {
    const pc = Math.max(0, Math.min(100, Math.round(event.percentComplete)));
    lines.push(`PERCENT-COMPLETE:${pc}`);
    lines.push(`STATUS:${statusFor(pc)}`);
  } else {
    lines.push(`STATUS:${statusFor(undefined)}`);
  }

  // Categorize milestones so calendars can style them distinctly.
  if (event.milestone) lines.push('CATEGORIES:MILESTONE');

  const attendees = event.attendees ?? [];
  if (attendees.length > 0) {
    // First attendee doubles as ORGANIZER (Bryntum/DHTMLX parity).
    lines.push(attendeeLine(attendees[0]!, 'ORGANIZER'));
    for (const att of attendees) lines.push(attendeeLine(att, 'ATTENDEE'));
  }

  // Optional display alarm a fixed lead-time before the start.
  if (ctx.alarmMinutesBefore != null && ctx.alarmMinutesBefore > 0) {
    lines.push('BEGIN:VALARM');
    lines.push('ACTION:DISPLAY');
    lines.push(`DESCRIPTION:${escapeIcsText(event.summary)}`);
    lines.push(`TRIGGER:-PT${Math.round(ctx.alarmMinutesBefore)}M`);
    lines.push('END:VALARM');
  }

  lines.push('END:VEVENT');
  return lines;
}

/* ═══════════════════════════════════════════════════════════════════════════
   4. VCALENDAR ASSEMBLY
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Assemble a complete `VCALENDAR` string from already-normalized events. Folds
 * every content line and joins with CRLF, ending with a trailing CRLF (so the
 * file is well-formed for strict parsers).
 */
export function buildVCalendar<T extends Model = Model>(
  events: ReadonlyArray<IcsEvent>,
  options: IcsExportOptions<T> = {},
): string {
  const prodId = options.prodId ?? DEFAULT_PRODID;
  const uidDomain = options.uidDomain ?? DEFAULT_UID_DOMAIN;
  const dtstamp = options.dtstamp ?? Date.now();

  const raw: string[] = [];
  raw.push('BEGIN:VCALENDAR');
  raw.push('VERSION:2.0');
  raw.push(`PRODID:${escapeIcsText(prodId)}`);
  raw.push('CALSCALE:GREGORIAN');
  raw.push('METHOD:PUBLISH');
  if (options.calendarName) {
    raw.push(`X-WR-CALNAME:${escapeIcsText(options.calendarName)}`);
  }
  if (options.tzid) {
    raw.push(`X-WR-TIMEZONE:${escapeIcsText(options.tzid)}`);
  }

  for (const event of events) {
    raw.push(
      ...veventLines<T>(event, {
        uidDomain,
        dtstamp,
        ...(options.tzid ? { tzid: options.tzid } : {}),
        ...(options.alarmMinutesBefore != null
          ? { alarmMinutesBefore: options.alarmMinutesBefore }
          : {}),
      }),
    );
  }

  raw.push('END:VCALENDAR');

  return raw.map(foldIcsLine).join(CRLF) + CRLF;
}

/* ═══════════════════════════════════════════════════════════════════════════
   5. TASK TREE → EVENTS → VCALENDAR
   ═══════════════════════════════════════════════════════════════════════════ */

/** Flatten a task tree to a depth-first list with a summary flag per node. */
function flattenTasks<T extends Model>(
  source: TaskTreeSource<T>,
): Array<{ task: TaskModel<T>; summary: boolean }> {
  const out: Array<{ task: TaskModel<T>; summary: boolean }> = [];
  const walk = (
    nodes: ReadonlyArray<TaskModel<T> & { children?: TaskModel<T>[] }>,
  ): void => {
    for (const node of nodes) {
      const children = source.getChildren(node);
      out.push({ task: node, summary: children.length > 0 });
      if (children.length > 0) walk(children);
    }
  };
  walk(source.items);
  return out;
}

/** Is a task a milestone (explicit flag, or zero-duration / start == end)? */
export function isMilestone<T extends Model>(task: TaskModel<T>): boolean {
  if (task.milestone === true) return true;
  if (task.duration === 0) return true;
  if (
    task.start != null &&
    task.end != null &&
    Number.isFinite(task.start) &&
    Number.isFinite(task.end) &&
    task.start === task.end
  ) {
    return true;
  }
  return false;
}

/**
 * Normalize one task into an {@link IcsEvent}, or `undefined` when the task has no
 * resolvable start (an unscheduled task cannot be a calendar event).
 */
export function taskToEvent<T extends Model>(
  task: TaskModel<T>,
  summary: boolean,
  resolvers: IcsResolvers<T>,
): IcsEvent | undefined {
  const start = task.start;
  if (start == null || !Number.isFinite(start)) return undefined;

  const milestone = isMilestone(task);
  // Milestones (and tasks with no end) collapse to a point in time.
  const end =
    milestone || task.end == null || !Number.isFinite(task.end)
      ? start
      : (task.end as number);

  const event: IcsEvent = {
    id: task.id,
    summary: task.name != null && task.name !== '' ? task.name : String(task.id),
    start,
    end: end < start ? start : end,
    milestone,
  };

  if (task.percentDone != null && Number.isFinite(task.percentDone)) {
    // Task model stores a 0..1 fraction; ICS wants a 0..100 integer.
    event.percentComplete = Math.max(0, Math.min(100, Math.round(task.percentDone * 100)));
  }

  const desc = resolvers.descriptionOf?.(task);
  if (desc != null && desc !== '') event.description = desc;
  const loc = resolvers.locationOf?.(task);
  if (loc != null && loc !== '') event.location = loc;

  const attendees = resolvers.attendeesOf
    ? resolvers.attendeesOf(task)
    : defaultAttendees(task);
  if (attendees.length > 0) event.attendees = attendees;

  // `summary` (a parent/summary row) is carried only to allow include='leaf'
  // filtering upstream; it does not alter the emitted event.
  void summary;
  return event;
}

/**
 * Default attendee resolution from a task's `resourceIds` when no resolver is
 * supplied: each id becomes a bare `urn:` attendee with no name/email.
 */
function defaultAttendees<T extends Model>(task: TaskModel<T>): IcsAttendee[] {
  const ids = task.resourceIds ?? [];
  return ids.map((id) => ({ id }));
}

/**
 * Serialize a task tree directly to a complete `VCALENDAR` string. Walks the tree
 * depth-first, normalizes each (scheduled) task to a `VEVENT`, applies the
 * `include` filter, and folds/joins per RFC 5545.
 *
 * @param source  The task tree (a `TreeStore` or any compatible shape).
 * @param options Resolvers + calendar/ICS formatting (see {@link IcsExportOptions}).
 */
export function tasksToIcs<T extends Model = Model>(
  source: TaskTreeSource<T>,
  options: IcsExportOptions<T> = {},
): string {
  const include = options.include ?? 'all';
  const flat = flattenTasks(source);

  const events: IcsEvent[] = [];
  for (const { task, summary } of flat) {
    if (include === 'leaf' && summary) continue;
    const event = taskToEvent(task, summary, options);
    if (!event) continue;
    if (include === 'milestones' && !event.milestone) continue;
    events.push(event);
  }

  return buildVCalendar(events, options);
}

/** Default MIME type for an exported ICS file. */
export const ICS_MIME_TYPE = 'text/calendar;charset=utf-8';

/** Default file extension for an exported ICS file. */
export const ICS_FILE_EXTENSION = '.ics';
