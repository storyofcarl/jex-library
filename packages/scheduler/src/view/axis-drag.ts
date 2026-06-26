/**
 * Orientation-aware bar drag / resize / drag-create controllers.
 *
 * `@jects/timeline-core`'s `startBarDrag` / `startDragCreate` read the pointer's
 * `clientX` only — they are hard-wired to a horizontal time axis. Vertical mode
 * projects time onto the Y dimension, so the gesture must track `clientY`
 * instead. Rather than fork timeline-core (an upstream package this feature must
 * not touch), this module reimplements the same vetoable, snap-aware,
 * pointer-captured gesture lifecycle but reads the driving client coordinate
 * through an injected `mainClient(e)` selector (supplied by the `Orientation`).
 *
 * The math is identical to timeline-core's controllers — only the source of the
 * scalar pixel delta differs — so horizontal behaviour is preserved exactly when
 * `mainClient` returns `clientX`.
 *
 * House veto convention: an `onBefore` hook returning `false` cancels the gesture
 * (no observable side effects, no further callbacks except `onEnd`).
 */

import type { RecordId } from '@jects/core';
import type { TimeAxis, TimeSpan } from '@jects/timeline-core';

/** Which kind of gesture a controller is performing. */
export type AxisDragMode = 'move' | 'resize-start' | 'resize-end';

/** Snapshot handed to every drag callback. */
export interface AxisDragState {
  readonly eventId: RecordId;
  readonly mode: AxisDragMode;
  readonly origin: TimeSpan;
  readonly span: TimeSpan;
  /** Pixel delta along the main (time) axis from the gesture start. */
  readonly delta: number;
  readonly native: PointerEvent;
}

export interface AxisDragOptions {
  eventId: RecordId;
  mode: AxisDragMode;
  origin: TimeSpan;
  axis: TimeAxis;
  /** Reads the main-axis client coordinate from a pointer event. */
  mainClient: (e: { clientX: number; clientY: number }) => number;
  snap?: boolean;
  minDuration?: number;
  bounds?: TimeSpan;
  onBefore?: (state: AxisDragState) => boolean | void;
  onPreview?: (state: AxisDragState) => void;
  onCommit?: (state: AxisDragState) => void;
  onEnd?: (state: AxisDragState) => void;
}

/** Controller produced by {@link startAxisBarDrag}. */
export interface AxisDragController {
  readonly isActive: boolean;
  readonly span: TimeSpan;
  cancel(): void;
  destroy(): void;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
function snapTime(axis: TimeAxis, t: number, snap: boolean): number {
  return snap ? axis.snap(t) : t;
}
function dur(span: TimeSpan): number {
  return span.end - span.start;
}

class Controller implements AxisDragController {
  private readonly disposers: Array<() => void> = [];
  private readonly startMain: number;
  private readonly snap: boolean;
  private readonly minDuration: number;
  private current: TimeSpan;
  private active = false;
  private finished = false;
  private readonly captureTarget: HTMLElement | null;
  private readonly pointerId: number;

  constructor(
    private readonly down: PointerEvent,
    private readonly opts: AxisDragOptions,
  ) {
    this.startMain = opts.mainClient(down);
    this.snap = opts.snap ?? true;
    this.current = opts.origin;
    this.minDuration = opts.minDuration ?? this.oneTick();

    if (this.fire(opts.onBefore) === false) {
      this.finished = true;
      this.captureTarget = null;
      this.pointerId = -1;
      return;
    }

    this.active = true;
    this.captureTarget = down.target instanceof HTMLElement ? down.target : null;
    this.pointerId = down.pointerId;
    try {
      this.captureTarget?.setPointerCapture?.(down.pointerId);
    } catch {
      /* best-effort (jsdom / detached nodes) */
    }

    const move = (e: PointerEvent): void => this.onMove(e);
    const up = (e: PointerEvent): void => this.onUp(e);
    const cancel = (): void => this.cancel();
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    this.disposers.push(
      () => window.removeEventListener('pointermove', move),
      () => window.removeEventListener('pointerup', up),
      () => window.removeEventListener('pointercancel', cancel),
    );
  }

