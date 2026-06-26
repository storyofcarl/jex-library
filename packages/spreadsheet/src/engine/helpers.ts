/**
 * Shared runtime helpers for the function library: argument flattening, range
 * iteration, criteria matching (SUMIF/COUNTIF/*IFS), wildcard matching, and
 * comparison/equality used by lookups and logical comparisons.
 */

import type { CellValue } from '../contract.js';
import { ERR, isBlank, isError, toNumber, toText } from './errors.js';

/** An argument is either a scalar value or a 2D array (a range/array result). */
export type FnArg = CellValue | CellValue[][];

/** Re-exported so the function library can format values uniformly. */
export { toText };

/** Is this argument a 2D array (range / array literal)? */
export function isMatrix(a: FnArg | undefined): a is CellValue[][] {
  return Array.isArray(a);
}

/** Flatten all arguments (scalars + matrices) into a single value list. */
export function flatten(args: ReadonlyArray<FnArg | undefined>): CellValue[] {
  const out: CellValue[] = [];
  for (const a of args) {
    if (isMatrix(a)) {
      for (const row of a) for (const v of row) out.push(v ?? null);
    } else {
      out.push(a ?? null);
    }
  }
  return out;
}

/** Flatten into numbers only (ignoring blanks/text/booleans like Excel SUM). */
export function flattenNumbers(
  args: ReadonlyArray<FnArg | undefined>,
  opts?: { includeBooleans?: boolean; includeText?: boolean },
): number[] | { error: ReturnType<typeof toNumber> } {
  const out: number[] = [];
  for (const a of args) {
    if (isMatrix(a)) {
      for (const row of a) {
        for (const v of row) {
          if (isError(v)) return { error: v };
          if (typeof v === 'number') out.push(v);
          else if (v instanceof Date) out.push(toNumber(v) as number);
          else if (typeof v === 'boolean' && opts?.includeBooleans) out.push(v ? 1 : 0);
          // Text and blanks inside ranges are ignored by SUM-like functions.
        }
      }
    } else {
      // Scalar argument: coerce (text numbers count).
      if (isError(a)) return { error: a };
      if (isBlank(a ?? null)) continue;
      if (typeof a === 'boolean') {
        out.push(a ? 1 : 0);
        continue;
      }
      const n = toNumber(a as CellValue);
      if (isError(n)) {
        if (opts?.includeText) continue;
        return { error: n };
      }
      out.push(n);
    }
  }
  return out;
}

/** Coerce a single FnArg expected to be a scalar (top-left of a 1x1 matrix). */
export function asScalar(a: FnArg | undefined): CellValue {
  if (isMatrix(a)) return a[0]?.[0] ?? null;
  return a ?? null;
}

/** Loose equality used by `=`/lookups: case-insensitive text, numeric, etc. */
export function looseEquals(a: CellValue, b: CellValue): boolean {
  if (isError(a) || isError(b)) return false;
  const aBlank = isBlank(a);
  const bBlank = isBlank(b);
  if (aBlank && bBlank) return true;
  if (aBlank !== bBlank) {
    // Blank equals 0 or "" in Excel comparisons.
    const other = aBlank ? b : a;
    if (other === 0 || other === '') return true;
    return false;
  }
  if (typeof a === 'number' || typeof b === 'number' || a instanceof Date || b instanceof Date) {
    const na = toNumber(a);
    const nb = toNumber(b);
    if (!isError(na) && !isError(nb)) return na === nb;
  }
  if (typeof a === 'boolean' || typeof b === 'boolean') {
    return Boolean(a) === Boolean(b) && typeof a === typeof b
      ? a === b
      : String(a).toUpperCase() === String(b).toUpperCase();
  }
  return toText(a).toUpperCase() === toText(b).toUpperCase();
}

/**
 * Ordered comparison used by `<`,`>` and binary-search lookups. Returns negative
 * if a<b, 0 if equal, positive if a>b. Numbers sort before text before booleans
 * (Excel ordering), matching for like types.
 */
export function compareValues(a: CellValue, b: CellValue): number {
  const ra = rankType(a);
  const rb = rankType(b);
  if (ra !== rb) return ra - rb;
  if (ra === 0) {
    // numbers / dates
    const na = toNumber(a) as number;
    const nb = toNumber(b) as number;
    return na === nb ? 0 : na < nb ? -1 : 1;
  }
  if (ra === 1) {
    // text (case-insensitive)
    const ta = toText(a).toUpperCase();
    const tb = toText(b).toUpperCase();
    return ta === tb ? 0 : ta < tb ? -1 : 1;
  }
  // booleans
  const ba = a ? 1 : 0;
  const bb = b ? 1 : 0;
  return ba - bb;
}

