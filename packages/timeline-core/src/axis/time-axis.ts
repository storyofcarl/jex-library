/**
 * {@link TimeAxis} default implementation — the horizontal time ⇄ pixel
 * projection both Scheduler and Gantt render on. Pure geometry, no DOM.
 *
 * ## Why a tick table rather than a single linear scale
 *
 * For fixed-length units (hour/day/week) time→pixel is a clean linear map. But
 * the contract's `tickUnit` may be `month`/`quarter`/`year`, whose cells differ
 * in real length (28–31 days, 90–92 days, 365–366 days). A single
 * milliseconds-per-pixel constant would make February visibly narrower than
 * March. To keep every tick the *same pixel width* while spanning its true
 * duration, the axis precomputes a table of finest-lane tick boundaries: each
 * entry stores the tick's start time and its left pixel offset. `toX`/`toTime`
 * then binary-search this table and interpolate within the located tick.
 *
 * For fixed units the table is still exact and the interpolation collapses to a
 * straight line, so there is no accuracy cost. The table is rebuilt only when
 * the range, preset, or zoom changes (via `setView`/`setRange`).
 */

import type {
  TimeAxis,
  TimeSpan,
  TimeMs,
  DurationMs,
  ViewPreset,
  TimeTick,
} from '../contract.js';
import { addUnits, floorToUnit, isFixedUnit, fixedUnitMs } from './time-units.js';
import { clampZoom } from './presets.js';

/** One precomputed finest-lane tick boundary: start time ↔ left pixel offset. */
interface TickEntry {
  /** Tick start time (UTC ms), unit-aligned for tick 0, then calendar-stepped. */
  time: TimeMs;
  /** Left pixel offset of this tick within axis content. */
  x: number;
  /** Pixel width of this tick (constant per zoom; cached to avoid re-derivation). */
  width: number;
}

export interface TimeAxisConfig {
  /** Total time range the axis covers. */
  range: TimeSpan;
  /** Active view preset. */
  preset: ViewPreset;
  /** Initial zoom multiplier (snapped to the preset's `zoomLevels`). Default 1. */
  zoom?: number;
  /** Optional callback fired after any re-projection (range/view change). */
  onChange?: () => void;
}

export class DefaultTimeAxis implements TimeAxis {
  private _range: TimeSpan;
  private _preset: ViewPreset;
  private _zoom: number;
  private readonly onChange: (() => void) | undefined;

  /** Sorted ascending by time/x. Always has ≥ 1 entry; last is the right edge. */
  private ticks: TickEntry[] = [];
  private _contentWidth = 0;
  /** Pixel width of one finest tick at the current preset+zoom. */
  private tickPx = 0;

  constructor(config: TimeAxisConfig) {
    this._range = normalizeRange(config.range);
    this._preset = config.preset;
    this._zoom = clampZoom(config.preset, config.zoom ?? 1);
    this.onChange = config.onChange;
    this.rebuild();
  }

  /* ── readonly projection state ──────────────────────────────────────── */

  get range(): TimeSpan {
    return this._range;
  }
  get preset(): ViewPreset {
    return this._preset;
  }
  get zoom(): number {
    return this._zoom;
  }
  get contentWidth(): number {
    return this._contentWidth;
  }

  /* ── time ⇄ pixel projection ────────────────────────────────────────── */

  toX(time: TimeMs): number {
    const t = clamp(time, this._range.start, this._range.end);
    // Binary search for the tick whose [time, nextTime) contains `t`.
    const i = this.tickIndexForTime(t);
    const tick = this.ticks[i]!;
    const next = this.ticks[i + 1];
    const tickStart = tick.time;
    const tickEnd = next ? next.time : this._range.end;
    const span = tickEnd - tickStart;
    if (span <= 0) return tick.x;
    const frac = (t - tickStart) / span;
    return tick.x + frac * tick.width;
  }

  toTime(x: number): TimeMs {
    const px = clamp(x, 0, this._contentWidth);
    const i = this.tickIndexForX(px);
    const tick = this.ticks[i]!;
    const next = this.ticks[i + 1];
    const tickStart = tick.time;
    const tickEnd = next ? next.time : this._range.end;
    const w = tick.width;
    if (w <= 0) return tickStart;
    const frac = (px - tick.x) / w;
    return Math.round(tickStart + frac * (tickEnd - tickStart));
  }

