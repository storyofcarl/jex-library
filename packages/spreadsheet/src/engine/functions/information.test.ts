import { describe, expect, it } from 'vitest';
import { evalFormula, isErrorCode } from '../test-utils.js';

describe('information functions', () => {
  it('ISNUMBER / ISTEXT / ISLOGICAL', () => {
    expect(evalFormula('ISNUMBER(5)')).toBe(true);
    expect(evalFormula('ISNUMBER("x")')).toBe(false);
    expect(evalFormula('ISTEXT("x")')).toBe(true);
    expect(evalFormula('ISLOGICAL(TRUE)')).toBe(true);
  });

  it('ISBLANK', () => {
    expect(evalFormula('ISBLANK(A1)', {})).toBe(true);
    expect(evalFormula('ISBLANK(A1)', { A1: 1 })).toBe(false);
  });

  it('ISERROR / ISERR / ISNA', () => {
    expect(evalFormula('ISERROR(1/0)')).toBe(true);
    expect(evalFormula('ISERR(1/0)')).toBe(true);
    expect(evalFormula('ISERR(#N/A)')).toBe(false);
    expect(evalFormula('ISNA(#N/A)')).toBe(true);
  });

  it('ISEVEN / ISODD', () => {
    expect(evalFormula('ISEVEN(4)')).toBe(true);
    expect(evalFormula('ISODD(3)')).toBe(true);
  });

  it('NA / ERROR.TYPE', () => {
    expect(isErrorCode(evalFormula('NA()'), '#N/A')).toBe(true);
    expect(evalFormula('ERROR.TYPE(1/0)')).toBe(2);
  });

  it('N / TYPE', () => {
    expect(evalFormula('N(5)')).toBe(5);
    expect(evalFormula('N("x")')).toBe(0);
    expect(evalFormula('TYPE(5)')).toBe(1);
    expect(evalFormula('TYPE("x")')).toBe(2);
  });
});
