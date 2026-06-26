/**
 * `dependency-notation` — the pure, framework-free parser/serializer for the
 * Bryntum/DHTMLX **predecessors / successors notation** used by the editable
 * dependency columns.
 *
 * Notation (one term per linked task, comma- or semicolon-separated):
 *
 *     <taskRef>[<type>][<lag>]
 *
 *   - `<taskRef>` — the OTHER task's identifier as shown in the grid (its id, or
 *     a WBS/row label when a `resolveRef` is supplied). For a Predecessors cell
 *     the term names the PREDECESSOR; for a Successors cell it names the
 *     SUCCESSOR.
 *   - `<type>`   — optional dependency type `FS` | `SS` | `FF` | `SF`
 *     (case-insensitive). Omitted ⇒ `FS` (the default), matching Bryntum.
 *   - `<lag>`    — optional signed lag/lead, e.g. `+1d`, `-2d`, `+3h`, `1w`.
 *     A bare sign-less number is treated as positive. Unit suffix one of
 *     `d` (day), `h` (hour), `w` (week, 5 working days), `m`/`mo` (month, 20
 *     working days). Omitted unit ⇒ days. Omitted lag ⇒ 0.
 *
 * Examples (Predecessors cell of task X):  `2`, `2FS`, `3SS+1d`, `5FF-2d, 6`.
 *
 * The module is DOM-free and self-contained so it is unit-testable without any
 * widget mount and reusable by both the grid columns and the inline editor.
 */

import type { RecordId } from '@jects/core';
import type { DependencyType } from '../contract.js';

/** Milliseconds in one calendar day (lag is expressed in working-ish day units). */
const MS_PER_DAY = 86_400_000;
const MS_PER_HOUR = 3_600_000;
/** A working week / month, in days, for the `w` / `m` lag suffixes. */
const DAYS_PER_WEEK = 5;
const DAYS_PER_MONTH = 20;

/** The recognised dependency types, upper-cased. */
const DEP_TYPES: readonly DependencyType[] = ['FS', 'SS', 'FF', 'SF'];

/** A single parsed dependency term from a notation string. */
export interface ParsedDependencyTerm {
  /** The referenced task id (already resolved through `resolveRef`). */
  ref: RecordId;
  /** The raw, untrimmed reference token as typed (for echo / error messages). */
  rawRef: string;
  /** Dependency type; defaults to `'FS'` when not written. */
  type: DependencyType;
  /** Lag (+) / lead (−) in milliseconds. */
  lag: number;
}

/** A term the parser could not resolve, with a human-readable reason. */
export interface DependencyParseError {
  /** The offending term text. */
  term: string;
  /** Machine-readable reason. */
  reason: 'emptyRef' | 'unknownType' | 'badLag' | 'unknownRef' | 'selfRef' | 'duplicate';
  /** Human-readable message. */
  message: string;
}

/** The full result of parsing a notation string. */
export interface DependencyParseResult {
  /** Successfully parsed terms (in source order, de-duplicated by ref+type). */
  terms: ParsedDependencyTerm[];
  /** Terms that failed to parse/resolve. */
  errors: DependencyParseError[];
}

/** Options for {@link parseDependencyNotation}. */
export interface ParseOptions {
  /**
   * Resolve a typed reference token to a real task id (e.g. WBS `1.2` → `t5`).
   * Return `undefined` to reject the token as an unknown task. When omitted the
   * token is used verbatim as the id (string), and numeric-looking tokens are
   * coerced to numbers so they match numeric task ids.
   */
  resolveRef?(token: string): RecordId | undefined;
  /** The id of the task whose cell is being edited, to reject self-references. */
  selfId?: RecordId;
  /** Working hours per day for the `h` lag suffix → day fraction. Default 24. */
  hoursPerDay?: number;
}

/** Options for {@link serializeDependencyTerms} / the cell formatters. */
export interface SerializeOptions {
  /**
   * Render a task id back to its display token (inverse of `resolveRef`). When
   * omitted the id is stringified.
   */
  refToToken?(id: RecordId): string;
  /** Working hours per day for emitting an `h` suffix on sub-day lags. Default 24. */
  hoursPerDay?: number;
  /** Separator between terms. Default `', '`. */
  separator?: string;
}

