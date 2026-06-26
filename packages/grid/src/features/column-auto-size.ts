/**
 * ColumnAutoSizeFeature — header double-click "auto-fit-to-content" affordance
 * for @jects/grid.
 *
 * Mirrors the Bryntum / DHTMLX behavior: every column header carries a thin
 * **resize handle** at its trailing edge; double-clicking that handle auto-fits
 * the column width to its widest content (header label + the widest visible cell
 * value), exactly like double-clicking the column divider in Excel. This is the
 * missing *UX affordance* + the *engine-supplied text measurer* that the existing
 * `ColumnModel.autoSize` / `ColumnFeature.autoSize` logic was waiting for.
 *
 * Design (concurrency-safe — additive; talks to the grid ONLY through `GridApi`,
 * and to column ops through the already-installed `columns` feature):
 *   - A thin, focusable handle (`role="separator"`) is injected at the trailing
 *     edge of every header cell. Header cells are re-rendered on layout changes,
 *     so the feature re-decorates after `viewportChange`, `columnResize`, and
 *     `columnReorder` (all delegated; idempotent — never double-injects).
 *   - **Double-click** the handle → measure the column's content with the core
 *     canvas `measureText` (layout-free, reads the grid's real CSS font) and
 *     auto-size to fit. Delegates the actual clamp/persist/emit to the column
 *     feature's `autoSize(id, measure)` when present (so per-column `resizable`
 *     / `minWidth` / `maxWidth` bands are honored), else falls back to a direct
 *     `updateColumn` width write.
 *   - **Keyboard** a11y: the handle is a tab stop; `Enter` / `Space` trigger the
 *     same auto-fit (WCAG 2.1.1 — the pointer affordance has a keyboard path).
 *
 * Measuring: header font + cell font may differ (header is usually heavier), so
 * each is measured with its own resolved CSS `font` shorthand. We measure the
 * header label and every *visible* row's cell value (capped at `sampleLimit`
 * rows to stay O(viewport) on huge datasets — the visible window is what the
 * user sees), take the max, and let the column feature add its content padding.
 *
 * The feature emits a typed `columnAutoSize` event (module-augmented onto the
 * frozen contract) and releases every listener/DOM it created on `destroy()`.
 */

import { createEl, measureText, type Model } from '@jects/core';
import type { ColumnDef, GridApi, GridFeature } from '../contract.js';
import { Disposers } from './shared.js';
import './column-auto-size.css';

/**
 * Payload for the `columnAutoSize` grid event. Augments the contract's
 * `GridEvents` (see the module augmentation at the bottom of this file) so
 * consumers get a fully typed `grid.on('columnAutoSize', …)`.
 */
export interface ColumnAutoSizeEvent<Row extends Model = Model> {
  /** The stable id of the auto-sized column. */
  columnId: string;
  /** The column definition that was auto-sized. */
  column: ColumnDef<Row>;
  /** The new (clamped) width in px. */
  width: number;
  /** The measured content width (header/cell text, before padding/clamp). */
  contentWidth: number;
}

/**
 * Hook the integrator can supply to override how a column's content width is
 * measured. Receives the column def, the resolved header/cell CSS font
 * shorthands, and a lazy row-value reader; returns the widest content in px
 * (BEFORE the column feature's padding/clamp). When omitted, the built-in
 * `measureText`-based measurer is used.
 */
export type MeasureColumnContent<Row extends Model = Model> = (ctx: {
  column: ColumnDef<Row>;
  api: GridApi<Row>;
  headerFont: string;
  cellFont: string;
  /** Measure rendered width of `text` in the given CSS `font` shorthand. */
  measure: (text: string, font: string) => number;
}) => number;

export interface ColumnAutoSizeFeatureOptions<Row extends Model = Model> {
  /** Thickness (px) of the double-click hit-area at the header's trailing edge. Default `8`. */
  handleSize?: number;
  /**
   * Max number of (visible) rows sampled when measuring content. Keeps the
   * measure O(viewport) on large datasets. Default `200`.
   */
  sampleLimit?: number;
  /**
   * Whether to include the header label in the measured content. Default `true`
   * (the header must remain readable after the fit).
   */
  includeHeader?: boolean;
  /** Override the content measurer (defaults to the canvas `measureText` one). */
  measure?: MeasureColumnContent<Row>;
}