  get isActive(): boolean {
    return this.active && !this.finished;
  }
  get span(): TimeSpan {
    return this.current;
  }

  private oneTick(): number {
    const { axis } = this.opts;
    const t0 = axis.toTime(0);
    const snapped = axis.snap(t0 + 1);
    const next = axis.snap(snapped + 1);
    const step = Math.abs(next - snapped);
    return step > 0 ? step : 1;
  }

  private state(native: PointerEvent): AxisDragState {
    return {
      eventId: this.opts.eventId,
      mode: this.opts.mode,
      origin: this.opts.origin,
      span: this.current,
      delta: this.opts.mainClient(native) - this.startMain,
      native,
    };
  }

  private fire(fn: ((s: AxisDragState) => boolean | void) | undefined): boolean | void {
    if (!fn) return;
    return fn(this.state(this.down));
  }

  private computeSpan(deltaPx: number): TimeSpan {
    const { axis, origin, mode, bounds } = this.opts;
    const deltaMs = axis.toTime(deltaPx) - axis.toTime(0);

    if (mode === 'move') {
      let next: TimeSpan = { start: origin.start + deltaMs, end: origin.end + deltaMs };
      if (this.snap) {
        const snappedStart = snapTime(axis, next.start, true);
        next = { start: snappedStart, end: snappedStart + dur(origin) };
      }
      return this.applyBounds(next, 'move', bounds);
    }
    if (mode === 'resize-start') {
      let start = snapTime(axis, origin.start + deltaMs, this.snap);
      start = Math.min(start, origin.end - this.minDuration);
      return this.applyBounds({ start, end: origin.end }, 'resize-start', bounds);
    }
    let end = snapTime(axis, origin.end + deltaMs, this.snap);
    end = Math.max(end, origin.start + this.minDuration);
    return this.applyBounds({ start: origin.start, end }, 'resize-end', bounds);
  }

  private applyBounds(span: TimeSpan, mode: AxisDragMode, bounds: TimeSpan | undefined): TimeSpan {
    if (!bounds) return span;
    if (mode === 'move') {
      const d = dur(span);
      const start = clamp(span.start, bounds.start, bounds.end - d);
      return { start, end: start + d };
    }
    if (mode === 'resize-start') {
      const start = clamp(span.start, bounds.start, span.end - this.minDuration);
      return { start, end: span.end };
    }
    const end = clamp(span.end, span.start + this.minDuration, bounds.end);
    return { start: span.start, end };
  }

  private onMove(e: PointerEvent): void {
    if (!this.isActive || e.pointerId !== this.pointerId) return;
    this.current = this.computeSpan(this.opts.mainClient(e) - this.startMain);
    this.opts.onPreview?.(this.state(e));
  }

  private onUp(e: PointerEvent): void {
    if (!this.isActive || e.pointerId !== this.pointerId) return;
    this.current = this.computeSpan(this.opts.mainClient(e) - this.startMain);
    const changed =
      this.current.start !== this.opts.origin.start || this.current.end !== this.opts.origin.end;
    this.finish(e, changed);
  }

  private finish(e: PointerEvent, commit: boolean): void {
    if (this.finished) return;
    const state = this.state(e);
    if (commit) this.opts.onCommit?.(state);
    this.opts.onEnd?.(state);
    this.teardown();
  }

  cancel(): void {
    if (this.finished) return;
    this.current = this.opts.origin;
    this.opts.onEnd?.(this.state(this.down));
    this.teardown();
  }

  private teardown(): void {
    this.finished = true;
    this.active = false;
    try {
      this.captureTarget?.releasePointerCapture?.(this.pointerId);
    } catch {
      /* best-effort */
    }
    for (const d of this.disposers.splice(0)) d();
  }

