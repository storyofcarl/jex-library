/**
 * `@jects/gantt` — MS Project interop (MSPDI XML import + export).
 *
 * Bryntum/DHTMLX parity: a self-contained, framework-free codec that round-trips
 * a Gantt project to and from Microsoft Project's interchange format. The native
 * `.mpp` container is a proprietary OLE2 compound binary that cannot be parsed
 * without a heavyweight binary reader; MS Project itself ships the **MSPDI XML**
 * schema (`http://schemas.microsoft.com/project`) as the documented, lossless
 * interchange format ("Save As → XML"). This module implements MSPDI (the schema
 * every Project-compatible tool — Bryntum, DHTMLX, GanttProject, ProjectLibre —
 * reads and writes), so a `.mpp` exported as XML imports here, and what we emit
 * opens directly in MS Project.
 *
 * What it maps (both directions):
 *   - **Tasks** — WBS tree (`OutlineLevel`/`OutlineNumber`), name, start/finish,
 *     duration (ISO-8601-ish `PT…H…M…S` durations against an 8h/day calendar),
 *     `PercentComplete`, `Milestone`, summary flag, `Manual` (manually scheduled).
 *   - **Dependencies** — `PredecessorLink` with `Type` (0=FF 1=FS 2=SF 3=SS) and
 *     `LinkLag` (in tenths of a minute, the MSPDI unit).
 *   - **Calendars** — base calendars: weekday working/non-working `WeekDay`s with
 *     `WorkingTimes`, plus dated `Exceptions` (holidays / shifts).
 *   - **Constraints** — `ConstraintType` (0..7) ⇄ our `ConstraintType` union and
 *     `ConstraintDate`.
 *   - **Resources** — `Type` (0=material 1=work / cost flag), `MaxUnits`,
 *     `StandardRate` (hourly cost), `CalendarUID`, group.
 *   - **Assignments** — task↔resource `Assignment`s with `Units`.
 *   - **Baselines** — task `Baseline` (`Start`/`Finish`/`Duration`/`Work`) ⇄ our
 *     `Baseline` snapshot map. Multiple numbered baselines are supported.
 *
 * Design discipline (mirrors `engine/` and `resource/`): this is a PURE codec.
 * It builds NO DOM, owns no Widget, imports only framework-free contract types,
 * and ships its own tiny tolerant XML reader/writer so it has zero runtime deps
 * and runs identically in jsdom, Node, and the browser. The `Gantt` widget wires
 * it in additively (see wireNotes) — nothing here reaches into the widget.
 *
 * All times are epoch milliseconds (UTC); durations are milliseconds — same as
 * the scheduling contract.
 */

import type { RecordId, Model } from '@jects/core';
import type {
  TaskModel,
  DependencyModel,
  DependencyType,
  CalendarModel,
  CalendarException,
  WeekdayRule,
  WorkingInterval,
  ConstraintType,
  Baseline,
  BaselineTask,
} from '../contract.js';
import type {
  ResourceModel,
  ResourceType,
  AssignmentModel,
} from '../resource/resource-contract.js';

/* ═══════════════════════════════════════════════════════════════════════════
   0. PUBLIC PROJECT-BUNDLE SHAPE
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * The full project payload the codec reads/writes. This is the same data a
 * `Gantt` is constructed from (tasks + dependencies + calendars + resources +
 * assignments + baselines), gathered into one serialisable bundle.
 */
export interface MsProjectBundle<T extends Model = Model, R extends Model = Model> {
  /** Project display name (MSPDI `<Name>`/`<Title>`). */
  name?: string;
  /** Project start anchor (epoch ms). */
  projectStart?: number;
  /** Default/base calendar id (MSPDI `<CalendarUID>` of the project). */
  defaultCalendarId?: string;
  /** Flat task list (tree via `parentId`; ordered as in the WBS). */
  tasks: TaskModel<T>[];
  /** Dependency links. */
  dependencies: DependencyModel[];
  /** Calendars referenced by tasks/resources. */
  calendars: CalendarModel[];
  /** Project resources. */
  resources: ResourceModel<R>[];
  /** Task↔resource assignments. */
  assignments: AssignmentModel[];
  /** Captured baselines (snapshot maps). */
  baselines: Baseline[];
}

/** Non-fatal issues collected while importing a (possibly imperfect) file. */
export interface MsProjectImportWarning {
  /** Machine-readable code. */
  code:
    | 'unknownConstraint'
    | 'unknownDependencyType'
    | 'missingTask'
    | 'badDate'
    | 'badDuration'
    | 'orphanAssignment'
    | 'malformedXml';
  /** Human-readable detail. */
  message: string;
}

/** Result of an import: the bundle plus any collected warnings. */
export interface MsProjectImportResult<T extends Model = Model, R extends Model = Model> {
  bundle: MsProjectBundle<T, R>;
  warnings: MsProjectImportWarning[];
}

/** Tuning for export. */
export interface MsProjectExportOptions {
  /** Project name written to `<Name>`/`<Title>`. */
  name?: string;
  /** Hours in a working day used for duration↔`PT…` conversion. Default 8. */
  hoursPerDay?: number;
  /** Pretty-print with newlines + indentation. Default `true`. */
  pretty?: boolean;
}

/** Tuning for import. */
export interface MsProjectImportOptions {
  /** Hours in a working day used for `PT…`↔duration conversion. Default 8. */
  hoursPerDay?: number;
}

const MS_PER_MIN = 60_000;
const MS_PER_HOUR = 3_600_000;
const DEFAULT_HOURS_PER_DAY = 8;
const MSPDI_NS = 'http://schemas.microsoft.com/project';

