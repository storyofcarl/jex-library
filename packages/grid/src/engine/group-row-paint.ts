/**
 * Group-header row painting for the DOM renderer (Bryntum/DHTMLX "Group" feature
 * parity). Lives in its own module so the shared {@link DomRenderer} only needs a
 * one-line delegation when it encounters a `kind: 'group'` row entry.
 *
 * A group-header band is one full-width row that spans the whole grid (it ignores
 * the per-column grid and instead paints):
 *   - a collapse/expand **toggle chevron** (rotated when open), keyboard-operable,
 *   - the group **caption** = the column header + the shared group **value**,
 *   - a leaf **count** badge, and
 *   - per-column **aggregate cells** positioned over their columns (sum/avg/…),
 *
 * The element is wired for click-to-collapse via a `data-group-key` attribute the
 * widget reads to call `GroupFeature.toggleGroup(key)`. The band carries
 * `role="row"` + `aria-expanded` so assistive tech perceives the collapsible
 * group per the WAI-ARIA treegrid/grid conventions.
 */

import { createEl, type Model } from '@jects/core';
import type { GroupRowData } from './row-model.js';
import type { ColumnLayout } from './column-layout.js';
import { positionColumnCell } from './rtl.js';
import './group-row.css';

/** Marker class the widget delegates clicks/keys from. */
export const GROUP_ROW_CLASS = 'jects-grid-group-row';
/** The toggle button class. */
export const GROUP_TOGGLE_CLASS = 'jects-grid-group__toggle';

/** Default display formatter for an aggregate value (integer-aware). */
export function formatAggregate(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'number') {
    return Number.isInteger(value) ? String(value) : value.toFixed(2);
  }
  if (value instanceof Date) return value.toLocaleDateString();
  return String(value);
}

/** Render the group **value** (caption) to display text. */
export function formatGroupValue(value: unknown): string {
  if (value == null || value === '') return '(none)';
  if (value instanceof Date) return value.toLocaleDateString();
  return String(value);
}

export interface GroupRowPaintOptions {
  /** Indentation (px) applied per nesting depth. Default 16. */
  indent?: number;
  /** Header label for the grouping column (for the caption prefix). */
  columnHeader?: string;
  /** Format an aggregate value for a column. Defaults to {@link formatAggregate}. */
  formatAggregate?: (value: unknown, columnId: string) => string;
  /**
   * Active reading direction. When `true`, aggregate cells are positioned with
   * logical insets so they mirror under `dir="rtl"` (matching the body/header
   * cells). Default `false` (LTR, physical insets).
   */
  rtl?: boolean;
}

/**
 * Paint (or repaint, idempotently) a group-header band into `el`.
 *
 * The element is reused across recycling cycles: we fully rebuild its children
 * each call (a group band is cheap and there are far fewer of them than leaf
 * rows), and key it by `data-group-key` for click delegation.
 */
export function paintGroupRow<Row extends Model = Model>(
  el: HTMLElement,
  group: GroupRowData,
  layout: ColumnLayout<Row>,
  options: GroupRowPaintOptions = {},
): void {
  const indent = options.indent ?? 16;
  const fmtAgg = options.formatAggregate ?? ((v: unknown) => formatAggregate(v));
  const rtl = options.rtl ?? false;

  el.classList.add(GROUP_ROW_CLASS, 'jects-grid-group');
  el.setAttribute('role', 'row');
  // NOTE: `aria-expanded` belongs on the gridcell (a `role="row"` only supports
  // it inside a treegrid), and a `row` must contain `gridcell`s — so the toggle
  // button lives INSIDE the lead gridcell, never as a direct child of the row.
  el.removeAttribute('aria-expanded');
  el.dataset['groupKey'] = group.key;
  el.dataset['groupDepth'] = String(group.depth);
  el.style.width = `${layout.totalWidth}px`;
  el.replaceChildren();

  // Lead cell: indent + toggle + caption + count. Sticky to the left so the
  // group label stays visible while the body scrolls horizontally. It is the
  // band's single spanning gridcell and carries the expanded state for AT.
  const lead = createEl('div', { className: 'jects-grid-group__lead' });
  lead.setAttribute('role', 'gridcell');
  lead.setAttribute('aria-expanded', String(!group.collapsed));
  lead.setAttribute('aria-colindex', '1');
  lead.style.paddingInlineStart = `${8 + group.depth * indent}px`;

  const toggle = createEl('button', { className: GROUP_TOGGLE_CLASS });
  toggle.type = 'button';
  toggle.dataset['groupToggle'] = '';
  toggle.setAttribute('aria-expanded', String(!group.collapsed));
  toggle.setAttribute(
    'aria-label',
    `${group.collapsed ? 'Expand' : 'Collapse'} group ${formatGroupValue(group.value)}`,
  );
  const chevron = createEl('span', { className: 'jects-grid-group__chevron' });
  if (!group.collapsed) chevron.classList.add('jects-grid-group__chevron--open');
  toggle.appendChild(chevron);
  lead.appendChild(toggle);

  const caption = createEl('span', { className: 'jects-grid-group__caption' });
  if (options.columnHeader) {
    const label = createEl('span', { className: 'jects-grid-group__label' });
    label.textContent = `${options.columnHeader}: `;
    caption.appendChild(label);
  }
  const value = createEl('span', { className: 'jects-grid-group__value' });
  value.textContent = formatGroupValue(group.value);
  caption.appendChild(value);
  lead.appendChild(caption);

  const count = createEl('span', { className: 'jects-grid-group__count' });
  count.textContent = `(${group.count})`;
  lead.appendChild(count);

  el.appendChild(lead);

  // Per-column aggregate cells, positioned over their columns so the group
  // summary lines up under each column the same way the footer Summary does.
  // The first column is covered by the sticky lead gridcell (aria-colindex 1),
  // so its aggregate is skipped to avoid a duplicate colindex / overlap.
  for (const col of layout.columns) {
    const id = col.id;
    if (col.index === 0) continue;
    if (!(id in group.summary)) continue;
    const cell = createEl('div', { className: 'jects-grid-group__agg' });
    cell.setAttribute('role', 'gridcell');
    cell.setAttribute('aria-colindex', String(col.index + 1));
    // Mirror the body/header positioning math (frozen bands + RTL logical insets)
    // so the group summary lines up under each column. `top`/`bottom` span the band.
    cell.style.top = '0';
    cell.style.bottom = '0';
    positionColumnCell(cell, col, layout, rtl);
    const align = col.def.align ?? (col.def.type === 'number' ? 'end' : 'start');
    cell.classList.add(`jects-grid-group__agg--${align}`);
    cell.textContent = fmtAgg(group.summary[id], id);
    el.appendChild(cell);
  }
}

