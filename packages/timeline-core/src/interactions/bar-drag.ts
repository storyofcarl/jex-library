/**
 * Bar drag / resize / drag-create primitives (pointer events).
 *
 * Framework-free interaction controllers that translate pointer gestures into
 * proposed `TimeSpan` changes against a `TimeAxis`, with tick snapping and
 * vetoable lifecycle hooks. They DO NOT mutate any store or DOM directly — they
 * report the proposed span through `onPreview`/`onCommit` callbacks so the engine
 * (which owns `api.updateEventSpan` and the renderer) decides what to apply.
 * This keeps the primitives reusable by Scheduler and Gantt over the contract.
 *
 * House veto convention: an `onBefore` hook returning `false` cancels the
 * gesture (the controller restores the original span and emits nothing further).
 */

import type { RecordId } from '@jects/core';
import type { TimeAxis, TimeSpan, TimeMs } from '../contract.js';
import { Disposers, addListener, clamp, snapTime, spanDuration, shiftSpan } from './shared.js';

/** Which kind of gesture a controller is performing. */
export type DragMode = 'move' | 'resize-start' | 'resize-end';

/** Snapshot handed to every drag callback. */
export interface DragState {
  /** The event being manipulated. */
  readonly eventId: RecordId;
  /** The gesture kind. */
  readonly mode: DragMode;
  /** The span when the gesture began. */
  readonly origin: TimeSpan;
  /** The current proposed span (snapped). */
  readonly span: TimeSpan;
  /** Pixel delta from the gesture's start point. */
  readonly dx: number;
  /** The raw pointer event driving this update. */
  readonly native: PointerEvent;
}

export interface BarDragOptions {
  /** The event id under manipulation. */
  eventId: RecordId;
  /** The gesture kind. */
  mode: DragMode;
  /** The span at gesture start. */
  origin: TimeSpan;
  /** Time ⇄ pixel projection (snapping delegated here). */
  axis: TimeAxis;
  /** Snap proposed times to the tick grid. Default `true`. */
  snap?: boolean;
  /** Minimum duration (ms) a resize may shrink a bar to. Default 1 tick worth. */
  minDuration?: number;
  /** Optional hard bounds the span may not cross (e.g. parent task window). */
  bounds?: TimeSpan;
  /** Vetoable: return `false` to cancel before the gesture starts. */
  onBefore?: (state: DragState) => boolean | void;
  /** Live preview on each pointer move (already snapped + clamped). */
  onPreview?: (state: DragState) => void;
  /** Commit on pointer up (only fired if the span actually changed). */
  onCommit?: (state: DragState) => void;
  /** Always fired on pointer up / cancel, after commit (for cleanup). */
  onEnd?: (state: DragState) => void;
}

/**
 * Begin a drag/resize gesture from a `pointerdown`. Captures the pointer, wires
 * global move/up listeners (gated, single-shot), and returns a controller whose
 * `cancel()`/`destroy()` aborts cleanly. The caller passes the originating
 * `pointerdown` so we can capture and seed the start coordinate.
 */
export function startBarDrag(
  down: PointerEvent,
  opts: BarDragOptions,
): BarDragController {
  return new BarDragController(down, opts);
}

export class BarDragController {
  private readonly disposers = new Disposers();
  private readonly startX: number;
  private readonly snap: boolean;
  private readonly minDuration: number;
  private current: TimeSpan;
  private active = false;
  private finished = false;
  private readonly captureTarget: HTMLElement | null;
  private readonly capturePointerId: number;

  constructor(
    private readonly down: PointerEvent,
    private readonly opts: BarDragOptions,
  ) {
    this.startX = down.clientX;
    this.snap = opts.snap ?? true;
    this.current = opts.origin;
    // A min duration of one tick keeps a resized bar from collapsing to 0px.
    this.minDuration = opts.minDuration ?? this.oneTick();

    // Veto BEFORE doing anything observable.
    if (this.fire(opts.onBefore) === false) {
      this.finished = true;
      this.captureTarget = null;
      this.capturePointerId = -1;
      return;
    }

    this.active = true;
    this.captureTarget = down.target instanceof HTMLElement ? down.target : null;
    this.capturePointerId = down.pointerId;
    try {
      this.captureTarget?.setPointerCapture?.(down.pointerId);
    } catch {
      /* capture is best-effort (jsdom / detached nodes) */
    }

    // Global listeners so the gesture survives the pointer leaving the bar.
    this.disposers.add(addListener(window, 'pointermove', (e) => this.onMove(e)));
    this.disposers.add(addListener(window, 'pointerup', (e) => this.onUp(e)));
    this.disposers.add(addListener(window, 'pointercancel', () => this.cancel()));
  }

