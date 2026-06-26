/**
 * Built-in function library — aggregates every category into one map the engine
 * registers at construction. 150+ functions across Math, Statistical, Logical,
 * Text, Date, Financial, Lookup, Information, conditional aggregates, and
 * dynamic arrays.
 */

import type { SpreadsheetFunction } from '../../contract.js';
import { conditionalFunctions } from './conditional.js';
import { dateFunctions } from './datetime.js';
import { dynamicFunctions } from './dynamic.js';
import { financialFunctions } from './financial.js';
import { informationFunctions } from './information.js';
import { logicalFunctions } from './logical.js';
import { lookupFunctions } from './lookup.js';
import { mathFunctions } from './math.js';
import { statisticalFunctions } from './statistical.js';
import { textFunctions } from './text.js';

/** All built-in functions, keyed by UPPERCASE name. */
export const builtinFunctions: Record<string, SpreadsheetFunction> = {
  ...mathFunctions,
  ...statisticalFunctions,
  ...logicalFunctions,
  ...textFunctions,
  ...dateFunctions,
  ...financialFunctions,
  ...lookupFunctions,
  ...informationFunctions,
  ...conditionalFunctions,
  ...dynamicFunctions,
};

/** Count of built-in functions (excluding internal `_`-prefixed helpers). */
export function builtinFunctionCount(): number {
  return Object.keys(builtinFunctions).filter((k) => !k.startsWith('_')).length;
}

export {
  conditionalFunctions,
  dateFunctions,
  dynamicFunctions,
  financialFunctions,
  informationFunctions,
  logicalFunctions,
  lookupFunctions,
  mathFunctions,
  statisticalFunctions,
  textFunctions,
};
