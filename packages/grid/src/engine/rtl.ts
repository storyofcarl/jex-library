/**
 * RTL geometry & direction resolution for the grid (Bryntum/DHTMLX "RTL support"
 * parity).
 *
 * The grid lays out cells with **absolute positioning** (`left`/`right` in px,
 * keyed off the resolved {@link ColumnLayout}). That math is computed for a
 * left-to-right reading order: the frozen-left band pins to the physical left,
 * the frozen-right band to the physical right, and centre columns flow rightward
 * from the frozen-left band. Under `dir="rtl"` every one of those edges flips —
 * the "start" band must pin to the visual RIGHT, the "end" band to the visual
 * LEFT, and centre columns flow leftward from the start band.
 *
 * Rather than mirror every pixel coordinate by hand (which would also have to
 * track the scroller's RTL `scrollLeft` sign quirks per browser), this module
 * centralises positioning into a single {@link positionColumnCell} helper that:
 *
 *   - in **LTR** writes the historical *physical* `left`/`right` insets (byte-for
 *     -byte identical to the original `styleColumnCell`, so nothing regresses),
 *   - in **RTL** writes the same magnitudes as **logical** insets
 *     (`inset-inline-start` / `inset-inline-end`). Because the row/header
 *     containers are themselves anchored with `inset-inline-start: 0`, the
 *     browser resolves those logical insets against the container's RIGHT edge
 *     under `dir="rtl"`, mirroring the whole grid automatically — including the
 *     frozen bands and the centre flow — with no per-coordinate arithmetic.
 *
 * Direction is resolved from the grid host so a consumer only has to set
 * `dir="rtl"` on the grid element (or any ancestor) — exactly the Bryntum/DHTMLX
 * authoring model. {@link gridIsRTL} reads the `dir` attribute up the ancestor
 * chain first (works in jsdom, where computed style is unreliable) and falls
 * back to the core {@link isRTL} computed-style probe in a real browser.
 */

import { isRTL, type Model } from '@jects/core';
import type { ColumnLayout, LaidOutColumn } from './column-layout.js';

/** Marker class the renderer/CSS use to scope RTL-specific rules on the root. */
export const RTL_CLASS = 'jects-grid--rtl';

/**
 * Resolve the effective reading direction for a grid rooted at `el`.
 *
 * Resolution order (first decisive wins):
 *   1. an explicit `dir` attribute on `el` or any ancestor (`rtl` / `ltr`),
 *   2. the computed `direction` style (core {@link isRTL}) when attached to a
 *      live document that lays out (real browser),
 *   3. `false` (LTR) as the safe default.
 *
 * Reading the attribute chain first means unit tests (jsdom) and SSR-style hosts
 * resolve deterministically even though jsdom never computes `direction`.
 */
export function gridIsRTL(el: HTMLElement | null | undefined): boolean {
  if (!el) return false;
  // Walk up the ancestor chain honouring the nearest explicit `dir`.
  let node: HTMLElement | null = el;
  while (node) {
    const dir = node.getAttribute?.('dir');
    if (dir === 'rtl') return true;
    if (dir === 'ltr') return false;
    node = node.parentElement;
  }
  // No explicit `dir` anywhere: fall back to the computed-style probe (real DOM).
  try {
    return isRTL(el);
  } catch {
    return false;
  }
}

/**
 * The inline insets (in px, or `'auto'`) a column cell needs, expressed
 * **logically** (start = leading edge in the active reading direction). LTR and
 * RTL share the same magnitudes; only how they are *written to the DOM* differs
 * (physical vs logical), which {@link positionColumnCell} handles.
 *
 * @returns `{ start, end }` where exactly one is a px number and the other is
 *          `'auto'` — matching the original frozen-band convention.
 */
export function columnInsets<Row extends Model = Model>(
  col: LaidOutColumn<Row>,
  layout: ColumnLayout<Row>,
): { start: number | 'auto'; end: number | 'auto' } {
  if (col.frozen === 'left') {
    // Frozen "start" band: offset from the leading edge by its band-left.
    return { start: col.left, end: 'auto' };
  }
  if (col.frozen === 'right') {
    // Frozen "end" band: `col.left` is measured from the band's leading edge, so
    // the trailing inset is bandWidth - left - width (leftmost end-col → 0).
    const endInset = layout.rightWidth - col.left - col.width;
    return { start: 'auto', end: endInset };
  }
  // Centre (scrolling) band: shift past the frozen-start band so centre columns
  // sit after the pinned columns in reading order.
  return { start: col.left + layout.leftWidth, end: 'auto' };
}