  /** Whether the gesture is still live. */
  get isActive(): boolean {
    return this.active && !this.finished;
  }

  /** The latest proposed (snapped + clamped) span. */
  get span(): TimeSpan {
    return this.current;
  }

  private oneTick(): number {
    // Width of the finest tick increment, in ms, derived from the axis grid.
    const { axis } = this.opts;
    const t0 = axis.toTime(0);
    const snapped = axis.snap(t0 + 1);
    const next = axis.snap(snapped + 1);
    const step = Math.abs(next - snapped);
    return step > 0 ? step : 1;
  }

  private state(native: PointerEvent): DragState {
    return {
      eventId: this.opts.eventId,
      mode: this.opts.mode,
      origin: this.opts.origin,
      span: this.current,
      dx: native.clientX - this.startX,
      native,
    };
  }

  private fire(fn: ((s: DragState) => boolean | void) | undefined): boolean | void {
    if (!fn) return;
    return fn(this.state(this.down));
  }

  /** Compute the proposed span for a pixel delta, applying snap + clamps. */
  private computeSpan(dx: number): TimeSpan {
    const { axis, origin, mode, bounds } = this.opts;
    const deltaMs = axis.toTime(dx) - axis.toTime(0);

    if (mode === 'move') {
      let next = shiftSpan(origin, deltaMs);
      if (this.snap) {
        // Snap the leading edge, keep the duration intact.
        const snappedStart = snapTime(axis, next.start, true);
        next = { start: snappedStart, end: snappedStart + spanDuration(origin) };
      }
      return this.applyBounds(next, 'move', bounds);
    }

    if (mode === 'resize-start') {
      let start = snapTime(axis, origin.start + deltaMs, this.snap);
      // Never cross the (fixed) end minus the min duration.
      start = Math.min(start, origin.end - this.minDuration);
      const next = { start, end: origin.end };
      return this.applyBounds(next, 'resize-start', bounds);
    }

    // resize-end
    let end = snapTime(axis, origin.end + deltaMs, this.snap);
    end = Math.max(end, origin.start + this.minDuration);
    const next = { start: origin.start, end };
    return this.applyBounds(next, 'resize-end', bounds);
  }

  private applyBounds(
    span: TimeSpan,
    mode: DragMode,
    bounds: TimeSpan | undefined,
  ): TimeSpan {
    if (!bounds) return span;
    if (mode === 'move') {
      const dur = spanDuration(span);
      const start = clamp(span.start, bounds.start, bounds.end - dur);
      return { start, end: start + dur };
    }
    if (mode === 'resize-start') {
      const start = clamp(span.start, bounds.start, span.end - this.minDuration);
      return { start, end: span.end };
    }
    const end = clamp(span.end, span.start + this.minDuration, bounds.end);
    return { start: span.start, end };
  }

  private onMove(e: PointerEvent): void {
    if (!this.isActive) return;
    if (e.pointerId !== this.capturePointerId) return;
    const next = this.computeSpan(e.clientX - this.startX);
    this.current = next;
    this.opts.onPreview?.(this.state(e));
  }

  private onUp(e: PointerEvent): void {
    if (!this.isActive) return;
    if (e.pointerId !== this.capturePointerId) return;
    const next = this.computeSpan(e.clientX - this.startX);
    this.current = next;
    const changed = next.start !== this.opts.origin.start || next.end !== this.opts.origin.end;
    this.finish(e, changed);
  }

  private finish(e: PointerEvent, commit: boolean): void {
    if (this.finished) return;
    const state = this.state(e);
    if (commit) this.opts.onCommit?.(state);
    this.opts.onEnd?.(state);
    this.teardown();
  }

  /** Abort the gesture, restoring the original span; fires `onEnd`. */
  cancel(): void {
    if (this.finished) return;
    this.current = this.opts.origin;
    const state = this.state(this.down);
    this.opts.onEnd?.(state);
    this.teardown();
  }

  private teardown(): void {
    this.finished = true;
    this.active = false;
    try {
      this.captureTarget?.releasePointerCapture?.(this.capturePointerId);
    } catch {
      /* best-effort */
    }
    this.disposers.dispose();
  }

  /** Release everything (idempotent). */
  destroy(): void {
    if (this.finished) {
      this.disposers.dispose();
      return;
    }
    this.cancel();
  }
}

/* ── Drag-create (sweep out a new bar) ─────────────────────────────────────── */

/** Snapshot for the drag-create gesture. */
export interface DragCreateState {
  /** The row the new bar is being created in. */
  readonly rowId: RecordId;
  /** The current proposed span (ordered, snapped). */
  readonly span: TimeSpan;
  /** The raw pointer event. */
  readonly native: PointerEvent;
}

