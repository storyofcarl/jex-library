/**
 * Test harness for the interactions layer.
 *
 * Provides a minimal, deterministic `TimeAxis` implementation (linear ms↔px with
 * a fixed snap step) and an `EventBar` factory, so the framework-free interaction
 * primitives can be exercised under jsdom without the full engine. This lives in
 * the interactions folder (the only files this area may add) and is imported by
 * the `*.test.ts` suites here.
 */

import type { RecordId, Model } from '@jects/core';
import type {
  TimeAxis,
  TimeSpan,
  TimeMs,
  ViewPreset,
  TimeTick,
  EventBar,
  TimelineEvent,
} from '../contract.js';

const PRESET: ViewPreset = {
  id: 'test',
  headers: [{ unit: 'day' }],
  tickUnit: 'hour',
  pxPerUnit: 0,
  zoomLevels: [1],
};

/**
 * A linear test axis: `pxPerMs` pixels per millisecond, snapping to a fixed
 * `snapMs` grid. `originTime` maps to x=0. Pure and synchronous.
 */
export class TestAxis implements TimeAxis {
  readonly preset = PRESET;
  readonly zoom = 1;
  range: TimeSpan;

  constructor(
    private readonly pxPerMs = 0.01,
    private readonly snapMs = 1000,
    private readonly originTime: TimeMs = 0,
    rangeMs = 1_000_000,
  ) {
    this.range = { start: originTime, end: originTime + rangeMs };
  }

  get contentWidth(): number {
    return (this.range.end - this.range.start) * this.pxPerMs;
  }

  toX(time: TimeMs): number {
    return (time - this.originTime) * this.pxPerMs;
  }

  toTime(x: number): TimeMs {
    return this.originTime + x / this.pxPerMs;
  }

  spanToBox(span: TimeSpan): { x: number; width: number } {
    const x = this.toX(span.start);
    return { x, width: this.toX(span.end) - x };
  }

  durationToWidth(duration: number): number {
    return duration * this.pxPerMs;
  }

  ticksInRange(xStart: number, xEnd: number): TimeTick[] {
    const out: TimeTick[] = [];
    const startTime = this.snap(this.toTime(xStart));
    for (let t = startTime, i = 0; this.toX(t) <= xEnd; t += this.snapMs, i++) {
      const span = { start: t, end: t + this.snapMs };
      const box = this.spanToBox(span);
      out.push({ index: i, span, x: box.x, width: box.width, major: false });
    }
    return out;
  }

  snap(time: TimeMs): TimeMs {
    return Math.round(time / this.snapMs) * this.snapMs;
  }

  setView(): void {
    /* fixed in tests */
  }

  setRange(range: TimeSpan): void {
    this.range = range;
  }
}

/** A trivial record for event bars in tests. */
export type TestRecord = Model & { id: RecordId };

/** Build a `TimelineEvent` for tests. */
export function makeEvent(
  id: RecordId,
  rowId: RecordId,
  span: TimeSpan,
): TimelineEvent<TestRecord> {
  return { id, rowId, span, record: { id } };
}

/** Build an `EventBar` for tests, projecting the span via the axis. */
export function makeBar(
  axis: TimeAxis,
  id: RecordId,
  rowId: RecordId,
  span: TimeSpan,
  y = 0,
  height = 20,
): EventBar<TestRecord> {
  const { x, width } = axis.spanToBox(span);
  return { event: makeEvent(id, rowId, span), x, width, y, height, lane: 0 };
}

/**
 * Synthesize a PointerEvent for jsdom. jsdom (in this environment) does not ship
 * a global `PointerEvent` constructor, so we build a `MouseEvent` and augment it
 * with the `pointerId`/`pointerType` fields the controllers read. `clientX` and
 * `pointerId` are forced via `defineProperty` so dispatched events carry them.
 */
export function makePointer(
  type: string,
  clientX: number,
  opts: { pointerId?: number; target?: HTMLElement } = {},
): PointerEvent {
  const pointerId = opts.pointerId ?? 1;
  const PointerCtor: typeof PointerEvent | undefined =
    typeof PointerEvent === 'function' ? PointerEvent : undefined;
  let ev: Event;
  if (PointerCtor) {
    ev = new PointerCtor(type, { bubbles: true, cancelable: true, clientX, clientY: 0, pointerId });
  } else {
    ev = new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY: 0 });
  }
  Object.defineProperty(ev, 'clientX', { value: clientX, configurable: true });
  Object.defineProperty(ev, 'pointerId', { value: pointerId, configurable: true });
  Object.defineProperty(ev, 'pointerType', { value: 'mouse', configurable: true });
  if (opts.target) {
    Object.defineProperty(ev, 'target', { value: opts.target, configurable: true });
  }
  return ev as PointerEvent;
}

/** A jsdom element with stubbed pointer-capture methods (jsdom lacks them). */
export function makeCaptureEl(): HTMLElement {
  const el = document.createElement('div');
  (el as unknown as { setPointerCapture(id: number): void }).setPointerCapture = () => {};
  (el as unknown as { releasePointerCapture(id: number): void }).releasePointerCapture = () => {};
  return el;
}
