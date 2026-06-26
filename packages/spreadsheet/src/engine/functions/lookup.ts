/**
 * Lookup & reference worksheet functions: VLOOKUP / HLOOKUP / XLOOKUP / INDEX /
 * MATCH / XMATCH / LOOKUP / CHOOSE / ROW(S) / COLUMN(S) / TRANSPOSE.
 */

import type { CellValue, SpreadsheetFunction } from '../../contract.js';
import { ERR, isBlank, isError, toNumber } from '../errors.js';
import {
  type FnArg,
  asScalar,
  compareValues,
  isMatrix,
  looseEquals,
  wildcardToRegExp,
} from '../helpers.js';

/** Null-coalesce an index access. */
function nz(v: CellValue | undefined): CellValue {
  return v ?? null;
}
/** First column of a matrix as a vector. */
function firstColumn(m: CellValue[][]): CellValue[] {
  return m.map((r) => nz(r[0]));
}
/** First row of a matrix as a vector. */
function firstRow(m: CellValue[][]): CellValue[] {
  return (m[0] ?? []).map(nz);
}

export const lookupFunctions: Record<string, SpreadsheetFunction> = {
  VLOOKUP: (args) => {
    const lookup = asScalar(args[0]);
    if (isError(lookup)) return lookup;
    const table = args[1];
    if (!isMatrix(table)) return ERR.NA;
    const colIndex = toNumber(asScalar(args[2]));
    if (isError(colIndex)) return colIndex;
    const ci = Math.floor(colIndex as number);
    if (ci < 1 || ci > (table[0]?.length ?? 0)) return ERR.REF;
    const approximate = args.length > 3 ? Boolean(asScalar(args[3])) : true;
    const idx = findInColumn(firstColumn(table), lookup, approximate);
    if (idx === -1) return ERR.NA;
    return nz(table[idx]?.[ci - 1]);
  },
  HLOOKUP: (args) => {
    const lookup = asScalar(args[0]);
    if (isError(lookup)) return lookup;
    const table = args[1];
    if (!isMatrix(table)) return ERR.NA;
    const rowIndex = toNumber(asScalar(args[2]));
    if (isError(rowIndex)) return rowIndex;
    const ri = Math.floor(rowIndex as number);
    if (ri < 1 || ri > table.length) return ERR.REF;
    const approximate = args.length > 3 ? Boolean(asScalar(args[3])) : true;
    const idx = findInColumn(firstRow(table), lookup, approximate);
    if (idx === -1) return ERR.NA;
    return nz(table[ri - 1]?.[idx]);
  },
  LOOKUP: (args) => {
    const lookup = asScalar(args[0]);
    if (isError(lookup)) return lookup;
    const vector = args[1];
    if (!isMatrix(vector)) return ERR.NA;
    const lookupVec = (vector[0]?.length ?? 0) >= vector.length ? firstRow(vector) : firstColumn(vector);
    const result = args.length > 2 ? args[2] : vector;
    const idx = findInColumn(lookupVec, lookup, true);
    if (idx === -1) return ERR.NA;
    if (isMatrix(result)) {
      const flat = (result[0]?.length ?? 0) >= result.length ? firstRow(result) : firstColumn(result);
      return nz(flat[idx]) ?? ERR.NA;
    }
    return asScalar(result);
  },
  MATCH: (args) => {
    const lookup = asScalar(args[0]);
    if (isError(lookup)) return lookup;
    const arr = toFlatVector(args[1]);
    const matchType = args.length > 2 ? toNumber(asScalar(args[2])) : 1;
    if (isError(matchType)) return matchType;
    const idx = matchImpl(arr, lookup, matchType as number);
    return idx === -1 ? ERR.NA : idx + 1;
  },
  XMATCH: (args) => {
    const lookup = asScalar(args[0]);
    if (isError(lookup)) return lookup;
    const arr = toFlatVector(args[1]);
    const matchMode = args.length > 2 ? toNumber(asScalar(args[2])) : 0;
    if (isError(matchMode)) return matchMode;
    const idx = xmatchImpl(arr, lookup, matchMode as number);
    return idx === -1 ? ERR.NA : idx + 1;
  },
  INDEX: (args) => {
    const arr = args[0];
    const rowNum = args.length > 1 ? toNumber(asScalar(args[1])) : 0;
    if (isError(rowNum)) return rowNum;
    const colNum = args.length > 2 ? toNumber(asScalar(args[2])) : 0;
    if (isError(colNum)) return colNum;
    const matrix = isMatrix(arr) ? arr : [[asScalar(arr)]];
    const r = Math.floor(rowNum as number);
    const c = Math.floor(colNum as number);
    const rows = matrix.length;
    const cols = matrix[0]?.length ?? 0;
    if (rows === 1 && args.length <= 2) {
      return nz((matrix[0] ?? [])[r - 1]) ?? ERR.REF;
    }
    if (cols === 1 && args.length <= 2) {
      return nz(matrix[r - 1]?.[0]) ?? ERR.REF;
    }
    if (r === 0 && c === 0) return matrix as CellValue[][];
    if (r === 0) {
      if (c < 1 || c > cols) return ERR.REF;
      return matrix.map((row) => [nz(row[c - 1])]);
    }
    if (c === 0) {
      if (r < 1 || r > rows) return ERR.REF;
      return [(matrix[r - 1] ?? []).map(nz)];
    }
    if (r < 1 || r > rows || c < 1 || c > cols) return ERR.REF;
    return nz(matrix[r - 1]?.[c - 1]);
  },
  XLOOKUP: (args) => xlookupImpl(args),
  CHOOSE: (args) => {
    const idx = toNumber(asScalar(args[0]));
    if (isError(idx)) return idx;
    const i = Math.floor(idx as number);
    if (i < 1 || i > args.length - 1) return ERR.VALUE;
    return asScalar(args[i]);
  },
  ROWS: (args) => {
    const a = args[0];
    return isMatrix(a) ? a.length : 1;
  },
  COLUMNS: (args) => {
    const a = args[0];
    return isMatrix(a) ? a[0]?.length ?? 0 : 1;
  },
  TRANSPOSE: (args) => {
    const a = args[0];
    const m = isMatrix(a) ? a : [[asScalar(a)]];
    return transposeGrid(m);
  },
};