export interface DragCreateOptions {
  /** The row the new bar belongs to. */
  rowId: RecordId;
  /** The time the sweep anchored at (from the pointerdown x). */
  anchorTime: TimeMs;
  /** Time ⇄ pixel projection. */
  axis: TimeAxis;
  /** Function mapping a clientX → content-space x (subtracts scroll/offset). */
  toContentX: (clientX: number) => number;
  /** Snap both ends to the tick grid. Default `true`. */
  snap?: boolean;
  /** Minimum duration before a sweep counts as a real bar. Default 1 tick. */
  minDuration?: number;
  /** Vetoable: return `false` to cancel before the sweep starts. */
  onBefore?: (state: DragCreateState) => boolean | void;
  /** Live preview as the sweep grows. */
  onPreview?: (state: DragCreateState) => void;
  /** Commit on pointer up (only if the swept span meets `minDuration`). */
  onCommit?: (state: DragCreateState) => void;
  /** Always fired on pointer up / cancel. */
  onEnd?: (state: DragCreateState) => void;
}

/**
 * Begin a drag-create gesture: the user presses on empty row space and sweeps to
 * define a new bar's span. Works in either direction (the resulting span is
 * always ordered). Mirrors {@link BarDragController}'s lifecycle/veto discipline.
 */
export function startDragCreate(
  down: PointerEvent,
  opts: DragCreateOptions,
): DragCreateController {
  return new DragCreateController(down, opts);
}

export class DragCreateController {
  private readonly disposers = new Disposers();
  private readonly snap: boolean;
  private readonly minDuration: number;
  private current: TimeSpan;
  private active = false;
  private finished = false;
  private readonly captureTarget: HTMLElement | null;
  private readonly capturePointerId: number;

  constructor(
    private readonly down: PointerEvent,
    private readonly opts: DragCreateOptions,
  ) {
    this.snap = opts.snap ?? true;
    this.minDuration = opts.minDuration ?? 1;
    const a = snapTime(opts.axis, opts.anchorTime, this.snap);
    this.current = { start: a, end: a };

    if (this.fire(opts.onBefore) === false) {
      this.finished = true;
      this.captureTarget = null;
      this.capturePointerId = -1;
      return;
    }

    this.active = true;
    this.captureTarget = down.target instanceof HTMLElement ? down.target : null;
    this.capturePointerId = down.pointerId;
    try {
      this.captureTarget?.setPointerCapture?.(down.pointerId);
    } catch {
      /* best-effort */
    }

    this.disposers.add(addListener(window, 'pointermove', (e) => this.onMove(e)));
    this.disposers.add(addListener(window, 'pointerup', (e) => this.onUp(e)));
    this.disposers.add(addListener(window, 'pointercancel', () => this.cancel()));
  }

  get isActive(): boolean {
    return this.active && !this.finished;
  }

  get span(): TimeSpan {
    return this.current;
  }

  private compute(clientX: number): TimeSpan {
    const { axis, anchorTime, toContentX } = this.opts;
    const a = snapTime(axis, anchorTime, this.snap);
    const b = snapTime(axis, axis.toTime(toContentX(clientX)), this.snap);
    return a <= b ? { start: a, end: b } : { start: b, end: a };
  }

  private state(native: PointerEvent): DragCreateState {
    return { rowId: this.opts.rowId, span: this.current, native };
  }

  private fire(fn: ((s: DragCreateState) => boolean | void) | undefined): boolean | void {
    if (!fn) return;
    return fn(this.state(this.down));
  }

  private onMove(e: PointerEvent): void {
    if (!this.isActive || e.pointerId !== this.capturePointerId) return;
    this.current = this.compute(e.clientX);
    this.opts.onPreview?.(this.state(e));
  }

  private onUp(e: PointerEvent): void {
    if (!this.isActive || e.pointerId !== this.capturePointerId) return;
    this.current = this.compute(e.clientX);
    const ok = spanDuration(this.current) >= this.minDuration;
    const state = this.state(e);
    if (ok) this.opts.onCommit?.(state);
    this.opts.onEnd?.(state);
    this.teardown();
  }

  cancel(): void {
    if (this.finished) return;
    this.opts.onEnd?.(this.state(this.down));
    this.teardown();
  }

  private teardown(): void {
    this.finished = true;
    this.active = false;
    try {
      this.captureTarget?.releasePointerCapture?.(this.capturePointerId);
    } catch {
      /* best-effort */
    }
    this.disposers.dispose();
  }

  destroy(): void {
    if (this.finished) {
      this.disposers.dispose();
      return;
    }
    this.cancel();
  }
}