/**
 * Position an absolutely-positioned column cell (header cell, body cell, or a
 * group aggregate cell) over its column, honouring reading direction.
 *
 * In LTR this writes the historical physical `left`/`right` insets unchanged. In
 * RTL it writes the equivalent **logical** `inset-inline-start`/`-end` insets and
 * clears the physical ones, so the browser mirrors the band layout against the
 * container's right edge. The cell width is always set.
 *
 * @param el      the cell element to position
 * @param col     the laid-out column
 * @param layout  the resolved column layout (for `rightWidth`/`leftWidth`)
 * @param rtl     active reading direction (resolve once per paint via
 *                {@link gridIsRTL})
 * @param zIndex  optional stacking for frozen cells (pinned over scrolling cells)
 */
export function positionColumnCell<Row extends Model = Model>(
  el: HTMLElement,
  col: LaidOutColumn<Row>,
  layout: ColumnLayout<Row>,
  rtl: boolean,
  zIndex?: string,
): void {
  el.style.position = 'absolute';
  el.style.width = `${col.width}px`;

  const { start, end } = columnInsets(col, layout);

  if (rtl) {
    // Logical insets — the container's `inset-inline-start: 0` anchor means the
    // browser resolves these against the RIGHT edge under dir=rtl, mirroring the
    // band layout. Clear the physical props so a recycled (previously-LTR) cell
    // doesn't carry a stale `left`/`right`.
    el.style.left = '';
    el.style.right = '';
    el.style.insetInlineStart = start === 'auto' ? 'auto' : `${start}px`;
    el.style.insetInlineEnd = end === 'auto' ? 'auto' : `${end}px`;
  } else {
    // Physical insets — byte-for-byte the original LTR behaviour. Clear any
    // logical props a recycled (previously-RTL) cell may carry.
    el.style.insetInlineStart = '';
    el.style.insetInlineEnd = '';
    el.style.left = start === 'auto' ? 'auto' : `${start}px`;
    el.style.right = end === 'auto' ? 'auto' : `${end}px`;
  }

  if (zIndex != null && col.frozen) el.style.zIndex = zIndex;
}

/**
 * Normalise a horizontal scroll offset to a non-negative "distance from the
 * reading start" value, independent of the browser's RTL `scrollLeft` sign
 * convention.
 *
 * Browsers disagree on `scrollLeft` under `dir="rtl"`:
 *   - the modern/standard model (current Chrome, Firefox, Safari) reports `0` at
 *     the start (content's right edge) and goes **negative** toward the end;
 *   - legacy WebKit reported a positive value decreasing from `maxScroll`.
 *
 * The grid's geometry (`LaidOutColumn.left`, `computeColumnWindow`,
 * `scrollToColumn`) is all expressed as a non-negative offset measured from the
 * reading start, so the engine should consume a normalised value. In LTR this is
 * a no-op. In RTL it folds either sign convention into the same non-negative
 * "how far from the start have we scrolled" scalar.
 *
 * @param scrollLeft  the raw `element.scrollLeft`
 * @param rtl         whether the grid reads right-to-left
 * @param maxScroll   `scrollWidth - clientWidth` (only needed to disambiguate the
 *                    legacy positive-decreasing convention; pass `0`/omit when
 *                    unknown to assume the standard model)
 */
export function normalizeScrollLeft(
  scrollLeft: number,
  rtl: boolean,
  maxScroll = 0,
): number {
  if (!rtl) return Math.max(0, scrollLeft);
  // Standard/modern RTL: scrollLeft is <= 0; distance-from-start = -scrollLeft.
  // `+ 0` collapses a `-0` (from negating 0) to a plain `0`.
  if (scrollLeft <= 0) return Math.min(maxScroll || Infinity, -scrollLeft) + 0;
  // Legacy positive-decreasing RTL: distance-from-start = maxScroll - scrollLeft.
  if (maxScroll > 0) return Math.max(0, maxScroll - scrollLeft);
  // Unknown positive value with no maxScroll context: treat as already a distance.
  return scrollLeft;
}
