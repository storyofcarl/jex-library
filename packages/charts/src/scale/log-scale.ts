import { type NumericScale, type ScaleTick, defaultNumberFormat } from './scale.js';

export interface LogScaleOptions {
  domain: readonly [number, number];
  range: readonly [number, number];
  /** Log base. Default 10. */
  base?: number | undefined;
  tickCount?: number | undefined;
  format?: ((v: number) => string) | undefined;
}

/** A logarithmic scale. Domain must be strictly positive. */
export class LogScale implements NumericScale {
  readonly kind = 'log' as const;
  domain: readonly [number, number];
  range: readonly [number, number];
  readonly base: number;
  private readonly logBase: number;
  private readonly fmt: (v: number) => string;

  constructor(opts: LogScaleOptions) {
    this.base = opts.base ?? 10;
    this.logBase = Math.log(this.base);
    let [d0, d1] = opts.domain;
    // Clamp to a strictly-positive domain; log of <=0 is undefined.
    if (d0 <= 0) d0 = d1 > 0 ? Math.min(d1, 1) : 1;
    if (d1 <= 0) d1 = d0;
    if (d0 === d1) {
      d0 = d0 / this.base;
      d1 = d1 * this.base;
    }
    this.domain = [d0, d1];
    this.range = opts.range;
    this.fmt = opts.format ?? defaultNumberFormat;
  }

  private log(v: number): number {
    return Math.log(v) / this.logBase;
  }

  scale(value: number): number {
    const v = value <= 0 ? this.domain[0] : value;
    const l0 = this.log(this.domain[0]);
    const l1 = this.log(this.domain[1]);
    const [r0, r1] = this.range;
    const t = (this.log(v) - l0) / (l1 - l0);
    return r0 + t * (r1 - r0);
  }

  invert(pixel: number): number {
    const l0 = this.log(this.domain[0]);
    const l1 = this.log(this.domain[1]);
    const [r0, r1] = this.range;
    const t = (pixel - r0) / (r1 - r0);
    return Math.pow(this.base, l0 + t * (l1 - l0));
  }

  ticks(): ScaleTick[] {
    const [d0, d1] = this.domain;
    const e0 = Math.floor(this.log(d0));
    const e1 = Math.ceil(this.log(d1));
    const out: ScaleTick[] = [];
    for (let e = e0; e <= e1; e++) {
      const value = Math.pow(this.base, e);
      if (value < d0 * (1 - 1e-9) || value > d1 * (1 + 1e-9)) continue;
      out.push({ value, position: this.scale(value), label: this.fmt(value) });
    }
    // If too few power-of-base ticks, the single decade is fine; otherwise return.
    if (out.length === 0) {
      out.push(
        { value: d0, position: this.scale(d0), label: this.fmt(d0) },
        { value: d1, position: this.scale(d1), label: this.fmt(d1) },
      );
    }
    return out;
  }

  format(value: number): string {
    return this.fmt(value);
  }
}
