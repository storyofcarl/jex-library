/**
 * Viewport — read-only scroll/geometry surface over the engine's scroll state.
 *
 * The engine owns the actual scroll container and the computed window; this
 * object is the contract-facing {@link Viewport} that features query and use to
 * request programmatic scrolls. It never mutates engine state directly — it
 * forwards scroll requests to a host the engine provides.
 */

import type { Viewport, ViewportWindow } from '../contract.js';

/** Host the viewport forwards scroll requests / geometry reads to. */
export interface ViewportHost {
  readonly scrollTop: number;
  readonly scrollLeft: number;
  readonly height: number;
  readonly width: number;
  readonly window: ViewportWindow;
  /** Top pixel offset of a given row index (honors variable heights). */
  rowOffset(rowIndex: number): number;
  /** Height of a given row index. */
  rowSize(rowIndex: number): number;
  /** Left pixel offset of a given visible column index. */
  columnOffset(colIndex: number): number;
  /** Width of a given visible column index. */
  columnSize(colIndex: number): number;
  /** Apply a raw scroll position to the container. */
  applyScroll(opts: { top?: number; left?: number }): void;
}

export class DefaultViewport implements Viewport {
  constructor(private readonly host: ViewportHost) {}

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
  get window(): ViewportWindow {
    return this.host.window;
  }

  scrollToRow(rowIndex: number): void {
    const top = this.host.rowOffset(rowIndex);
    const size = this.host.rowSize(rowIndex);
    const viewTop = this.host.scrollTop;
    const viewBottom = viewTop + this.host.height;
    if (top < viewTop) {
      this.host.applyScroll({ top });
    } else if (top + size > viewBottom) {
      this.host.applyScroll({ top: top + size - this.host.height });
    }
  }

  scrollToColumn(colIndex: number): void {
    const left = this.host.columnOffset(colIndex);
    const size = this.host.columnSize(colIndex);
    const viewLeft = this.host.scrollLeft;
    const viewRight = viewLeft + this.host.width;
    if (left < viewLeft) {
      this.host.applyScroll({ left });
    } else if (left + size > viewRight) {
      this.host.applyScroll({ left: left + size - this.host.width });
    }
  }

  scrollTo(opts: { top?: number; left?: number }): void {
    this.host.applyScroll(opts);
  }
}
