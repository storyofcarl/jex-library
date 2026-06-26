import { type CategoryScale, type ScaleTick } from './scale.js';

export interface CategoryScaleOptions {
  domain: readonly string[];
  range: readonly [number, number];
  /** Inner padding as a fraction of step [0..1). Default 0.1. */
  padding?: number | undefined;
  format?: ((v: string, index: number) => string) | undefined;
}

/** A band/category scale — discrete categories mapped to evenly-spaced bands. */
export class BandScale implements CategoryScale {
  readonly kind = 'category' as const;
  domain: readonly string[];
  range: readonly [number, number];
  bandwidth: number;
  private readonly step: number;
  private readonly start: number;
  private readonly index = new Map<string, number>();
  private readonly fmt: (v: string, index: number) => string;

  constructor(opts: CategoryScaleOptions) {
    this.domain = opts.domain;
    this.range = opts.range;
    const padding = Math.min(Math.max(opts.padding ?? 0.1, 0), 0.999);
    this.fmt = opts.format ?? ((v) => v);

    const n = Math.max(this.domain.length, 1);
    const [r0, r1] = this.range;
    const span = r1 - r0;
    this.step = span / n;
    this.bandwidth = this.step * (1 - padding);
    // Center the first band, offsetting by half the inner padding.
    this.start = r0 + (this.step - this.bandwidth) / 2;
    this.domain.forEach((c, i) => this.index.set(c, i));
  }

  /** Left edge of the band for the i-th category. */
  private bandStart(i: number): number {
    return this.start + i * this.step;
  }

  /** Map a category to the CENTER pixel of its band. */
  scale(value: number | string): number {
    const i = typeof value === 'number' ? value : this.index.get(value) ?? -1;
    if (i < 0) return NaN;
    return this.bandStart(i) + this.bandwidth / 2;
  }

  /** Center pixel of a category band (or NaN if absent). */
  scaleBand(category: string): number {
    const i = this.index.get(category);
    return i === undefined ? NaN : this.bandStart(i) + this.bandwidth / 2;
  }

  /** Left edge of a category band. */
  bandLeft(category: string | number): number {
    const i = typeof category === 'number' ? category : this.index.get(category) ?? -1;
    return i < 0 ? NaN : this.bandStart(i);
  }

  ticks(): ScaleTick[] {
    return this.domain.map((c, i) => ({
      value: i,
      position: this.scale(i),
      label: this.fmt(c, i),
    }));
  }

  format(value: number): string {
    const c = this.domain[value];
    return c === undefined ? String(value) : this.fmt(c, value);
  }
}