/* ═══════════════════════════════════════════════════════════════════════════
   1. TINY TOLERANT XML  (reader + writer; zero dependencies)
   ═══════════════════════════════════════════════════════════════════════════ */

/** A minimal parsed XML element node. */
export interface XmlNode {
  tag: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  /** Concatenated direct text content (already entity-decoded). */
  text: string;
}

const ENTITY_DECODE: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

/** Decode the five predefined XML entities plus numeric char refs. */
export function decodeXmlText(raw: string): string {
  return raw.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body[0] === '#') {
      const isHex = body[1] === 'x' || body[1] === 'X';
      const code = parseInt(body.slice(isHex ? 2 : 1), isHex ? 16 : 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    const mapped = ENTITY_DECODE[body];
    return mapped !== undefined ? mapped : whole;
  });
}

/** Escape text/attribute content for safe XML output. */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Parse an XML document into a tree of {@link XmlNode}. A deliberately small,
 * forgiving recursive-descent reader: it handles elements, attributes, text,
 * self-closing tags, comments, CDATA, the XML/PI declaration and namespace
 * prefixes (which are stripped — MSPDI uses a default namespace). It does NOT
 * validate; malformed structure throws so the caller can record a warning.
 */
export function parseXml(source: string): XmlNode {
  let i = 0;
  const n = source.length;

  const stripPrefix = (tag: string): string => {
    const colon = tag.indexOf(':');
    return colon === -1 ? tag : tag.slice(colon + 1);
  };

  const skipMisc = (): void => {
    // Skip whitespace, comments, CDATA-irrelevant prolog, PIs, doctype.
    for (;;) {
      while (i < n && /\s/.test(source[i]!)) i++;
      if (source.startsWith('<!--', i)) {
        const end = source.indexOf('-->', i + 4);
        i = end === -1 ? n : end + 3;
        continue;
      }
      if (source.startsWith('<?', i)) {
        const end = source.indexOf('?>', i + 2);
        i = end === -1 ? n : end + 2;
        continue;
      }
      if (source.startsWith('<!DOCTYPE', i) || source.startsWith('<!doctype', i)) {
        const end = source.indexOf('>', i);
        i = end === -1 ? n : end + 1;
        continue;
      }
      break;
    }
  };

  const parseAttrs = (raw: string): Record<string, string> => {
    const attrs: Record<string, string> = {};
    const re = /([^\s=/]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(raw)) !== null) {
      const key = stripPrefix(m[1]!);
      const val = m[3] !== undefined ? m[3] : (m[4] ?? '');
      attrs[key] = decodeXmlText(val);
    }
    return attrs;
  };

  const parseElement = (): XmlNode => {
    if (source[i] !== '<') throw new Error(`Expected '<' at ${i}`);
    const tagEnd = source.indexOf('>', i);
    if (tagEnd === -1) throw new Error('Unterminated tag');
    const selfClosing = source[tagEnd - 1] === '/';
    const inner = source.slice(i + 1, selfClosing ? tagEnd - 1 : tagEnd).trim();
    const spaceIdx = inner.search(/\s/);
    const rawTag = spaceIdx === -1 ? inner : inner.slice(0, spaceIdx);
    const tag = stripPrefix(rawTag);
    const attrs = spaceIdx === -1 ? {} : parseAttrs(inner.slice(spaceIdx + 1));
    const node: XmlNode = { tag, attrs, children: [], text: '' };
    i = tagEnd + 1;
    if (selfClosing) return node;

    const textParts: string[] = [];
    for (;;) {
      if (i >= n) throw new Error(`Unclosed element <${tag}>`);
      if (source.startsWith('<![CDATA[', i)) {
        const end = source.indexOf(']]>', i + 9);
        const cdata = source.slice(i + 9, end === -1 ? n : end);
        textParts.push(cdata);
        i = end === -1 ? n : end + 3;
        continue;
      }
      if (source.startsWith('<!--', i)) {
        const end = source.indexOf('-->', i + 4);
        i = end === -1 ? n : end + 3;
        continue;
      }
      if (source.startsWith('</', i)) {
        const close = source.indexOf('>', i);
        i = close === -1 ? n : close + 1;
        break;
      }
      if (source[i] === '<') {
        node.children.push(parseElement());
        continue;
      }
      // text run
      const lt = source.indexOf('<', i);
      const chunk = source.slice(i, lt === -1 ? n : lt);
      textParts.push(chunk);
      i = lt === -1 ? n : lt;
    }
    node.text = decodeXmlText(textParts.join('')).trim();
    return node;
  };

  skipMisc();
  if (i >= n || source[i] !== '<') throw new Error('No root element');
  return parseElement();
}

/** First direct child with the given (prefix-stripped) tag. */
export function child(node: XmlNode | undefined, tag: string): XmlNode | undefined {
  return node?.children.find((c) => c.tag === tag);
}

/** All direct children with the given tag. */
export function children(node: XmlNode | undefined, tag: string): XmlNode[] {
  return node ? node.children.filter((c) => c.tag === tag) : [];
}

/** Trimmed text of the named direct child, or undefined. */
export function childText(node: XmlNode | undefined, tag: string): string | undefined {
  const c = child(node, tag);
  return c ? c.text : undefined;
}

/** A small XML writer that builds well-formed, optionally pretty MSPDI. */
class XmlWriter {
  private readonly parts: string[] = [];
  private depth = 0;
  constructor(private readonly pretty: boolean) {}

