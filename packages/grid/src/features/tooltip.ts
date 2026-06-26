/**
 * TooltipFeature — per-cell (and optional per-header) tooltips for @jects/grid.
 *
 * Parity target: Bryntum/DHTMLX cell tooltips. Two content sources, in priority
 * order:
 *
 *   1. A per-column `tooltip` renderer — `column.tooltip(ctx)` returning a string,
 *      trusted HTML (`{ html }`), an `HTMLElement`, or `false`/`null`/`''` to
 *      suppress the tooltip for that cell. This is the explicit, Bryntum-style
 *      `tooltipRenderer`.
 *   2. Overflow fallback — when a cell's text is truncated (its rendered content
 *      is wider than the cell box, i.e. `scrollWidth > clientWidth`), the full
 *      text is surfaced as a tooltip so users can read clipped values. Enabled by
 *      default; gate it with `overflowOnly` / `showOnOverflow`.
 *
 * The bubble itself reuses the `@jects/widgets` `Tooltip` overlay (the house
 * tooltip surface). Because that widget wires a *single static* target, this
 * feature creates one detached `Tooltip` and drives show / hide / reposition
 * imperatively as the pointer/focus moves between cells — keeping one bubble for
 * the whole grid (no per-cell widget churn).
 *
 * Accessibility:
 *   - the active cell gets `aria-describedby="<bubble id>"` while the tooltip is
 *     shown, and it is removed on hide / move / destroy (no stale references);
 *   - the bubble has `role="tooltip"` (from the widget);
 *   - tooltips appear on keyboard focus (`focusin`), not just hover (WCAG 1.4.13);
 *   - Escape dismisses the tooltip without moving focus.
 *
 * All interaction is confined to `GridApi`; `destroy()` releases every listener,
 * the bubble widget, and any `aria-describedby` it set.
 */

import type { Model } from '@jects/core';
import { Tooltip, type TooltipPlacement } from '@jects/widgets';
import type { CellAddress, ColumnDef, GridApi, GridFeature } from '../contract.js';
import { Disposers, escapeHtml, getValue } from './shared.js';
import './tooltip.css';

/* ═══════════════════════════════════════════════════════════════════════════
   Public types
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Result a column `tooltip` renderer may return:
 *   - `string`            → plain text bubble (HTML-escaped);
 *   - `{ html }`          → trusted HTML bubble;
 *   - `HTMLElement`       → arbitrary node mounted into the bubble;
 *   - `false`/`null`/`''` → suppress the tooltip for this cell.
 */
export type TooltipContent =
  | string
  | HTMLElement
  | { html: string }
  | null
  | false
  | undefined;

/** Context handed to a column/header tooltip renderer. */
export interface CellTooltipContext<Row extends Model = Model> {
  /** The row model (undefined for header tooltips). */
  row: Row | undefined;
  /** The resolved cell value (undefined for header tooltips). */
  value: unknown;
  /** The column definition. */
  column: ColumnDef<Row>;
  /** Cell address (header tooltips report `rowIndex === -1`). */
  address: CellAddress;
  /** The cell/header element under the pointer/focus. */
  el: HTMLElement;
  /** Whether this cell's own content is overflow-truncated. */
  overflow: boolean;
  /** The grid public API. */
  api: GridApi<Row>;
}

/**
 * A column tooltip renderer. Lives on `column.tooltip`. Since the frozen
 * `ColumnDef` contract does not (yet) declare it, columns carry it as an extra
 * field read structurally by this feature — see {@link TooltipColumnDef}.
 */
export type CellTooltipRenderer<Row extends Model = Model> = (
  ctx: CellTooltipContext<Row>,
) => TooltipContent;

/**
 * A `ColumnDef` augmented with the optional `tooltip` renderer this feature
 * reads. Authoring columns as `TooltipColumnDef` (instead of `ColumnDef`) gives
 * full typing for the renderer without mutating the frozen contract.
 */
export type TooltipColumnDef<Row extends Model = Model> = ColumnDef<Row> & {
  /** Per-cell tooltip renderer. Return `false`/`''` to suppress. */
  tooltip?: CellTooltipRenderer<Row>;
};

