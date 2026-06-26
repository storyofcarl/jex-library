import { describe, expect, it } from 'vitest';
import { evalFormula, isErrorCode } from '../test-utils.js';

describe('logical functions', () => {
  it('IF', () => {
    expect(evalFormula('IF(1>0,"yes","no")')).toBe('yes');
    expect(evalFormula('IF(1<0,"yes","no")')).toBe('no');
    expect(evalFormula('IF(FALSE,1)')).toBe(false);
  });

  it('AND / OR / NOT / XOR', () => {
    expect(evalFormula('AND(TRUE,TRUE,1)')).toBe(true);
    expect(evalFormula('AND(TRUE,FALSE)')).toBe(false);
    expect(evalFormula('OR(FALSE,FALSE,1)')).toBe(true);
    expect(evalFormula('NOT(TRUE)')).toBe(false);
    expect(evalFormula('XOR(TRUE,TRUE,TRUE)')).toBe(true);
    expect(evalFormula('XOR(TRUE,TRUE)')).toBe(false);
  });

  it('IFS', () => {
    expect(evalFormula('IFS(FALSE,1,TRUE,2)')).toBe(2);
    expect(isErrorCode(evalFormula('IFS(FALSE,1,FALSE,2)'), '#N/A')).toBe(true);
  });

  it('IFERROR / IFNA', () => {
    expect(evalFormula('IFERROR(1/0,"err")')).toBe('err');
    expect(evalFormula('IFERROR(5,"err")')).toBe(5);
    expect(evalFormula('IFNA(#N/A,"na")')).toBe('na');
    expect(isErrorCode(evalFormula('IFNA(1/0,"na")'), '#DIV/0!')).toBe(true);
  });

  it('SWITCH', () => {
    expect(evalFormula('SWITCH(2,1,"a",2,"b",3,"c")')).toBe('b');
    expect(evalFormula('SWITCH(9,1,"a","default")')).toBe('default');
  });

  it('TRUE / FALSE', () => {
    expect(evalFormula('TRUE()')).toBe(true);
    expect(evalFormula('FALSE()')).toBe(false);
  });
});