function transposeGrid(m: CellValue[][]): CellValue[][] {
  const rows = m.length;
  const cols = m[0]?.length ?? 0;
  const out: CellValue[][] = [];
  for (let c = 0; c < cols; c++) {
    const row: CellValue[] = [];
    for (let r = 0; r < rows; r++) row.push(nz(m[r]?.[c]));
    out.push(row);
  }
  return out;
}

function toFlatVector(a: FnArg | undefined): CellValue[] {
  if (!isMatrix(a)) return [asScalar(a)];
  if (a.length === 1) return (a[0] ?? []).map(nz);
  return firstColumn(a);
}

/**
 * Find a value in a column. With `approximate`, performs the Excel
 * "largest value ≤ lookup" assuming an ascending-sorted column; otherwise an
 * exact (case-insensitive, wildcard-aware for text) match.
 */
function findInColumn(col: CellValue[], lookup: CellValue, approximate: boolean): number {
  if (!approximate) {
    return exactMatch(col, lookup);
  }
  let result = -1;
  for (let i = 0; i < col.length; i++) {
    const v = nz(col[i]);
    if (isBlank(v)) continue;
    if (compareValues(v, lookup) <= 0) result = i;
    else break;
  }
  return result;
}

function exactMatch(col: CellValue[], lookup: CellValue): number {
  if (typeof lookup === 'string' && /[*?~]/.test(lookup)) {
    const re = wildcardToRegExp(lookup);
    for (let i = 0; i < col.length; i++) {
      const v = col[i];
      if (typeof v === 'string' && re.test(v)) return i;
    }
    return -1;
  }
  for (let i = 0; i < col.length; i++) {
    if (looseEquals(nz(col[i]), lookup)) return i;
  }
  return -1;
}