export interface TooltipFeatureOptions<Row extends Model = Model> {
  /**
   * Show a fallback tooltip with the cell's full text when its content is
   * overflow-truncated. Default `true`.
   */
  showOnOverflow?: boolean;
  /**
   * Only ever show tooltips for overflow-truncated cells — ignore column
   * `tooltip` renderers. Default `false`. (Mutually exclusive-ish with relying
   * on renderers; handy for a pure "show clipped text" grid.)
   */
  overflowOnly?: boolean;
  /** Also show tooltips on header cells (uses the column `headerTooltip`/`tooltip`). Default `false`. */
  headers?: boolean;
  /** A global fallback renderer used when a column has no `tooltip`. */
  renderer?: CellTooltipRenderer<Row>;
  /** Bubble side relative to the cell. Default `'top'`. */
  placement?: TooltipPlacement;
  /** Delay (ms) before showing after hover/focus. Default `300`. */
  showDelay?: number;
  /** Delay (ms) before hiding after leave/blur. Default `100`. */
  hideDelay?: number;
  /** Gap (px) between cell and bubble. Default `6`. */
  offset?: number;
  /** Max bubble width hint (px). Applied as inline `max-width`. Default unset (CSS token). */
  maxWidth?: number;
}

/** Payload describing the cell a tooltip is about. */
export interface CellTooltipPayload<Row extends Model = Model> {
  row: Row | undefined;
  column: ColumnDef<Row>;
  address: CellAddress;
  /** Resolved plain-text/HTML the bubble will display. */
  content: TooltipContent;
  /** The cell element. */
  el: HTMLElement;
}

/**
 * Events emitted on the grid by this feature. Follows the house veto convention:
 * a `beforeTooltipShow` handler returning `false` cancels the tooltip.
 *
 * These keys are additive to the grid event map; the feature emits them through
 * the same `GridApi.emit` used by other features. Callers subscribe with
 * `(grid.on as any)('tooltipShow', ...)` or via the typed helpers below.
 */
export interface TooltipFeatureEvents<Row extends Model = Model> {
  /** Vetoable: a tooltip is about to be shown for a cell. */
  beforeTooltipShow: CellTooltipPayload<Row>;
  /** A tooltip became visible. */
  tooltipShow: CellTooltipPayload<Row>;
  /** A tooltip was hidden. */
  tooltipHide: { address: CellAddress | null };
}

/* ═══════════════════════════════════════════════════════════════════════════
   Feature
   ═══════════════════════════════════════════════════════════════════════════ */

type AnyEmit = (event: string, payload: unknown) => boolean;
/** Loosened Tooltip config patch that permits `undefined` clears. */
interface BubblePatch {
  text?: string | undefined;
  html?: string | undefined;
  placement?: TooltipPlacement | undefined;
  target?: HTMLElement | undefined;
}

const CELL_SEL = '.jects-grid__cell[data-col-index]';
const HEADER_SEL = '.jects-grid__header-cell[data-col-index]';
const ROW_SEL = '.jects-grid__row[data-row-index]';

interface ResolvedOptions<Row extends Model> {
  showOnOverflow: boolean;
  overflowOnly: boolean;
  headers: boolean;
  placement: TooltipPlacement;
  showDelay: number;
  hideDelay: number;
  offset: number;
  renderer: CellTooltipRenderer<Row> | undefined;
  maxWidth: number | undefined;
}

export class TooltipFeature<Row extends Model = Model> implements GridFeature<Row> {
  readonly name = 'tooltip';

  private api!: GridApi<Row>;
  private readonly disposers = new Disposers();
  private readonly opts: ResolvedOptions<Row>;

  /** The single shared bubble (created lazily on first show). */
  private bubble: Tooltip | null = null;
  /** The cell the bubble currently describes (and that owns `aria-describedby`). */
  private activeCell: HTMLElement | null = null;
  private activeAddress: CellAddress | null = null;
  /** Pending show/hide timers. */
  private showTimer: ReturnType<typeof setTimeout> | undefined;
  private hideTimer: ReturnType<typeof setTimeout> | undefined;
  /** The cell a *pending* (scheduled, not yet shown) tooltip targets. */
  private pendingCell: HTMLElement | null = null;
  private destroyed = false;

  constructor(options: TooltipFeatureOptions<Row> = {}) {
    this.opts = {
      showOnOverflow: options.showOnOverflow ?? true,
      overflowOnly: options.overflowOnly ?? false,
      headers: options.headers ?? false,
      placement: options.placement ?? 'top',
      showDelay: options.showDelay ?? 300,
      hideDelay: options.hideDelay ?? 100,
      offset: options.offset ?? 6,
      renderer: options.renderer,
      maxWidth: options.maxWidth,
    };
  }

