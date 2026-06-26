/**
 * Statistical worksheet functions: aggregates, distributions, rank, etc.
 */

import type { CellValue, SpreadsheetFunction } from '../../contract.js';
import { ERR, isBlank, isError, toNumber } from '../errors.js';
import { type FnArg, asScalar, flatten, flattenNumbers, isMatrix } from '../helpers.js';

function numsOrError(
  args: ReadonlyArray<FnArg | undefined>,
  opts?: { includeBooleans?: boolean },
): number[] | CellValue {
  const r = flattenNumbers(args, opts);
  if ('error' in r) return r.error;
  return r;
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export const statisticalFunctions: Record<string, SpreadsheetFunction> = {
  AVERAGE: (args) => {
    const xs = numsOrError(args);
    if (!Array.isArray(xs)) return xs;
    if (xs.length === 0) return ERR.DIV0;
    return mean(xs);
  },
  AVERAGEA: (args) => {
    // Counts text as 0, booleans as 1/0.
    const vals = flatten(args);
    let sum = 0;
    let count = 0;
    for (const v of vals) {
      if (isError(v)) return v;
      if (isBlank(v)) continue;
      if (typeof v === 'number') sum += v;
      else if (typeof v === 'boolean') sum += v ? 1 : 0;
      else if (v instanceof Date) sum += toNumber(v) as number;
      else sum += 0; // text
      count++;
    }
    if (count === 0) return ERR.DIV0;
    return sum / count;
  },
  COUNT: (args) => {
    let count = 0;
    for (const a of args) {
      if (isMatrix(a)) {
        for (const row of a) for (const v of row) if (typeof v === 'number' || v instanceof Date) count++;
      } else {
        const s = asScalar(a);
        if (isError(s)) continue;
        if (typeof s === 'number' || s instanceof Date) count++;
        else if (typeof s === 'string' && s.trim() !== '' && !Number.isNaN(Number(s))) count++;
      }
    }
    return count;
  },
  COUNTA: (args) => {
    let count = 0;
    for (const v of flatten(args)) if (!isBlank(v)) count++;
    return count;
  },
  COUNTBLANK: (args) => {
    let count = 0;
    for (const v of flatten(args)) if (isBlank(v)) count++;
    return count;
  },
  MAX: (args) => {
    const xs = numsOrError(args);
    if (!Array.isArray(xs)) return xs;
    if (xs.length === 0) return 0;
    return Math.max(...xs);
  },
  MIN: (args) => {
    const xs = numsOrError(args);
    if (!Array.isArray(xs)) return xs;
    if (xs.length === 0) return 0;
    return Math.min(...xs);
  },
  MAXA: (args) => {
    const xs = flatten(args).filter((v) => !isBlank(v)).map((v) => coerceA(v));
    const err = xs.find(isError);
    if (err) return err as CellValue;
    const nums = xs as number[];
    return nums.length ? Math.max(...nums) : 0;
  },
  MINA: (args) => {
    const xs = flatten(args).filter((v) => !isBlank(v)).map((v) => coerceA(v));
    const err = xs.find(isError);
    if (err) return err as CellValue;
    const nums = xs as number[];
    return nums.length ? Math.min(...nums) : 0;
  },
  MEDIAN: (args) => {
    const xs = numsOrError(args);
    if (!Array.isArray(xs)) return xs;
    if (xs.length === 0) return ERR.NUM;
    const sorted = [...xs].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2
      ? (sorted[mid] as number)
      : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
  },
  MODE: (args) => {
    const xs = numsOrError(args);
    if (!Array.isArray(xs)) return xs;
    const counts = new Map<number, number>();
    let best: number | undefined;
    let bestCount = 1;
    for (const x of xs) {
      const c = (counts.get(x) ?? 0) + 1;
      counts.set(x, c);
      if (c > bestCount) {
        bestCount = c;
        best = x;
      }
    }
    return best === undefined ? ERR.NA : best;
  },
  VAR: (args) => variance(args, true),
  'VAR.S': (args) => variance(args, true),
  VARP: (args) => variance(args, false),
  'VAR.P': (args) => variance(args, false),
  STDEV: (args) => stdev(args, true),
  'STDEV.S': (args) => stdev(args, true),
  STDEVP: (args) => stdev(args, false),
  'STDEV.P': (args) => stdev(args, false),
  LARGE: (args) => kth(args, 'large'),
  SMALL: (args) => kth(args, 'small'),
  RANK: (args) => rankImpl(args),
  'RANK.EQ': (args) => rankImpl(args),
  PERCENTILE: (args) => percentile(args),
  'PERCENTILE.INC': (args) => percentile(args),
  QUARTILE: (args) => {
    const data = numsOrError([args[0]]);
    if (!Array.isArray(data)) return data;
    const q = toNumber(asScalar(args[1]));
    if (isError(q)) return q;
    const frac = (q as number) / 4;
    return percentileOf(data, frac);
  },
  GEOMEAN: (args) => {
    const xs = numsOrError(args);
    if (!Array.isArray(xs)) return xs;
    if (xs.some((x) => x <= 0)) return ERR.NUM;
    const logSum = xs.reduce((a, b) => a + Math.log(b), 0);
    return Math.exp(logSum / xs.length);
  },
  HARMEAN: (args) => {
    const xs = numsOrError(args);
    if (!Array.isArray(xs)) return xs;
    if (xs.some((x) => x <= 0)) return ERR.NUM;
    const recip = xs.reduce((a, b) => a + 1 / b, 0);
    return xs.length / recip;
  },
  AVEDEV: (args) => {
    const xs = numsOrError(args);
    if (!Array.isArray(xs)) return xs;
    if (xs.length === 0) return ERR.NUM;
    const m = mean(xs);
    return xs.reduce((a, b) => a + Math.abs(b - m), 0) / xs.length;
  },
  DEVSQ: (args) => {
    const xs = numsOrError(args);
    if (!Array.isArray(xs)) return xs;
    const m = mean(xs);
    return xs.reduce((a, b) => a + (b - m) ** 2, 0);
  },
  CORREL: (args) => correl(args),
  PEARSON: (args) => correl(args),
  SLOPE: (args) => {
    const r = pairs(args[1], args[0]);
    if (isError(r)) return r as CellValue;
    const { xs, ys } = r as { xs: number[]; ys: number[] };
    const mx = mean(xs);
    const my = mean(ys);
    let num = 0;
    let den = 0;
    for (let i = 0; i < xs.length; i++) {
      const x = xs[i] as number;
      const y = ys[i] as number;
      num += (x - mx) * (y - my);
      den += (x - mx) ** 2;
    }
    return den === 0 ? ERR.DIV0 : num / den;
  },
  INTERCEPT: (args) => {
    const r = pairs(args[1], args[0]);
    if (isError(r)) return r as CellValue;
    const { xs, ys } = r as { xs: number[]; ys: number[] };
    const mx = mean(xs);
    const my = mean(ys);
    let num = 0;
    let den = 0;
    for (let i = 0; i < xs.length; i++) {
      const x = xs[i] as number;
      const y = ys[i] as number;
      num += (x - mx) * (y - my);
      den += (x - mx) ** 2;
    }
    if (den === 0) return ERR.DIV0;
    const slope = num / den;
    return my - slope * mx;
  },
};

function coerceA(v: CellValue): number | CellValue {
  if (isError(v)) return v;
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v instanceof Date) return toNumber(v) as number;
  return 0; // text counts as 0
}