function matchImpl(arr: CellValue[], lookup: CellValue, matchType: number): number {
  if (matchType === 0) {
    return exactMatch(arr, lookup);
  }
  if (matchType > 0) {
    let result = -1;
    for (let i = 0; i < arr.length; i++) {
      const v = nz(arr[i]);
      if (isBlank(v)) continue;
      if (compareValues(v, lookup) <= 0) result = i;
      else break;
    }
    return result;
  }
  let result = -1;
  for (let i = 0; i < arr.length; i++) {
    const v = nz(arr[i]);
    if (isBlank(v)) continue;
    if (compareValues(v, lookup) >= 0) result = i;
    else break;
  }
  return result;
}

function xmatchImpl(arr: CellValue[], lookup: CellValue, mode: number): number {
  if (mode === 2) {
    return exactMatch(arr, lookup);
  }
  const exact = exactMatch(arr, lookup);
  if (exact !== -1 || mode === 0) return exact;
  // Approximate modes: pick the value CLOSEST to `lookup` among qualifying
  // candidates — the smallest value >= lookup (mode 1) or the largest value
  // <= lookup (mode -1) — measuring real magnitude rather than the sign-only
  // compareValues result (which would otherwise pick the first, not closest).
  if (mode === 1) {
    let best = -1;
    let bestDist = Infinity;
    for (let i = 0; i < arr.length; i++) {
      const v = nz(arr[i]);
      if (isBlank(v)) continue;
      if (compareValues(v, lookup) >= 0) {
        const d = approxDistance(v, lookup); // >= 0
        if (d < bestDist) {
          bestDist = d;
          best = i;
        }
      }
    }
    return best;
  }
  let best = -1;
  let bestDist = Infinity;
  for (let i = 0; i < arr.length; i++) {
    const v = nz(arr[i]);
    if (isBlank(v)) continue;
    if (compareValues(v, lookup) <= 0) {
      const d = approxDistance(v, lookup); // >= 0
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
  }
  return best;
}

/**
 * Magnitude of the gap between two values for XMATCH/XLOOKUP approximate ranking.
 * Numbers/dates use the absolute numeric difference; mismatched types or text
 * fall back to lexical distance (0 when ordered-equal, else 1) so a real
 * "closest" candidate is selected rather than merely the first qualifying one.
 */
function approxDistance(v: CellValue, lookup: CellValue): number {
  const nv = toNumber(v);
  const nl = toNumber(lookup);
  if (!isError(nv) && !isError(nl)) {
    return Math.abs((nv as number) - (nl as number));
  }
  return compareValues(v, lookup) === 0 ? 0 : 1;
}

function xlookupImpl(args: ReadonlyArray<FnArg | undefined>): CellValue | CellValue[][] {
  const lookup = asScalar(args[0]);
  if (isError(lookup)) return lookup;
  const lookupArr = args[1];
  const returnArr = args[2];
  const ifNotFound = args.length > 3 ? args[3] : undefined;
  const matchMode = args.length > 4 ? toNumber(asScalar(args[4])) : 0;
  if (isError(matchMode)) return matchMode;

  const lookupVec = toFlatVector(lookupArr);
  const idx = xmatchImpl(lookupVec, lookup, matchMode as number);
  if (idx === -1) {
    if (ifNotFound !== undefined) {
      return isMatrix(ifNotFound) ? ifNotFound : asScalar(ifNotFound);
    }
    return ERR.NA;
  }
  if (isMatrix(returnArr)) {
    const lookupIsColumn = isMatrix(lookupArr) && lookupArr.length >= (lookupArr[0]?.length ?? 0);
    if (lookupIsColumn) {
      const row = returnArr[idx];
      if (!row) return ERR.REF;
      return row.length === 1 ? nz(row[0]) : [row.map(nz)];
    }
    const col = returnArr.map((r) => [nz(r[idx])]);
    return col.length === 1 ? nz(col[0]?.[0]) : col;
  }
  return asScalar(returnArr);
}