function rankType(v: CellValue): number {
  if (typeof v === 'number' || v instanceof Date) return 0;
  if (typeof v === 'string') return 1;
  if (typeof v === 'boolean') return 2;
  return 3; // blank/null sorts last
}

/** Convert an Excel wildcard pattern (`*`, `?`, `~` escape) to a RegExp. */
export function wildcardToRegExp(pattern: string): RegExp {
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i] as string;
    if (ch === '~') {
      const nxt = pattern[i + 1];
      if (nxt === '*' || nxt === '?' || nxt === '~') {
        re += escapeRegExp(nxt);
        i++;
        continue;
      }
      re += escapeRegExp('~');
      continue;
    }
    if (ch === '*') {
      re += '.*';
      continue;
    }
    if (ch === '?') {
      re += '.';
      continue;
    }
    re += escapeRegExp(ch);
  }
  return new RegExp(`^${re}$`, 'i');
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build a predicate from a criteria value. Supports `">5"`, `"<=3"`, `"<>x"`,
 * `"=foo"`, bare equality (with wildcards for text), and direct scalar match.
 */
export function makeCriteria(criteria: CellValue): (v: CellValue) => boolean {
  if (typeof criteria === 'number' || typeof criteria === 'boolean' || criteria instanceof Date) {
    return (v) => looseEquals(v, criteria);
  }
  if (isBlank(criteria)) {
    return (v) => isBlank(v);
  }
  const text = toText(criteria);
  const m = /^(<=|>=|<>|=|<|>)\s*(.*)$/s.exec(text);
  if (m) {
    const op = m[1];
    const rhsRaw = m[2] as string;
    const rhsNum = Number(rhsRaw);
    const rhsIsNum = rhsRaw.trim() !== '' && !Number.isNaN(rhsNum);
    switch (op) {
      case '=':
        return makeEqualsCriteria(rhsRaw, rhsIsNum, rhsNum);
      case '<>':
        return negate(makeEqualsCriteria(rhsRaw, rhsIsNum, rhsNum));
      case '>':
        return (v) => numCompare(v, rhsRaw, rhsIsNum, rhsNum, (c) => c > 0);
      case '>=':
        return (v) => numCompare(v, rhsRaw, rhsIsNum, rhsNum, (c) => c >= 0);
      case '<':
        return (v) => numCompare(v, rhsRaw, rhsIsNum, rhsNum, (c) => c < 0);
      case '<=':
        return (v) => numCompare(v, rhsRaw, rhsIsNum, rhsNum, (c) => c <= 0);
    }
  }
  // Bare value → equality (with wildcards for text).
  return makeEqualsCriteria(text, false, NaN, criteria);
}

function makeEqualsCriteria(
  rhsRaw: string,
  rhsIsNum: boolean,
  rhsNum: number,
  original?: CellValue,
): (v: CellValue) => boolean {
  if (rhsIsNum) {
    return (v) => {
      const n = toNumber(v);
      return !isError(n) && n === rhsNum;
    };
  }
  if (original !== undefined && typeof original !== 'string') {
    return (v) => looseEquals(v, original);
  }
  if (/[*?~]/.test(rhsRaw)) {
    const re = wildcardToRegExp(rhsRaw);
    return (v) => !isBlank(v) && re.test(toText(v));
  }
  if (rhsRaw === '') {
    return (v) => isBlank(v);
  }
  // Boolean text.
  const up = rhsRaw.toUpperCase();
  if (up === 'TRUE' || up === 'FALSE') {
    const b = up === 'TRUE';
    return (v) => typeof v === 'boolean' && v === b;
  }
  return (v) => !isBlank(v) && toText(v).toUpperCase() === rhsRaw.toUpperCase();
}

function negate(p: (v: CellValue) => boolean): (v: CellValue) => boolean {
  return (v) => !p(v);
}

function numCompare(
  v: CellValue,
  rhsRaw: string,
  rhsIsNum: boolean,
  rhsNum: number,
  ok: (c: number) => boolean,
): boolean {
  if (rhsIsNum) {
    const n = toNumber(v);
    if (isError(n)) return false;
    return ok(n - rhsNum);
  }
  // Text comparison.
  if (isBlank(v)) return false;
  const c = compareValues(v, rhsRaw);
  return ok(c);
}

/** Guard helper: returns the first error in a flattened arg list, if any. */
export function firstError(args: ReadonlyArray<FnArg | undefined>): CellValue | undefined {
  for (const a of args) {
    if (isMatrix(a)) {
      for (const row of a) for (const v of row) if (isError(v)) return v;
    } else if (isError(a)) {
      return a;
    }
  }
  return undefined;
}

export { ERR };
