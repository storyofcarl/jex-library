/**
 * `@jects/gantt` — iCalendar (.ics) export.
 *
 * A pure, DOM-free RFC-5545 (iCalendar / VCALENDAR) serializer that emits one
 * `VEVENT` per task (or per leaf task), mirroring the Bryntum/DHTMLX
 * "export schedule to ICS" behaviour so a project plan can be opened in
 * Outlook / Google Calendar / Apple Calendar.
 *
 * Behaviour:
 *   - One `VEVENT` per exported task, built from the scheduled span:
 *       · `DTSTART` from `task.start`, `DTEND` from `task.end`.
 *       · `SUMMARY` from `task.name` (falling back to the task id).
 *   - **Milestone handling.** A milestone (`task.milestone === true`) or any
 *     zero-length span is emitted as a single instant: it carries `DTSTART`
 *     only (no `DTEND`), the RFC-5545 way to express a point-in-time event, and
 *     is tagged `CATEGORIES:MILESTONE` so calendars can style it.
 *   - **All-day vs timed.** By default a span whose start/end land on UTC
 *     midnight is emitted as an all-day event using `VALUE=DATE` (`DTEND` is the
 *     exclusive day after the last working day, per RFC 5545). Spans with a
 *     time-of-day are emitted as UTC date-times (`…Z`). Force one mode with
 *     `allDay: true | false`.
 *   - **Stable identity.** Each event gets a deterministic `UID`
 *     (`<taskId>@<domain>`) and a `SEQUENCE` (the project revision, default 0)
 *     so re-exporting and re-importing UPDATES the same calendar entry rather
 *     than duplicating it. A `DTSTAMP` (export time) is always present.
 *   - Optional `DESCRIPTION` (WBS / %% done / resources), `PERCENT-COMPLETE`,
 *     and `STATUS` (`COMPLETED` at 100%, else `IN-PROCESS`/`CONFIRMED`).
 *   - Output is CRLF-delimited and folded at 75 octets per RFC 5545 §3.1, with
 *     `TEXT` values escaped (`\, ; , \n` → `\\ \; \, \n`).
 *
 * Pure + dependency-free: it walks the same {@link TaskTreeSource} the CSV/XLSX
 * exporters use and returns a string. The download/UI wiring is the tiny
 * {@link downloadIcs} helper (a no-op under jsdom) — see the wire notes.
 */

import type { Model, RecordId } from '@jects/core';
import type { TaskModel } from '../contract.js';
import type { TaskTreeSource } from './serialize.js';

// Re-export the preview parser so consumers can `parseIcsEvents` from the same
// module they import the serializer from. The parser lives with the preview DOM
// helper (which owns the unfold/parse logic for the documents we emit); this
// alias keeps the public ICS export surface cohesive.
export { parseIcsEvents, unfoldIcs, renderIcsPreview } from './ics-preview.js';
export type { IcsPreviewEvent, IcsPreviewOptions } from './ics-preview.js';

/* ═══════════════════════════════════════════════════════════════════════════
   1. OPTIONS
   ═══════════════════════════════════════════════════════════════════════════ */

/** A task flattened from the tree, with its depth + outline number. */
export interface IcsTaskRow<T extends Model = Model> {
  task: TaskModel<T>;
  depth: number;
  wbs: string;
  summary: boolean;
}

/** Resolver callbacks the Gantt widget supplies when wiring the export. */
export interface IcsResolvers {
  /** Render a task's assigned resources for the DESCRIPTION (e.g. `"Alice, Bob"`). */
  resourcesOf?(taskId: RecordId): string;
}

/** Options for {@link tasksToIcs}. */
export interface IcsExportOptions<_T extends Model = Model> extends IcsResolvers {
  /**
   * The `PRODID` advertised in the calendar header. Default
   * `"-//Jects UI//@jects/gantt//EN"`.
   */
  prodId?: string;
  /**
   * Calendar name surfaced as `X-WR-CALNAME` (and the iCalendar `NAME`). When
   * omitted, no name property is written.
   */
  calendarName?: string;
  /**
   * Domain used to build each event's `UID` (`<taskId>@<domain>`). Keep it
   * stable across exports so re-import updates rather than duplicates. Default
   * `"jects.gantt"`.
   */
  uidDomain?: string;
  /**
   * Project revision written as each event's `SEQUENCE`. Bump it when the plan
   * changes so calendars treat a re-import as an UPDATE. Default `0`.
   */
  sequence?: number;
  /**
   * Force all-day (`true`) or timed (`false`) events. When omitted (default),
   * each task is auto-detected: a span on UTC-midnight boundaries → all-day,
   * otherwise timed UTC date-times.
   */
  allDay?: boolean;
  /**
   * Include summary (parent) tasks. Default `true`. When `false`, only leaf
   * tasks become events (the common "export the actual work" mode).
   */
  includeSummaryRows?: boolean;
  /**
   * Emit a `DESCRIPTION` carrying WBS / %% done / resources. Default `true`.
   */
  includeDescription?: boolean;
  /**
   * The export timestamp written as `DTSTAMP` (epoch ms). Defaults to
   * `Date.now()` — pass a fixed value for deterministic output (tests).
   */
  now?: number;
}

