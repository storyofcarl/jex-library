import {
  type NumericScale,
  type ScaleTick,
  niceTicks,
  niceBounds,
  defaultNumberFormat,
} from './scale.js';

export interface LinearScaleOptions {
  domain: readonly [number, number];
  range: readonly [number, number];
  /** If set, expand the domain to nice round bounds. */
  nice?: boolean | undefined;
  tickCount?: number | undefined;
  format?: ((v: number) => string) | undefined;
}

/** A continuous linear scale: y = m·x + b. */
export class LinearScale implements NumericScale {
  readonly kind = 'linear' as const;
  domain: readonly [number, number];
  range: readonly [number, number];
  private readonly tickCount: number;
  private readonly fmt: (v: number) => string;

  constructor(opts: LinearScaleOptions) {
    let [d0, d1] = opts.domain;
    if (opts.nice) [d0, d1] = niceBounds(d0, d1, opts.tickCount ?? 5);
    // Avoid degenerate zero-width domains.
    if (d0 === d1) {
      d0 -= 1;
      d1 += 1;
    }
    this.domain = [d0, d1];
    this.range = opts.range;
    this.tickCount = opts.tickCount ?? 5;
    this.fmt = opts.format ?? defaultNumberFormat;
  }

  scale(value: number): number {
    const [d0, d1] = this.domain;
    const [r0, r1] = this.range;
    const t = (value - d0) / (d1 - d0);
    return r0 + t * (r1 - r0);
  }

  invert(pixel: number): number {
    const [d0, d1] = this.domain;
    const [r0, r1] = this.range;
    const t = (pixel - r0) / (r1 - r0);
    return d0 + t * (d1 - d0);
  }

  ticks(count = this.tickCount): ScaleTick[] {
    const [d0, d1] = this.domain;
    return niceTicks(d0, d1, count).map((value) => ({
      value,
      position: this.scale(value),
      label: this.fmt(value),
    }));
  }

  format(value: number): string {
    return this.fmt(value);
  }
}
