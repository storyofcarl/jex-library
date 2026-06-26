/**
 * Master-detail row painting for the DOM renderer (Bryntum/DHTMLX "RowExpander"
 * parity). Lives in its own module so the shared {@link DomRenderer} only needs a
 * one-line delegation when it encounters a `kind: 'detail'` row entry.
 *
 * A detail row is one full-width row inserted directly beneath the master row it
 * belongs to (the {@link RowExpanderFeature} injects it via the row-source seam).
 * It ignores the per-column grid and instead hosts a single sticky, full-width
 * region whose content the consumer renders. The element carries `role="row"`
 * with a single spanning `role="gridcell"` so assistive tech perceives a valid
 * grid row; the detail is associated with its master via `data-detail-for`.
 */

import { createEl, type Model } from '@jects/core';
import type { DetailRowData } from './row-model.js';
import type { ColumnLayout } from './column-layout.js';
import './detail-row.css';

/** Marker class the renderer/feature key detail rows by. */
export const DETAIL_ROW_CLASS = 'jects-grid-detail-row';
/** Class of the spanning detail content cell. */
export const DETAIL_CELL_CLASS = 'jects-grid-detail__cell';
/** Class of the inner host the consumer renderer paints into. */
export const DETAIL_BODY_CLASS = 'jects-grid-detail__body';

/**
 * Paint (or repaint, idempotently) a master-detail region into `el`.
 *
 * The element is reused across recycling cycles, so we fully rebuild its single
 * sticky cell each call and re-invoke the consumer's `render` into a fresh body
 * host (cheap: there are far fewer expanded rows than leaf rows). The detail is
 * keyed by `data-detail-for` (the master id) for delegation/association.
 */
export function paintDetailRow<Row extends Model = Model>(
  el: HTMLElement,
  detail: DetailRowData<Row>,
  layout: ColumnLayout<Row>,
): void {
  el.classList.add(DETAIL_ROW_CLASS, 'jects-grid-detail');
  el.setAttribute('role', 'row');
  el.dataset['detailFor'] = String(detail.masterId);
  el.style.width = `${layout.totalWidth}px`;
  el.replaceChildren();

  // One spanning gridcell, sticky to the inline start so the detail content stays
  // visible while the body scrolls horizontally. Width is clamped to the viewport
  // via CSS sticky + max-inline-size so wide grids still show the panel in view.
  const cell = createEl('div', { className: DETAIL_CELL_CLASS });
  cell.setAttribute('role', 'gridcell');
  cell.setAttribute('aria-colindex', '1');

  const body = createEl('div', { className: DETAIL_BODY_CLASS });
  const result = detail.render(body);
  if (result instanceof HTMLElement && result !== body) {
    body.replaceChildren(result);
  }
  cell.appendChild(body);
  el.appendChild(cell);
}
