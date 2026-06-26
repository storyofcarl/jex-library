import { describe, expect, it } from 'vitest';
import { evalFormula, isErrorCode } from './test-utils.js';

describe('arithmetic operators', () => {
  it('adds, subtracts, multiplies, divides', () => {
    expect(evalFormula('1+2')).toBe(3);
    expect(evalFormula('5-3')).toBe(2);
    expect(evalFormula('4*3')).toBe(12);
    expect(evalFormula('10/4')).toBe(2.5);
  });

  it('exponent', () => {
    expect(evalFormula('2^10')).toBe(1024);
  });

  it('division by zero → #DIV/0!', () => {
    expect(isErrorCode(evalFormula('1/0'), '#DIV/0!')).toBe(true);
  });

  it('unary minus and percent', () => {
    expect(evalFormula('-5')).toBe(-5);
    expect(evalFormula('50%')).toBe(0.5);
  });

  it('respects precedence', () => {
    expect(evalFormula('1+2*3')).toBe(7);
    expect(evalFormula('(1+2)*3')).toBe(9);
  });
});

describe('comparison & logical operators', () => {
  it('compares numbers', () => {
    expect(evalFormula('1<2')).toBe(true);
    expect(evalFormula('2<=2')).toBe(true);
    expect(evalFormula('3>5')).toBe(false);
    expect(evalFormula('5=5')).toBe(true);
    expect(evalFormula('5<>6')).toBe(true);
  });

  it('compares text case-insensitively for equality', () => {
    expect(evalFormula('"abc"="ABC"')).toBe(true);
  });

  it('concatenation', () => {
    expect(evalFormula('"foo"&"bar"')).toBe('foobar');
    expect(evalFormula('"x"&1')).toBe('x1');
  });
});

describe('references', () => {
  it('reads a cell value', () => {
    expect(evalFormula('A1', { A1: 42 })).toBe(42);
  });

  it('arithmetic over refs', () => {
    expect(evalFormula('A1+B1', { A1: 10, B1: 5 })).toBe(15);
  });

  it('SUM over a range', () => {
    expect(evalFormula('SUM(A1:A3)', { A1: 1, A2: 2, A3: 3 })).toBe(6);
  });

  it('empty cell treated as 0 in arithmetic', () => {
    expect(evalFormula('A1+1', {})).toBe(1);
  });
});

describe('error propagation', () => {
  it('propagates errors through operators', () => {
    expect(isErrorCode(evalFormula('A1+1', { A1: { kind: 'error', code: '#VALUE!' } }), '#VALUE!')).toBe(
      true,
    );
  });

  it('text in arithmetic → #VALUE!', () => {
    expect(isErrorCode(evalFormula('"abc"+1'), '#VALUE!')).toBe(true);
  });

  it('unknown function → #NAME?', () => {
    expect(isErrorCode(evalFormula('NOTAFUNC(1)'), '#NAME?')).toBe(true);
  });

  it('error literal', () => {
    expect(isErrorCode(evalFormula('#N/A'), '#N/A')).toBe(true);
  });
});

describe('IF short-circuit', () => {
  it('does not surface error in untaken branch', () => {
    expect(evalFormula('IF(TRUE, 1, 1/0)')).toBe(1);
    expect(evalFormula('IF(FALSE, 1/0, 2)')).toBe(2);
  });
});

describe('array literals', () => {
  it('evaluates {1,2,3} to its top-left when reduced', () => {
    expect(evalFormula('SUM({1,2,3})')).toBe(6);
  });
});
