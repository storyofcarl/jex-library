/**
 * Shared helpers for the @jects/timeline-core interactions layer.
 *
 * The interaction primitives in this folder (drag / resize / drag-create,
 * dependency-line routing, positioning, tooltips) are framework-free and operate
 * purely against the FROZEN contract types from `../contract.ts` — they never
 * reach into engine internals. These helpers keep each primitive small and
 * consistent:
 *
 *  - `Disposers` — a leak-proof disposer bag so every primitive's `destroy()` is
 *    a one-liner that can never accumulate listeners across press/release cycles.
 *  - `clamp` / `nearestSnap` — geometry maths reused by drag and resize.
 *  - `addListener` — typed `addEventListener` that returns its own disposer.
 */

import type {
  TimeAxis,
  TimeMs,
  TimeSpan,
  DurationMs,
} from '../contract.js';

/**
 * A leak-proof disposer bag. Each interaction primitive owns one and empties it
 * in `destroy()`. Disposers run in reverse registration order, exactly once, and
 * a throwing disposer never aborts teardown of the rest.
 */
export class Disposers {
  private fns: Array<() => void> = [];
  private done = false;

  /** Register a disposer. If already disposed, runs it immediately. */
  add(fn: () => void): void {
    if (this.done) {
      fn();
      return;
    }
    this.fns.push(fn);
  }

  /** Run every disposer (reverse order) exactly once. */
  dispose(): void {
    if (this.done) return;
    this.done = true;
    for (let i = this.fns.length - 1; i >= 0; i--) {
      try {
        this.fns[i]!();
      } catch {
        /* a disposer must never break teardown of the rest */
      }
    }
    this.fns = [];
  }

  get size(): number {
    return this.fns.length;
  }

  get disposed(): boolean {
    return this.done;
  }
}

/**
 * Bind a DOM listener and return a disposer that removes it. Keeps each
 * primitive's wiring declarative and leak-safe (the disposer goes straight into
 * a `Disposers` bag).
 */
export function addListener<K extends keyof HTMLElementEventMap>(
  target: HTMLElement,
  type: K,
  fn: (ev: HTMLElementEventMap[K]) => void,
  options?: AddEventListenerOptions | boolean,
): () => void;
export function addListener<K extends keyof WindowEventMap>(
  target: Window,
  type: K,
  fn: (ev: WindowEventMap[K]) => void,
  options?: AddEventListenerOptions | boolean,
): () => void;
export function addListener(
  target: HTMLElement | Window,
  type: string,
  fn: (ev: Event) => void,
  options?: AddEventListenerOptions | boolean,
): () => void {
  target.addEventListener(type, fn as EventListener, options);
  return () => target.removeEventListener(type, fn as EventListener, options);
}

/** Clamp `n` into the inclusive `[min, max]` range (handles inverted bounds). */
export function clamp(n: number, min: number, max: number): number {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  return Math.min(hi, Math.max(lo, n));
}

/**
 * Snap a time to the nearest tick boundary via the axis. The axis owns the
 * tick grid, so we delegate; `enabled === false` returns the time untouched
 * (lets callers toggle snapping per gesture, e.g. holding a modifier key).
 */
export function snapTime(axis: TimeAxis, time: TimeMs, enabled = true): TimeMs {
  return enabled ? axis.snap(time) : time;
}

/** Duration of a span in ms (never negative). */
export function spanDuration(span: TimeSpan): DurationMs {
  return Math.max(0, span.end - span.start);
}

/** Shift a span by a time delta, preserving its duration. */
export function shiftSpan(span: TimeSpan, deltaMs: number): TimeSpan {
  return { start: span.start + deltaMs, end: span.end + deltaMs };
}

/** Convert a pixel delta to a time delta at the axis' current scale. */
export function pxToDelta(axis: TimeAxis, dx: number): number {
  // toTime is affine over the content, so the time-delta of a pixel-delta is
  // the difference of two projections from a common origin.
  return axis.toTime(dx) - axis.toTime(0);
}

/** True when two spans are identical (start AND end). */
export function spansEqual(a: TimeSpan, b: TimeSpan): boolean {
  return a.start === b.start && a.end === b.end;
}
