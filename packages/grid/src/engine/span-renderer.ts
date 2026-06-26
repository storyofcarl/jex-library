/**
 * SpanDomRenderer — the {@link DomRenderer} extended with merged-cell (col/row
 * span) support, wiring the orphaned `../columns/spans.ts` geometry into a real
 * paint (PARITY.md → Grid → "Merged cells / spans").
 *
 * Bryntum/DHTMLX behavior matched:
 *   - A cell whose column declares `column.meta.span` becomes a span **origin**:
 *     it is enlarged to cover `colSpan` column widths and `rowSpan` row heights.
 *   - Every cell **covered** by an origin is hidden (no duplicate content under
 *     the enlarged origin), including cells whose origin scrolled out of the
 *     painted window (cross-window clipping via `SpanMap.clippedOrigins`).
 *   - Spans are resolved against the full data view, so virtualization/scroll
 *     never paints a covered cell or a half-clipped origin.
 *
 * Implementation: the base renderer owns the row/cell pool and paints the window
 * exactly as before. This subclass overrides the public paint entry points
 * (`renderViewport`/`updateCell`/`refreshRow`), lets the base paint run first,
 * then applies a span **post-pass** over the freshly painted DOM — sizing origin
 * cells and hiding covered ones. Post-processing the DOM (rather than reaching
 * into the base renderer's private cell painter) keeps this fully additive: the
 * base renderer is untouched, so a concurrent edit to it cannot break spans.
 *
 * The enlarged origin cells are marked with `data-span-origin` + the
 * `--col-span`/`--row-span` classes and an `aria-colspan`/`aria-rowspan` so
 * assistive tech perceives the merge (WAI-ARIA grid).
 */

import { type Model } from '@jects/core';
import type { GridApi, ViewportWindow } from '../contract.js';
import { DomRenderer } from './dom-renderer.js';
import type { GridEngine } from './engine.js';
import { computeWindowSpanMap, hasSpanProviders } from './span-host.js';
import { isCovered, originAt, type SpanMap, type SpanOrigin } from '../columns/spans.js';
import './span-cells.css';

export class SpanDomRenderer<Row extends Model = Model> extends DomRenderer<Row> {
  /** Last resolved map, reused by single-cell repaints (`updateCell`). */
  private spanMap: SpanMap | null = null;
  private spanScrollEl: HTMLElement | null = null;

  constructor(private readonly spanEngine: GridEngine<Row>) {
    super(spanEngine);
  }

  override mount(host: HTMLElement, api: GridApi<Row>): void {
    super.mount(host, api);
    this.spanScrollEl = host;
  }

  override renderViewport(window: ViewportWindow): void {
    super.renderViewport(window);
    this.applySpans(window);
  }

  override refreshRow(rowIndex: number): void {
    super.refreshRow(rowIndex);
    // A model change can change a span; re-resolve and re-apply for the window.
    this.reapply();
  }

  override updateCell(rowIndex: number, colIndex: number): void {
    super.updateCell(rowIndex, colIndex);
    // The base repaint reset the cell's inline geometry/visibility; if a span is
    // active, restore the origin/covered state for the touched cell from the map.
    if (this.spanMap && this.spanMap.hasSpans) {
      this.applyToCell(rowIndex, colIndex, this.spanMap);
    }
  }

  override destroy(): void {
    this.spanMap = null;
    this.spanScrollEl = null;
    super.destroy();
  }

  /* ── span post-pass ──────────────────────────────────────────────────── */

  /** Re-resolve + re-apply spans over whatever window is currently painted. */
  private reapply(): void {
    const window = this.spanEngine.computeViewportWindow();
    this.applySpans(window);
  }