  destroy(): void {
    if (this.finished) {
      for (const d of this.disposers.splice(0)) d();
      return;
    }
    this.cancel();
  }
}

/** Begin an orientation-aware drag/resize gesture from a `pointerdown`. */
export function startAxisBarDrag(down: PointerEvent, opts: AxisDragOptions): AxisDragController {
  return new Controller(down, opts);
}

/* ── Drag-create (sweep out a new bar along the main axis) ─────────────────── */

export interface AxisDragCreateState {
  readonly rowId: RecordId;
  readonly span: TimeSpan;
  readonly native: PointerEvent;
}

export interface AxisDragCreateOptions {
  rowId: RecordId;
  anchorTime: number;
  axis: TimeAxis;
  /** Map a pointer event → content-space MAIN coordinate (subtracts scroll/offset). */
  toContentMain: (e: { clientX: number; clientY: number }) => number;
  snap?: boolean;
  minDuration?: number;
  onBefore?: (state: AxisDragCreateState) => boolean | void;
  onPreview?: (state: AxisDragCreateState) => void;
  onCommit?: (state: AxisDragCreateState) => void;
  onEnd?: (state: AxisDragCreateState) => void;
}

class CreateController implements AxisDragController {
  private readonly disposers: Array<() => void> = [];
  private readonly snap: boolean;
  private readonly minDuration: number;
  private current: TimeSpan;
  private active = false;
  private finished = false;
  private readonly captureTarget: HTMLElement | null;
  private readonly pointerId: number;

  constructor(
    private readonly down: PointerEvent,
    private readonly opts: AxisDragCreateOptions,
  ) {
    this.snap = opts.snap ?? true;
    this.minDuration = opts.minDuration ?? 1;
    const a = snapTime(opts.axis, opts.anchorTime, this.snap);
    this.current = { start: a, end: a };

    if (this.fire(opts.onBefore) === false) {
      this.finished = true;
      this.captureTarget = null;
      this.pointerId = -1;
      return;
    }

    this.active = true;
    this.captureTarget = down.target instanceof HTMLElement ? down.target : null;
    this.pointerId = down.pointerId;
    try {
      this.captureTarget?.setPointerCapture?.(down.pointerId);
    } catch {
      /* best-effort */
    }

    const move = (e: PointerEvent): void => this.onMove(e);
    const up = (e: PointerEvent): void => this.onUp(e);
    const cancel = (): void => this.cancel();
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    this.disposers.push(
      () => window.removeEventListener('pointermove', move),
      () => window.removeEventListener('pointerup', up),
      () => window.removeEventListener('pointercancel', cancel),
    );
  }

  get isActive(): boolean {
    return this.active && !this.finished;
  }
  get span(): TimeSpan {
    return this.current;
  }

  private compute(e: PointerEvent): TimeSpan {
    const { axis, anchorTime, toContentMain } = this.opts;
    const a = snapTime(axis, anchorTime, this.snap);
    const b = snapTime(axis, axis.toTime(toContentMain(e)), this.snap);
    return a <= b ? { start: a, end: b } : { start: b, end: a };
  }

  private state(native: PointerEvent): AxisDragCreateState {
    return { rowId: this.opts.rowId, span: this.current, native };
  }

  private fire(fn: ((s: AxisDragCreateState) => boolean | void) | undefined): boolean | void {
    if (!fn) return;
    return fn(this.state(this.down));
  }

  private onMove(e: PointerEvent): void {
    if (!this.isActive || e.pointerId !== this.pointerId) return;
    this.current = this.compute(e);
    this.opts.onPreview?.(this.state(e));
  }

  private onUp(e: PointerEvent): void {
    if (!this.isActive || e.pointerId !== this.pointerId) return;
    this.current = this.compute(e);
    const ok = dur(this.current) >= this.minDuration;
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
      this.captureTarget?.releasePointerCapture?.(this.pointerId);
    } catch {
      /* best-effort */
    }
    for (const d of this.disposers.splice(0)) d();
  }

  destroy(): void {
    if (this.finished) {
      for (const d of this.disposers.splice(0)) d();
      return;
    }
    this.cancel();
  }
}

/** Begin an orientation-aware drag-create gesture from a `pointerdown`. */
export function startAxisDragCreate(
  down: PointerEvent,
  opts: AxisDragCreateOptions,
): AxisDragController {
  return new CreateController(down, opts);
}
