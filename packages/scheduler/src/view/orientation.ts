/**
 * Orientation abstraction for the Scheduler's geometry.
 *
 * The scheduler renders two orthogonal axes:
 *
 *   - the **main** axis — the time axis, projected by `@jects/timeline-core`'s
 *     `TimeAxis` (`toX`/`toTime`/`spanToBox`/`ticksInRange`/`contentWidth`). The
 *     axis is dimension-agnostic: it always returns a single scalar "along time"
 *     coordinate. Which screen dimension that scalar drives is the orientation's
 *     job.
 *   - the **cross** axis — the resource axis (lanes). In `horizontal` mode lanes
 *     are stacked rows (cross = Y); in `vertical` mode lanes are columns laid out
 *     left-to-right (cross = X) and time flows DOWN.
 *
 * This module turns the axis's scalar projection + a `(mainStart, mainSize)` /
 * `(crossStart, crossSize)` box into concrete CSS box properties, and turns a
 * pointer's `clientX`/`clientY` into the main/cross content coordinate the
 * gesture math needs. Both the horizontal renderer and the new vertical renderer
 * consume the same `Orientation` so the geometry is written once.
 *
 * Pure geometry: no DOM mutation here beyond writing inline styles onto an
 * element the caller owns, and no engine state — every method is a pure function
 * of its inputs (or a thin style writer). Token-purity is irrelevant (no CSS).
 */

import type { TimeAxis, TimeSpan } from '@jects/timeline-core';
import type { SchedulerOrientation } from '../contract.js';

/** A rectangle expressed in main/cross content coordinates (orientation-free). */
export interface AxisBox {
  /** Offset along the time (main) axis, in px. */
  main: number;
  /** Size along the time (main) axis, in px. */
  mainSize: number;
  /** Offset along the resource (cross) axis, in px. */
  cross: number;
  /** Size along the resource (cross) axis, in px. */
  crossSize: number;
}

/** A point in main/cross content coordinates (orientation-free). */
export interface AxisPoint {
  /** Coordinate along the time (main) axis, in px. */
  main: number;
  /** Coordinate along the resource (cross) axis, in px. */
  cross: number;
}

/**
 * The geometry strategy for one orientation. All scheduler painting/gesture code
 * is written against this interface so a single code path serves both modes.
 */
export interface Orientation {
  /** The orientation this strategy implements. */
  readonly kind: SchedulerOrientation;

  /**
   * Whether the time axis is the screen's vertical dimension. `false` for
   * `horizontal` (time → X), `true` for `vertical` (time → Y).
   */
  readonly timeIsVertical: boolean;

  /**
   * Project a time span to its main-axis `{ start, size }` via the axis. This is
   * just `axis.spanToBox`, renamed to the orientation-free vocabulary so callers
   * never assume "x"/"width" means horizontal.
   */
  spanToMain(axis: TimeAxis, span: TimeSpan): { start: number; size: number };

  /** Map a content-space main coordinate back to a time. */
  mainToTime(axis: TimeAxis, main: number): number;

  /** Map a time to a content-space main coordinate. */
  timeToMain(axis: TimeAxis, time: number): number;

  /**
   * Convert a pointer event's client coordinates (relative to the content box's
   * top-left, already provided as `localX`/`localY`) into the main/cross content
   * coordinates this orientation uses.
   */
  toAxisPoint(localX: number, localY: number): AxisPoint;

  /**
   * The single client coordinate the main-axis drag gesture tracks. Horizontal
   * gestures read `clientX`; vertical gestures read `clientY`.
   */
  mainClient(e: { clientX: number; clientY: number }): number;

  /** Write an `AxisBox` onto an element as absolute-position inline styles. */
  applyBox(el: HTMLElement, box: AxisBox): void;

  /** Write only the main-axis offset+size onto an element (for live drag preview). */
  applyMain(el: HTMLElement, mainStart: number, mainSize: number): void;

  /** Write only the cross-axis offset+size onto an element. */
  applyCross(el: HTMLElement, crossStart: number, crossSize: number): void;

  /**
   * Position a full-bleed line that spans the WHOLE cross axis and sits at a
   * single main coordinate (a time gridline / now-marker). Horizontal → a
   * vertical line at `left = main`; vertical → a horizontal line at `top = main`.
   */
  applyMainLine(el: HTMLElement, main: number): void;

