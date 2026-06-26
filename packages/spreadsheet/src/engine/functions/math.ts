/**
 * Math & trigonometry worksheet functions.
 */

import type { CellValue, SpreadsheetFunction } from '../../contract.js';
import { ERR, isError, toNumber } from '../errors.js';
import { type FnArg, asScalar, flattenNumbers, isMatrix } from '../helpers.js';

/** Coerce one positional arg to a number, propagating errors. */
function num(a: FnArg | undefined): number | CellValue {
  const s = asScalar(a);
  const n = toNumber(s as CellValue);
  return n;
}

/** Build a single-number-in / number-out function with error propagation. */
function unary(fn: (x: number) => number | CellValue): SpreadsheetFunction {
  return (args) => {
    const n = num(args[0]);
    if (isError(n)) return n;
    return fn(n as number);
  };
}

export const mathFunctions: Record<string, SpreadsheetFunction> = {
  SUM: (args) => {
    const r = flattenNumbers(args);
    if ('error' in r) return r.error;
    return r.reduce((a, b) => a + b, 0);
  },
  PRODUCT: (args) => {
    const r = flattenNumbers(args);
    if ('error' in r) return r.error;
    if (r.length === 0) return 0;
    return r.reduce((a, b) => a * b, 1);
  },
  ABS: unary(Math.abs),
  SIGN: unary((x) => (x > 0 ? 1 : x < 0 ? -1 : 0)),
  SQRT: unary((x) => (x < 0 ? ERR.NUM : Math.sqrt(x))),
  POWER: (args) => {
    const b = num(args[0]);
    const e = num(args[1]);
    if (isError(b)) return b;
    if (isError(e)) return e;
    const r = Math.pow(b as number, e as number);
    return Number.isNaN(r) ? ERR.NUM : r;
  },
  EXP: unary(Math.exp),
  LN: unary((x) => (x <= 0 ? ERR.NUM : Math.log(x))),
  LOG10: unary((x) => (x <= 0 ? ERR.NUM : Math.log10(x))),
  LOG: (args) => {
    const x = num(args[0]);
    if (isError(x)) return x;
    if ((x as number) <= 0) return ERR.NUM;
    const base = args.length > 1 ? num(args[1]) : 10;
    if (isError(base)) return base;
    if ((base as number) <= 0 || (base as number) === 1) return ERR.NUM;
    return Math.log(x as number) / Math.log(base as number);
  },
  MOD: (args) => {
    const a = num(args[0]);
    const b = num(args[1]);
    if (isError(a)) return a;
    if (isError(b)) return b;
    if ((b as number) === 0) return ERR.DIV0;
    const an = a as number;
    const bn = b as number;
    return an - bn * Math.floor(an / bn);
  },
  QUOTIENT: (args) => {
    const a = num(args[0]);
    const b = num(args[1]);
    if (isError(a)) return a;
    if (isError(b)) return b;
    if ((b as number) === 0) return ERR.DIV0;
    return Math.trunc((a as number) / (b as number));
  },
  ROUND: (args) => roundImpl(args, 'round'),
  ROUNDUP: (args) => roundImpl(args, 'up'),
  ROUNDDOWN: (args) => roundImpl(args, 'down'),
  MROUND: (args) => {
    const x = num(args[0]);
    const m = num(args[1]);
    if (isError(x)) return x;
    if (isError(m)) return m;
    if ((m as number) === 0) return 0;
    if (Math.sign(x as number) !== Math.sign(m as number) && (x as number) !== 0) return ERR.NUM;
    return Math.round((x as number) / (m as number)) * (m as number);
  },
  CEILING: (args) => {
    const x = num(args[0]);
    const sig = args.length > 1 ? num(args[1]) : 1;
    if (isError(x)) return x;
    if (isError(sig)) return sig;
    const s = sig as number;
    if (s === 0) return 0;
    return Math.ceil((x as number) / s) * s;
  },
  FLOOR: (args) => {
    const x = num(args[0]);
    const sig = args.length > 1 ? num(args[1]) : 1;
    if (isError(x)) return x;
    if (isError(sig)) return sig;
    const s = sig as number;
    if (s === 0) return ERR.DIV0;
    return Math.floor((x as number) / s) * s;
  },
  INT: unary(Math.floor),
  TRUNC: (args) => {
    const x = num(args[0]);
    if (isError(x)) return x;
    const digits = args.length > 1 ? num(args[1]) : 0;
    if (isError(digits)) return digits;
    const f = Math.pow(10, Math.trunc(digits as number));
    return Math.trunc((x as number) * f) / f;
  },
  ROUND_FRAC: unary((x) => x),
  PI: () => Math.PI,
  SQRTPI: unary((x) => (x < 0 ? ERR.NUM : Math.sqrt(x * Math.PI))),
  SIN: unary(Math.sin),
  COS: unary(Math.cos),
  TAN: unary(Math.tan),
  ASIN: unary((x) => (x < -1 || x > 1 ? ERR.NUM : Math.asin(x))),
  ACOS: unary((x) => (x < -1 || x > 1 ? ERR.NUM : Math.acos(x))),
  ATAN: unary(Math.atan),
  ATAN2: (args) => {
    const x = num(args[0]);
    const y = num(args[1]);
    if (isError(x)) return x;
    if (isError(y)) return y;
    return Math.atan2(y as number, x as number);
  },
  SINH: unary(Math.sinh),
  COSH: unary(Math.cosh),
  TANH: unary(Math.tanh),
  DEGREES: unary((x) => (x * 180) / Math.PI),
  RADIANS: unary((x) => (x * Math.PI) / 180),
  GCD: (args) => {
    const r = flattenNumbers(args);
    if ('error' in r) return r.error;
    if (r.some((n) => n < 0)) return ERR.NUM;
    return r.map((n) => Math.floor(n)).reduce((a, b) => gcd(a, b), 0);
  },
  LCM: (args) => {
    const r = flattenNumbers(args);
    if ('error' in r) return r.error;
    if (r.some((n) => n < 0)) return ERR.NUM;
    return r.map((n) => Math.floor(n)).reduce((a, b) => lcm(a, b), 1);
  },
  FACT: unary((x) => {
    if (x < 0) return ERR.NUM;
    const n = Math.floor(x);
    let f = 1;
    for (let i = 2; i <= n; i++) f *= i;
    return f;
  }),
  COMBIN: (args) => {
    const n = num(args[0]);
    const k = num(args[1]);
    if (isError(n)) return n;
    if (isError(k)) return k;
    return combin(Math.floor(n as number), Math.floor(k as number));
  },
  PERMUT: (args) => {
    const n = num(args[0]);
    const k = num(args[1]);
    if (isError(n)) return n;
    if (isError(k)) return k;
    const nn = Math.floor(n as number);
    const kk = Math.floor(k as number);
    if (nn < 0 || kk < 0 || kk > nn) return ERR.NUM;
    let r = 1;
    for (let i = 0; i < kk; i++) r *= nn - i;
    return r;
  },
  EVEN: unary((x) => {
    const c = Math.ceil(Math.abs(x) / 2) * 2;
    return x < 0 ? -c : c;
  }),
  ODD: unary((x) => {
    let c = Math.ceil(Math.abs(x));
    if (c % 2 === 0) c += 1;
    return x < 0 ? -c : c;
  }),
  RAND: () => Math.random(),
  RANDBETWEEN: (args) => {
    const lo = num(args[0]);
    const hi = num(args[1]);
    if (isError(lo)) return lo;
    if (isError(hi)) return hi;
    const l = Math.ceil(lo as number);
    const h = Math.floor(hi as number);
    return l + Math.floor(Math.random() * (h - l + 1));
  },
  SUMSQ: (args) => {
    const r = flattenNumbers(args);
    if ('error' in r) return r.error;
    return r.reduce((a, b) => a + b * b, 0);
  },
  SUMPRODUCT: (args) => sumProduct(args),
  BASE: (args) => {
    const n = num(args[0]);
    const radix = num(args[1]);
    if (isError(n)) return n;
    if (isError(radix)) return radix;
    const r = radix as number;
    if (r < 2 || r > 36) return ERR.NUM;
    let out = Math.floor(n as number).toString(r).toUpperCase();
    if (args.length > 2) {
      const minLen = num(args[2]);
      if (!isError(minLen)) out = out.padStart(minLen as number, '0');
    }
    return out;
  },
  DECIMAL: (args) => {
    const text = asScalar(args[0]);
    const radix = num(args[1]);
    if (isError(radix)) return radix;
    const r = radix as number;
    if (r < 2 || r > 36) return ERR.NUM;
    const v = parseInt(String(text), r);
    return Number.isNaN(v) ? ERR.NUM : v;
  },
  ROMAN: (args) => {
    const n = num(args[0]);
    if (isError(n)) return n;
    return toRoman(Math.floor(n as number));
  },
};

