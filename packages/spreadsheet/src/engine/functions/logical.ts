/**
 * Logical worksheet functions: IF / IFS / AND / OR / NOT / IFERROR / SWITCH …
 */

import type { CellValue, SpreadsheetFunction } from '../../contract.js';
import { ERR, isBlank, isError, toBoolean } from '../errors.js';
import { asScalar, flatten, looseEquals } from '../helpers.js';

function truthy(v: CellValue): boolean | CellValue {
  const b = toBoolean(v);
  return b;
}

export const logicalFunctions: Record<string, SpreadsheetFunction> = {
  TRUE: () => true,
  FALSE: () => false,
  NOT: (args) => {
    const b = truthy(asScalar(args[0]));
    if (isError(b)) return b;
    return !b;
  },
  AND: (args) => {
    const vals = flatten(args);
    let seen = false;
    for (const v of vals) {
      if (isBlank(v)) continue;
      const b = toBoolean(v);
      if (isError(b)) return b;
      seen = true;
      if (!b) return false;
    }
    return seen ? true : ERR.VALUE;
  },
  OR: (args) => {
    const vals = flatten(args);
    let seen = false;
    for (const v of vals) {
      if (isBlank(v)) continue;
      const b = toBoolean(v);
      if (isError(b)) return b;
      seen = true;
      if (b) return true;
    }
    return seen ? false : ERR.VALUE;
  },
  XOR: (args) => {
    const vals = flatten(args);
    let count = 0;
    let seen = false;
    for (const v of vals) {
      if (isBlank(v)) continue;
      const b = toBoolean(v);
      if (isError(b)) return b;
      seen = true;
      if (b) count++;
    }
    return seen ? count % 2 === 1 : ERR.VALUE;
  },
  IF: (args) => {
    const cond = toBoolean(asScalar(args[0]));
    if (isError(cond)) return cond;
    if (cond) return asScalar(args[1] ?? true);
    if (args.length > 2) return asScalar(args[2]);
    return false;
  },
  IFS: (args) => {
    for (let i = 0; i + 1 < args.length; i += 2) {
      const cond = toBoolean(asScalar(args[i]));
      if (isError(cond)) return cond;
      if (cond) return asScalar(args[i + 1]);
    }
    return ERR.NA;
  },
  IFERROR: (args) => {
    const v = asScalar(args[0]);
    if (isError(v)) return asScalar(args[1]);
    return v;
  },
  IFNA: (args) => {
    const v = asScalar(args[0]);
    if (isError(v) && v.code === '#N/A') return asScalar(args[1]);
    return v;
  },
  SWITCH: (args) => {
    const subject = asScalar(args[0]);
    const rest = args.slice(1);
    let i = 0;
    for (; i + 1 < rest.length; i += 2) {
      const candidate = asScalar(rest[i]);
      if (looseEquals(subject, candidate)) return asScalar(rest[i + 1]);
    }
    // Odd trailing arg = default.
    if (i < rest.length) return asScalar(rest[i]);
    return ERR.NA;
  },
};
