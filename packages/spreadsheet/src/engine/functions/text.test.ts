import { describe, expect, it } from 'vitest';
import { evalFormula, isErrorCode } from '../test-utils.js';
import { textFunctions } from './text.js';

describe('text functions', () => {
  it('CONCAT / CONCATENATE / TEXTJOIN', () => {
    expect(evalFormula('CONCATENATE("a","b","c")')).toBe('abc');
    expect(evalFormula('CONCAT("x",1,TRUE)')).toBe('x1TRUE');
    expect(evalFormula('TEXTJOIN("-",TRUE,"a","","b")')).toBe('a-b');
  });

  it('LEN / LEFT / RIGHT / MID', () => {
    expect(evalFormula('LEN("hello")')).toBe(5);
    expect(evalFormula('LEFT("hello",2)')).toBe('he');
    expect(evalFormula('RIGHT("hello",3)')).toBe('llo');
    expect(evalFormula('MID("hello",2,3)')).toBe('ell');
  });

  it('UPPER / LOWER / PROPER / TRIM', () => {
    expect(evalFormula('UPPER("abc")')).toBe('ABC');
    expect(evalFormula('LOWER("ABC")')).toBe('abc');
    expect(evalFormula('PROPER("hello world")')).toBe('Hello World');
    expect(evalFormula('TRIM("  a   b  ")')).toBe('a b');
  });

  it('REPT / SUBSTITUTE / REPLACE', () => {
    expect(evalFormula('REPT("ab",3)')).toBe('ababab');
    expect(evalFormula('SUBSTITUTE("a-b-c","-","+")')).toBe('a+b+c');
    expect(evalFormula('SUBSTITUTE("a-b-c","-","+",2)')).toBe('a-b+c');
    expect(evalFormula('REPLACE("abcdef",2,3,"XY")')).toBe('aXYef');
  });

  it('FIND / SEARCH (case sensitivity)', () => {
    expect(evalFormula('FIND("b","abc")')).toBe(2);
    expect(evalFormula('SEARCH("B","abc")')).toBe(2);
    expect(isErrorCode(evalFormula('FIND("B","abc")'), '#VALUE!')).toBe(true);
  });

  it('EXACT', () => {
    expect(evalFormula('EXACT("a","a")')).toBe(true);
    expect(evalFormula('EXACT("a","A")')).toBe(false);
  });

  it('TEXT formatting', () => {
    expect(evalFormula('TEXT(1234.5,"#,##0.00")')).toBe('1,234.50');
    expect(evalFormula('TEXT(0.25,"0%")')).toBe('25%');
  });

  it('VALUE / CHAR / CODE', () => {
    expect(evalFormula('VALUE("42")')).toBe(42);
    expect(evalFormula('CHAR(65)')).toBe('A');
    expect(evalFormula('CODE("A")')).toBe(65);
  });

  it('TEXTBEFORE / TEXTAFTER', () => {
    expect(evalFormula('TEXTBEFORE("a@b","@")')).toBe('a');
    expect(evalFormula('TEXTAFTER("a@b","@")')).toBe('b');
  });

  it('TEXT date patterns resolve mm as minutes in time contexts', () => {
    const TEXT = textFunctions.TEXT as (args: unknown[]) => unknown;
    const d = new Date(2024, 0, 1, 13, 45, 30);
    // mm between hh and ss → minutes, not month.
    expect(TEXT([d, 'hh:mm:ss'])).toBe('13:45:30');
    // mm after hh → minutes.
    expect(TEXT([d, 'hh:mm'])).toBe('13:45');
    // mm in a pure date context → month.
    expect(TEXT([new Date(2024, 2, 9), 'yyyy-mm-dd'])).toBe('2024-03-09');
    // Mixed: date mm is month, time mm is minutes.
    expect(TEXT([new Date(2024, 2, 9, 8, 7, 0), 'mm/dd/yyyy hh:mm'])).toBe('03/09/2024 08:07');
  });
});
