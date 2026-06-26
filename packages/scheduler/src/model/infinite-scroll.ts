/**
 * Infinite scroll — endless time axis. Pure planning math for extending the
 * axis range when the viewport approaches either temporal edge, plus the scroll
 * compensation required to keep the visible content visually stationary.
 *
 * No DOM, no axis mutation here: the renderer calls {@link planInfiniteScroll}
 * with the current scroll/viewport geometry and applies the returned plan
 * (`axis.setRange(...)` + adjust `scrollLeft`). Time is epoch ms (UTC).
 *
 * Why scroll compensation is needed: timeline-core's `DefaultTimeAxis.setRange`
 * re-anchors pixel x=0 to `range.start`. So PREPENDING time (moving the left edge
 * earlier) shifts every existing pixel position to the right by the width of the
 * prepended span — the viewport would appear to jump. We counter that by adding
 * the same pixel delta to `scrollLeft`, so the content under the viewport stays
 * put while fresh runway appears on the left. Appending time (moving the right
 * edge later) does NOT move existing pixels, so it needs no compensation.
 */

import type { TimeAxis, TimeSpan, TimeMs } from '@jects/timeline-core';

/** Inputs describing the current scroll state against the axis. */
export interface InfiniteScrollInput {
  /** The live time axis (read-only here). */
  axis: TimeAxis;
  /** Current horizontal scroll offset in px. */
  scrollLeft: number;
  /** Visible viewport width in px. */
  viewportWidth: number;
  /**
   * Trigger threshold in px: extend when the viewport edge is within this many
   * pixels of the corresponding content edge. Default 200.
   */
  threshold?: number;
  /**
   * How much time to add per extension, in ms. Defaults to one viewport-width
   * worth of time (so a single extension always clears the threshold).
   */
  extendBy?: number;
}

/** The plan the renderer applies, or `null` when no extension is needed. */
export interface InfiniteScrollPlan {
  /** The new, wider range to pass to `axis.setRange`. */
  range: TimeSpan;
  /**
   * Pixel delta to ADD to `scrollLeft` AFTER `setRange`, compensating for the
   * left-edge re-anchor so the visible content does not jump. 0 when only the
   * right edge was extended.
   */
  scrollLeftDelta: number;
  /** Which edge(s) were extended (diagnostics / tests). */
  extendedStart: boolean;
  extendedEnd: boolean;
}

/**
 * Decide whether the axis range must grow given the current scroll position, and
 * by how much. Returns `null` when both edges are comfortably far from the
 * viewport (no work to do), so the caller can cheaply early-out on every scroll.
 *
 * The extension is symmetric per edge: the left edge moves earlier by `extendBy`
 * ms when the viewport nears the start, the right edge later by `extendBy` ms
 * when it nears the end. Both can fire in one pass for a viewport wider than the
 * content.
 */
export function planInfiniteScroll(input: InfiniteScrollInput): InfiniteScrollPlan | null {
  const { axis, scrollLeft, viewportWidth } = input;
  const threshold = input.threshold ?? 200;
  const contentWidth = axis.contentWidth;

  const nearStart = scrollLeft <= threshold;
  const nearEnd = scrollLeft + viewportWidth >= contentWidth - threshold;
  if (!nearStart && !nearEnd) return null;

  // Default extension: one viewport's worth of TIME (px → ms via the axis), so a
  // single step always clears the threshold regardless of zoom.
  const viewportMs = axis.toTime(viewportWidth) - axis.toTime(0);
  const extendBy = input.extendBy ?? Math.max(1, Math.round(viewportMs));

  let start: TimeMs = axis.range.start;
  let end: TimeMs = axis.range.end;
  if (nearStart) start -= extendBy;
  if (nearEnd) end += extendBy;

  // Left-edge compensation: prepended pixels = width of the prepended time span
  // at the current scale. Appending (right edge) needs none.
  const scrollLeftDelta = nearStart ? axis.durationToWidth(extendBy) : 0;

  return {
    range: { start, end },
    scrollLeftDelta,
    extendedStart: nearStart,
    extendedEnd: nearEnd,
  };
}