  /**
   * Resolve the span map for `window` and reconcile every painted cell to it:
   * origin cells are enlarged across their col/row span; covered cells are
   * hidden; ordinary cells are reset to their natural geometry (so a cell that
   * *was* an origin/covered and is no longer one is fully restored).
   */
  private applySpans(window: ViewportWindow): void {
    const host = this.scrollHost();
    if (!host) return;

    // Fast path: no column declares a span provider → nothing to do, and make
    // sure no stale span attributes linger from a previous column set.
    if (!hasSpanProviders(this.spanEngine)) {
      if (this.spanMap?.hasSpans) this.clearAll(host);
      this.spanMap = null;
      return;
    }

    const map = computeWindowSpanMap(this.spanEngine, window);
    this.spanMap = map;

    if (!map.hasSpans) {
      this.clearAll(host);
      return;
    }

    const rowEls = host.querySelectorAll<HTMLElement>('.jects-grid__row');
    rowEls.forEach((rowEl) => {
      const rowIndex = Number(rowEl.dataset['rowIndex']);
      if (Number.isNaN(rowIndex)) return;
      const cells = rowEl.querySelectorAll<HTMLElement>('.jects-grid__cell');
      cells.forEach((cellEl) => {
        const colIndex = Number(cellEl.dataset['colIndex']);
        if (Number.isNaN(colIndex)) return;
        this.reconcileCell(cellEl, rowIndex, colIndex, map);
      });
    });
  }

  /** Apply span state to a single (row,col) cell if it is currently painted. */
  private applyToCell(rowIndex: number, colIndex: number, map: SpanMap): void {
    const host = this.scrollHost();
    if (!host) return;
    const cellEl = host.querySelector<HTMLElement>(
      `.jects-grid__row[data-row-index="${rowIndex}"] .jects-grid__cell[data-col-index="${colIndex}"]`,
    );
    if (cellEl) this.reconcileCell(cellEl, rowIndex, colIndex, map);
  }

  /**
   * Bring one painted cell into agreement with the span map:
   *   - covered → hidden (and aria-hidden) so the origin shows through;
   *   - origin with span > 1 → enlarged across the col-span width sum & row-span
   *     height sum, marked `data-span-origin` with `aria-colspan`/`aria-rowspan`;
   *   - otherwise → cleared back to natural single-cell geometry.
   */
  private reconcileCell(
    cellEl: HTMLElement,
    rowIndex: number,
    colIndex: number,
    map: SpanMap,
  ): void {
    if (isCovered(map, rowIndex, colIndex)) {
      this.markCovered(cellEl);
      return;
    }
    const origin = originAt(map, rowIndex, colIndex);
    if (origin && (origin.colSpan > 1 || origin.rowSpan > 1)) {
      this.markOrigin(cellEl, origin);
      return;
    }
    this.clearCell(cellEl);
  }

  /** Hide a covered cell (kept in the DOM for pool recycling, but invisible). */
  private markCovered(cellEl: HTMLElement): void {
    cellEl.classList.remove('jects-grid__cell--span-origin');
    cellEl.classList.add('jects-grid__cell--span-covered');
    cellEl.style.display = 'none';
    cellEl.setAttribute('aria-hidden', 'true');
    cellEl.removeAttribute('aria-colspan');
    cellEl.removeAttribute('aria-rowspan');
    delete cellEl.dataset['spanOrigin'];
  }

  /** Enlarge an origin cell to its col/row span footprint. */
  private markOrigin(cellEl: HTMLElement, origin: SpanOrigin): void {
    cellEl.classList.remove('jects-grid__cell--span-covered');
    cellEl.classList.add('jects-grid__cell--span-origin');
    cellEl.style.display = '';
    cellEl.removeAttribute('aria-hidden');
    cellEl.dataset['spanOrigin'] = '';

    const width = this.sumColumnWidths(origin.colIndex, origin.colSpan);
    const height = this.sumRowHeights(origin.rowIndex, origin.rowSpan);
    cellEl.style.width = `${width}px`;
    // Override the row-height constraint so the origin can grow downward over the
    // rows it covers; the covered rows still occupy their slots (the origin is
    // positioned absolutely from the top of its own row, so it overlays them).
    cellEl.style.height = `${height}px`;
    // Raise above sibling/covered cells so its enlarged box paints on top.
    cellEl.style.zIndex = '1';

    if (origin.colSpan > 1) cellEl.setAttribute('aria-colspan', String(origin.colSpan));
    else cellEl.removeAttribute('aria-colspan');
    if (origin.rowSpan > 1) cellEl.setAttribute('aria-rowspan', String(origin.rowSpan));
    else cellEl.removeAttribute('aria-rowspan');
  }

