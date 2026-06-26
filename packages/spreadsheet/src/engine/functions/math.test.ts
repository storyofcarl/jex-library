import { describe, expect, it } from 'vitest';
import { evalFormula, isErrorCode } from '../test-utils.js';

describe('math functions', () => {
  it('SUM / PRODUCT', () => {
    expect(evalFormula('SUM(1,2,3,4)')).toBe(10);
    expect(evalFormula('PRODUCT(2,3,4)')).toBe(24);
  });

  it('ABS / SIGN / SQRT', () => {
    expect(evalFormula('ABS(-7)')).toBe(7);
    expect(evalFormula('SIGN(-3)')).toBe(-1);
    expect(evalFormula('SQRT(16)')).toBe(4);
    expect(isErrorCode(evalFormula('SQRT(-1)'), '#NUM!')).toBe(true);
  });

  it('POWER / EXP / LN / LOG', () => {
    expect(evalFormula('POWER(2,8)')).toBe(256);
    expect(evalFormula('LN(1)')).toBe(0);
    expect(evalFormula('LOG(1000)') as number).toBeCloseTo(3);
    expect(evalFormula('LOG(8,2)') as number).toBeCloseTo(3);
  });

  it('MOD / QUOTIENT', () => {
    expect(evalFormula('MOD(10,3)')).toBe(1);
    expect(evalFormula('MOD(-10,3)')).toBe(2);
    expect(evalFormula('QUOTIENT(10,3)')).toBe(3);
    expect(isErrorCode(evalFormula('MOD(1,0)'), '#DIV/0!')).toBe(true);
  });

  it('ROUND family', () => {
    expect(evalFormula('ROUND(2.345,2)')).toBe(2.35);
    expect(evalFormula('ROUND(2.5,0)')).toBe(3);
    expect(evalFormula('ROUNDUP(2.1,0)')).toBe(3);
    expect(evalFormula('ROUNDDOWN(2.9,0)')).toBe(2);
    expect(evalFormula('ROUND(-2.5,0)')).toBe(-3);
  });

  it('CEILING / FLOOR / INT / TRUNC', () => {
    expect(evalFormula('CEILING(4.1,1)')).toBe(5);
    expect(evalFormula('FLOOR(4.9,1)')).toBe(4);
    expect(evalFormula('INT(4.9)')).toBe(4);
    expect(evalFormula('INT(-4.1)')).toBe(-5);
    expect(evalFormula('TRUNC(4.99,1)')).toBe(4.9);
  });

  it('GCD / LCM / FACT / COMBIN', () => {
    expect(evalFormula('GCD(12,18)')).toBe(6);
    expect(evalFormula('LCM(4,6)')).toBe(12);
    expect(evalFormula('FACT(5)')).toBe(120);
    expect(evalFormula('COMBIN(5,2)')).toBe(10);
    expect(evalFormula('PERMUT(5,2)')).toBe(20);
  });

  it('EVEN / ODD', () => {
    expect(evalFormula('EVEN(3)')).toBe(4);
    expect(evalFormula('ODD(2)')).toBe(3);
  });

  it('PI / trig / DEGREES / RADIANS', () => {
    expect(evalFormula('PI()')).toBeCloseTo(Math.PI);
    expect(evalFormula('SIN(0)')).toBe(0);
    expect(evalFormula('COS(0)')).toBe(1);
    expect(evalFormula('DEGREES(PI())')).toBeCloseTo(180);
    expect(evalFormula('RADIANS(180)')).toBeCloseTo(Math.PI);
  });

  it('SUMSQ / SUMPRODUCT', () => {
    expect(evalFormula('SUMSQ(3,4)')).toBe(25);
    expect(evalFormula('SUMPRODUCT(A1:A2,B1:B2)', { A1: 1, A2: 2, B1: 3, B2: 4 })).toBe(11);
  });

  it('ROMAN / BASE / DECIMAL', () => {
    expect(evalFormula('ROMAN(1994)')).toBe('MCMXCIV');
    expect(evalFormula('BASE(255,16)')).toBe('FF');
    expect(evalFormula('DECIMAL("FF",16)')).toBe(255);
  });
});