const DEFAULTS = {
  handleSize: 8,
  sampleLimit: 200,
  includeHeader: true,
} as const;

/** Fallback CSS `font` shorthand if computed style is unavailable (jsdom). */
const FALLBACK_FONT = '14px sans-serif';

/** Structural view of the `columns` feature this feature delegates auto-size to. */
interface ColumnFeatureLike<Row extends Model = Model> {
  autoSize?: (id: string, measure: (def: ColumnDef<Row>) => number) => number;
}

export class ColumnAutoSizeFeature<Row extends Model = Model> implements GridFeature<Row> {
  readonly name = 'columnAutoSize';

  private api!: GridApi<Row>;
  private readonly disposers = new Disposers();

  private readonly handleSize: number;
  private readonly sampleLimit: number;
  private readonly includeHeader: boolean;
  private readonly measureHook?: MeasureColumnContent<Row>;

  constructor(options: ColumnAutoSizeFeatureOptions<Row> = {}) {
    this.handleSize = options.handleSize ?? DEFAULTS.handleSize;
    this.sampleLimit = options.sampleLimit ?? DEFAULTS.sampleLimit;
    this.includeHeader = options.includeHeader ?? DEFAULTS.includeHeader;
    if (options.measure) this.measureHook = options.measure;
  }

  init(grid: GridApi<Row>): void {
    this.api = grid;
    grid.track(() => this.disposers.dispose());

    grid.el.classList.add('jects-grid--col-auto-sizable');

    // Header cells are rebuilt on layout changes — re-decorate after each so
    // the handle survives. All three are cheap + idempotent.
    this.disposers.add(grid.on('viewportChange', () => this.decorateHeaders()));
    this.disposers.add(grid.on('columnResize', () => this.decorateHeaders()));
    this.disposers.add(grid.on('columnReorder', () => this.decorateHeaders()));

    // Delegated gesture handling on the grid root (a single listener pair).
    const onDblClick = (e: Event): void => this.onDblClick(e as MouseEvent);
    const onKeyDown = (e: Event): void => this.onKeyDown(e as KeyboardEvent);
    grid.el.addEventListener('dblclick', onDblClick);
    grid.el.addEventListener('keydown', onKeyDown);
    this.disposers.add(() => {
      grid.el.removeEventListener('dblclick', onDblClick);
      grid.el.removeEventListener('keydown', onKeyDown);
    });

    // Decorate whatever header is already painted.
    this.decorateHeaders();
  }

  /* ── public API ──────────────────────────────────────────────────────── */

  /**
   * Programmatically auto-fit a column to its content (same path the
   * double-click triggers). Returns the committed width, or `undefined` when the
   * column is unknown / not resizable.
   */
  autoSizeColumn(id: string): number | undefined {
    const column = this.api.getColumn(id);
    if (!column) return undefined;
    if (column.resizable === false) return column.width;

    const contentWidth = this.measureColumn(column);
    const width = this.applyAutoSize(id, column, contentWidth);
    if (width == null) return undefined;
    this.api.emit('columnAutoSize', {
      columnId: id,
      column,
      width,
      contentWidth,
    } as ColumnAutoSizeEvent<Row>);
    // Header geometry changed — re-decorate so the handle tracks the new edge.
    this.decorateHeaders();
    return width;
  }

  /* ── header decoration (inject the double-click handle) ──────────────── */

