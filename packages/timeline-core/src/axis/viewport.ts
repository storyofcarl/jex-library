/**
 * {@link TimelineViewport} default implementation — the read-only scroll/geometry
 * surface exposed to features. The engine owns the real scroll container; this
 * object answers geometry queries and forwards scroll *requests* to a host the
 * engine provides. It never mutates engine state directly.
 *
 * Horizontal axis is time (projected via the {@link TimeAxis}); vertical axis is
 * rows (sized via the {@link RowVirtualizer}). `visibleSpan` and `rowWindow` are
 * derived live from the current scroll position so features always see geometry
 * consistent with what the renderer paints.
 */

import type { Model } from '@jects/core';
import type {
  TimelineViewport,
  TimeSpan,
  TimeMs,
  RowWindow,
  TimeAxis,
  RowVirtualizer,
} from '../contract.js';

/**
 * The minimal scroll-container surface the viewport reads/writes. The engine
 * implements this over its real DOM scroller; tests can supply a plain object.
 */
export interface ViewportHost {
  readonly scrollTop: number;
  readonly scrollLeft: number;
  readonly height: number;
  readonly width: number;
  /** Apply a raw scroll position to the underlying container. */
  applyScroll(opts: { top?: number; left?: number }): void;
}

export interface TimelineViewportConfig<R extends Model = Model> {
  host: ViewportHost;
  axis: TimeAxis;
  rows: RowVirtualizer<R>;
  /** Default overscan rows for the derived window. Default 3. */
  overscan?: number;
}

export class DefaultTimelineViewport<R extends Model = Model> implements TimelineViewport {
  private readonly host: ViewportHost;
  private readonly axis: TimeAxis;
  private readonly rows: RowVirtualizer<R>;
  private readonly overscan: number;

  constructor(config: TimelineViewportConfig<R>) {
    this.host = config.host;
    this.axis = config.axis;
    this.rows = config.rows;
    this.overscan = config.overscan ?? 3;
  }

  get scrollTop(): number {
    return this.host.scrollTop;
  }
  get scrollLeft(): number {
    return this.host.scrollLeft;
  }
  get height(): number {
    return this.host.height;
  }
  get width(): number {
    return this.host.width;
  }

  /** The time span currently visible horizontally, derived from scroll + width. */
  get visibleSpan(): TimeSpan {
    const left = this.host.scrollLeft;
    const right = left + this.host.width;
    return {
      start: this.axis.toTime(left),
      end: this.axis.toTime(right),
    };
  }

  /** The current row window (vertical virtualization result). */
  get rowWindow(): RowWindow<R> {
    return this.rows.computeWindow({
      scrollTop: this.host.scrollTop,
      viewportHeight: this.host.height,
      overscan: this.overscan,
    });
  }

  /** Scroll a time into horizontal view (left-aligned if off-screen). */
  scrollToTime(time: TimeMs): void {
    const x = this.axis.toX(time);
    const left = this.host.scrollLeft;
    const right = left + this.host.width;
    if (x < left) {
      this.host.applyScroll({ left: x });
    } else if (x > right) {
      this.host.applyScroll({ left: x - this.host.width });
    }
  }

  /** Scroll a row into vertical view (top-aligned if above, bottom if below). */
  scrollToRow(rowIndex: number): void {
    const top = this.rows.offsetOf(rowIndex);
    const size = this.rows.heightOf(rowIndex);
    const viewTop = this.host.scrollTop;
    const viewBottom = viewTop + this.host.height;
    if (top < viewTop) {
      this.host.applyScroll({ top });
    } else if (top + size > viewBottom) {
      this.host.applyScroll({ top: top + size - this.host.height });
    }
  }

  /** Set raw scroll position. */
  scrollTo(opts: { top?: number; left?: number }): void {
    this.host.applyScroll(opts);
  }
}