  private pad(): string {
    return this.pretty ? '  '.repeat(this.depth) : '';
  }
  private nl(): string {
    return this.pretty ? '\n' : '';
  }

  open(tag: string, attrs?: Record<string, string>): this {
    const a = attrs
      ? Object.entries(attrs)
          .map(([k, v]) => ` ${k}="${escapeXml(v)}"`)
          .join('')
      : '';
    this.parts.push(`${this.pad()}<${tag}${a}>${this.nl()}`);
    this.depth++;
    return this;
  }
  close(tag: string): this {
    this.depth--;
    this.parts.push(`${this.pad()}</${tag}>${this.nl()}`);
    return this;
  }
  /** A leaf element with text content (omitted entirely when value is undefined). */
  leaf(tag: string, value: string | number | boolean | undefined): this {
    if (value === undefined || value === null) return this;
    const text = typeof value === 'boolean' ? (value ? '1' : '0') : String(value);
    this.parts.push(`${this.pad()}<${tag}>${escapeXml(text)}</${tag}>${this.nl()}`);
    return this;
  }
  raw(line: string): this {
    this.parts.push(`${this.pad()}${line}${this.nl()}`);
    return this;
  }
  toString(): string {
    return this.parts.join('');
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   2. VALUE CODECS (dates, durations, enums)
   ═══════════════════════════════════════════════════════════════════════════ */

/** Format an epoch-ms instant as MSPDI local date-time `YYYY-MM-DDThh:mm:ss`. */
export function formatMsDate(ms: number): string {
  const d = new Date(ms);
  const p = (x: number, w = 2) => String(x).padStart(w, '0');
  return (
    `${p(d.getUTCFullYear(), 4)}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}` +
    `T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`
  );
}

/**
 * Parse an MSPDI date-time. Accepts `YYYY-MM-DDThh:mm:ss`, optional trailing
 * timezone, or a plain date. Treated as UTC (MS Project XML is timezone-naive;
 * we normalise to UTC so round-trips are stable). Returns `undefined` on garbage.
 */
export function parseMsDate(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const m =
    /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(raw.trim());
  if (!m) return undefined;
  const [, y, mo, da, hh, mm, ss] = m;
  const ms = Date.UTC(
    Number(y),
    Number(mo) - 1,
    Number(da),
    hh ? Number(hh) : 0,
    mm ? Number(mm) : 0,
    ss ? Number(ss) : 0,
  );
  return Number.isFinite(ms) ? ms : undefined;
}

/**
 * Format a working-time duration (ms) as an MSPDI `PT…H…M…S` duration string.
 * MSPDI expresses durations in this ISO-8601-derived form; the day boundary is
 * implicit in the calendar, so we emit hours/minutes/seconds only.
 */
export function formatMsDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  let out = 'PT';
  out += `${h}H`;
  out += `${m}M`;
  out += `${s}S`;
  return out;
}

/**
 * Parse an MSPDI `PT…H…M…S` (or `P…D` / `…DT…`) duration into working ms.
 * `hoursPerDay` converts any day component to hours. Returns `undefined` if no
 * recognisable duration token is present.
 */
export function parseMsDuration(
  raw: string | undefined,
  hoursPerDay = DEFAULT_HOURS_PER_DAY,
): number | undefined {
  if (!raw) return undefined;
  const m = /^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(
    raw.trim(),
  );
  if (!m) return undefined;
  const [, d, h, min, s] = m;
  if (d === undefined && h === undefined && min === undefined && s === undefined) {
    return undefined;
  }
  const days = d ? Number(d) : 0;
  const hours = h ? Number(h) : 0;
  const minutes = min ? Number(min) : 0;
  const seconds = s ? Number(s) : 0;
  return (
    days * hoursPerDay * MS_PER_HOUR +
    hours * MS_PER_HOUR +
    minutes * MS_PER_MIN +
    seconds * 1000
  );
}

/** MSPDI numeric dependency type ⇄ our union. (0=FF 1=FS 2=SF 3=SS). */
const MS_DEP_TYPE: Record<string, DependencyType> = {
  '0': 'FF',
  '1': 'FS',
  '2': 'SF',
  '3': 'SS',
};
const DEP_TYPE_MS: Record<DependencyType, string> = {
  FF: '0',
  FS: '1',
  SF: '2',
  SS: '3',
};

/** MSPDI numeric constraint type (0..7) ⇄ our union. */
const MS_CONSTRAINT: Record<string, ConstraintType> = {
  '0': 'asSoonAsPossible',
  '1': 'asLateAsPossible',
  '2': 'mustStartOn',
  '3': 'mustFinishOn',
  '4': 'startNoEarlierThan',
  '5': 'startNoLaterThan',
  '6': 'finishNoEarlierThan',
  '7': 'finishNoLaterThan',
};
const CONSTRAINT_MS: Record<ConstraintType, string> = {
  asSoonAsPossible: '0',
  asLateAsPossible: '1',
  mustStartOn: '2',
  mustFinishOn: '3',
  startNoEarlierThan: '4',
  startNoLaterThan: '5',
  finishNoEarlierThan: '6',
  finishNoLaterThan: '7',
};

/** MSPDI resource `Type` (0=material, 1=work) + cost flag ⇄ our resource type. */
function msResourceType(typeRaw: string | undefined, costFlag: string | undefined): ResourceType {
  if (costFlag === '1') return 'cost';
  if (typeRaw === '0') return 'material';
  return 'work';
}
function resourceTypeMs(type: ResourceType | undefined): { type: string; cost: boolean } {
  switch (type) {
    case 'material':
      return { type: '0', cost: false };
    case 'cost':
      return { type: '1', cost: true };
    case 'equipment':
    case 'work':
    default:
      return { type: '1', cost: false };
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   3. IMPORT  (MSPDI XML → bundle)
   ═══════════════════════════════════════════════════════════════════════════ */

/** Minutes-from-midnight from an MSPDI `hh:mm:ss` time-of-day string. */
function timeOfDayToMinutes(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const m = /(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(raw.trim());
  if (!m) return undefined;
  return Number(m[1]) * 60 + Number(m[2]);
}

function parseWorkingTimes(weekDay: XmlNode): WorkingInterval[] {
  const wt = child(weekDay, 'WorkingTimes');
  const intervals: WorkingInterval[] = [];
  for (const period of children(wt, 'WorkingTime')) {
    const from = timeOfDayToMinutes(childText(period, 'FromTime'));
    let to = timeOfDayToMinutes(childText(period, 'ToTime'));
    if (from === undefined || to === undefined) continue;
    // MS Project writes 00:00 for "to midnight" at end-of-day.
    if (to === 0 && from > 0) to = 24 * 60;
    if (to > from) intervals.push({ from, to });
  }
  return intervals;
}

function parseCalendar(calNode: XmlNode): CalendarModel {
  const id = childText(calNode, 'UID') ?? childText(calNode, 'Name') ?? 'cal';
  const name = childText(calNode, 'Name');
  const week: WeekdayRule[] = [];
  const exceptions: CalendarException[] = [];

  for (const wd of children(child(calNode, 'WeekDays'), 'WeekDay')) {
    const dayTypeRaw = childText(wd, 'DayType');
    const isException = dayTypeRaw === '0';
    if (isException) {
      // A dated exception: TimePeriod FromDate/ToDate + WorkingTimes (empty = holiday).
      const tp = child(wd, 'TimePeriod');
      const from = parseMsDate(childText(tp, 'FromDate'));
      const to = parseMsDate(childText(tp, 'ToDate'));
      if (from !== undefined && to !== undefined) {
        exceptions.push({
          span: { start: from, end: to },
          intervals: parseWorkingTimes(wd),
          ...(childText(wd, 'Name') ? { name: childText(wd, 'Name')! } : {}),
        });
      }
      continue;
    }
    // DayType 1..7 = Sunday..Saturday in MSPDI; our weekday is 0=Sun..6=Sat.
    const dayType = dayTypeRaw ? Number(dayTypeRaw) : NaN;
    if (!Number.isFinite(dayType) || dayType < 1 || dayType > 7) continue;
    const working = childText(wd, 'DayWorking') === '1';
    week.push({
      weekday: dayType - 1,
      intervals: working ? parseWorkingTimes(wd) : [],
    });
  }

  // Explicit <Exceptions> block (newer MSPDI files).
  for (const ex of children(child(calNode, 'Exceptions'), 'Exception')) {
    const tp = child(ex, 'TimePeriod');
    const from = parseMsDate(childText(tp, 'FromDate'));
    const to = parseMsDate(childText(tp, 'ToDate'));
    if (from === undefined || to === undefined) continue;
    exceptions.push({
      span: { start: from, end: to },
      intervals: parseWorkingTimes(ex),
      ...(childText(ex, 'Name') ? { name: childText(ex, 'Name')! } : {}),
    });
  }

  const cal: CalendarModel = { id: String(id), week };
  if (name) cal.name = name;
  if (exceptions.length) cal.exceptions = exceptions;
  return cal;
}

function endFromDuration(start: number | undefined, ms: number | undefined): number | undefined {
  if (start === undefined || ms === undefined) return undefined;
  return start + ms;
}

/**
 * Import an MSPDI XML document into a {@link MsProjectBundle}. Tolerant: unknown
 * enum values, missing dates, and orphan references are collected as warnings
 * instead of throwing, so a partially-conformant export still loads.
 */
export function importMsProject<T extends Model = Model, R extends Model = Model>(
  xml: string,
  options: MsProjectImportOptions = {},
): MsProjectImportResult<T, R> {
  const hoursPerDay = options.hoursPerDay ?? DEFAULT_HOURS_PER_DAY;
  const warnings: MsProjectImportWarning[] = [];
  // Predecessor links are stashed during the task pass and resolved once all
  // UIDs are known. Local (not module-level) so concurrent imports never clash.
  const pendingLinks: Array<{
    fromUid: string;
    toUid: string;
    type: DependencyType;
    lag: number;
  }> = [];

  let root: XmlNode;
  try {
    root = parseXml(xml);
  } catch (err) {
    warnings.push({
      code: 'malformedXml',
      message: err instanceof Error ? err.message : String(err),
    });
    return {
      bundle: {
        tasks: [],
        dependencies: [],
        calendars: [],
        resources: [],
        assignments: [],
        baselines: [],
      },
      warnings,
    };
  }

  const projectName = childText(root, 'Name') ?? childText(root, 'Title');
  const projectStart = parseMsDate(childText(root, 'StartDate'));
  const defaultCalendarId = childText(root, 'CalendarUID');

  /* ── calendars ─────────────────────────────────────────────────────── */
  const calendars: CalendarModel[] = [];
  for (const calNode of children(child(root, 'Calendars'), 'Calendar')) {
    calendars.push(parseCalendar(calNode));
  }

  /* ── tasks (WBS tree via OutlineLevel) ──────────────────────────────── */
  const tasks: TaskModel<T>[] = [];
  // Track parent at each outline depth so we can wire parentId.
  const parentAtLevel = new Map<number, RecordId>();
  // Map MSPDI task UID → our task id (UID is what links/assignments reference).
  const uidToId = new Map<string, RecordId>();
  // Baseline accumulation keyed by baseline number.
  const baselineAccum = new Map<number, Map<RecordId, BaselineTask>>();

  for (const tNode of children(child(root, 'Tasks'), 'Task')) {
    const uid = childText(tNode, 'UID');
    if (uid === undefined) continue;
    const idText = childText(tNode, 'ID') ?? uid;
    const id: RecordId = idText;
    uidToId.set(uid, id);

    const outlineLevel = Number(childText(tNode, 'OutlineLevel') ?? '1') || 1;
    const start = parseMsDate(childText(tNode, 'Start'));
    const finish = parseMsDate(childText(tNode, 'Finish'));
    const durationMs = parseMsDuration(childText(tNode, 'Duration'), hoursPerDay);
    const percentText = childText(tNode, 'PercentComplete');
    const isSummary = childText(tNode, 'Summary') === '1';
    const isMilestone = childText(tNode, 'Milestone') === '1';
    const isManual = childText(tNode, 'Manual') === '1';

    const task: TaskModel<T> = { id };
    const nm = childText(tNode, 'Name');
    if (nm !== undefined) task.name = nm;
    if (start !== undefined) task.start = start;
    if (finish !== undefined) task.end = finish;
    else {
      const end = endFromDuration(start, durationMs);
      if (end !== undefined) task.end = end;
    }
    if (durationMs !== undefined) task.duration = durationMs;
    if (percentText !== undefined) {
      const pc = Number(percentText);
      if (Number.isFinite(pc)) task.percentDone = Math.max(0, Math.min(1, pc / 100));
    }
    if (isSummary) task.summary = true;
    if (isMilestone) task.milestone = true;
    if (isManual) task.manuallyScheduled = true;

    // Constraint
    const ctRaw = childText(tNode, 'ConstraintType');
    if (ctRaw !== undefined && ctRaw !== '0') {
      const mapped = MS_CONSTRAINT[ctRaw];
      if (mapped) {
        task.constraintType = mapped;
        const cd = parseMsDate(childText(tNode, 'ConstraintDate'));
        if (cd !== undefined) task.constraintDate = cd;
      } else {
        warnings.push({
          code: 'unknownConstraint',
          message: `Task ${uid}: unknown ConstraintType "${ctRaw}"`,
        });
      }
    }

    // Calendar
    const calUid = childText(tNode, 'CalendarUID');
    if (calUid && calUid !== '-1') task.calendarId = calUid;

    // parent wiring via outline level
    parentAtLevel.set(outlineLevel, id);
    if (outlineLevel > 1) {
      // nearest ancestor at a shallower level
      let pl = outlineLevel - 1;
      let parent: RecordId | undefined;
      while (pl >= 1) {
        const candidate = parentAtLevel.get(pl);
        if (candidate !== undefined) {
          parent = candidate;
          break;
        }
        pl--;
      }
      if (parent !== undefined) task.parentId = parent;
    }
    // clear deeper levels (a new shallower task invalidates deeper parents)
    for (const lvl of [...parentAtLevel.keys()]) {
      if (lvl > outlineLevel) parentAtLevel.delete(lvl);
    }

    tasks.push(task);

    // Baselines on the task
    for (const bl of children(tNode, 'Baseline')) {
      const num = Number(childText(bl, 'Number') ?? '0') || 0;
      const bStart = parseMsDate(childText(bl, 'Start'));
      const bFinish = parseMsDate(childText(bl, 'Finish'));
      const bDur = parseMsDuration(childText(bl, 'Duration'), hoursPerDay);
      if (bStart === undefined && bFinish === undefined) continue;
      const map = baselineAccum.get(num) ?? new Map<RecordId, BaselineTask>();
      const s = bStart ?? task.start ?? 0;
      const e = bFinish ?? endFromDuration(s, bDur) ?? task.end ?? s;
      map.set(id, {
        taskId: id,
        start: s,
        end: e,
        duration: bDur ?? Math.max(0, e - s),
        ...(task.percentDone !== undefined ? { percentDone: task.percentDone } : {}),
      });
      baselineAccum.set(num, map);
    }

    // Dependencies (PredecessorLink) — predecessor UID is referenced.
    for (const link of children(tNode, 'PredecessorLink')) {
      const fromUid = childText(link, 'PredecessorUID');
      if (fromUid === undefined) continue;
      const typeRaw = childText(link, 'Type') ?? '1';
      const type = MS_DEP_TYPE[typeRaw];
      if (!type) {
        warnings.push({
          code: 'unknownDependencyType',
          message: `Task ${uid}: unknown PredecessorLink Type "${typeRaw}"`,
        });
      }
      // LinkLag is in tenths of a minute; LagFormat may vary but tenths-of-min is canonical.
      const lagRaw = childText(link, 'LinkLag');
      const lagTenthsMin = lagRaw ? Number(lagRaw) : 0;
      const lagMs = Number.isFinite(lagTenthsMin) ? (lagTenthsMin / 10) * MS_PER_MIN : 0;
      // stash raw link to resolve after all UIDs known
      pendingLinks.push({
        fromUid,
        toUid: uid,
        type: type ?? 'FS',
        lag: lagMs,
      });
    }
  }

  // resolve pending links now that uidToId is complete
  const dependencies: DependencyModel[] = [];
  let linkSeq = 1;
  for (const pl of pendingLinks) {
    const fromId = uidToId.get(pl.fromUid);
    const toId = uidToId.get(pl.toUid);
    if (fromId === undefined || toId === undefined) {
      warnings.push({
        code: 'missingTask',
        message: `Dependency references unknown task UID (${pl.fromUid}→${pl.toUid})`,
      });
      continue;
    }
    const dep: DependencyModel = {
      id: `dep-${linkSeq++}`,
      fromId,
      toId,
      type: pl.type,
    };
    if (pl.lag) dep.lag = pl.lag;
    dependencies.push(dep);
  }
  /* ── resources ─────────────────────────────────────────────────────── */
  const resources: ResourceModel<R>[] = [];
  const resUidToId = new Map<string, RecordId>();
  for (const rNode of children(child(root, 'Resources'), 'Resource')) {
    const uid = childText(rNode, 'UID');
    if (uid === undefined) continue;
    // MSPDI emits a phantom UID 0 placeholder resource with no name — skip it.
    const nm = childText(rNode, 'Name');
    if (uid === '0' && !nm) continue;
    const id: RecordId = childText(rNode, 'ID') ?? uid;
    resUidToId.set(uid, id);
    const res: ResourceModel<R> = {
      id,
      type: msResourceType(childText(rNode, 'Type'), childText(rNode, 'IsCostResource')),
    };
    if (nm !== undefined) res.name = nm;
    const maxUnitsRaw = childText(rNode, 'MaxUnits');
    if (maxUnitsRaw !== undefined) {
      const mu = Number(maxUnitsRaw);
      if (Number.isFinite(mu)) {
        // MSPDI MaxUnits is a fraction (1.0 = 100%); store both forms.
        res.capacity = mu;
        res.maxUnits = Math.round(mu * 100);
      }
    }
    const rateRaw = childText(rNode, 'StandardRate');
    if (rateRaw !== undefined) {
      const rate = parseFloat(rateRaw);
      if (Number.isFinite(rate)) res.hourlyCost = rate;
    }
    const calUid = childText(rNode, 'CalendarUID');
    if (calUid && calUid !== '-1') res.calendarId = calUid;
    const group = childText(rNode, 'Group');
    if (group) res.group = group;
    resources.push(res);
  }

  /* ── assignments ───────────────────────────────────────────────────── */
  const assignments: AssignmentModel[] = [];
  let asgSeq = 1;
  for (const aNode of children(child(root, 'Assignments'), 'Assignment')) {
    const taskUid = childText(aNode, 'TaskUID');
    const resUid = childText(aNode, 'ResourceUID');
    if (taskUid === undefined || resUid === undefined) continue;
    const taskId = uidToId.get(taskUid);
    const resourceId = resUidToId.get(resUid);
    if (taskId === undefined || resourceId === undefined) {
      warnings.push({
        code: 'orphanAssignment',
        message: `Assignment references unknown task/resource (${taskUid}/${resUid})`,
      });
      continue;
    }
    const unitsRaw = childText(aNode, 'Units');
    const unitsFrac = unitsRaw ? Number(unitsRaw) : 1;
    const units = Number.isFinite(unitsFrac) ? Math.round(unitsFrac * 100) : 100;
    assignments.push({
      id: childText(aNode, 'UID') ?? `asg-${asgSeq++}`,
      taskId,
      resourceId,
      units,
    });
  }

  /* ── baselines → snapshot models ───────────────────────────────────── */
  const baselines: Baseline[] = [];
  for (const [num, map] of [...baselineAccum.entries()].sort((a, b) => a[0] - b[0])) {
    baselines.push({
      id: num === 0 ? 'baseline' : `baseline-${num}`,
      name: num === 0 ? 'Baseline' : `Baseline ${num}`,
      takenAt: projectStart ?? Date.now(),
      tasks: map,
    });
  }

  const bundle: MsProjectBundle<T, R> = {
    ...(projectName !== undefined ? { name: projectName } : {}),
    ...(projectStart !== undefined ? { projectStart } : {}),
    ...(defaultCalendarId !== undefined ? { defaultCalendarId } : {}),
    tasks,
    dependencies,
    calendars,
    resources,
    assignments,
    baselines,
  };

  return { bundle, warnings };
}

/* ═══════════════════════════════════════════════════════════════════════════
   4. EXPORT  (bundle → MSPDI XML)
   ═══════════════════════════════════════════════════════════════════════════ */

/** Minutes-from-midnight → MSPDI `hh:mm:ss`. */
function minutesToTimeOfDay(minutes: number): string {
  const clamped = ((minutes % 1440) + 1440) % 1440;
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  const p = (x: number) => String(x).padStart(2, '0');
  return `${p(h)}:${p(m)}:00`;
}

function writeCalendar(w: XmlWriter, cal: CalendarModel): void {
  w.open('Calendar');
  w.leaf('UID', cal.id);
  if (cal.name) w.leaf('Name', cal.name);
  w.leaf('IsBaseCalendar', '1');
  w.leaf('IsBaselineCalendar', '0');
  w.open('WeekDays');
  // weekday rules → MSPDI DayType 1..7 (Sun..Sat)
  const ruleByWeekday = new Map<number, WeekdayRule>();
  for (const r of cal.week) ruleByWeekday.set(r.weekday, r);
  for (let d = 0; d < 7; d++) {
    const rule = ruleByWeekday.get(d);
    const intervals = rule?.intervals ?? [];
    const working = intervals.length > 0;
    w.open('WeekDay');
    w.leaf('DayType', String(d + 1));
    w.leaf('DayWorking', working);
    if (working) {
      w.open('WorkingTimes');
      for (const iv of intervals) {
        w.open('WorkingTime');
        w.leaf('FromTime', minutesToTimeOfDay(iv.from));
        w.leaf('ToTime', minutesToTimeOfDay(iv.to >= 1440 ? 0 : iv.to));
        w.close('WorkingTime');
      }
      w.close('WorkingTimes');
    }
    w.close('WeekDay');
  }
  w.close('WeekDays');
  if (cal.exceptions && cal.exceptions.length) {
    w.open('Exceptions');
    for (const ex of cal.exceptions) {
      w.open('Exception');
      if (ex.name) w.leaf('Name', ex.name);
      w.leaf('DayWorking', ex.intervals.length > 0);
      w.open('TimePeriod');
      w.leaf('FromDate', formatMsDate(ex.span.start));
      w.leaf('ToDate', formatMsDate(ex.span.end));
      w.close('TimePeriod');
      if (ex.intervals.length) {
        w.open('WorkingTimes');
        for (const iv of ex.intervals) {
          w.open('WorkingTime');
          w.leaf('FromTime', minutesToTimeOfDay(iv.from));
          w.leaf('ToTime', minutesToTimeOfDay(iv.to >= 1440 ? 0 : iv.to));
          w.close('WorkingTime');
        }
        w.close('WorkingTimes');
      }
      w.close('Exception');
    }
    w.close('Exceptions');
  }
  w.close('Calendar');
}

/**
 * Serialise a {@link MsProjectBundle} to MSPDI XML that MS Project (and every
 * MSPDI-compatible tool) can open. Deterministic, namespaced, and pretty by
 * default. Numbering: task `UID`s are stable integers assigned in array order so
 * `PredecessorLink`/`Assignment` references resolve; the original task `id` is
 * preserved as the task's `<ID>` for human readability.
 */
export function exportMsProject<T extends Model = Model, R extends Model = Model>(
  bundle: MsProjectBundle<T, R>,
  options: MsProjectExportOptions = {},
): string {
  const pretty = options.pretty ?? true;
  const hoursPerDay = options.hoursPerDay ?? DEFAULT_HOURS_PER_DAY;
  const w = new XmlWriter(pretty);

  w.raw('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>');
  w.open('Project', { xmlns: MSPDI_NS });
  w.leaf('Name', options.name ?? bundle.name ?? 'Project');
  w.leaf('Title', options.name ?? bundle.name ?? 'Project');
  if (bundle.projectStart !== undefined) {
    w.leaf('StartDate', formatMsDate(bundle.projectStart));
  }
  if (bundle.defaultCalendarId !== undefined) {
    w.leaf('CalendarUID', bundle.defaultCalendarId);
  }
  w.leaf('ScheduleFromStart', '1');
  w.leaf('DurationFormat', '7'); // hours
  w.leaf('MinutesPerDay', String(hoursPerDay * 60));
  w.leaf('MinutesPerWeek', String(hoursPerDay * 60 * 5));

  /* ── assign stable integer UIDs ────────────────────────────────────── */
  const taskUid = new Map<RecordId, number>();
  bundle.tasks.forEach((t, i) => taskUid.set(t.id, i + 1));
  const resUid = new Map<RecordId, number>();
  bundle.resources.forEach((r, i) => resUid.set(r.id, i + 1));

  // depth lookup for OutlineLevel
  const taskById = new Map<RecordId, TaskModel<T>>();
  for (const t of bundle.tasks) taskById.set(t.id, t);
  const depthOf = (t: TaskModel<T>): number => {
    let depth = 1;
    let cur: TaskModel<T> | undefined = t;
    const seen = new Set<RecordId>();
    while (cur && cur.parentId != null && !seen.has(cur.id)) {
      seen.add(cur.id);
      cur = taskById.get(cur.parentId);
      if (cur) depth++;
      else break;
    }
    return depth;
  };

  // predecessor links grouped by successor task id
  const linksByTo = new Map<RecordId, DependencyModel[]>();
  for (const dep of bundle.dependencies) {
    const arr = linksByTo.get(dep.toId) ?? [];
    arr.push(dep);
    linksByTo.set(dep.toId, arr);
  }

  // baseline lookup: taskId → array of {num, snapshot}
  const baselinesByTask = new Map<RecordId, Array<{ num: number; snap: BaselineTask }>>();
  bundle.baselines.forEach((b, idx) => {
    const num = /baseline-(\d+)/.exec(b.id)?.[1] ?? (b.id === 'baseline' ? '0' : String(idx));
    const numN = Number(num) || 0;
    for (const [tid, snap] of b.tasks) {
      const arr = baselinesByTask.get(tid) ?? [];
      arr.push({ num: numN, snap });
      baselinesByTask.set(tid, arr);
    }
  });

  /* ── calendars ─────────────────────────────────────────────────────── */
  w.open('Calendars');
  for (const cal of bundle.calendars) writeCalendar(w, cal);
  w.close('Calendars');

  /* ── tasks ─────────────────────────────────────────────────────────── */
  w.open('Tasks');
  bundle.tasks.forEach((t) => {
    const uid = taskUid.get(t.id)!;
    w.open('Task');
    w.leaf('UID', uid);
    w.leaf('ID', String(t.id));
    if (t.name !== undefined) w.leaf('Name', t.name);
    w.leaf('OutlineLevel', depthOf(t));
    w.leaf('Summary', !!t.summary);
    w.leaf('Milestone', !!t.milestone);
    if (t.manuallyScheduled) w.leaf('Manual', '1');
    if (t.start !== undefined) w.leaf('Start', formatMsDate(t.start));
    if (t.end !== undefined) w.leaf('Finish', formatMsDate(t.end));
    if (t.duration !== undefined) {
      w.leaf('Duration', formatMsDuration(t.duration));
      w.leaf('DurationFormat', '7');
    } else if (t.start !== undefined && t.end !== undefined) {
      w.leaf('Duration', formatMsDuration(t.end - t.start));
    }
    if (t.percentDone !== undefined) {
      w.leaf('PercentComplete', Math.round(t.percentDone * 100));
    }
    if (t.constraintType) {
      w.leaf('ConstraintType', CONSTRAINT_MS[t.constraintType]);
      if (t.constraintDate !== undefined) {
        w.leaf('ConstraintDate', formatMsDate(t.constraintDate));
      }
    } else {
      w.leaf('ConstraintType', '0');
    }
    if (t.calendarId !== undefined) w.leaf('CalendarUID', t.calendarId);

    // predecessor links
    for (const dep of linksByTo.get(t.id) ?? []) {
      const predUid = taskUid.get(dep.fromId);
      if (predUid === undefined) continue;
      w.open('PredecessorLink');
      w.leaf('PredecessorUID', predUid);
      w.leaf('Type', DEP_TYPE_MS[dep.type ?? 'FS']);
      if (dep.lag) {
        // ms → tenths of a minute
        w.leaf('LinkLag', String(Math.round((dep.lag / MS_PER_MIN) * 10)));
        w.leaf('LagFormat', '7');
      }
      w.close('PredecessorLink');
    }

    // baselines
    for (const { num, snap } of baselinesByTask.get(t.id) ?? []) {
      w.open('Baseline');
      w.leaf('Number', num);
      w.leaf('Start', formatMsDate(snap.start));
      w.leaf('Finish', formatMsDate(snap.end));
      w.leaf('Duration', formatMsDuration(snap.duration));
      w.close('Baseline');
    }

    w.close('Task');
  });
  w.close('Tasks');

  /* ── resources ─────────────────────────────────────────────────────── */
  w.open('Resources');
  bundle.resources.forEach((r) => {
    const uid = resUid.get(r.id)!;
    const { type, cost } = resourceTypeMs(r.type);
    w.open('Resource');
    w.leaf('UID', uid);
    w.leaf('ID', String(r.id));
    if (r.name !== undefined) w.leaf('Name', r.name);
    w.leaf('Type', type);
    w.leaf('IsCostResource', cost);
    if (r.maxUnits !== undefined) w.leaf('MaxUnits', (r.maxUnits / 100).toFixed(2));
    else if (r.capacity !== undefined) w.leaf('MaxUnits', r.capacity.toFixed(2));
    if (r.hourlyCost !== undefined) w.leaf('StandardRate', String(r.hourlyCost));
    if (r.calendarId !== undefined) w.leaf('CalendarUID', r.calendarId);
    if (r.group !== undefined) w.leaf('Group', r.group);
    w.close('Resource');
  });
  w.close('Resources');

  /* ── assignments ───────────────────────────────────────────────────── */
  w.open('Assignments');
  bundle.assignments.forEach((a, i) => {
    const tUid = taskUid.get(a.taskId);
    const rUid = resUid.get(a.resourceId);
    if (tUid === undefined || rUid === undefined) return;
    w.open('Assignment');
    w.leaf('UID', String(a.id ?? i + 1));
    w.leaf('TaskUID', tUid);
    w.leaf('ResourceUID', rUid);
    w.leaf('Units', ((a.units ?? 100) / 100).toFixed(2));
    w.close('Assignment');
  });
  w.close('Assignments');

  w.close('Project');
  return w.toString();
}

/* ═══════════════════════════════════════════════════════════════════════════
   5. CONVENIENCE: round-trip + bundle-from-Gantt helpers
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Detect whether a string looks like a `.mpp` binary (OLE2 compound file) rather
 * than MSPDI XML. The native `.mpp` magic bytes are `D0 CF 11 E0`. We surface a
 * clear error rather than silently failing, since binary `.mpp` requires a
 * separate (heavyweight) reader that this codec intentionally does not bundle.
 */
export function isBinaryMpp(data: string | Uint8Array): boolean {
  if (typeof data === 'string') {
    return (
      data.charCodeAt(0) === 0xd0 &&
      data.charCodeAt(1) === 0xcf &&
      data.charCodeAt(2) === 0x11 &&
      data.charCodeAt(3) === 0xe0
    );
  }
  return data[0] === 0xd0 && data[1] === 0xcf && data[2] === 0x11 && data[3] === 0xe0;
}

/**
 * Import either MSPDI XML or a binary `.mpp`. Binary `.mpp` is rejected with a
 * descriptive error (it is a proprietary OLE2 container — re-export from MS
 * Project as XML, or use a dedicated `.mpp` reader). XML imports normally.
 */
export function importMsProjectFile<T extends Model = Model, R extends Model = Model>(
  data: string,
  options?: MsProjectImportOptions,
): MsProjectImportResult<T, R> {
  if (isBinaryMpp(data)) {
    throw new Error(
      'Binary .mpp (OLE2 compound file) is not supported directly — re-export from ' +
        'MS Project as XML (Save As → XML) to import via MSPDI.',
    );
  }
  return importMsProject<T, R>(data, options);
}
