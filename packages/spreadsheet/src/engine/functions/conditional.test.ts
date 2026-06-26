import { describe, expect, it } from 'vitest';
import { evalFormula } from '../test-utils.js';

const sales = {
  A1: 'east',
  B1: 100,
  A2: 'west',
  B2: 200,
  A3: 'east',
  B3: 150,
  A4: 'west',
  B4: 50,
};

describe('conditional aggregates', () => {
  it('SUMIF', () => {
    expect(evalFormula('SUMIF(A1:A4,"east",B1:B4)', sales)).toBe(250);
    expect(evalFormula('SUMIF(B1:B4,">100")', sales)).toBe(350);
  });

  it('COUNTIF', () => {
    expect(evalFormula('COUNTIF(A1:A4,"west")', sales)).toBe(2);
    expect(evalFormula('COUNTIF(B1:B4,">=100")', sales)).toBe(3);
  });

  it('AVERAGEIF', () => {
    expect(evalFormula('AVERAGEIF(A1:A4,"east",B1:B4)', sales)).toBe(125);
  });

  it('SUMIFS multi-criteria', () => {
    expect(evalFormula('SUMIFS(B1:B4,A1:A4,"east",B1:B4,">100")', sales)).toBe(150);
  });

  it('COUNTIFS', () => {
    expect(evalFormula('COUNTIFS(A1:A4,"west",B1:B4,"<100")', sales)).toBe(1);
  });

  it('AVERAGEIFS', () => {
    expect(evalFormula('AVERAGEIFS(B1:B4,A1:A4,"west")', sales)).toBe(125);
  });

  it('MINIFS / MAXIFS', () => {
    expect(evalFormula('MINIFS(B1:B4,A1:A4,"east")', sales)).toBe(100);
    expect(evalFormula('MAXIFS(B1:B4,A1:A4,"west")', sales)).toBe(200);
  });

  it('wildcards in criteria', () => {
    const d = { A1: 'apple', B1: 1, A2: 'apricot', B2: 2, A3: 'banana', B3: 3 };
    expect(evalFormula('SUMIF(A1:A3,"ap*",B1:B3)', d)).toBe(3);
  });
});
