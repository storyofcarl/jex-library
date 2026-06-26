import { type NumericScale, type ScaleTick } from './scale.js';

export interface TimeScaleOptions {
  /** Domain as epoch-millisecond bounds (or Date objects). */
  domain: readonly [number | Date, number | Date];
  range: readonly [number, number];
  tickCount?: number | undefined;
  format?: ((ms: number) => string) | undefined;
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

/** Candidate "nice" time intervals in ms, ascending. */
const TIME_STEPS = [
  SECOND, 5 * SECOND, 15 * SECOND, 30 * SECOND,
  MINUTE, 5 * MINUTE, 15 * MINUTE, 30 * MINUTE,
  HOUR, 3 * HOUR, 6 * HOUR, 12 * HOUR,
  DAY, 2 * DAY, WEEK,
  MONTH, 3 * MONTH, 6 * MONTH,
  YEAR,
];

function toMs(v: number | Date): number {
  return v instanceof Date ? v.getTime() : v;
}

function defaultTimeFormat(ms: number): string {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return String(ms);
  // Compact ISO-ish: date for day-or-coarser, time otherwise.
  const hasTime = d.getUTCHours() !== 0 || d.getUTCMinutes() !== 0 || d.getUTCSeconds() !== 0;
  const date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  if (!hasTime) return date;
  return `${date} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** A time scale — linear in epoch-ms, with calendar-aware nice ticks. */
export class TimeScale implements NumericScale {
  readonly kind = 'time' as const;
  domain: readonly [number, number];
  range: readonly [number, number];
  private readonly tickCount: number;
  private readonly fmt: (ms: number) => string;

  constructor(opts: TimeScaleOptions) {
    let d0 = toMs(opts.domain[0]);
    let d1 = toMs(opts.domain[1]);
    if (d0 === d1) {
      d0 -= HOUR;
      d1 += HOUR;
    }
    this.domain = [d0, d1];
    this.range = opts.range;
    this.tickCount = opts.tickCount ?? 5;
    this.fmt = opts.format ?? defaultTimeFormat;
  }

  scale(value: number | Date): number {
    const v = toMs(value);
    const [d0, d1] = this.domain;
    const [r0, r1] = this.range;
    return r0 + ((v - d0) / (d1 - d0)) * (r1 - r0);
  }

  invert(pixel: number): number {
    const [d0, d1] = this.domain;
    const [r0, r1] = this.range;
    return d0 + ((pixel - r0) / (r1 - r0)) * (d1 - d0);
  }

  /** Pick the smallest TIME_STEP that yields <= count ticks. */
  private chooseStep(count: number): number {
    const span = this.domain[1] - this.domain[0];
    const target = span / Math.max(count, 1);
    for (const step of TIME_STEPS) {
      if (step >= target) return step;
    }
    return TIME_STEPS[TIME_STEPS.length - 1]!;
  }

  ticks(count = this.tickCount): ScaleTick[] {
    const step = this.chooseStep(count);
    const [d0, d1] = this.domain;
    const start = Math.ceil(d0 / step) * step;
    const out: ScaleTick[] = [];
    for (let t = start; t <= d1 + 1e-6; t += step) {
      out.push({ value: t, position: this.scale(t), label: this.fmt(t) });
      if (out.length > 1000) break;
    }
    return out;
  }

  format(value: number): string {
    return this.fmt(value);
  }
}
