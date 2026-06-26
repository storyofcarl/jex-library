import { describe, expect, it } from 'vitest';
import { evalFormula, isErrorCode } from '../test-utils.js';

const data = { A1: 2, A2: 4, A3: 4, A4: 4, A5: 5, A6: 5, A7: 7, A8: 9 };

describe('statistical functions', () => {
  it('AVERAGE / MEDIAN / MODE', () => {
    expect(evalFormula('AVERAGE(A1:A8)', data)).toBe(5);
    expect(evalFormula('MEDIAN(A1:A8)', data)).toBe(4.5);
    expect(evalFormula('MODE(A1:A8)', data)).toBe(4);
  });

  it('COUNT / COUNTA / COUNTBLANK', () => {
    expect(evalFormula('COUNT(A1:A4)', { A1: 1, A2: 'x', A4: 3 })).toBe(2);
    expect(evalFormula('COUNTA(A1:A4)', { A1: 1, A2: 'x', A4: 3 })).toBe(3);
    expect(evalFormula('COUNTBLANK(A1:A4)', { A1: 1, A2: 'x', A4: 3 })).toBe(1);
  });

  it('MAX / MIN', () => {
    expect(evalFormula('MAX(A1:A8)', data)).toBe(9);
    expect(evalFormula('MIN(A1:A8)', data)).toBe(2);
  });

  it('STDEV.P / VAR.P', () => {
    expect(evalFormula('VARP(A1:A8)', data)).toBeCloseTo(4);
    expect(evalFormula('STDEVP(A1:A8)', data)).toBeCloseTo(2);
  });

  it('STDEV.S sample variance', () => {
    expect(evalFormula('VAR(A1:A8)', data)).toBeCloseTo(4.571, 2);
  });

  it('LARGE / SMALL', () => {
    expect(evalFormula('LARGE(A1:A8,1)', data)).toBe(9);
    expect(evalFormula('SMALL(A1:A8,1)', data)).toBe(2);
    expect(evalFormula('LARGE(A1:A8,2)', data)).toBe(7);
  });

  it('RANK', () => {
    expect(evalFormula('RANK(7,A1:A8)', data)).toBe(2);
  });

  it('PERCENTILE / QUARTILE', () => {
    expect(evalFormula('PERCENTILE(A1:A8,0.5)', data)).toBe(4.5);
    expect(evalFormula('QUARTILE(A1:A8,2)', data)).toBe(4.5);
  });

  it('GEOMEAN / HARMEAN', () => {
    expect(evalFormula('GEOMEAN(A1:A3)', { A1: 1, A2: 2, A3: 4 })).toBeCloseTo(2);
    expect(evalFormula('HARMEAN(A1:A2)', { A1: 1, A2: 1 })).toBe(1);
  });

  it('CORREL / SLOPE / INTERCEPT', () => {
    const xy = { A1: 1, A2: 2, A3: 3, B1: 2, B2: 4, B3: 6 };
    expect(evalFormula('CORREL(A1:A3,B1:B3)', xy)).toBeCloseTo(1);
    expect(evalFormula('SLOPE(B1:B3,A1:A3)', xy)).toBeCloseTo(2);
    expect(evalFormula('INTERCEPT(B1:B3,A1:A3)', xy)).toBeCloseTo(0);
  });

  it('AVERAGE of empty → #DIV/0!', () => {
    expect(isErrorCode(evalFormula('AVERAGE(A1:A2)', {}), '#DIV/0!')).toBe(true);
  });
});
