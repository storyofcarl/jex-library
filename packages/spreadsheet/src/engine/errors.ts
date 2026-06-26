/**
 * Error sentinels and value coercion helpers shared across the function library
 * and evaluator. Errors are first-class values that propagate, never thrown.
 */

import type { CellError, CellErrorCode, CellValue } from '../contract.js';

/** Construct a `CellError` value. */
export function makeError(code: CellErrorCode, message?: string): CellError {
  return message === undefined ? { kind: 'error', code } : { kind: 'error', code, message };
}

/** Canonical error singletons (cheap, immutable enough for our purposes). */
export const ERR = {
  NULL: makeError('#NULL!'),
  DIV0: makeError('#DIV/0!'),
  VALUE: makeError('#VALUE!'),
  REF: makeError('#REF!'),
  NAME: makeError('#NAME?'),
  NUM: makeError('#NUM!'),
  NA: makeError('#N/A'),
  SPILL: makeError('#SPILL!'),
  CYCLE: makeError('#CYCLE!'),
  CALC: makeError('#CALC!'),
} as const;

/** Type guard: is this value a `CellError`? */
export function isError(v: unknown): v is CellError {
  return typeof v === 'object' && v !== null && (v as CellError).kind === 'error';
}

/** Recognize an error-sentinel string (e.g. literal `"#N/A"` typed into a cell). */
export function errorCodeFromString(s: string): CellErrorCode | undefined {
  const codes: CellErrorCode[] = [
    '#NULL!',
    '#DIV/0!',
    '#VALUE!',
    '#REF!',
    '#NAME?',
    '#NUM!',
    '#N/A',
    '#SPILL!',
    '#CYCLE!',
    '#CALC!',
  ];
  return codes.includes(s as CellErrorCode) ? (s as CellErrorCode) : undefined;
}

/** Is the value an empty cell (null or empty string)? */
export function isBlank(v: CellValue): boolean {
  return v === null || v === undefined || v === '';
}

/**
 * Coerce a scalar to a number for arithmetic. Booleans → 1/0; Date → serial;
 * numeric strings → number; blank → 0. Returns a `CellError` for non-numeric
 * text (caller propagates).
 */
export function toNumber(v: CellValue): number | CellError {
  if (isError(v)) return v;
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v instanceof Date) return dateToSerial(v);
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'string') {
    const t = v.trim();
    if (t === '') return 0;
    // Percent suffix.
    if (/%$/.test(t)) {
      const n = Number(t.slice(0, -1));
      if (!Number.isNaN(n)) return n / 100;
    }
    const n = Number(t);
    if (!Number.isNaN(n)) return n;
    // Try a date string.
    const d = Date.parse(t);
    if (!Number.isNaN(d)) return dateToSerial(new Date(d));
    return ERR.VALUE;
  }
  return ERR.VALUE;
}

/** Like `toNumber` but a blank string/null is treated as missing (NaN sentinel). */
export function toNumberStrict(v: CellValue): number | CellError {
  if (isBlank(v)) return ERR.VALUE;
  return toNumber(v);
}

/** Coerce a scalar to its string form for `&` concatenation / text functions. */
export function toText(v: CellValue): string {
  if (isError(v)) return v.code;
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (v instanceof Date) return formatDateDefault(v);
  if (typeof v === 'number') return numberToText(v);
  return String(v);
}

/** Default number → string (general format, trims float noise). */
export function numberToText(n: number): string {
  if (!Number.isFinite(n)) return n > 0 ? '#NUM!' : n < 0 ? '#NUM!' : '#NUM!';
  if (Number.isInteger(n)) return String(n);
  // Limit to 15 significant digits like Excel's general format.
  let s = n.toPrecision(15);
  if (s.includes('.') && !s.includes('e') && !s.includes('E')) {
    s = s.replace(/\.?0+$/, '');
  }
  const num = Number(s);
  return String(num);
}

/**
 * Coerce a scalar to boolean for logical functions. Numbers: 0 → false, else
 * true. Strings "TRUE"/"FALSE" (case-insensitive) parse; other text → error.
 */
export function toBoolean(v: CellValue): boolean | CellError {
  if (isError(v)) return v;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (v === null || v === undefined || v === '') return false;
  if (typeof v === 'string') {
    const t = v.trim().toUpperCase();
    if (t === 'TRUE') return true;
    if (t === 'FALSE') return false;
    const n = Number(t);
    if (!Number.isNaN(n)) return n !== 0;
    return ERR.VALUE;
  }
  return ERR.VALUE;
}

/* ── Date serials (Excel 1900 system, no 1900-leap bug for simplicity) ───── */

const DAY_MS = 86400000;
// Excel epoch: serial 1 == 1900-01-01. We use the common offset where the JS
// date 1899-12-30 maps to serial 0, sidestepping the fictitious 1900-02-29.
const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30);

/** JS Date → Excel serial number (days since 1899-12-30, fractional = time). */
export function dateToSerial(d: Date): number {
  const ms =
    Date.UTC(
      d.getFullYear(),
      d.getMonth(),
      d.getDate(),
      d.getHours(),
      d.getMinutes(),
      d.getSeconds(),
      d.getMilliseconds(),
    ) - EXCEL_EPOCH_UTC;
  return ms / DAY_MS;
}

/** Excel serial number → JS Date (local components). */
export function serialToDate(serial: number): Date {
  const ms = EXCEL_EPOCH_UTC + Math.round(serial * DAY_MS);
  const utc = new Date(ms);
  return new Date(
    utc.getUTCFullYear(),
    utc.getUTCMonth(),
    utc.getUTCDate(),
    utc.getUTCHours(),
    utc.getUTCMinutes(),
    utc.getUTCSeconds(),
    utc.getUTCMilliseconds(),
  );
}

/** ISO-ish default date formatting (yyyy-mm-dd, plus time when non-midnight). */
export function formatDateDefault(d: Date): string {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  const hasTime = d.getHours() || d.getMinutes() || d.getSeconds();
  if (!hasTime) return `${y}-${mo}-${da}`;
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${y}-${mo}-${da} ${hh}:${mi}:${ss}`;
}