  /**
   * Position a band that covers a main-axis range across the WHOLE cross axis
   * (non-working-time shading). Horizontal → `left/width`; vertical → `top/height`.
   */
  applyMainBand(el: HTMLElement, main: number, mainSize: number): void;
}

/** Horizontal: time → X (left/width), resources → Y (top/height). */
class HorizontalOrientation implements Orientation {
  readonly kind: SchedulerOrientation = 'horizontal';
  readonly timeIsVertical = false;

  spanToMain(axis: TimeAxis, span: TimeSpan): { start: number; size: number } {
    const box = axis.spanToBox(span);
    return { start: box.x, size: box.width };
  }
  mainToTime(axis: TimeAxis, main: number): number {
    return axis.toTime(main);
  }
  timeToMain(axis: TimeAxis, time: number): number {
    return axis.toX(time);
  }
  toAxisPoint(localX: number, localY: number): AxisPoint {
    return { main: localX, cross: localY };
  }
  mainClient(e: { clientX: number; clientY: number }): number {
    return e.clientX;
  }
  applyBox(el: HTMLElement, box: AxisBox): void {
    el.style.left = `${box.main}px`;
    el.style.width = `${Math.max(1, box.mainSize)}px`;
    el.style.top = `${box.cross}px`;
    el.style.height = `${box.crossSize}px`;
  }
  applyMain(el: HTMLElement, mainStart: number, mainSize: number): void {
    el.style.left = `${mainStart}px`;
    el.style.width = `${Math.max(1, mainSize)}px`;
  }
  applyCross(el: HTMLElement, crossStart: number, crossSize: number): void {
    el.style.top = `${crossStart}px`;
    el.style.height = `${crossSize}px`;
  }
  applyMainLine(el: HTMLElement, main: number): void {
    el.style.left = `${main}px`;
  }
  applyMainBand(el: HTMLElement, main: number, mainSize: number): void {
    el.style.left = `${main}px`;
    el.style.width = `${mainSize}px`;
  }
}

/** Vertical: time → Y (top/height), resources → X (left/width). */
class VerticalOrientation implements Orientation {
  readonly kind: SchedulerOrientation = 'vertical';
  readonly timeIsVertical = true;

  spanToMain(axis: TimeAxis, span: TimeSpan): { start: number; size: number } {
    const box = axis.spanToBox(span);
    return { start: box.x, size: box.width };
  }
  mainToTime(axis: TimeAxis, main: number): number {
    return axis.toTime(main);
  }
  timeToMain(axis: TimeAxis, time: number): number {
    return axis.toX(time);
  }
  toAxisPoint(localX: number, localY: number): AxisPoint {
    // Time flows down → the vertical screen coordinate is the main axis.
    return { main: localY, cross: localX };
  }
  mainClient(e: { clientX: number; clientY: number }): number {
    return e.clientY;
  }
  applyBox(el: HTMLElement, box: AxisBox): void {
    el.style.top = `${box.main}px`;
    el.style.height = `${Math.max(1, box.mainSize)}px`;
    el.style.left = `${box.cross}px`;
    el.style.width = `${box.crossSize}px`;
  }
  applyMain(el: HTMLElement, mainStart: number, mainSize: number): void {
    el.style.top = `${mainStart}px`;
    el.style.height = `${Math.max(1, mainSize)}px`;
  }
  applyCross(el: HTMLElement, crossStart: number, crossSize: number): void {
    el.style.left = `${crossStart}px`;
    el.style.width = `${crossSize}px`;
  }
  applyMainLine(el: HTMLElement, main: number): void {
    el.style.top = `${main}px`;
  }
  applyMainBand(el: HTMLElement, main: number, mainSize: number): void {
    el.style.top = `${main}px`;
    el.style.height = `${mainSize}px`;
  }
}

const HORIZONTAL = new HorizontalOrientation();
const VERTICAL = new VerticalOrientation();

/** Resolve the geometry strategy for an orientation (default `horizontal`). */
export function resolveOrientation(kind: SchedulerOrientation | undefined): Orientation {
  return kind === 'vertical' ? VERTICAL : HORIZONTAL;
}