  /* ── lifecycle ─────────────────────────────────────────────────────────── */

  init(grid: GridApi<Row>): void {
    this.api = grid;
    grid.track(() => this.disposers.dispose());

    const root = grid.el;
    const over = (e: Event): void => this.onPointerOver(e as PointerEvent);
    const out = (e: Event): void => this.onPointerOut(e as PointerEvent);
    const focusIn = (e: Event): void => this.onFocusIn(e as FocusEvent);
    const focusOut = (e: Event): void => this.onFocusOut(e as FocusEvent);
    const key = (e: Event): void => this.onKeyDown(e as KeyboardEvent);

    root.addEventListener('pointerover', over);
    root.addEventListener('pointerout', out);
    root.addEventListener('focusin', focusIn);
    root.addEventListener('focusout', focusOut);
    root.addEventListener('keydown', key);
    // Any scroll dismisses immediately (the cell moved out from under the bubble).
    const onScroll = (): void => this.hideNow();
    root.addEventListener('scroll', onScroll, true);

    this.disposers.add(() => root.removeEventListener('pointerover', over));
    this.disposers.add(() => root.removeEventListener('pointerout', out));
    this.disposers.add(() => root.removeEventListener('focusin', focusIn));
    this.disposers.add(() => root.removeEventListener('focusout', focusOut));
    this.disposers.add(() => root.removeEventListener('keydown', key));
    this.disposers.add(() => root.removeEventListener('scroll', onScroll, true));
    this.disposers.add(() => {
      clearTimeout(this.showTimer);
      clearTimeout(this.hideTimer);
    });
    this.disposers.add(() => this.teardownBubble());
    // Hiding when the grid repaints keeps the bubble from pointing at a recycled
    // cell that now shows a different row.
    this.disposers.add(grid.on('viewportChange', () => this.hideNow()));

    grid.el.classList.add('jects-grid--has-tooltips');
    this.disposers.add(() => grid.el.classList.remove('jects-grid--has-tooltips'));
  }

  destroy(): void {
    this.destroyed = true;
    this.disposers.dispose();
  }

  /* ── pointer / focus handlers ──────────────────────────────────────────── */

  private onPointerOver(e: PointerEvent): void {
    const cell = this.cellFromEvent(e);
    if (!cell) return;
    if (cell === this.activeCell || cell === this.pendingCell) {
      // Re-entering the same cell cancels a pending hide.
      clearTimeout(this.hideTimer);
      return;
    }
    this.scheduleShow(cell);
  }

  private onPointerOut(e: PointerEvent): void {
    const cell = this.cellFromEvent(e);
    if (!cell) return;
    // Ignore moves *within* the same cell (to a child element).
    const related = e.relatedTarget as Node | null;
    if (related && cell.contains(related)) return;
    if (cell === this.activeCell || cell === this.pendingCell) this.scheduleHide();
  }

  private onFocusIn(e: FocusEvent): void {
    const cell = this.cellFromEvent(e);
    if (!cell || cell === this.activeCell) return;
    this.scheduleShow(cell, /* immediate-ish */ true);
  }

