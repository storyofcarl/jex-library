/**
 * @jects/gantt — MS Project (MSPDI) interop types & shared codecs.
 *
 * This module freezes the typed surface for the Microsoft Project XML
 * (MSPDI — "Microsoft Project Data Interchange") import/export feature and the
 * small, pure codecs both the reader and writer share. It builds NO DOM and
 * holds NO runtime engine state — it is the data-mapping seam between an MSPDI
 * document and the `@jects/gantt` engine model
 * (`TaskModel`/`DependencyModel`/`CalendarModel`/`ResourceModel`/`AssignmentModel`).
 *
 * MSPDI background (the bits we map):
 *   - Times are local ISO-8601 (`2026-01-05T08:00:00`, no zone). We treat them as
 *     UTC epoch-ms, matching the engine contract's "epoch ms (UTC)" convention.
 *   - Durations are ISO-8601 *working-time* spans (`PT8H0M0S`) measured against the
 *     project's minutes-per-day / minutes-per-week, NOT wall-clock. The engine's
 *     `duration` is working ms, so the conversion is a pure unit change.
 *   - Enumerations (dependency `Type`, `ConstraintType`, calendar `DayType`,
 *     resource `Type`) are small integer codes; the maps below are the single
 *     source of truth for both directions.
 */

import type { Model, RecordId } from '@jects/core';
import type {
  CalendarModel,
  ConstraintType,
  DependencyModel,
  DependencyType,
  TaskModel,
} from '../contract.js';
import type {
  AssignmentModel,
  ResourceModel,
  ResourceType,
} from '../resource/resource-contract.js';

/* ═══════════════════════════════════════════════════════════════════════════
   1. CONSTANTS
   ═══════════════════════════════════════════════════════════════════════════ */

export const MS_PER_MINUTE = 60_000;
export const MS_PER_HOUR = 3_600_000;
/** MSPDI default working minutes per day (MS Project default = 480 = 8h). */
export const DEFAULT_MINUTES_PER_DAY = 480;
/** MSPDI default working minutes per week (MS Project default = 2400 = 40h). */
export const DEFAULT_MINUTES_PER_WEEK = 2400;
/** MSPDI default working days per month. */
export const DEFAULT_DAYS_PER_MONTH = 20;

/** The MSPDI XML namespace every `<Project>` document declares. */
export const MSPDI_NAMESPACE = 'http://schemas.microsoft.com/project';

/* ═══════════════════════════════════════════════════════════════════════════
   2. ENUM CODE MAPS (single source of truth, both directions)
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * MSPDI `PredecessorLink/Type` codes → engine `DependencyType`.
 *   0 = Finish-Finish · 1 = Finish-Start · 2 = Start-Finish · 3 = Start-Start.
 * (MS Project's ordering is FF/FS/SF/SS — note it is NOT the obvious order.)
 */
export const MSP_DEP_TYPE_TO_ENGINE: Readonly<Record<number, DependencyType>> = {
  0: 'FF',
  1: 'FS',
  2: 'SF',
  3: 'SS',
};

/** Engine `DependencyType` → MSPDI `Type` code (inverse of the above). */
export const ENGINE_DEP_TYPE_TO_MSP: Readonly<Record<DependencyType, number>> = {
  FF: 0,
  FS: 1,
  SF: 2,
  SS: 3,
};

/**
 * MSPDI `Task/ConstraintType` codes → engine `ConstraintType`.
 *   0 ASAP · 1 ALAP · 2 MustStartOn · 3 MustFinishOn · 4 StartNoEarlierThan ·
 *   5 StartNoLaterThan · 6 FinishNoEarlierThan · 7 FinishNoLaterThan.
 */
export const MSP_CONSTRAINT_TO_ENGINE: Readonly<Record<number, ConstraintType>> = {
  0: 'asSoonAsPossible',
  1: 'asLateAsPossible',
  2: 'mustStartOn',
  3: 'mustFinishOn',
  4: 'startNoEarlierThan',
  5: 'startNoLaterThan',
  6: 'finishNoEarlierThan',
  7: 'finishNoLaterThan',
};

/** Engine `ConstraintType` → MSPDI `ConstraintType` code (inverse). */
export const ENGINE_CONSTRAINT_TO_MSP: Readonly<Record<ConstraintType, number>> = {
  asSoonAsPossible: 0,
  asLateAsPossible: 1,
  mustStartOn: 2,
  mustFinishOn: 3,
  startNoEarlierThan: 4,
  startNoLaterThan: 5,
  finishNoEarlierThan: 6,
  finishNoLaterThan: 7,
};

/**
 * MSPDI `Resource/Type` codes → engine `ResourceType`.
 *   0 = material · 1 = work · 2 = cost. (`equipment` has no MSP code; it maps to
 *   `material` on export, the closest MSP kind.)
 */
export const MSP_RESOURCE_TYPE_TO_ENGINE: Readonly<Record<number, ResourceType>> = {
  0: 'material',
  1: 'work',
  2: 'cost',
};