/** Coerce a raw token into a {@link RecordId}, preferring numbers when numeric. */
function tokenToId(token: string): RecordId {
  const t = token.trim();
  // A purely numeric token becomes a number so it matches numeric task ids.
  if (t !== '' && /^-?\d+$/.test(t)) return Number(t);
  return t;
}

/**
 * Parse a lag fragment like `+1d`, `-2h`, `3`, `1w`, `2mo` into milliseconds.
 * Returns `null` when the fragment is malformed.
 */
export function parseLag(fragment: string, hoursPerDay = 24): number | null {
  const f = fragment.trim();
  if (f === '') return 0;
  const m = /^([+-]?)(\d+(?:\.\d+)?)\s*(d|day|days|h|hr|hrs|hour|hours|w|wk|week|weeks|mo|mon|month|months|m)?$/i.exec(
    f,
  );
  if (!m) return null;
  const sign = m[1] === '-' ? -1 : 1;
  const value = Number(m[2]);
  if (!Number.isFinite(value)) return null;
  const unit = (m[3] ?? 'd').toLowerCase();
  let ms: number;
  if (unit.startsWith('h')) {
    // Hours scale relative to the working day so `8h` on an 8h/day calendar = 1d.
    ms = (value / Math.max(1, hoursPerDay)) * MS_PER_DAY;
    // But when hoursPerDay is the default 24, an `h` is a real wall-clock hour.
    if (hoursPerDay === 24) ms = value * MS_PER_HOUR;
  } else if (unit.startsWith('w')) {
    ms = value * DAYS_PER_WEEK * MS_PER_DAY;
  } else if (unit === 'mo' || unit === 'mon' || unit.startsWith('month') || unit === 'm') {
    ms = value * DAYS_PER_MONTH * MS_PER_DAY;
  } else {
    ms = value * MS_PER_DAY;
  }
  return sign * ms;
}

/**
 * Split a single term `2FS+1d` into `{ refToken, type, lagFragment }`. The split
 * is greedy on a trailing type token and a trailing signed-lag fragment, leaving
 * everything before them as the reference token (so WBS refs like `1.2` survive).
 */
function splitTerm(term: string): { refToken: string; typeToken: string; lagFragment: string } {
  let rest = term.trim();
  let lagFragment = '';
  let typeToken = '';

  // Trailing lag: a signed/unsigned number with optional unit at the very end.
  const lagMatch = /([+-]\s*\d+(?:\.\d+)?\s*(?:d|day|days|h|hr|hrs|hour|hours|w|wk|week|weeks|mo|mon|month|months|m)?)$/i.exec(
    rest,
  );
  if (lagMatch) {
    lagFragment = lagMatch[1]!.replace(/\s+/g, '');
    rest = rest.slice(0, rest.length - lagMatch[0].length).trim();
  }

  // Trailing type token (FS/SS/FF/SF), case-insensitive.
  const typeMatch = /(FS|SS|FF|SF)$/i.exec(rest);
  if (typeMatch) {
    typeToken = typeMatch[1]!.toUpperCase();
    rest = rest.slice(0, rest.length - typeMatch[0].length).trim();
  }

  return { refToken: rest, typeToken, lagFragment };
}

/**
 * Parse a full predecessors/successors notation string into typed terms plus a
 * list of per-term errors (so the UI can show partial success + validation).
 */
export function parseDependencyNotation(
  input: string,
  options: ParseOptions = {},
): DependencyParseResult {
  const terms: ParsedDependencyTerm[] = [];
  const errors: DependencyParseError[] = [];
  const seen = new Set<string>();
  const hoursPerDay = options.hoursPerDay ?? 24;

  const rawTerms = input
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  for (const raw of rawTerms) {
    const { refToken, typeToken, lagFragment } = splitTerm(raw);
    if (refToken === '') {
      errors.push({ term: raw, reason: 'emptyRef', message: `Missing task reference in "${raw}".` });
      continue;
    }

    const type = (typeToken || 'FS') as DependencyType;
    if (!DEP_TYPES.includes(type)) {
      errors.push({ term: raw, reason: 'unknownType', message: `Unknown link type in "${raw}".` });
      continue;
    }

    const lag = parseLag(lagFragment, hoursPerDay);
    if (lag === null) {
      errors.push({ term: raw, reason: 'badLag', message: `Invalid lag "${lagFragment}" in "${raw}".` });
      continue;
    }

    const ref = options.resolveRef ? options.resolveRef(refToken) : tokenToId(refToken);
    if (ref === undefined || ref === null || ref === '') {
      errors.push({ term: raw, reason: 'unknownRef', message: `Unknown task "${refToken}".` });
      continue;
    }

    if (options.selfId !== undefined && String(ref) === String(options.selfId)) {
      errors.push({ term: raw, reason: 'selfRef', message: `A task cannot depend on itself ("${refToken}").` });
      continue;
    }

    const key = `${String(ref)}|${type}`;
    if (seen.has(key)) {
      errors.push({ term: raw, reason: 'duplicate', message: `Duplicate link to "${refToken}" (${type}).` });
      continue;
    }
    seen.add(key);
    terms.push({ ref, rawRef: refToken, type, lag });
  }

  return { terms, errors };
}