  /** Reset a cell that is neither covered nor a (>1) origin to natural state. */
  private clearCell(cellEl: HTMLElement): void {
    if (
      !cellEl.classList.contains('jects-grid__cell--span-origin') &&
      !cellEl.classList.contains('jects-grid__cell--span-covered') &&
      cellEl.style.display !== 'none'
    ) {
      return; // already natural — avoid churning style on every paint
    }
    cellEl.classList.remove('jects-grid__cell--span-origin', 'jects-grid__cell--span-covered');
    cellEl.style.display = '';
    cellEl.style.height = '';
    cellEl.style.zIndex = '';
    cellEl.removeAttribute('aria-hidden');
    cellEl.removeAttribute('aria-colspan');
    cellEl.removeAttribute('aria-rowspan');
    delete cellEl.dataset['spanOrigin'];
    // Width is restored by the base renderer's styleColumnCell on the next paint;
    // restore the laid-out width now so a same-window clear looks correct too.
    const laid = this.spanEngine.columns.find(
      (c) => c.index === Number(cellEl.dataset['colIndex']),
    );
    if (laid) cellEl.style.width = `${laid.width}px`;
  }

  /**
   * Remove all span styling from every painted cell. We scan *all* cells (not
   * only those still carrying a span class) because the base renderer's repaint
   * can wipe the span class via `className =` while leaving the inline
   * `display:none`/geometry behind — those orphaned artifacts must be cleared.
   */
  private clearAll(host: HTMLElement): void {
    host
      .querySelectorAll<HTMLElement>('.jects-grid__cell')
      .forEach((cellEl) => this.clearCell(cellEl));
  }

  /* ── geometry helpers ────────────────────────────────────────────────── */

  /** Sum of the resolved widths of `count` columns starting at `colIndex`. */
  private sumColumnWidths(colIndex: number, count: number): number {
    const cols = this.spanEngine.columns;
    let w = 0;
    for (let i = colIndex; i < colIndex + count && i < cols.length; i++) {
      w += cols[i]?.width ?? 0;
    }
    return w;
  }

  /** Sum of the heights of `count` rows starting at `rowIndex`. */
  private sumRowHeights(rowIndex: number, count: number): number {
    let h = 0;
    for (let i = rowIndex; i < rowIndex + count; i++) {
      h += this.spanEngine.rowSize(i);
    }
    return h;
  }

  private scrollHost(): HTMLElement | null {
    // The renderer mounts header+body into the host; query the live body root.
    return this.spanScrollEl;
  }
}

/**
 * {@link RendererFactory} that installs the span-aware renderer. Pass to
 * `new Grid(el, { renderer: spanRendererFactory })` to enable merged cells; the
 * factory reads the engine off the `GridApi` so it slots into the existing
 * pluggable-renderer seam (D9) with no engine/widget changes.
 */
export function spanRendererFactory<Row extends Model = Model>(
  api: GridApi<Row>,
): SpanDomRenderer<Row> {
  // The Grid widget exposes its engine through the GridApi's renderer wiring;
  // the engine is the same instance the default renderer would receive. We read
  // it via the api's internal `engine` accessor when present, else fall back to
  // a structural cast (the widget always constructs the renderer with its engine
  // in scope — see wireNotes for the one-line wiring alternative).
  const host = api as unknown as {
    engine?: GridEngine<Row>;
    getEngine?: () => GridEngine<Row>;
  };
  const engine = host.getEngine ? host.getEngine() : host.engine;
  if (!engine) {
    throw new Error(
      'spanRendererFactory: GridApi did not expose an engine. Use SpanDomRenderer ' +
        'directly with the engine instance (see span-renderer wireNotes).',
    );
  }
  return new SpanDomRenderer<Row>(engine);
}

/** Construct a span-aware renderer directly from an engine (preferred wiring). */
export function createSpanRenderer<Row extends Model = Model>(
  engine: GridEngine<Row>,
): SpanDomRenderer<Row> {
  return new SpanDomRenderer<Row>(engine);
}