  private decorateHeaders(): void {
    const headers = this.api.el.querySelectorAll<HTMLElement>('.jects-grid__header-cell');
    headers.forEach((cell) => {
      const id = cell.dataset['colId'];
      if (id == null) return;
      let handle = cell.querySelector<HTMLElement>(':scope > .jects-grid__col-auto-sizer');
      if (!handle) {
        handle = createEl('div', { className: 'jects-grid__col-auto-sizer' });
        handle.dataset['colAutoSizer'] = '';
        handle.setAttribute('role', 'separator');
        handle.setAttribute('aria-orientation', 'vertical');
        handle.tabIndex = 0;
        handle.style.width = `${this.handleSize}px`;
        // A pointerdown on the handle must not start a header sort / selection.
        handle.addEventListener('mousedown', stopEvent);
        handle.addEventListener('click', stopEvent);
        cell.appendChild(handle);
      }
      const column = this.api.getColumn(id);
      const resizable = column?.resizable !== false;
      handle.hidden = !resizable;
      handle.setAttribute(
        'aria-label',
        `Auto-size column ${column?.header ?? column?.field ?? id} to fit content`,
      );
      // A focusable `role="separator"` is a *focusable separator* and must carry
      // value attributes (axe `aria-required-attr`). The handle represents the
      // column's width, so expose that as its value within the column's resize
      // band, keeping the separator semantics valid for assistive tech.
      const min = column?.minWidth ?? 40;
      const max = column?.maxWidth;
      const cur = column?.width ?? min;
      handle.setAttribute('aria-valuemin', String(min));
      if (max != null) handle.setAttribute('aria-valuemax', String(max));
      else handle.removeAttribute('aria-valuemax');
      handle.setAttribute('aria-valuenow', String(Math.round(cur)));
    });
  }

  /* ── gesture handlers ────────────────────────────────────────────────── */

  private onDblClick(event: MouseEvent): void {
    const id = this.handleColumnId(event.target);
    if (id == null) return;
    event.preventDefault();
    event.stopPropagation();
    this.autoSizeColumn(id);
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'Spacebar') return;
    const id = this.handleColumnId(event.target);
    if (id == null) return;
    event.preventDefault();
    event.stopPropagation();
    this.autoSizeColumn(id);
    // Keep keyboard focus on the (re-decorated) handle for the same column.
    this.refocusHandle(id);
  }

  /** Resolve the column id for an event whose target is (within) an auto-sizer handle. */
  private handleColumnId(target: EventTarget | null): string | null {
    const handle = (target as HTMLElement | null)?.closest<HTMLElement>('[data-col-auto-sizer]');
    if (!handle) return null;
    const cell = handle.closest<HTMLElement>('.jects-grid__header-cell');
    return cell?.dataset['colId'] ?? null;
  }

  private refocusHandle(id: string): void {
    const cell = this.api.el.querySelector<HTMLElement>(
      `.jects-grid__header-cell[data-col-id="${cssEscape(id)}"]`,
    );
    cell?.querySelector<HTMLElement>('[data-col-auto-sizer]')?.focus();
  }

  /* ── measuring + applying ────────────────────────────────────────────── */

  /**
   * Measure the widest content of a column (header label + visible cell values)
   * using the canvas `measureText` against the grid's real CSS fonts.
   */
  private measureColumn(column: ColumnDef<Row>): number {
    const { headerFont, cellFont } = this.resolveFonts();
    if (this.measureHook) {
      return this.measureHook({
        column,
        api: this.api,
        headerFont,
        cellFont,
        measure: measureText,
      });
    }

    let max = 0;
    if (this.includeHeader) {
      const label = column.header ?? column.field ?? '';
      max = Math.max(max, measureText(String(label), headerFont));
    }

    const total = this.api.getRowCount();
    const limit = Math.min(total, this.sampleLimit);
    const field = column.field;
    for (let i = 0; i < limit; i++) {
      const row = this.api.getRow(i);
      if (row === undefined) continue;
      const value = field != null ? (row as Model)[field] : undefined;
      const text = this.cellText(value, column);
      if (text === '') continue;
      max = Math.max(max, measureText(text, cellFont));
    }
    return max;
  }

  /** Stringify a cell value the way the default renderer would (for measuring). */
  private cellText(value: unknown, column: ColumnDef<Row>): string {
    if (column.type === 'check') return value ? '✓' : '';
    if (value == null) return '';
    return String(value);
  }

  /**
   * Resolve the CSS `font` shorthand of a header cell + a body cell so measuring
   * matches what is actually painted. Falls back to a sane default under jsdom
   * (where `getComputedStyle` returns empty font metrics).
   */
  private resolveFonts(): { headerFont: string; cellFont: string } {
    const headerCell = this.api.el.querySelector<HTMLElement>('.jects-grid__header-cell');
    const bodyCell = this.api.el.querySelector<HTMLElement>('.jects-grid__cell');
    return {
      headerFont: fontOf(headerCell) ?? fontOf(this.api.el) ?? FALLBACK_FONT,
      cellFont: fontOf(bodyCell) ?? fontOf(this.api.el) ?? FALLBACK_FONT,
    };
  }

  /**
   * Apply an auto-size to the column. Prefers the installed `columns` feature's
   * `autoSize` (which honors `resizable`/`minWidth`/`maxWidth` + emits the
   * contract `columnResize` event + repaints); falls back to a direct
   * `updateColumn` width write when that feature is absent. Returns the committed
   * width, or `undefined` when nothing could be applied.
   */
  private applyAutoSize(
    id: string,
    column: ColumnDef<Row>,
    contentWidth: number,
  ): number | undefined {
    const colFeature = this.api.features.get('columns') as ColumnFeatureLike<Row> | undefined;
    if (colFeature?.autoSize) {
      // The column feature owns the padding; we hand it a measurer that returns
      // the already-measured content width regardless of which def it passes.
      return colFeature.autoSize(id, () => contentWidth);
    }
    // Fallback: clamp here and write the width directly.
    const padding = 24;
    const min = column.minWidth ?? 40;
    const max = column.maxWidth ?? Infinity;
    const width = Math.max(min, Math.min(max, Math.ceil(contentWidth) + padding));
    this.api.updateColumn(id, { width });
    this.api.invalidateLayout();
    return width;
  }

  destroy(): void {
    this.api?.el.classList.remove('jects-grid--col-auto-sizable');
    // Remove injected handles so the header DOM is left clean.
    this.api?.el
      .querySelectorAll<HTMLElement>('.jects-grid__col-auto-sizer')
      .forEach((h) => h.remove());
    this.disposers.dispose();
  }
}