  private onFocusOut(e: FocusEvent): void {
    const cell = this.cellFromEvent(e);
    if (!cell) return;
    if (cell === this.activeCell || cell === this.pendingCell) this.scheduleHide();
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape' && (this.activeCell || this.pendingCell)) {
      this.hideNow();
    }
  }

  /** Resolve the cell (or header) element an event happened in. */
  private cellFromEvent(e: Event): HTMLElement | null {
    const t = e.target as HTMLElement | null;
    if (!t || typeof t.closest !== 'function') return null;
    const cell = t.closest<HTMLElement>(CELL_SEL);
    if (cell && this.api.el.contains(cell)) return cell;
    if (this.opts.headers) {
      const header = t.closest<HTMLElement>(HEADER_SEL);
      if (header && this.api.el.contains(header)) return header;
    }
    return null;
  }

  /* ── show / hide scheduling ────────────────────────────────────────────── */

  private scheduleShow(cell: HTMLElement, focus = false): void {
    clearTimeout(this.hideTimer);
    clearTimeout(this.showTimer);
    this.pendingCell = cell;
    const delay = focus ? Math.min(this.opts.showDelay, 100) : this.opts.showDelay;
    this.showTimer = setTimeout(() => this.showFor(cell), delay);
  }

  private scheduleHide(): void {
    clearTimeout(this.showTimer);
    clearTimeout(this.hideTimer);
    this.pendingCell = null;
    this.hideTimer = setTimeout(() => this.hideNow(), this.opts.hideDelay);
  }

  /**
   * Resolve content for a cell and, if non-empty and not vetoed, show the bubble.
   * Public so consumers/tests can trigger a tooltip imperatively.
   */
  showFor(cell: HTMLElement): boolean {
    if (this.isDestroyed) return false;
    this.pendingCell = null;
    const resolved = this.resolveForCell(cell);
    if (!resolved) {
      this.hideNow();
      return false;
    }
    const { content, payload } = resolved;

    // Veto hook.
    const proceed = (this.api.emit as unknown as AnyEmit)('beforeTooltipShow', payload);
    if (proceed === false) return false;

    const bubble = this.ensureBubble();
    // `update()` merges config; passing a key explicitly clears the prior cell's
    // value (the widget renders from config, so stale text/html must be unset).
    // exactOptionalPropertyTypes forbids `{ html: undefined }` literally, so we
    // route clears through this loosened patch helper.
    const patch = (p: BubblePatch): void => {
      bubble.update(p as never);
    };

    // Push content into the bubble and position it against the cell.
    if (typeof content === 'string') {
      patch({ text: content, html: undefined, placement: this.opts.placement });
    } else if (content instanceof HTMLElement) {
      // Clear any text/html from a prior cell so the widget's render() does not
      // re-apply it over our element node, then mount the node.
      patch({ text: undefined, html: undefined, placement: this.opts.placement });
      bubble.el.replaceChildren(content);
    } else if (content && typeof content === 'object' && 'html' in content) {
      patch({ html: content.html, text: undefined, placement: this.opts.placement });
    } else {
      this.hideNow();
      return false;
    }

    // Re-target the bubble to this cell for positioning + aria wiring.
    this.clearAria();
    this.activeCell = cell;
    this.activeAddress = payload.address;
    patch({ target: cell });
    bubble.showNow();
    cell.setAttribute('aria-describedby', bubble.el.id);

    (this.api.emit as unknown as AnyEmit)('tooltipShow', payload);
    return true;
  }

  /** Hide the bubble immediately and release aria/state. */
  hideNow(): void {
    clearTimeout(this.showTimer);
    clearTimeout(this.hideTimer);
    this.pendingCell = null;
    if (!this.activeCell && !this.bubble?.isVisible) {
      this.activeAddress = null;
      return;
    }
    this.clearAria();
    this.bubble?.hideNow();
    const addr = this.activeAddress;
    this.activeCell = null;
    this.activeAddress = null;
    if (addr) (this.api.emit as unknown as AnyEmit)('tooltipHide', { address: addr });
  }

  /* ── content resolution ────────────────────────────────────────────────── */

  private resolveForCell(
    cell: HTMLElement,
  ): { content: TooltipContent; payload: CellTooltipPayload<Row> } | null {
    const isHeader = cell.classList.contains('jects-grid__header-cell');
    if (isHeader && !this.opts.headers) return null;
    const colIndex = Number(cell.dataset['colIndex']);
    if (Number.isNaN(colIndex)) return null;
    const column = this.api.columns[colIndex] as TooltipColumnDef<Row> | undefined;
    if (!column) return null;

    let rowIndex = -1;
    let row: Row | undefined;
    if (!isHeader) {
      const rowEl = cell.closest<HTMLElement>(ROW_SEL);
      rowIndex = rowEl ? Number(rowEl.dataset['rowIndex']) : NaN;
      if (Number.isNaN(rowIndex)) return null;
      row = this.api.getRow(rowIndex);
      if (!row) return null;
    }

    const address: CellAddress = { rowIndex, colIndex };
    const overflow = this.isOverflowing(cell);
    const value = row !== undefined ? getValue(row, column) : undefined;

    const ctx: CellTooltipContext<Row> = {
      row,
      value,
      column,
      address,
      el: cell,
      overflow,
      api: this.api,
    };

    let content: TooltipContent;
    if (!this.opts.overflowOnly) {
      const renderer = column.tooltip ?? this.opts.renderer;
      if (renderer) content = renderer(ctx);
    }

    // Overflow fallback: surface the clipped text when no explicit content.
    if (isEmptyContent(content) && this.opts.showOnOverflow && overflow) {
      const text = (cell.textContent ?? '').trim();
      if (text) content = text;
    }

    if (isEmptyContent(content)) return null;

    return {
      content,
      payload: { row, column, address, content, el: cell },
    };
  }

  /** Is the cell's content wider/taller than its box (i.e. truncated)? */
  private isOverflowing(cell: HTMLElement): boolean {
    // A child wrapper may be the true overflow source; check the cell and its
    // single content child. `scrollWidth > clientWidth + 1` tolerates sub-pixel.
    if (cell.scrollWidth > cell.clientWidth + 1) return true;
    if (cell.scrollHeight > cell.clientHeight + 1) return true;
    return false;
  }

  /* ── bubble lifecycle ──────────────────────────────────────────────────── */

  private ensureBubble(): Tooltip {
    return this.bubble ?? (this.bubble = this.createBubble());
  }

  private createBubble(): Tooltip {
    // Portal the bubble host OUT of the grid root (into <body>). The grid root
    // carries `role="grid"`, whose required-children contract forbids a
    // `role="tooltip"` descendant — mounting the bubble inside it produces an
    // `aria-required-children` axe violation. A document-level host keeps the
    // bubble out of the grid's a11y ownership subtree while `aria-describedby`
    // (an id reference, not containment) still wires the cell to it. The host is
    // still torn down with the feature via the disposer below.
    const host = document.createElement('div');
    host.className = 'jects-grid-tooltip-host';
    document.body.appendChild(host);
    const bubble = new Tooltip(host, {
      placement: this.opts.placement,
      showDelay: 0,
      hideDelay: 0,
      offset: this.opts.offset,
      cls: 'jects-grid-tooltip',
    });
    if (this.opts.maxWidth != null) {
      bubble.el.style.maxWidth = `${this.opts.maxWidth}px`;
    }
    this.disposers.add(() => host.remove());
    return bubble;
  }

  private teardownBubble(): void {
    this.clearAria();
    this.bubble?.destroy();
    this.bubble = null;
    this.activeCell = null;
    this.activeAddress = null;
    this.pendingCell = null;
  }

  private clearAria(): void {
    if (this.activeCell && this.bubble) {
      const cur = this.activeCell.getAttribute('aria-describedby');
      if (cur === this.bubble.el.id) this.activeCell.removeAttribute('aria-describedby');
    }
  }

  /* ── introspection (tests / consumers) ─────────────────────────────────── */

  /** The cell address the tooltip currently describes, or `null`. */
  get currentAddress(): CellAddress | null {
    return this.activeAddress;
  }

  /** Is a tooltip currently visible? */
  get isVisible(): boolean {
    return !!this.bubble?.isVisible;
  }

  /** The shared bubble element (created lazily), for assertions. */
  get bubbleEl(): HTMLElement | null {
    return this.bubble?.el ?? null;
  }

  private get isDestroyed(): boolean {
    return this.destroyed;
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   Helpers + factory
   ═══════════════════════════════════════════════════════════════════════════ */

/** Treat `''`, `null`, `false`, `undefined` as "no tooltip". */
function isEmptyContent(c: TooltipContent): boolean {
  if (c == null || c === false) return true;
  if (typeof c === 'string') return c.trim() === '';
  return false;
}

/**
 * Build a simple HTML tooltip body from a list of label/value pairs — a common
 * "detail card" tooltip. Returns a `{ html }` content object (already escaped).
 */
export function detailTooltip(rows: Array<[label: string, value: unknown]>): { html: string } {
  const body = rows
    .map(
      ([label, value]) =>
        `<div class="jects-grid-tooltip__row"><span class="jects-grid-tooltip__label">${escapeHtml(
          String(label),
        )}</span><span class="jects-grid-tooltip__value">${escapeHtml(
          value == null ? '' : String(value),
        )}</span></div>`,
    )
    .join('');
  return { html: `<div class="jects-grid-tooltip__card">${body}</div>` };
}

/** Convenience factory. */
export function tooltipFeature<Row extends Model = Model>(
  options?: TooltipFeatureOptions<Row>,
): TooltipFeature<Row> {
  return new TooltipFeature<Row>(options);
}
