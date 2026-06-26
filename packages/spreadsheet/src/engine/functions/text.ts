/**
 * String / text worksheet functions.
 */

import type { CellValue, SpreadsheetFunction } from '../../contract.js';
import { ERR, isError, toNumber, toText } from '../errors.js';
import { type FnArg, asScalar, flatten, isMatrix } from '../helpers.js';

function str(a: FnArg | undefined): string | CellValue {
  const s = asScalar(a);
  if (isError(s)) return s;
  return toText(s);
}
function n(a: FnArg | undefined): number | CellValue {
  const v = toNumber(asScalar(a));
  return v;
}

export const textFunctions: Record<string, SpreadsheetFunction> = {
  CONCATENATE: (args) => {
    let out = '';
    for (const v of flatten(args)) {
      if (isError(v)) return v;
      out += toText(v);
    }
    return out;
  },
  CONCAT: (args) => {
    let out = '';
    for (const v of flatten(args)) {
      if (isError(v)) return v;
      out += toText(v);
    }
    return out;
  },
  TEXTJOIN: (args) => {
    const delim = str(args[0]);
    if (isError(delim)) return delim;
    const ignoreEmpty = Boolean(asScalar(args[1]));
    const parts: string[] = [];
    for (let i = 2; i < args.length; i++) {
      const a = args[i];
      const values = isMatrix(a) ? a.flat() : [asScalar(a)];
      for (const v of values) {
        if (isError(v)) return v;
        const t = toText(v);
        if (ignoreEmpty && t === '') continue;
        parts.push(t);
      }
    }
    return parts.join(delim as string);
  },
  LEN: (args) => {
    const s = str(args[0]);
    if (isError(s)) return s;
    return (s as string).length;
  },
  LEFT: (args) => {
    const s = str(args[0]);
    if (isError(s)) return s;
    const count = args.length > 1 ? n(args[1]) : 1;
    if (isError(count)) return count;
    return (s as string).slice(0, Math.max(0, Math.floor(count as number)));
  },
  RIGHT: (args) => {
    const s = str(args[0]);
    if (isError(s)) return s;
    const count = args.length > 1 ? n(args[1]) : 1;
    if (isError(count)) return count;
    const c = Math.max(0, Math.floor(count as number));
    return c === 0 ? '' : (s as string).slice(-c);
  },
  MID: (args) => {
    const s = str(args[0]);
    if (isError(s)) return s;
    const start = n(args[1]);
    const len = n(args[2]);
    if (isError(start)) return start;
    if (isError(len)) return len;
    const st = Math.floor(start as number);
    if (st < 1) return ERR.VALUE;
    return (s as string).slice(st - 1, st - 1 + Math.max(0, Math.floor(len as number)));
  },
  UPPER: (args) => mapStr(args, (s) => s.toUpperCase()),
  LOWER: (args) => mapStr(args, (s) => s.toLowerCase()),
  PROPER: (args) =>
    mapStr(args, (s) => s.replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\B\w/g, (c) => c.toLowerCase())),
  TRIM: (args) => mapStr(args, (s) => s.replace(/\s+/g, ' ').trim()),
  // CLEAN strips non-printable control characters (Excel-compatible); the
  // control-char class is intentional here.
  // eslint-disable-next-line no-control-regex
  CLEAN: (args) => mapStr(args, (s) => s.replace(/[\x00-\x1f]/g, '')),
  REPT: (args) => {
    const s = str(args[0]);
    if (isError(s)) return s;
    const count = n(args[1]);
    if (isError(count)) return count;
    const c = Math.floor(count as number);
    if (c < 0) return ERR.VALUE;
    return (s as string).repeat(c);
  },
  SUBSTITUTE: (args) => {
    const s = str(args[0]);
    const oldT = str(args[1]);
    const newT = str(args[2]);
    if (isError(s)) return s;
    if (isError(oldT)) return oldT;
    if (isError(newT)) return newT;
    const source = s as string;
    const find = oldT as string;
    const repl = newT as string;
    if (find === '') return source;
    if (args.length > 3) {
      const which = n(args[3]);
      if (isError(which)) return which;
      const inst = Math.floor(which as number);
      let count = 0;
      let idx = 0;
      while ((idx = source.indexOf(find, idx)) !== -1) {
        count++;
        if (count === inst) {
          return source.slice(0, idx) + repl + source.slice(idx + find.length);
        }
        idx += find.length;
      }
      return source;
    }
    return source.split(find).join(repl);
  },
  REPLACE: (args) => {
    const s = str(args[0]);
    const start = n(args[1]);
    const len = n(args[2]);
    const newT = str(args[3]);
    if (isError(s)) return s;
    if (isError(start)) return start;
    if (isError(len)) return len;
    if (isError(newT)) return newT;
    const st = Math.floor(start as number) - 1;
    const ln = Math.floor(len as number);
    const source = s as string;
    return source.slice(0, st) + (newT as string) + source.slice(st + ln);
  },
  FIND: (args) => findImpl(args, true),
  SEARCH: (args) => findImpl(args, false),
  EXACT: (args) => {
    const a = str(args[0]);
    const b = str(args[1]);
    if (isError(a)) return a;
    if (isError(b)) return b;
    return a === b;
  },
  TEXT: (args) => {
    const v = asScalar(args[0]);
    if (isError(v)) return v;
    const fmt = str(args[1]);
    if (isError(fmt)) return fmt;
    return applyTextFormat(v, fmt as string);
  },
  VALUE: (args) => {
    const v = n(args[0]);
    return v;
  },
  NUMBERVALUE: (args) => {
    const s = str(args[0]);
    if (isError(s)) return s;
    const v = Number((s as string).replace(/,/g, ''));
    return Number.isNaN(v) ? ERR.VALUE : v;
  },
  CHAR: (args) => {
    const code = n(args[0]);
    if (isError(code)) return code;
    const c = Math.floor(code as number);
    if (c < 1 || c > 65535) return ERR.VALUE;
    return String.fromCharCode(c);
  },
  UNICHAR: (args) => {
    const code = n(args[0]);
    if (isError(code)) return code;
    return String.fromCodePoint(Math.floor(code as number));
  },
  CODE: (args) => {
    const s = str(args[0]);
    if (isError(s)) return s;
    if ((s as string).length === 0) return ERR.VALUE;
    return (s as string).charCodeAt(0);
  },
  UNICODE: (args) => {
    const s = str(args[0]);
    if (isError(s)) return s;
    if ((s as string).length === 0) return ERR.VALUE;
    return (s as string).codePointAt(0) ?? ERR.VALUE;
  },
  T: (args) => {
    const v = asScalar(args[0]);
    if (isError(v)) return v;
    return typeof v === 'string' ? v : '';
  },
  TEXTBEFORE: (args) => {
    const s = str(args[0]);
    const delim = str(args[1]);
    if (isError(s)) return s;
    if (isError(delim)) return delim;
    const idx = (s as string).indexOf(delim as string);
    return idx === -1 ? ERR.NA : (s as string).slice(0, idx);
  },
  TEXTAFTER: (args) => {
    const s = str(args[0]);
    const delim = str(args[1]);
    if (isError(s)) return s;
    if (isError(delim)) return delim;
    const idx = (s as string).indexOf(delim as string);
    return idx === -1 ? ERR.NA : (s as string).slice(idx + (delim as string).length);
  },
};