/** Convenience factory. */
export function columnAutoSizeFeature<Row extends Model = Model>(
  options?: ColumnAutoSizeFeatureOptions<Row>,
): ColumnAutoSizeFeature<Row> {
  return new ColumnAutoSizeFeature<Row>(options);
}

/* ── helpers ───────────────────────────────────────────────────────────── */

function stopEvent(e: Event): void {
  e.stopPropagation();
}

/** Resolve an element's CSS `font` shorthand, or `null` if not measurable. */
function fontOf(el: HTMLElement | null): string | null {
  if (!el || typeof getComputedStyle !== 'function') return null;
  const cs = getComputedStyle(el);
  if (cs.font && cs.font.trim() !== '') return cs.font;
  // jsdom (and some browsers) leave `font` empty — reconstruct from longhands.
  const size = cs.fontSize;
  const family = cs.fontFamily;
  if (size && family) {
    const weight = cs.fontWeight && cs.fontWeight !== 'normal' ? `${cs.fontWeight} ` : '';
    return `${weight}${size} ${family}`;
  }
  return null;
}

/** Minimal CSS.escape shim (jsdom may lack it for attribute selectors). */
function cssEscape(value: string): string {
  const fn = (globalThis as { CSS?: { escape?: (s: string) => string } }).CSS?.escape;
  if (typeof fn === 'function') return fn(value);
  return value.replace(/["\\\]]/g, '\\$&');
}

/* ═══════════════════════════════════════════════════════════════════════════
   Module augmentation — make `columnAutoSize` a first-class, typed grid event so
   consumers get `grid.on('columnAutoSize', e => …)` with a typed payload. This
   is purely additive to the frozen contract (no edits to contract.ts).
   ═══════════════════════════════════════════════════════════════════════════ */
declare module '../contract.js' {
  interface GridEvents<Row extends Model> {
    /** A column was auto-sized to fit its content (header handle double-click). */
    columnAutoSize: ColumnAutoSizeEvent<Row>;
  }
}