/** Engine `ResourceType` → MSPDI `Type` code (inverse; `equipment`→material). */
export const ENGINE_RESOURCE_TYPE_TO_MSP: Readonly<Record<ResourceType, number>> = {
  material: 0,
  work: 1,
  cost: 2,
  equipment: 0,
};

/** MSPDI `WeekDay/DayType` (1=Sunday … 7=Saturday) → engine weekday (0=Sun…6=Sat). */
export function dayTypeToWeekday(dayType: number): number {
  // DayType 1..7 == Sunday..Saturday; engine weekday 0..6 == Sunday..Saturday.
  return dayType - 1;
}

/** Engine weekday (0=Sun…6=Sat) → MSPDI `DayType` (1=Sunday…7=Saturday). */
export function weekdayToDayType(weekday: number): number {
  return weekday + 1;
}

/* ═══════════════════════════════════════════════════════════════════════════
   3. PUBLIC OPTION / RESULT TYPES
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * The engine-model project payload an MSPDI document maps to (or is built from).
 * This is the lingua franca between the reader, the writer, and the Gantt engine:
 * exactly the four model collections the scheduling + resource contracts define,
 * plus per-task baseline snapshots and the project anchor/calendar metadata.
 *
 * It is intentionally a plain data bag (no class, no DOM) so it round-trips and
 * can be fed straight into `SchedulingEngine.setTasks/setDependencies/...` and the
 * resource stores.
 */
export interface MspProject<
  T extends Model = Model,
  R extends Model = Model,
> {
  /** Project display name (MSPDI `<Name>` / `<Title>`). */
  name?: string;
  /** Project start anchor (epoch ms) — MSPDI `<StartDate>`. */
  projectStart?: number;
  /** Project finish anchor (epoch ms) — MSPDI `<FinishDate>`. */
  projectEnd?: number;
  /** Project default calendar id — MSPDI `<CalendarUID>` resolved to a name/id. */
  defaultCalendarId?: string;
  /** Working minutes/day used for ISO-duration ⇄ working-ms conversion. */
  minutesPerDay: number;
  /** Working minutes/week used for week-grained durations. */
  minutesPerWeek: number;
  /** Working days/month used for month-grained durations. */
  daysPerMonth: number;
  /** Flat task list (tree via `parentId`). */
  tasks: TaskModel<T>[];
  /** Dependency links. */
  dependencies: DependencyModel[];
  /** Working calendars. */
  calendars: CalendarModel[];
  /** Resources (people / equipment / material / cost). */
  resources: ResourceModel<R>[];
  /** Task↔resource assignments. */
  assignments: AssignmentModel[];
  /**
   * Per-task baseline snapshots, keyed by MSP baseline number (0..10). Each value
   * maps a task id to its snapshotted start/end/duration/work. Built into engine
   * `Baseline`s by `toBaselines()`.
   */
  baselines: Map<number, Map<RecordId, MspBaselineTask>>;
}

/** A baseline snapshot for one task at one MSP baseline number. */
export interface MspBaselineTask {
  taskId: RecordId;
  start: number;
  end: number;
  /** Working-ms duration. */
  duration: number;
  percentDone?: number;
}

/** A non-fatal diagnostic surfaced during import or export. */
export interface MspDiagnostic {
  /** Severity. `warning` = lossy/assumed; `error` = a record was dropped. */
  level: 'warning' | 'error';
  /** Stable machine code. */
  code: MspDiagnosticCode;
  /** Human-readable detail. */
  message: string;
  /** The offending record id, when applicable. */
  ref?: string | number;
}

export type MspDiagnosticCode =
  | 'malformedXml'
  | 'missingRoot'
  | 'unknownNamespace'
  | 'taskMissingUid'
  | 'unparsableDate'
  | 'unparsableDuration'
  | 'danglingPredecessor'
  | 'danglingAssignmentTask'
  | 'danglingAssignmentResource'
  | 'unknownConstraintCode'
  | 'unknownDependencyCode'
  | 'binaryMppUnsupported'
  | 'cyclicCalendarBase';

/** Options controlling the MSPDI reader. */
export interface MspImportOptions {
  /**
   * How `null`/unknown enum codes are handled. `lenient` (default) substitutes the
   * documented default and records a `warning`; `strict` records an `error` and
   * drops the offending field.
   */
  mode?: 'lenient' | 'strict';
  /**
   * When `true` (default), MSPDI outline/summary tasks (those with `<Summary>1`)
   * keep their `summary` flag; the engine still derives summaries from the tree.
   */
  preserveSummaryFlag?: boolean;
}

/** The result of importing an MSPDI document. */
export interface MspImportResult<
  T extends Model = Model,
  R extends Model = Model,
> {
  /** The mapped engine-model project (empty collections on a fatal parse error). */
  project: MspProject<T, R>;
  /** Whether the parse produced a usable project (false on a fatal error). */
  ok: boolean;
  /** Non-fatal warnings + any fatal error. */
  diagnostics: MspDiagnostic[];
}