function mapStr(args: ReadonlyArray<FnArg>, fn: (s: string) => string): CellValue {
  const s = str(args[0]);
  if (isError(s)) return s;
  return fn(s as string);
}

function findImpl(args: ReadonlyArray<FnArg>, caseSensitive: boolean): CellValue {
  const find = str(args[0]);
  const within = str(args[1]);
  if (isError(find)) return find;
  if (isError(within)) return within;
  let fStr = find as string;
  let wStr = within as string;
  const startNum = args.length > 2 ? n(args[2]) : 1;
  if (isError(startNum)) return startNum;
  const start = Math.floor(startNum as number) - 1;
  if (!caseSensitive) {
    fStr = fStr.toLowerCase();
    wStr = wStr.toLowerCase();
  }
  const idx = wStr.indexOf(fStr, Math.max(0, start));
  return idx === -1 ? ERR.VALUE : idx + 1;
}

/**
 * Minimal `TEXT()` formatter: handles `0`/`#` numeric placeholders, decimals,
 * thousands, `%`, and a few date patterns. Not exhaustive Excel parity but
 * covers the common cases used by tests/UI.
 */
function applyTextFormat(value: CellValue, fmt: string): string {
  if (typeof value === 'number') {
    return formatNumberPattern(value, fmt);
  }
  if (value instanceof Date) {
    return formatDatePattern(value, fmt);
  }
  return toText(value);
}

