/**
 * Financial worksheet functions: time-value-of-money, depreciation, etc.
 */

import type { CellValue, SpreadsheetFunction } from '../../contract.js';
import { ERR, isError, toNumber } from '../errors.js';
import { type FnArg, asScalar, flattenNumbers } from '../helpers.js';

function n(a: FnArg | undefined, dflt = 0): number | CellValue {
  if (a === undefined) return dflt;
  const s = asScalar(a);
  if (s === '' || s === null) return dflt;
  return toNumber(s as CellValue);
}

function need(...vs: Array<number | CellValue>): CellValue | undefined {
  for (const v of vs) if (isError(v)) return v;
  return undefined;
}

export const financialFunctions: Record<string, SpreadsheetFunction> = {
  PV: (args) => {
    const rate = n(args[0]);
    const nper = n(args[1]);
    const pmt = n(args[2]);
    const fv = n(args[3], 0);
    const type = n(args[4], 0);
    const e = need(rate, nper, pmt, fv, type);
    if (e) return e;
    return pvCalc(rate as number, nper as number, pmt as number, fv as number, type as number);
  },
  FV: (args) => {
    const rate = n(args[0]);
    const nper = n(args[1]);
    const pmt = n(args[2]);
    const pv = n(args[3], 0);
    const type = n(args[4], 0);
    const e = need(rate, nper, pmt, pv, type);
    if (e) return e;
    return fvCalc(rate as number, nper as number, pmt as number, pv as number, type as number);
  },
  PMT: (args) => {
    const rate = n(args[0]);
    const nper = n(args[1]);
    const pv = n(args[2]);
    const fv = n(args[3], 0);
    const type = n(args[4], 0);
    const e = need(rate, nper, pv, fv, type);
    if (e) return e;
    return pmtCalc(rate as number, nper as number, pv as number, fv as number, type as number);
  },
  IPMT: (args) => {
    const rate = n(args[0]);
    const per = n(args[1]);
    const nper = n(args[2]);
    const pv = n(args[3]);
    const fv = n(args[4], 0);
    const type = n(args[5], 0);
    const e = need(rate, per, nper, pv, fv, type);
    if (e) return e;
    const r = rate as number;
    const pmt = pmtCalc(r, nper as number, pv as number, fv as number, type as number);
    if (isError(pmt)) return pmt;
    const bal = fvCalc(r, (per as number) - 1, pmt as number, pv as number, type as number);
    if (isError(bal)) return bal;
    let interest = (bal as number) * r;
    if ((type as number) === 1) interest /= 1 + r;
    return interest;
  },
  PPMT: (args) => {
    const rate = n(args[0]);
    const per = n(args[1]);
    const nper = n(args[2]);
    const pv = n(args[3]);
    const fv = n(args[4], 0);
    const type = n(args[5], 0);
    const e = need(rate, per, nper, pv, fv, type);
    if (e) return e;
    const pmt = pmtCalc(rate as number, nper as number, pv as number, fv as number, type as number);
    if (isError(pmt)) return pmt;
    const ipmt = (financialFunctions.IPMT as SpreadsheetFunction)(args, {} as never);
    if (isError(ipmt)) return ipmt;
    return (pmt as number) - (ipmt as number);
  },
  NPER: (args) => {
    const rate = n(args[0]);
    const pmt = n(args[1]);
    const pv = n(args[2]);
    const fv = n(args[3], 0);
    const type = n(args[4], 0);
    const e = need(rate, pmt, pv, fv, type);
    if (e) return e;
    const r = rate as number;
    const p = pmt as number;
    if (r === 0) {
      if (p === 0) return ERR.NUM;
      return -((pv as number) + (fv as number)) / p;
    }
    const adj = p * (1 + r * (type as number));
    const num = adj - (fv as number) * r;
    const den = (pv as number) * r + adj;
    if (num / den <= 0) return ERR.NUM;
    return Math.log(num / den) / Math.log(1 + r);
  },
  RATE: (args) => {
    const nper = n(args[0]);
    const pmt = n(args[1]);
    const pv = n(args[2]);
    const fv = n(args[3], 0);
    const type = n(args[4], 0);
    const guess = n(args[5], 0.1);
    const e = need(nper, pmt, pv, fv, type, guess);
    if (e) return e;
    return rateCalc(
      nper as number,
      pmt as number,
      pv as number,
      fv as number,
      type as number,
      guess as number,
    );
  },
  NPV: (args) => {
    const rate = n(args[0]);
    if (isError(rate)) return rate;
    const flows = flattenNumbers(args.slice(1));
    if ('error' in flows) return flows.error;
    let total = 0;
    flows.forEach((cf, i) => {
      total += cf / Math.pow(1 + (rate as number), i + 1);
    });
    return total;
  },
  IRR: (args) => {
    const flows = flattenNumbers([args[0]]);
    if ('error' in flows) return flows.error;
    const guess = n(args[1], 0.1);
    if (isError(guess)) return guess;
    return irrCalc(flows, guess as number);
  },
  SLN: (args) => {
    const cost = n(args[0]);
    const salvage = n(args[1]);
    const life = n(args[2]);
    const e = need(cost, salvage, life);
    if (e) return e;
    if ((life as number) === 0) return ERR.DIV0;
    return ((cost as number) - (salvage as number)) / (life as number);
  },
  SYD: (args) => {
    const cost = n(args[0]);
    const salvage = n(args[1]);
    const life = n(args[2]);
    const per = n(args[3]);
    const e = need(cost, salvage, life, per);
    if (e) return e;
    const l = life as number;
    return (
      (((cost as number) - (salvage as number)) * (l - (per as number) + 1) * 2) /
      (l * (l + 1))
    );
  },
  DB: (args) => {
    const cost = n(args[0]);
    const salvage = n(args[1]);
    const life = n(args[2]);
    const period = n(args[3]);
    const e = need(cost, salvage, life, period);
    if (e) return e;
    const c = cost as number;
    const s = salvage as number;
    const l = life as number;
    const rate = Math.round((1 - Math.pow(s / c, 1 / l)) * 1000) / 1000;
    let total = 0;
    let dep = 0;
    for (let i = 1; i <= (period as number); i++) {
      dep = (c - total) * rate;
      total += dep;
    }
    return dep;
  },
  DDB: (args) => {
    const cost = n(args[0]);
    const salvage = n(args[1]);
    const life = n(args[2]);
    const period = n(args[3]);
    const factor = n(args[4], 2);
    const e = need(cost, salvage, life, period, factor);
    if (e) return e;
    const c = cost as number;
    const s = salvage as number;
    const l = life as number;
    const f = factor as number;
    let total = 0;
    let dep = 0;
    for (let i = 1; i <= (period as number); i++) {
      dep = Math.min(((c - total) * f) / l, c - s - total);
      if (dep < 0) dep = 0;
      total += dep;
    }
    return dep;
  },
  EFFECT: (args) => {
    const nominal = n(args[0]);
    const npery = n(args[1]);
    const e = need(nominal, npery);
    if (e) return e;
    const p = Math.floor(npery as number);
    if (p < 1) return ERR.NUM;
    return Math.pow(1 + (nominal as number) / p, p) - 1;
  },
  NOMINAL: (args) => {
    const effect = n(args[0]);
    const npery = n(args[1]);
    const e = need(effect, npery);
    if (e) return e;
    const p = Math.floor(npery as number);
    if (p < 1) return ERR.NUM;
    return (Math.pow((effect as number) + 1, 1 / p) - 1) * p;
  },
};

