import { describe, expect, it } from 'vitest';
import { evalFormula } from '../test-utils.js';

describe('financial functions', () => {
  it('PMT', () => {
    // 0.5%/mo, 360 months, $200k loan.
    expect(evalFormula('PMT(0.005,360,200000)') as number).toBeCloseTo(-1199.1, 0);
  });

  it('FV', () => {
    expect(evalFormula('FV(0.005,12,-100,0)') as number).toBeCloseTo(1233.56, 1);
  });

  it('PV', () => {
    expect(evalFormula('PV(0.005,12,-100)') as number).toBeCloseTo(1161.89, 1);
  });

  it('NPER', () => {
    expect(evalFormula('NPER(0.01,-100,1000)') as number).toBeCloseTo(10.59, 1);
  });

  it('RATE', () => {
    expect(evalFormula('RATE(12,-100,1000)') as number).toBeCloseTo(0.0292, 3);
  });

  it('NPV', () => {
    expect(evalFormula('NPV(0.1,100,200,300)') as number).toBeCloseTo(481.59, 1);
  });

  it('IRR', () => {
    expect(evalFormula('IRR(A1:A4)', { A1: -100, A2: 40, A3: 40, A4: 40 }) as number).toBeCloseTo(
      0.0993,
      2,
    );
  });

  it('SLN / SYD', () => {
    expect(evalFormula('SLN(1000,100,5)')).toBe(180);
    expect(evalFormula('SYD(1000,100,5,1)')).toBe(300);
  });

  it('DDB', () => {
    expect(evalFormula('DDB(1000,100,5,1)') as number).toBeCloseTo(400, 0);
  });

  it('EFFECT / NOMINAL', () => {
    expect(evalFormula('EFFECT(0.12,12)') as number).toBeCloseTo(0.1268, 3);
    expect(evalFormula('NOMINAL(0.1268,12)') as number).toBeCloseTo(0.12, 2);
  });
});
