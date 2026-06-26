/**
 * Display formatting for cell values — turns a computed `CellValue` plus a
 * `CellFormat` into the string the grid paints. Pure & DOM-free.
 *
 * Supports the contract's format types: general / number / currency / percent /
 * date / time / text / boolean, plus a small subset of custom number patterns
 * (`#,##0.00`, `0%`, `0.00%`, `yyyy-mm-dd`, `hh:mm`, etc.).
 */

import type { CellError, CellFormat, CellValue } from '../contract.js';

/** True when a value is a first-class `CellError`. */
export function isCellError(v: CellValue): v is CellError {
  return typeof v === 'object' && v !== null && (v as CellError).kind === 'error';
}

const DEFAULT_CURRENCY: Record<string, string> = {
  'en-US': '$',
  'en-GB': '£',
  'de-DE': '€',
  'fr-FR': '€',
  'ja-JP': '¥',
};

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Count decimal places implied by a number pattern (e.g. `0.00` → 2). */
function decimalsFromPattern(pattern: string): number {
  const dot = pattern.indexOf('.');
  if (dot < 0) return 0;
  let n = 0;
  for (let i = dot + 1; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '0' || ch === '#') n++;
    else break;
  }
  return n;
}

/** Group an integer string with thousands separators. */
function groupThousands(intStr: string): string {
  const neg = intStr.startsWith('-');
  const digits = neg ? intStr.slice(1) : intStr;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return neg ? `-${grouped}` : grouped;
}

/** Apply a numeric pattern to a number. */
function formatNumberPattern(value: number, pattern: string): string {
  const isPercent = pattern.includes('%');
  const grouped = pattern.includes(',');
  const n = isPercent ? value * 100 : value;
  const decimals = decimalsFromPattern(pattern);
  const fixed = n.toFixed(decimals);
  const parts = fixed.split('.');
  let intPart = parts[0] ?? '0';
  const fracPart = parts[1];
  if (grouped) intPart = groupThousands(intPart);
  let out = fracPart != null ? `${intPart}.${fracPart}` : intPart;
  if (isPercent) out += '%';
  return out;
}

/**
 * Format a Date according to a yyyy/mm/dd/hh/ss-style pattern. A single token
 * scan disambiguates mm (months vs minutes): an mm following an hh time token
 * is treated as minutes.
 */
function formatDatePattern(d: Date, pattern: string): string {
  const tokenRe = /yyyy|yy|hh|ss|mm|dd/g;
  let sawTime = false;
  return pattern.replace(tokenRe, (token) => {
    switch (token) {
      case 'yyyy':
        return String(d.getFullYear());
      case 'yy':
        return pad2(d.getFullYear() % 100);
      case 'dd':
        return pad2(d.getDate());
      case 'hh':
        sawTime = true;
        return pad2(d.getHours());
      case 'ss':
        return pad2(d.getSeconds());
      case 'mm':
        return sawTime ? pad2(d.getMinutes()) : pad2(d.getMonth() + 1);
      default:
        return token;
    }
  });
}

function coerceDate(value: CellValue): Date | null {
  if (value instanceof Date) return value;
  if (typeof value === 'number') {
    // Excel serial date (days since 1899-12-30).
    const ms = Math.round((value - 25569) * 86400 * 1000);
    const d = new Date(ms);
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof value === 'string') {
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/**
 * Produce the display string for a value under a format. Mirrors the engine's
 * `getDisplayValue`, but the UI also calls this directly for previews.
 */
export function formatValue(value: CellValue, format?: CellFormat): string {
  if (value === null || value === undefined || value === '') return '';
  if (isCellError(value)) return value.code;
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';

  const type = format?.type ?? 'general';
  const pattern = format?.numberFormat;

  if (type === 'text') return String(value);

  if (type === 'date' || type === 'time') {
    const d = coerceDate(value);
    if (!d) return String(value);
    if (pattern) return formatDatePattern(d, pattern);
    return type === 'time'
      ? `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
      : `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }

  if (typeof value === 'number') {
    if (type === 'percent') return formatNumberPattern(value, pattern ?? '0%');
    if (type === 'currency') {
      const sym = DEFAULT_CURRENCY[format?.locale ?? 'en-US'] ?? '$';
      const body = formatNumberPattern(value, pattern ?? '#,##0.00');
      return value < 0 ? `-${sym}${body.slice(1)}` : `${sym}${body}`;
    }
    if (type === 'number') return formatNumberPattern(value, pattern ?? '#,##0.##');
    // general
    if (pattern) return formatNumberPattern(value, pattern);
    return numberToGeneral(value);
  }

  // string / date already handled
  if (value instanceof Date) {
    return `${value.getFullYear()}-${pad2(value.getMonth() + 1)}-${pad2(value.getDate())}`;
  }
  return String(value);
}

/** "General" number formatting: trim trailing zeros, no grouping. */
function numberToGeneral(n: number): string {
  if (Number.isInteger(n)) return String(n);
  // limit to a sane precision then trim
  const s = n.toPrecision(12);
  return String(parseFloat(s));
}

/**
 * Parse raw user input into a typed `CellValue`, honoring an optional target
 * format (so typing into a `text`-typed cell keeps the string verbatim). Strings
 * beginning with `=` are NOT handled here — the caller routes those to formulas.
 */
export function parseInput(input: string, format?: CellFormat): CellValue {
  if (format?.type === 'text') return input;
  const trimmed = input.trim();
  if (trimmed === '') return null;
  if (/^(true|false)$/i.test(trimmed)) return /^true$/i.test(trimmed);
  // percent input like "12%"
  if (/^-?\d+(\.\d+)?%$/.test(trimmed)) {
    return parseFloat(trimmed) / 100;
  }
  // currency-ish input
  const numeric = trimmed.replace(/^[$£€¥]/, '').replace(/,/g, '');
  if (/^-?\d+(\.\d+)?$/.test(numeric)) return parseFloat(numeric);
  return input;
}

/** Named number-format presets surfaced in the toolbar's format menu. */
export const NUMBER_FORMAT_PRESETS: ReadonlyArray<{
  id: NonNullable<CellFormat['type']> | 'custom';
  label: string;
  format: CellFormat;
}> = [
  { id: 'general', label: 'General', format: { type: 'general' } },
  { id: 'number', label: 'Number', format: { type: 'number', numberFormat: '#,##0.00' } },
  { id: 'currency', label: 'Currency', format: { type: 'currency', numberFormat: '#,##0.00' } },
  { id: 'percent', label: 'Percent', format: { type: 'percent', numberFormat: '0.00%' } },
  { id: 'date', label: 'Date', format: { type: 'date', numberFormat: 'yyyy-mm-dd' } },
  { id: 'time', label: 'Time', format: { type: 'time', numberFormat: 'hh:mm' } },
  { id: 'text', label: 'Text', format: { type: 'text' } },
];
