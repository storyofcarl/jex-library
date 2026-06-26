import { describe, expect, it } from 'vitest';
import { evalFormula } from '../test-utils.js';
import { dateToSerial } from '../errors.js';

describe('date functions', () => {
  it('DATE → serial', () => {
    const serial = evalFormula('DATE(2020,1,1)') as number;
    expect(serial).toBe(dateToSerial(new Date(2020, 0, 1)));
  });

  it('YEAR / MONTH / DAY', () => {
    expect(evalFormula('YEAR(DATE(2020,5,15))')).toBe(2020);
    expect(evalFormula('MONTH(DATE(2020,5,15))')).toBe(5);
    expect(evalFormula('DAY(DATE(2020,5,15))')).toBe(15);
  });

  it('WEEKDAY', () => {
    // 2020-01-01 is a Wednesday → type 1 = 4.
    expect(evalFormula('WEEKDAY(DATE(2020,1,1))')).toBe(4);
    expect(evalFormula('WEEKDAY(DATE(2020,1,1),2)')).toBe(3);
  });

  it('EOMONTH / EDATE', () => {
    expect(evalFormula('DAY(EOMONTH(DATE(2020,2,15),0))')).toBe(29); // leap
    expect(evalFormula('MONTH(EDATE(DATE(2020,1,31),1))')).toBe(2);
  });

  it('DATEDIF', () => {
    expect(evalFormula('DATEDIF(DATE(2020,1,1),DATE(2021,1,1),"Y")')).toBe(1);
    expect(evalFormula('DATEDIF(DATE(2020,1,1),DATE(2020,4,1),"M")')).toBe(3);
    expect(evalFormula('DATEDIF(DATE(2020,1,1),DATE(2020,1,15),"D")')).toBe(14);
  });

  it('DATEDIF MD borrows from the start month (no negative result)', () => {
    // Jan 30 → Mar 5: 5 - 30 + 31(Jan days) = 6 (Excel rule).
    expect(evalFormula('DATEDIF(DATE(2024,1,30),DATE(2024,3,5),"MD")')).toBe(6);
    // Same day-of-month: 0.
    expect(evalFormula('DATEDIF(DATE(2024,1,10),DATE(2024,3,10),"MD")')).toBe(0);
    // End day after start day: simple subtraction.
    expect(evalFormula('DATEDIF(DATE(2024,1,5),DATE(2024,3,20),"MD")')).toBe(15);
  });

  it('DAYS', () => {
    expect(evalFormula('DAYS(DATE(2020,1,15),DATE(2020,1,1))')).toBe(14);
  });

  it('NETWORKDAYS', () => {
    // Mon 2020-01-06 .. Fri 2020-01-10 = 5 business days.
    expect(evalFormula('NETWORKDAYS(DATE(2020,1,6),DATE(2020,1,10))')).toBe(5);
  });

  it('TIME fraction', () => {
    expect(evalFormula('TIME(12,0,0)')).toBeCloseTo(0.5);
  });

  it('HOUR / MINUTE', () => {
    expect(evalFormula('HOUR(TIME(13,30,0))')).toBe(13);
    expect(evalFormula('MINUTE(TIME(13,30,0))')).toBe(30);
  });
});