export function formatNumberPattern(value: number, fmt: string): string {
  if (fmt === 'General' || fmt === '') return String(value);
  // Percent.
  let v = value;
  let suffix = '';
  let pattern = fmt;
  const pctCount = (pattern.match(/%/g) || []).length;
  if (pctCount > 0) {
    v *= Math.pow(100, pctCount);
    pattern = pattern.replace(/%/g, '');
    suffix = '%'.repeat(pctCount);
  }
  const useThousands = /[#0],[#0]/.test(pattern) || /,/.test(pattern);
  // Decimal places from the part after the dot.
  const dotIdx = pattern.indexOf('.');
  let decimals = 0;
  if (dotIdx !== -1) {
    const frac = pattern.slice(dotIdx + 1).replace(/[^0#]/g, '');
    decimals = frac.length;
  }
  let out = Math.abs(v).toFixed(decimals);
  if (useThousands) {
    const [intPart, fracPart] = out.split('.');
    const grouped = (intPart as string).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    out = fracPart !== undefined ? `${grouped}.${fracPart}` : grouped;
  }
  return (v < 0 ? '-' : '') + out + suffix;
}

function formatDatePattern(d: Date, fmt: string): string {
  // Tokenize first so `m`/`mm` can be resolved as MONTH or MINUTE from context:
  // Excel treats `m`/`mm` as minutes when adjacent to an hour token (h/hh) or a
  // seconds token (s/ss), and as month otherwise.
  const tokenRe = /yyyy|yy|hh|h|ss|s|mm|m|dd|d/g;
  const tokens: string[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = tokenRe.exec(fmt))) {
    if (match.index > last) tokens.push(fmt.slice(last, match.index));
    tokens.push(match[0]);
    last = tokenRe.lastIndex;
  }
  if (last < fmt.length) tokens.push(fmt.slice(last));

  const isTimeToken = (t: string): boolean => t === 'h' || t === 'hh' || t === 's' || t === 'ss';
  const isMonthMinuteToken = (t: string): boolean => t === 'm' || t === 'mm';

  return tokens
    .map((t, i) => {
      switch (t) {
        case 'yyyy':
          return String(d.getFullYear());
        case 'yy':
          return String(d.getFullYear()).slice(-2);
        case 'dd':
          return String(d.getDate()).padStart(2, '0');
        case 'd':
          return String(d.getDate());
        case 'hh':
          return String(d.getHours()).padStart(2, '0');
        case 'h':
          return String(d.getHours());
        case 'ss':
          return String(d.getSeconds()).padStart(2, '0');
        case 's':
          return String(d.getSeconds());
        case 'mm':
        case 'm': {
          // Minutes if a preceding token is h/hh or a following token is s/ss.
          let isMinute = false;
          for (let j = i - 1; j >= 0; j--) {
            if (isTimeToken(tokens[j]!)) {
              isMinute = true;
              break;
            }
            if (isMonthMinuteToken(tokens[j]!)) continue;
            if (/\w/.test(tokens[j]!)) break;
          }
          if (!isMinute) {
            for (let j = i + 1; j < tokens.length; j++) {
              if (tokens[j] === 's' || tokens[j] === 'ss') {
                isMinute = true;
                break;
              }
              if (isMonthMinuteToken(tokens[j]!)) continue;
              if (/\w/.test(tokens[j]!)) break;
            }
          }
          const num = isMinute ? d.getMinutes() : d.getMonth() + 1;
          return t === 'mm' ? String(num).padStart(2, '0') : String(num);
        }
        default:
          return t;
      }
    })
    .join('');
}