const DEFAULT_PRODID = '-//Jects UI//@jects/gantt//EN';
const DEFAULT_UID_DOMAIN = 'jects.gantt';
const MS_PER_DAY = 86_400_000;

/* ═══════════════════════════════════════════════════════════════════════════
   2. RFC-5545 PRIMITIVES (pure string helpers)
   ═══════════════════════════════════════════════════════════════════════════ */

/** Two-digit zero-pad. */
function p2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * Format an epoch-ms as an iCalendar UTC date-time: `YYYYMMDDTHHMMSSZ`
 * (RFC 5545 §3.3.5 "form #2, UTC").
 */
export function formatIcsDateTime(ms: number): string {
  const d = new Date(ms);
  return (
    `${d.getUTCFullYear()}${p2(d.getUTCMonth() + 1)}${p2(d.getUTCDate())}` +
    `T${p2(d.getUTCHours())}${p2(d.getUTCMinutes())}${p2(d.getUTCSeconds())}Z`
  );
}

/**
 * Format an epoch-ms as an iCalendar DATE value: `YYYYMMDD` (RFC 5545 §3.3.4),
 * used for all-day events (`VALUE=DATE`).
 */
export function formatIcsDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}${p2(d.getUTCMonth() + 1)}${p2(d.getUTCDate())}`;
}

/** True when the epoch-ms lands exactly on a UTC-midnight day boundary. */
export function isUtcMidnight(ms: number): boolean {
  return ms % MS_PER_DAY === 0;
}

/**
 * Escape a TEXT value per RFC 5545 §3.3.11: backslash, semicolon and comma are
 * backslash-escaped; newlines become the literal `\n`; CRs are dropped.
 */
export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/**
 * Fold one content line to ≤75 octets per RFC 5545 §3.1: a continuation line is
 * prefixed with a single space. Folding is octet-based (UTF-8), so multi-byte
 * characters are never split across a fold boundary.
 */
export function foldIcsLine(line: string): string {
  // Fast path: pure ASCII and short enough.
  if (line.length <= 75 && isAscii(line)) return line;

  const bytes = utf8Bytes(line);
  if (bytes.length <= 75) return line;

  // Walk codepoints, emitting a fold whenever the next char would overflow the
  // current segment's octet budget (75 for the first line, 74 thereafter since
  // a continuation starts with one space).
  const out: string[] = [];
  let seg = '';
  let segBytes = 0;
  let budget = 75;
  for (const ch of line) {
    const chBytes = utf8Bytes(ch).length;
    if (segBytes + chBytes > budget) {
      out.push(seg);
      seg = ch;
      segBytes = chBytes;
      budget = 74; // continuation lines carry a leading space
    } else {
      seg += ch;
      segBytes += chBytes;
    }
  }
  out.push(seg);
  return out.join('\r\n ');
}

function isAscii(s: string): boolean {
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) > 127) return false;
  return true;
}

/** UTF-8 byte length of a string (TextEncoder when available, manual fallback). */
function utf8Bytes(s: string): Uint8Array {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s);
  // Minimal manual UTF-8 encoder for hosts lacking TextEncoder.
  const bytes: number[] = [];
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c < 0x80) bytes.push(c);
    else if (c < 0x800) bytes.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    else if (c >= 0xd800 && c <= 0xdbff) {
      // Surrogate pair.
      const c2 = s.charCodeAt(++i);
      c = 0x10000 + ((c & 0x3ff) << 10) + (c2 & 0x3ff);
      bytes.push(
        0xf0 | (c >> 18),
        0x80 | ((c >> 12) & 0x3f),
        0x80 | ((c >> 6) & 0x3f),
        0x80 | (c & 0x3f),
      );
    } else bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
  }
  return Uint8Array.from(bytes);
}

/* ═══════════════════════════════════════════════════════════════════════════
   3. TREE FLATTENING
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Walk the task tree depth-first, yielding each task with its depth + outline
 * `wbs` number. Honors `includeSummaryRows`. Pure.
 */
export function flattenTasks<T extends Model = Model>(
  source: TaskTreeSource<T>,
  includeSummary = true,
): IcsTaskRow<T>[] {
  const rows: IcsTaskRow<T>[] = [];
  const walk = (
    nodes: ReadonlyArray<TaskModel<T> & { children?: TaskModel<T>[] }>,
    depth: number,
    prefix: string,
  ): void => {
    nodes.forEach((node, i) => {
      const wbs = prefix ? `${prefix}.${i + 1}` : String(i + 1);
      const children = source.getChildren(node);
      const isSummary = children.length > 0;
      if (includeSummary || !isSummary) {
        rows.push({ task: node, depth, wbs, summary: isSummary });
      }
      if (isSummary) walk(children, depth + 1, wbs);
    });
  };
  walk(source.items, 0, '');
  return rows;
}

/* ═══════════════════════════════════════════════════════════════════════════
   4. VEVENT
   ═══════════════════════════════════════════════════════════════════════════ */

/** True when a task should be emitted as a single instant (milestone). */
export function isMilestoneTask(task: TaskModel): boolean {
  if (task.milestone === true) return true;
  // A zero-length (or missing-end) span is also an instant.
  if (task.start != null && Number.isFinite(task.start)) {
    if (task.end == null || !Number.isFinite(task.end)) return true;
    if (task.end <= task.start) return true;
  }
  return false;
}

/** Decide whether a task's span should serialize as an all-day event. */
function resolveAllDay(task: TaskModel, override: boolean | undefined): boolean {
  if (override !== undefined) return override;
  const start = task.start;
  const end = task.end;
  if (start == null) return false;
  // Auto: all-day when both ends land on UTC midnight (whole-day spans).
  return isUtcMidnight(start) && (end == null || isUtcMidnight(end));
}

/** A `name:value` property line (escaping is the caller's job for TEXT values). */
function prop(name: string, value: string): string {
  return `${name}:${value}`;
}

/** Build the human-readable DESCRIPTION text for a task. */
function buildDescription<T extends Model>(
  row: IcsTaskRow<T>,
  opts: IcsExportOptions<T>,
): string {
  const parts: string[] = [];
  parts.push(`WBS: ${row.wbs}`);
  const pd = row.task.percentDone;
  if (pd != null && Number.isFinite(pd)) {
    parts.push(`Complete: ${Math.round(Math.max(0, Math.min(1, pd)) * 100)}%`);
  }
  const res = opts.resourcesOf?.(row.task.id);
  if (res) parts.push(`Resources: ${res}`);
  return parts.join('\n');
}

/**
 * Serialize one task to a `VEVENT` block as an array of (unfolded) content
 * lines. Pure.
 */
export function taskToVevent<T extends Model = Model>(
  row: IcsTaskRow<T>,
  opts: IcsExportOptions<T>,
  dtstamp: string,
): string[] {
  const { task } = row;
  const domain = opts.uidDomain ?? DEFAULT_UID_DOMAIN;
  const seq = opts.sequence ?? 0;
  const lines: string[] = ['BEGIN:VEVENT'];

  lines.push(prop('UID', `${String(task.id)}@${domain}`));
  lines.push(prop('SEQUENCE', String(seq)));
  lines.push(prop('DTSTAMP', dtstamp));

  const summary = task.name && task.name.length > 0 ? task.name : String(task.id);
  lines.push(prop('SUMMARY', escapeIcsText(summary)));

  const milestone = isMilestoneTask(task);
  const start = task.start;

  if (start != null && Number.isFinite(start)) {
    if (milestone) {
      // A point-in-time event: DTSTART only, tagged MILESTONE.
      const allDay = resolveAllDay(task, opts.allDay);
      if (allDay) {
        lines.push(`DTSTART;VALUE=DATE:${formatIcsDate(start)}`);
      } else {
        lines.push(prop('DTSTART', formatIcsDateTime(start)));
      }
      lines.push(prop('CATEGORIES', 'MILESTONE'));
    } else {
      const end = task.end!;
      const allDay = resolveAllDay(task, opts.allDay);
      if (allDay) {
        lines.push(`DTSTART;VALUE=DATE:${formatIcsDate(start)}`);
        // RFC 5545: DTEND for an all-day event is the EXCLUSIVE day after the
        // last day. The scheduled `end` is already exclusive (next day midnight),
        // so it maps straight through; guard the degenerate same-day case.
        const exclusiveEnd = end > start ? end : start + MS_PER_DAY;
        lines.push(`DTEND;VALUE=DATE:${formatIcsDate(exclusiveEnd)}`);
      } else {
        lines.push(prop('DTSTART', formatIcsDateTime(start)));
        lines.push(prop('DTEND', formatIcsDateTime(end)));
      }
    }
  }

  // PERCENT-COMPLETE + STATUS.
  const pd = task.percentDone;
  if (pd != null && Number.isFinite(pd)) {
    const pct = Math.round(Math.max(0, Math.min(1, pd)) * 100);
    lines.push(prop('PERCENT-COMPLETE', String(pct)));
    lines.push(prop('STATUS', pct >= 100 ? 'COMPLETED' : 'IN-PROCESS'));
  }

  if (opts.includeDescription !== false) {
    const desc = buildDescription(row, opts);
    if (desc) lines.push(prop('DESCRIPTION', escapeIcsText(desc)));
  }

  lines.push('END:VEVENT');
  return lines;
}

/* ═══════════════════════════════════════════════════════════════════════════
   5. VCALENDAR
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Serialize a task tree to a complete `VCALENDAR` iCalendar document. Walks the
 * tree (depth-first, preserving outline order), emits one `VEVENT` per exported
 * task, folds every content line to ≤75 octets, and joins with CRLF. Pure.
 *
 * @param source  The task tree (a `TreeStore` or any compatible shape).
 * @param options Header / identity / formatting options (see {@link IcsExportOptions}).
 */
export function tasksToIcs<T extends Model = Model>(
  source: TaskTreeSource<T>,
  options: IcsExportOptions<T> = {},
): string {
  const prodId = options.prodId ?? DEFAULT_PRODID;
  const now = options.now ?? Date.now();
  const dtstamp = formatIcsDateTime(now);
  const includeSummary = options.includeSummaryRows !== false;

  const rows = flattenTasks(source, includeSummary);

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    prop('PRODID', prodId),
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];
  if (options.calendarName) {
    lines.push(prop('NAME', escapeIcsText(options.calendarName)));
    lines.push(prop('X-WR-CALNAME', escapeIcsText(options.calendarName)));
  }

  for (const row of rows) {
    for (const l of taskToVevent(row, options, dtstamp)) lines.push(l);
  }

  lines.push('END:VCALENDAR');

  return lines.map(foldIcsLine).join('\r\n') + '\r\n';
}

/* ═══════════════════════════════════════════════════════════════════════════
   6. DOWNLOAD HELPER (DOM side — no-op under jsdom)
   ═══════════════════════════════════════════════════════════════════════════ */

/** The standard MIME type for an iCalendar document. */
export const ICS_MIME = 'text/calendar;charset=utf-8';

/**
 * Trigger a browser download of an iCalendar string as `filename`. Appends the
 * `.ics` extension when absent. No-op in hosts without the object-URL API
 * (jsdom), so callers can still produce + return the payload without a DOM side
 * effect.
 */
export function downloadIcs(ics: string, filename = 'gantt.ics'): void {
  const name = /\.ics$/i.test(filename) ? filename : `${filename}.ics`;
  if (
    typeof URL === 'undefined' ||
    typeof URL.createObjectURL !== 'function' ||
    typeof document === 'undefined'
  ) {
    return;
  }
  const blob = new Blob([ics], { type: ICS_MIME });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}


/**
 * One-shot: serialize a task tree to ICS and offer it as a browser download.
 * Returns the produced ICS string (so callers can also keep/inspect it). This
 * is the shape the Gantt widget's `exportIcs()` method delegates to.
 */
export function exportIcs<T extends Model = Model>(
  source: TaskTreeSource<T>,
  options: IcsExportOptions<T> & { download?: string | boolean } = {},
): string {
  const ics = tasksToIcs(source, options);
  if (options.download) {
    const name =
      typeof options.download === 'string' ? options.download : 'gantt.ics';
    downloadIcs(ics, name);
  }
  return ics;
}