function variance(args: ReadonlyArray<FnArg | undefined>, sample: boolean): CellValue {
  const xs = numsOrError(args);
  if (!Array.isArray(xs)) return xs;
  const n = xs.length;
  if (n < (sample ? 2 : 1)) return ERR.DIV0;
  const m = mean(xs);
  const ss = xs.reduce((a, b) => a + (b - m) ** 2, 0);
  return ss / (sample ? n - 1 : n);
}

function stdev(args: ReadonlyArray<FnArg | undefined>, sample: boolean): CellValue {
  const v = variance(args, sample);
  if (isError(v)) return v;
  return Math.sqrt(v as number);
}

function kth(args: ReadonlyArray<FnArg | undefined>, which: 'large' | 'small'): CellValue {
  const data = numsOrError([args[0]]);
  if (!Array.isArray(data)) return data;
  const k = toNumber(asScalar(args[1]));
  if (isError(k)) return k;
  const kk = Math.floor(k as number);
  if (kk < 1 || kk > data.length) return ERR.NUM;
  const sorted = [...data].sort((a, b) => (which === 'large' ? b - a : a - b));
  return sorted[kk - 1] as number;
}

function rankImpl(args: ReadonlyArray<FnArg | undefined>): CellValue {
  const x = toNumber(asScalar(args[0]));
  if (isError(x)) return x;
  const data = numsOrError([args[1]]);
  if (!Array.isArray(data)) return data;
  const order = args.length > 2 ? toNumber(asScalar(args[2])) : 0;
  if (isError(order)) return order;
  const ascending = (order as number) !== 0;
  const sorted = [...data].sort((a, b) => (ascending ? a - b : b - a));
  const idx = sorted.indexOf(x as number);
  return idx === -1 ? ERR.NA : idx + 1;
}

function percentile(args: ReadonlyArray<FnArg | undefined>): CellValue {
  const data = numsOrError([args[0]]);
  if (!Array.isArray(data)) return data;
  const k = toNumber(asScalar(args[1]));
  if (isError(k)) return k;
  return percentileOf(data, k as number);
}

function percentileOf(data: number[], k: number): CellValue {
  if (k < 0 || k > 1) return ERR.NUM;
  if (data.length === 0) return ERR.NUM;
  const sorted = [...data].sort((a, b) => a - b);
  const pos = k * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo] as number;
  return (sorted[lo] as number) + (pos - lo) * ((sorted[hi] as number) - (sorted[lo] as number));
}

function pairs(
  aArg: FnArg | undefined,
  bArg: FnArg | undefined,
): { xs: number[]; ys: number[] } | CellValue {
  const ax = flattenNumbers([aArg]);
  const bx = flattenNumbers([bArg]);
  if ('error' in ax) return ax.error;
  if ('error' in bx) return bx.error;
  if (ax.length !== bx.length) return ERR.NA;
  return { xs: ax, ys: bx };
}

function correl(args: ReadonlyArray<FnArg | undefined>): CellValue {
  const r = pairs(args[0], args[1]);
  if (isError(r)) return r as CellValue;
  const { xs, ys } = r as { xs: number[]; ys: number[] };
  const mx = mean(xs);
  const my = mean(ys);
  let cov = 0;
  let vx = 0;
  let vy = 0;
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i] as number;
    const y = ys[i] as number;
    cov += (x - mx) * (y - my);
    vx += (x - mx) ** 2;
    vy += (y - my) ** 2;
  }
  const den = Math.sqrt(vx * vy);
  return den === 0 ? ERR.DIV0 : cov / den;
}
