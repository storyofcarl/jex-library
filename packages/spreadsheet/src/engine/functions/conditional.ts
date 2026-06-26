/**
 * Conditional-aggregate worksheet functions: SUMIF(S), COUNTIF(S),
 * AVERAGEIF(S), MINIFS, MAXIFS.
 */

import type { CellValue, SpreadsheetFunction } from '../../contract.js';
import { ERR, isError, toNumber } from '../errors.js';
import { type FnArg, asScalar, isMatrix, makeCriteria } from '../helpers.js';

function asGrid(a: FnArg | undefined): CellValue[][] {
  if (isMatrix(a)) return a;
  return [[asScalar(a)]];
}

function flatGrid(g: CellValue[][]): CellValue[] {
  const out: CellValue[] = [];
  for (const row of g) for (const v of row) out.push(v);
  return out;
}

/** Apply N (criteria-range, criteria) pairs, returning a boolean mask. */
function buildMask(
  pairs: Array<{ range: CellValue[]; criteria: CellValue }>,
): boolean[] | CellValue {
  if (pairs.length === 0) return [];
  const len = (pairs[0] as { range: CellValue[] }).range.length;
  for (const p of pairs) {
    if (p.range.length !== len) return ERR.VALUE;
  }
  const mask = new Array<boolean>(len).fill(true);
  for (const p of pairs) {
    const pred = makeCriteria(p.criteria);
    for (let i = 0; i < len; i++) {
      if (mask[i] && !pred(p.range[i] ?? null)) mask[i] = false;
    }
  }
  return mask;
}

export const conditionalFunctions: Record<string, SpreadsheetFunction> = {
  SUMIF: (args) => {
    const range = flatGrid(asGrid(args[0]));
    const criteria = asScalar(args[1]);
    const sumRange = args.length > 2 ? flatGrid(asGrid(args[2])) : range;
    const pred = makeCriteria(criteria);
    let sum = 0;
    for (let i = 0; i < range.length; i++) {
      if (pred(range[i] ?? null)) {
        const n = toNumber(sumRange[i] ?? null);
        if (!isError(n)) sum += n;
      }
    }
    return sum;
  },
  SUMIFS: (args) => {
    const sumRange = flatGrid(asGrid(args[0]));
    const pairs = pairUp(args.slice(1));
    if (isError(pairs)) return pairs as CellValue;
    const mask = buildMask(pairs as Array<{ range: CellValue[]; criteria: CellValue }>);
    if (isError(mask)) return mask;
    let sum = 0;
    (mask as boolean[]).forEach((ok, i) => {
      if (ok) {
        const n = toNumber(sumRange[i] ?? null);
        if (!isError(n)) sum += n;
      }
    });
    return sum;
  },
  COUNTIF: (args) => {
    const range = flatGrid(asGrid(args[0]));
    const pred = makeCriteria(asScalar(args[1]));
    let count = 0;
    for (const v of range) if (pred(v)) count++;
    return count;
  },
  COUNTIFS: (args) => {
    const pairs = pairUp(args);
    if (isError(pairs)) return pairs as CellValue;
    const mask = buildMask(pairs as Array<{ range: CellValue[]; criteria: CellValue }>);
    if (isError(mask)) return mask;
    return (mask as boolean[]).filter(Boolean).length;
  },
  AVERAGEIF: (args) => {
    const range = flatGrid(asGrid(args[0]));
    const criteria = asScalar(args[1]);
    const avgRange = args.length > 2 ? flatGrid(asGrid(args[2])) : range;
    const pred = makeCriteria(criteria);
    let sum = 0;
    let count = 0;
    for (let i = 0; i < range.length; i++) {
      if (pred(range[i] ?? null)) {
        const n = toNumber(avgRange[i] ?? null);
        if (!isError(n) && typeof avgRange[i] === 'number') {
          sum += n;
          count++;
        }
      }
    }
    return count === 0 ? ERR.DIV0 : sum / count;
  },
  AVERAGEIFS: (args) => {
    const avgRange = flatGrid(asGrid(args[0]));
    const pairs = pairUp(args.slice(1));
    if (isError(pairs)) return pairs as CellValue;
    const mask = buildMask(pairs as Array<{ range: CellValue[]; criteria: CellValue }>);
    if (isError(mask)) return mask;
    let sum = 0;
    let count = 0;
    (mask as boolean[]).forEach((ok, i) => {
      if (ok && typeof avgRange[i] === 'number') {
        sum += avgRange[i] as number;
        count++;
      }
    });
    return count === 0 ? ERR.DIV0 : sum / count;
  },
  MINIFS: (args) => minMaxIfs(args, 'min'),
  MAXIFS: (args) => minMaxIfs(args, 'max'),
};

function pairUp(
  args: ReadonlyArray<FnArg | undefined>,
): Array<{ range: CellValue[]; criteria: CellValue }> | CellValue {
  const out: Array<{ range: CellValue[]; criteria: CellValue }> = [];
  for (let i = 0; i + 1 < args.length; i += 2) {
    out.push({ range: flatGrid(asGrid(args[i])), criteria: asScalar(args[i + 1]) });
  }
  return out;
}

function minMaxIfs(args: ReadonlyArray<FnArg | undefined>, which: 'min' | 'max'): CellValue {
  const valRange = flatGrid(asGrid(args[0]));
  const pairs = pairUp(args.slice(1));
  if (isError(pairs)) return pairs as CellValue;
  const mask = buildMask(pairs as Array<{ range: CellValue[]; criteria: CellValue }>);
  if (isError(mask)) return mask;
  const picked: number[] = [];
  (mask as boolean[]).forEach((ok, i) => {
    if (ok && typeof valRange[i] === 'number') picked.push(valRange[i] as number);
  });
  if (picked.length === 0) return 0;
  return which === 'min' ? Math.min(...picked) : Math.max(...picked);
}
