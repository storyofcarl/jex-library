import { describe, expect, it } from 'vitest';
import { builtinFunctionCount, builtinFunctions } from './index.js';
import { FormulaEngineImpl } from '../engine.js';
import { makeWorkbook } from '../test-utils.js';

describe('function library', () => {
  it('registers 150+ public worksheet functions', () => {
    expect(builtinFunctionCount()).toBeGreaterThanOrEqual(150);
  });

  it('engine knows every built-in by name (case-insensitive)', () => {
    const e = new FormulaEngineImpl(makeWorkbook());
    for (const name of Object.keys(builtinFunctions)) {
      if (name.startsWith('_')) continue;
      expect(e.hasFunction(name)).toBe(true);
      expect(e.hasFunction(name.toLowerCase())).toBe(true);
    }
  });

  it('covers each category', () => {
    const names = Object.keys(builtinFunctions);
    // A representative from each category must be present.
    for (const fn of [
      'SUM',
      'AVERAGE',
      'IF',
      'CONCAT',
      'DATE',
      'PMT',
      'VLOOKUP',
      'ISNUMBER',
      'SUMIFS',
      'UNIQUE',
    ]) {
      expect(names).toContain(fn);
    }
  });
});