  spanToBox(span: TimeSpan): { x: number; width: number } {
    const x = this.toX(span.start);
    const x2 = this.toX(span.end);
    return { x, width: Math.max(0, x2 - x) };
  }

  durationToWidth(duration: DurationMs): number {
    if (duration <= 0) return 0;
    // Width of a duration depends on where it sits when units are variable, so
    // measure from the range start (a stable, representative anchor). For fixed
    // units this is exact everywhere; for calendar units it is the width the
    // duration occupies starting at the range origin.
    const end = Math.min(this._range.end, this._range.start + duration);
    return this.toX(end) - this.toX(this._range.start);
  }

  /* ── tick generation ────────────────────────────────────────────────── */

  ticksInRange(xStart: number, xEnd: number): TimeTick[] {
    const lo = clamp(Math.min(xStart, xEnd), 0, this._contentWidth);
    const hi = clamp(Math.max(xStart, xEnd), 0, this._contentWidth);
    const out: TimeTick[] = [];
    // The last entry is the right-edge sentinel (no real tick), so stop before it.
    const lastReal = this.ticks.length - 1;
    let i = this.tickIndexForX(lo);
    for (; i < lastReal; i++) {
      const tick = this.ticks[i]!;
      if (tick.x > hi) break;
      const next = this.ticks[i + 1]!;
      out.push({
        index: i,
        span: { start: tick.time, end: next.time },
        x: tick.x,
        width: tick.width,
        major: this.isMajorBoundary(tick.time),
      });
    }
    return out;
  }

  snap(time: TimeMs): TimeMs {
    const { unit, increment } = this.finest();
    const t = clamp(time, this._range.start, this._range.end);
    // Find the bounding tick and snap to whichever boundary is nearer.
    const i = this.tickIndexForTime(t);
    const tick = this.ticks[i]!;
    const start = tick.time;
    const end = this.ticks[i + 1]?.time ?? addUnits(start, unit, increment);
    return t - start <= end - t ? start : end;
  }

  /* ── view / range control ───────────────────────────────────────────── */

  setView(view: { preset?: ViewPreset; zoom?: number }): void {
    let changed = false;
    if (view.preset && view.preset.id !== this._preset.id) {
      this._preset = view.preset;
      changed = true;
    }
    const nextZoom = clampZoom(this._preset, view.zoom ?? this._zoom);
    if (nextZoom !== this._zoom) {
      this._zoom = nextZoom;
      changed = true;
    }
    if (changed) {
      this.rebuild();
      this.onChange?.();
    }
  }

  setRange(range: TimeSpan): void {
    const next = normalizeRange(range);
    if (next.start === this._range.start && next.end === this._range.end) return;
    this._range = next;
    this.rebuild();
    this.onChange?.();
  }

  /* ── internals ──────────────────────────────────────────────────────── */

  /** The finest (bottom) lane unit + increment from the preset. */
  private finest(): { unit: TimeAxis['preset']['tickUnit']; increment: number } {
    return { unit: this._preset.tickUnit, increment: this._preset.tickIncrement ?? 1 };
  }

  /** Pixel width of one finest tick at the active preset + zoom. */
  private computeTickPx(): number {
    const { increment } = this.finest();
    return this._preset.pxPerUnit * increment * this._zoom;
  }

