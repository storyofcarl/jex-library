import { describe, expect, it } from 'vitest';
import { evalFormula, isErrorCode } from '../test-utils.js';

const table = {
  A1: 'apple',
  B1: 1,
  A2: 'banana',
  B2: 2,
  A3: 'cherry',
  B3: 3,
};

describe('lookup functions', () => {
  it('VLOOKUP exact', () => {
    expect(evalFormula('VLOOKUP("banana",A1:B3,2,FALSE)', table)).toBe(2);
    expect(isErrorCode(evalFormula('VLOOKUP("x",A1:B3,2,FALSE)', table), '#N/A')).toBe(true);
  });

  it('VLOOKUP approximate', () => {
    const nums = { A1: 1, B1: 'a', A2: 5, B2: 'b', A3: 10, B3: 'c' };
    expect(evalFormula('VLOOKUP(7,A1:B3,2,TRUE)', nums)).toBe('b');
  });

  it('HLOOKUP', () => {
    const h = { A1: 'x', B1: 'y', A2: 10, B2: 20 };
    expect(evalFormula('HLOOKUP("y",A1:B2,2,FALSE)', h)).toBe(20);
  });

  it('INDEX', () => {
    expect(evalFormula('INDEX(A1:B3,2,2)', table)).toBe(2);
    expect(evalFormula('INDEX(A1:A3,3,1)', table)).toBe('cherry');
  });

  it('MATCH', () => {
    expect(evalFormula('MATCH("cherry",A1:A3,0)', table)).toBe(3);
    const nums = { A1: 1, A2: 3, A3: 5 };
    expect(evalFormula('MATCH(4,A1:A3,1)', nums)).toBe(2);
  });

  it('INDEX + MATCH', () => {
    expect(evalFormula('INDEX(B1:B3,MATCH("banana",A1:A3,0))', table)).toBe(2);
  });

  it('XLOOKUP', () => {
    expect(evalFormula('XLOOKUP("cherry",A1:A3,B1:B3)', table)).toBe(3);
    expect(evalFormula('XLOOKUP("x",A1:A3,B1:B3,"miss")', table)).toBe('miss');
  });

  it('XMATCH', () => {
    expect(evalFormula('XMATCH("banana",A1:A3)', table)).toBe(2);
  });

  it('XMATCH approximate picks the closest, not the first qualifying', () => {
    // Unsorted {1,3,10,7}; mode 1 = smallest value >= lookup; closest is 7 (idx 4).
    const nums = { A1: 1, A2: 3, A3: 10, A4: 7 };
    expect(evalFormula('XMATCH(5,A1:A4,1)', nums)).toBe(4);
    // mode -1 = largest value <= lookup; closest is 3 (idx 2).
    expect(evalFormula('XMATCH(5,A1:A4,-1)', nums)).toBe(2);
  });

  it('CHOOSE', () => {
    expect(evalFormula('CHOOSE(2,"a","b","c")')).toBe('b');
  });

  it('ROWS / COLUMNS', () => {
    expect(evalFormula('ROWS(A1:B3)', table)).toBe(3);
    expect(evalFormula('COLUMNS(A1:B3)', table)).toBe(2);
  });

  it('LOOKUP', () => {
    const nums = { A1: 1, A2: 3, A3: 5, B1: 'a', B2: 'b', B3: 'c' };
    expect(evalFormula('LOOKUP(3,A1:A3,B1:B3)', nums)).toBe('b');
  });
});
