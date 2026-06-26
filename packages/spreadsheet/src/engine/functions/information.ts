/**
 * Information worksheet functions: type tests (ISNUMBER, ISBLANK, …), NA(),
 * ERROR.TYPE, N(), TYPE.
 */

import type { CellValue, SpreadsheetFunction } from '../../contract.js';
import { ERR, isBlank, isError, toNumber } from '../errors.js';
import { type FnArg, asScalar, isMatrix } from '../helpers.js';

function v(a: FnArg | undefined): CellValue {
  return asScalar(a);
}

const ERROR_TYPE_MAP: Record<string, number> = {
  '#NULL!': 1,
  '#DIV/0!': 2,
  '#VALUE!': 3,
  '#REF!': 4,
  '#NAME?': 5,
  '#NUM!': 6,
  '#N/A': 7,
  '#SPILL!': 9,
  '#CALC!': 14,
  '#CYCLE!': 8,
};

export const informationFunctions: Record<string, SpreadsheetFunction> = {
  ISNUMBER: (args) => typeof v(args[0]) === 'number' || v(args[0]) instanceof Date,
  ISTEXT: (args) => typeof v(args[0]) === 'string',
  ISNONTEXT: (args) => typeof v(args[0]) !== 'string',
  ISLOGICAL: (args) => typeof v(args[0]) === 'boolean',
  ISBLANK: (args) => {
    const a = args[0];
    if (isMatrix(a)) return isBlank(a[0]?.[0] ?? null);
    return isBlank(a as CellValue);
  },
  ISERROR: (args) => isError(v(args[0])),
  ISERR: (args) => {
    const val = v(args[0]);
    return isError(val) && val.code !== '#N/A';
  },
  ISNA: (args) => {
    const val = v(args[0]);
    return isError(val) && val.code === '#N/A';
  },
  ISEVEN: (args) => {
    const num = toNumber(v(args[0]));
    if (isError(num)) return num;
    return Math.floor(Math.abs(num as number)) % 2 === 0;
  },
  ISODD: (args) => {
    const num = toNumber(v(args[0]));
    if (isError(num)) return num;
    return Math.floor(Math.abs(num as number)) % 2 === 1;
  },
  ISREF: () => false, // refs are resolved to values before the function sees them
  ISFORMULA: () => false,
  NA: () => ERR.NA,
  'ERROR.TYPE': (args) => {
    const val = v(args[0]);
    if (isError(val)) return ERROR_TYPE_MAP[val.code] ?? ERR.NA;
    return ERR.NA;
  },
  N: (args) => {
    const val = v(args[0]);
    if (isError(val)) return val;
    if (typeof val === 'number') return val;
    if (typeof val === 'boolean') return val ? 1 : 0;
    if (val instanceof Date) return toNumber(val);
    return 0;
  },
  TYPE: (args) => {
    const a = args[0];
    if (isMatrix(a)) return 64;
    const val = a as CellValue;
    if (isError(val)) return 16;
    if (typeof val === 'number' || val instanceof Date) return 1;
    if (typeof val === 'string') return 2;
    if (typeof val === 'boolean') return 4;
    return 1;
  },
};