  /**
   * Rebuild the tick table for the current range/preset/zoom. Walks the calendar
   * from the floored range start to the range end, one tick per `increment`
   * units, assigning each a fixed pixel width.
   */
  private rebuild(): void {
    const { unit, increment } = this.finest();
    this.tickPx = this.computeTickPx();
    const ticks: TickEntry[] = [];

    // Tick 0 starts at the unit boundary at/just before the range start so cells
    // align to natural boundaries (a "day" tick starts at midnight, etc.).
    let t = floorToUnit(this._range.start, unit);
    let x = 0;
    // If the range starts mid-tick, the first tick's left edge is at a negative
    // offset relative to range start; we keep content origin at range.start, so
    // shift so x=0 corresponds to range.start. Compute the offset of range.start
    // within its first tick and subtract.
    const firstTickEnd = addUnits(t, unit, increment);
    const firstTickSpan = firstTickEnd - t;
    const leadFrac = firstTickSpan > 0 ? (this._range.start - t) / firstTickSpan : 0;
    const originShift = leadFrac * this.tickPx;

    let guard = 0;
    while (t < this._range.end) {
      ticks.push({ time: t, x: x - originShift, width: this.tickPx });
      t = addUnits(t, unit, increment);
      x += this.tickPx;
      if (++guard > 5_000_000) break; // pathological-range safety valve
    }
    // Right-edge sentinel: maps range.end → contentWidth so interpolation of the
    // final real tick has a well-defined upper bound.
    const lastX = ticks.length > 0 ? ticks[ticks.length - 1]!.x + this.tickPx : 0;
    this._contentWidth = Math.max(0, lastX);
    ticks.push({ time: this._range.end, x: this._contentWidth, width: 0 });

    // Re-anchor: the first real tick may have a negative x (range starts mid-cell).
    // Clamp content origin so x=0 is range.start. Recompute by shifting all by the
    // first real tick's negative lead, then setting contentWidth to last sentinel.
    if (ticks.length > 1 && ticks[0]!.x < 0) {
      const shift = -ticks[0]!.x;
      for (const e of ticks) e.x += shift;
      this._contentWidth = ticks[ticks.length - 1]!.x;
    }
    this.ticks = ticks;
  }

  /** Binary search: index of the tick entry whose [time, next.time) contains t. */
  private tickIndexForTime(t: TimeMs): number {
    const arr = this.ticks;
    let lo = 0;
    let hi = arr.length - 1; // last entry is the sentinel at range.end
    if (t <= arr[0]!.time) return 0;
    if (t >= arr[hi]!.time) return Math.max(0, hi - 1);
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (arr[mid]!.time <= t) lo = mid;
      else hi = mid - 1;
    }
    return Math.min(lo, arr.length - 2);
  }

  /** Binary search: index of the tick entry whose [x, next.x) contains px. */
  private tickIndexForX(px: number): number {
    const arr = this.ticks;
    let lo = 0;
    let hi = arr.length - 1;
    if (px <= arr[0]!.x) return 0;
    if (px >= arr[hi]!.x) return Math.max(0, hi - 1);
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (arr[mid]!.x <= px) lo = mid;
      else hi = mid - 1;
    }
    return Math.min(lo, arr.length - 2);
  }

  /**
   * Whether a tick boundary coincides with a coarser header band's boundary
   * (drawn as a major gridline). Checks every band above the finest one.
   */
  private isMajorBoundary(time: TimeMs): boolean {
    const headers = this._preset.headers;
    // Bands are coarse→fine; the last is the finest (the tick lane itself).
    for (let b = 0; b < headers.length - 1; b++) {
      const band = headers[b]!;
      const inc = band.increment ?? 1;
      // A boundary is major if the time equals a band-cell start.
      if (this.isUnitBoundary(time, band.unit, inc)) return true;
    }
    return false;
  }

  /** Whether `time` is aligned to the start of an `increment`-sized unit cell. */
  private isUnitBoundary(time: TimeMs, unit: TimeAxis['preset']['tickUnit'], increment: number): boolean {
    const floored = floorToUnit(time, unit);
    if (floored !== time) return false;
    if (increment <= 1) return true;
    // For multi-unit cells, also require alignment to the increment grid.
    if (isFixedUnit(unit)) {
      const step = fixedUnitMs(unit) * increment;
      // Anchor to the range start's unit boundary to define the cell grid.
      const anchor = floorToUnit(this._range.start, unit);
      return (time - anchor) % step === 0;
    }
    return true;
  }
}

/* ── helpers ──────────────────────────────────────────────────────────── */

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Ensure a range is well-formed (`end > start`); swap/repair if not. */
function normalizeRange(range: TimeSpan): TimeSpan {
  let { start, end } = range;
  if (end < start) [start, end] = [end, start];
  if (end === start) end = start + 1;
  return { start, end };
}