/** Options controlling the MSPDI writer. */
export interface MspExportOptions {
  /** Pretty-print the XML with 2-space indents. Default `true`. */
  pretty?: boolean;
  /** Project `<Name>` to stamp (defaults to the project's name or `'Project'`). */
  name?: string;
  /**
   * MSPDI `<SaveVersion>`. Default `14` (Project 2010+), the most widely importable.
   */
  saveVersion?: number;
}

/* ═══════════════════════════════════════════════════════════════════════════
   4. SHARED CODECS (pure; used by both reader and writer)
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Parse an MSPDI ISO-8601 local datetime (`2026-01-05T08:00:00`) to epoch ms,
 * interpreting it as UTC (the engine convention). Returns `undefined` for empty
 * or unparsable input. Accepts an optional trailing `Z` (treated identically).
 */
export function parseMspDate(text: string | null | undefined): number | undefined {
  if (text == null) return undefined;
  const t = text.trim();
  if (t === '') return undefined;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?Z?$/.exec(t);
  if (!m) return undefined;
  const [, y, mo, d, h, mi, s] = m as unknown as [string, string, string, string, string, string, string];
  const ms = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s);
  return Number.isNaN(ms) ? undefined : ms;
}

/** Two-digit zero-pad. */
function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * Format an epoch-ms instant as an MSPDI ISO-8601 local datetime (no zone), e.g.
 * `2026-01-05T08:00:00`. Treats the instant as UTC (engine convention).
 */
export function formatMspDate(ms: number): string {
  const d = new Date(ms);
  return (
    `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}` +
    `T${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`
  );
}

/**
 * Parse an MSPDI ISO-8601 *duration* (`PT8H30M0S`, `P2DT4H`, `PT0S`) to working
 * **ms**. MSPDI durations carry hour/minute/second components directly (they are
 * already working time), and may carry day/week/month components that the project
 * minutes-per-day / minutes-per-week / days-per-month convert to working time.
 *
 * @param text   the ISO duration string.
 * @param cal    project working-time granularity for D/W/M components.
 * @returns working ms, or `undefined` if the string is not a valid ISO duration.
 */
export function parseMspDuration(
  text: string | null | undefined,
  cal: { minutesPerDay: number; minutesPerWeek: number; daysPerMonth: number },
): number | undefined {
  if (text == null) return undefined;
  const t = text.trim();
  if (t === '') return undefined;
  // ISO 8601: P[nY][nM_month][nW][nD]T[nH][nM_min][nS]. MSPDI uses W/D/H/M/S.
  const m =
    /^P(?:(\d+(?:\.\d+)?)Y)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)W)?(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(
      t,
    );
  if (!m) return undefined;
  const [, yy, mm, ww, dd, hh, min, ss] = m;
  // No component at all (bare "P" / "PT") is invalid.
  if (![yy, mm, ww, dd, hh, min, ss].some((v) => v !== undefined)) return undefined;
  const minPerDay = cal.minutesPerDay || DEFAULT_MINUTES_PER_DAY;
  const minPerWeek = cal.minutesPerWeek || DEFAULT_MINUTES_PER_WEEK;
  const daysPerMonth = cal.daysPerMonth || DEFAULT_DAYS_PER_MONTH;
  let ms = 0;
  if (yy) ms += +yy * 12 * daysPerMonth * minPerDay * MS_PER_MINUTE;
  if (mm) ms += +mm * daysPerMonth * minPerDay * MS_PER_MINUTE;
  if (ww) ms += +ww * minPerWeek * MS_PER_MINUTE;
  if (dd) ms += +dd * minPerDay * MS_PER_MINUTE;
  if (hh) ms += +hh * MS_PER_HOUR;
  if (min) ms += +min * MS_PER_MINUTE;
  if (ss) ms += +ss * 1000;
  return ms;
}

/**
 * Format working **ms** as an MSPDI ISO-8601 duration. Emits the compact
 * `PT{H}H{M}M{S}S` hour/minute/second form MS Project always accepts (it
 * re-buckets to days using minutes-per-day on import). Zero ⇒ `PT0H0M0S`.
 */
export function formatMspDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const min = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `PT${h}H${min}M${s}S`;
}

/**
 * MSPDI `DurationFormat` code for a duration, used so MS Project displays the
 * value in sensible units. We always emit elapsed-minutes-friendly values, so
 * `7` (minutes) is the safe, lossless default; callers may override.
 */
export const MSP_DURATION_FORMAT_MINUTES = 7;
/** `DurationFormat` 53 = "hours" — used when emitting whole-hour durations. */
export const MSP_DURATION_FORMAT_HOURS = 53;

/** Clamp a percent 0..100 from a `percentDone` 0..1 fraction. */
export function fractionToPercent(fraction: number | undefined): number {
  if (fraction == null || Number.isNaN(fraction)) return 0;
  return Math.max(0, Math.min(100, Math.round(fraction * 100)));
}

/** Convert an MSP 0..100 percent to a 0..1 fraction. */
export function percentToFraction(percent: number | undefined): number {
  if (percent == null || Number.isNaN(percent)) return 0;
  return Math.max(0, Math.min(1, percent / 100));
}

/** XML-escape a text value for safe insertion into an element body / attribute. */
export function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