function pvCalc(rate: number, nper: number, pmt: number, fv: number, type: number): number {
  if (rate === 0) return -(pmt * nper + fv);
  const f = Math.pow(1 + rate, nper);
  return -(fv + pmt * (1 + rate * type) * ((f - 1) / rate)) / f;
}
function fvCalc(rate: number, nper: number, pmt: number, pv: number, type: number): number {
  if (rate === 0) return -(pv + pmt * nper);
  const f = Math.pow(1 + rate, nper);
  return -(pv * f + pmt * (1 + rate * type) * ((f - 1) / rate));
}
function pmtCalc(rate: number, nper: number, pv: number, fv: number, type: number): number | CellValue {
  if (nper === 0) return ERR.NUM;
  if (rate === 0) return -(pv + fv) / nper;
  const f = Math.pow(1 + rate, nper);
  return -(rate * (fv + pv * f)) / ((1 + rate * type) * (f - 1));
}
function rateCalc(
  nper: number,
  pmt: number,
  pv: number,
  fv: number,
  type: number,
  guess: number,
): number | CellValue {
  let rate = guess;
  for (let i = 0; i < 100; i++) {
    const f = Math.pow(1 + rate, nper);
    const y =
      rate === 0
        ? pv + pmt * nper + fv
        : pv * f + pmt * (1 + rate * type) * ((f - 1) / rate) + fv;
    // Numerical derivative.
    const dr = 1e-6;
    const f2 = Math.pow(1 + rate + dr, nper);
    const y2 =
      rate + dr === 0
        ? pv + pmt * nper + fv
        : pv * f2 + pmt * (1 + (rate + dr) * type) * ((f2 - 1) / (rate + dr)) + fv;
    const deriv = (y2 - y) / dr;
    if (deriv === 0) break;
    const next = rate - y / deriv;
    if (Math.abs(next - rate) < 1e-8) return next;
    rate = next;
  }
  return Math.abs(rate) < 1 ? rate : ERR.NUM;
}
function irrCalc(flows: number[], guess: number): number | CellValue {
  let rate = guess;
  for (let iter = 0; iter < 100; iter++) {
    let npv = 0;
    let dnpv = 0;
    for (let i = 0; i < flows.length; i++) {
      const cf = flows[i] as number;
      npv += cf / Math.pow(1 + rate, i);
      dnpv += (-i * cf) / Math.pow(1 + rate, i + 1);
    }
    if (dnpv === 0) break;
    const next = rate - npv / dnpv;
    if (Math.abs(next - rate) < 1e-8) return next;
    rate = next;
  }
  return ERR.NUM;
}