/** Format a single lag value (ms) into a notation suffix like `+1d` / `-2h`. */
export function formatLag(lag: number | undefined, hoursPerDay = 24): string {
  if (!lag) return '';
  const sign = lag >= 0 ? '+' : '-';
  const abs = Math.abs(lag);
  // Prefer whole-day output; fall back to hours for sub-day lags.
  if (abs % MS_PER_DAY === 0) return `${sign}${abs / MS_PER_DAY}d`;
  if (hoursPerDay === 24 && abs % MS_PER_HOUR === 0) return `${sign}${abs / MS_PER_HOUR}h`;
  const days = abs / MS_PER_DAY;
  // Two-decimal day fraction, trimmed.
  return `${sign}${Number(days.toFixed(2))}d`;
}

/** Format one term `{ ref, type, lag }` back to notation (`2`, `3SS+1d`, …). */
export function serializeDependencyTerm(
  term: { ref: RecordId; type?: DependencyType; lag?: number },
  options: SerializeOptions = {},
): string {
  const token = options.refToToken ? options.refToToken(term.ref) : String(term.ref);
  const type = term.type && term.type !== 'FS' ? term.type : '';
  const lag = formatLag(term.lag, options.hoursPerDay ?? 24);
  return `${token}${type}${lag}`;
}

/** Serialize a list of terms into a `, `-joined notation string. */
export function serializeDependencyTerms(
  terms: ReadonlyArray<{ ref: RecordId; type?: DependencyType; lag?: number }>,
  options: SerializeOptions = {},
): string {
  const sep = options.separator ?? ', ';
  return terms.map((t) => serializeDependencyTerm(t, options)).join(sep);
}

/**
 * Diff a desired set of terms against the existing links, producing the minimal
 * add/remove edits to reconcile them. Existing links are keyed by `ref+type`;
 * a lag change on an existing key is emitted as a remove+add pair (links are
 * immutable in the engine, so a lag edit is a replace).
 *
 * @param desired  Parsed terms the user wants the cell to contain.
 * @param existing The current links for this cell's side, each with its link id.
 * @returns `{ toAdd, toRemove }` — `toAdd` carries the term + nothing else;
 *          `toRemove` carries the link ids to drop.
 */
export function diffDependencyTerms(
  desired: ReadonlyArray<ParsedDependencyTerm>,
  existing: ReadonlyArray<{ id: RecordId; ref: RecordId; type: DependencyType; lag: number }>,
): {
  toAdd: ParsedDependencyTerm[];
  toRemove: RecordId[];
} {
  const desiredByKey = new Map<string, ParsedDependencyTerm>();
  for (const t of desired) desiredByKey.set(`${String(t.ref)}|${t.type}`, t);

  const existingByKey = new Map<string, { id: RecordId; lag: number }>();
  for (const e of existing) existingByKey.set(`${String(e.ref)}|${e.type}`, { id: e.id, lag: e.lag });

  const toAdd: ParsedDependencyTerm[] = [];
  const toRemove: RecordId[] = [];

  // Removals: existing keys not desired, or desired with a changed lag.
  for (const e of existing) {
    const key = `${String(e.ref)}|${e.type}`;
    const want = desiredByKey.get(key);
    if (!want || want.lag !== e.lag) toRemove.push(e.id);
  }
  // Additions: desired keys not already present with the same lag.
  for (const t of desired) {
    const key = `${String(t.ref)}|${t.type}`;
    const have = existingByKey.get(key);
    if (!have || have.lag !== t.lag) toAdd.push(t);
  }

  return { toAdd, toRemove };
}