function roundImpl(args: ReadonlyArray<FnArg>, mode: 'round' | 'up' | 'down'): CellValue {
  const x = num(args[0]);
  if (isError(x)) return x;
  const digits = args.length > 1 ? num(args[1]) : 0;
  if (isError(digits)) return digits;
  const f = Math.pow(10, Math.trunc(digits as number));
  const scaled = (x as number) * f;
  let r: number;
  if (mode === 'round') {
    r = Math.sign(scaled) * Math.round(Math.abs(scaled));
  } else if (mode === 'up') {
    r = Math.sign(scaled) * Math.ceil(Math.abs(scaled));
  } else {
    r = Math.sign(scaled) * Math.floor(Math.abs(scaled));
  }
  return r / f;
}

function gcd(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) {
    [a, b] = [b, a % b];
  }
  return a;
}
function lcm(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return Math.abs(a * b) / gcd(a, b);
}
function combin(n: number, k: number): CellValue {
  if (n < 0 || k < 0 || k > n) return ERR.NUM;
  k = Math.min(k, n - k);
  let r = 1;
  for (let i = 0; i < k; i++) r = (r * (n - i)) / (i + 1);
  return Math.round(r);
}

function sumProduct(args: ReadonlyArray<FnArg | undefined>): CellValue {
  const matrices = args.map((a) => (isMatrix(a) ? a : [[asScalar(a)]]));
  const first = matrices[0] ?? [];
  const rows = first.length;
  const cols = first[0]?.length ?? 0;
  for (const m of matrices) {
    if (m.length !== rows || (m[0]?.length ?? 0) !== cols) return ERR.VALUE;
  }
  let total = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let prod = 1;
      for (const m of matrices) {
        const v = m[r]?.[c] ?? null;
        if (isError(v)) return v;
        const n = typeof v === 'number' ? v : typeof v === 'boolean' ? (v ? 1 : 0) : 0;
        prod *= n;
      }
      total += prod;
    }
  }
  return total;
}

function toRoman(n: number): CellValue {
  if (n < 0 || n > 3999) return ERR.VALUE;
  if (n === 0) return '';
  const table: Array<[number, string]> = [
    [1000, 'M'],
    [900, 'CM'],
    [500, 'D'],
    [400, 'CD'],
    [100, 'C'],
    [90, 'XC'],
    [50, 'L'],
    [40, 'XL'],
    [10, 'X'],
    [9, 'IX'],
    [5, 'V'],
    [4, 'IV'],
    [1, 'I'],
  ];
  let out = '';
  for (const [v, s] of table) {
    while (n >= v) {
      out += s;
      n -= v;
    }
  }
  return out;
}
