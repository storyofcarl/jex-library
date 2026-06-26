/**
 * FillFeature — range fill (fill-handle drag-fill + copy-fill) for @jects/grid.
 *
 * Mirrors the Bryntum `CellEdit`/`FillHandle` + DHTMLX "auto-fill" affordance and
 * the classic spreadsheet fill handle: the user grabs the small square at the
 * bottom-right corner of the active cell/range selection and drags it down (or
 * up/left/right) over adjacent cells; on release the source range's values are
 * extended across the swept cells. Two fill kinds, matching Excel/Sheets:
 *
 *   - **copy-fill** — the source block is tiled (repeated) across the target.
 *     This is the default and the behavior for non-numeric data.
 *   - **series-fill** — when the source is a single column/row of numbers (or
 *     dates) with a detectable constant step, the fill continues the arithmetic
 *     (or date) progression instead of repeating (e.g. `1,2` → `3,4,5`;
 *     `Jan 1, Jan 8` → `Jan 15, Jan 22`). A single numeric source increments by
 *     `+1` per step (Excel's single-cell drag), or copies when
 *     `series: 'never'` / Ctrl is held.
 *
 * Design (concurrency-safe — additive, talks to the grid only through `GridApi`):
 *   - The active range is derived purely from `GridApi.selection.getSelectedCells()`
 *     (bounding box), so it works against BOTH the engine's `DefaultSelectionModel`
 *     and the richer `GridSelectionModel` without reaching into either.
 *   - A focusable fill handle is injected at the source range's bottom-right
 *     corner after each `selectionChange` / `viewportChange` and re-anchored to
 *     the live DOM cell geometry (survives row/cell recycling).
 *   - Pointer drag sweeps a target rectangle (constrained to a single axis,
 *     like Excel) and draws a dashed preview; on pointer-up the fill is applied.
 *   - Keyboard: the handle is reachable in the tab order; ArrowDown/Up/Left/Right
 *     extend the projected target by one cell, Enter/Space commits, Escape cancels.
 *   - Writing goes through `store.update` (coerced per column type). The fill is
 *     **vetoable**: `beforeFill` fires first (a handler returning `false` cancels
 *     the whole operation); `fill` fires after the store mutations land.
 *
 * Releases every listener/DOM node it created on `destroy()`.
 */

import { createEl, type Model, type RecordId } from '@jects/core';
import type { CellAddress, ColumnType, GridApi, GridFeature } from '../contract.js';
import { Disposers } from './shared.js';
import type { UndoRedoFeature } from './undo-redo.js';
import './fill.css';

/* ═══════════════════════════════════════════════════════════════════════════
   Geometry + config
   ═══════════════════════════════════════════════════════════════════════════ */

/** Inclusive cell rectangle (top-left ≤ bottom-right). */
export interface FillRect {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

/** Direction a fill drag extends the source range. */
export type FillDirection = 'down' | 'up' | 'right' | 'left';

/** How the fill projects source values onto the target cells. */
export type FillKind = 'copy' | 'series';

/** Series behavior preference. */
export type FillSeriesMode = 'auto' | 'always' | 'never';

/**
 * Payload for the (vetoable) `beforeFill` and the (notification) `fill` events.
 * A `beforeFill` handler returning `false` cancels the operation. The `Row` type
 * parameter lets consumers write `FillEvent<Row>` symmetrically with the other
 * grid event payloads (and types the optional affected-`rows` accessor).
 */
export interface FillEvent<Row extends Model = Model> {
  /** The source rectangle whose values seed the fill. */
  source: FillRect;
  /** The target rectangle the values are written into (excludes the source). */
  target: FillRect;
  /** The axis/direction the user dragged. */
  direction: FillDirection;
  /** Whether the projection copies (tiles) or continues a series. */
  kind: FillKind;
  /** The cells actually written (post-commit; empty on `beforeFill`). */
  cells: CellAddress[];
  /**
   * The distinct row models touched by the written cells (post-commit; omitted on
   * `beforeFill`). A convenience for listeners that act per-row; derived from
   * `cells`, so it is `Row`-typed.
   */
  rows?: Row[];
}

export interface FillFeatureOptions {
  /**
   * Series detection. `'auto'` (default) continues a numeric/date progression
   * when one is detected, else copies. `'always'` forces series for numeric
   * sources; `'never'` always copies (tile).
   */
  series?: FillSeriesMode;
  /**
   * Pixel size of the square fill handle. Default `8` (a `--jects-space-2`-ish
   * square; the visual size is token-driven in CSS, this is the hit area).
   */
  handleSize?: number;
  /** Master enable. When false the handle is never shown. Default `true`. */
  enabled?: boolean;
}

const DEFAULTS = {
  series: 'auto' as FillSeriesMode,
  handleSize: 8,
  enabled: true,
} as const;

/* ═══════════════════════════════════════════════════════════════════════════
   Pure helpers (exported for unit tests)
   ═══════════════════════════════════════════════════════════════════════════ */

/** Bounding rectangle of a set of cells, or null when empty. */
export function boundingRect(cells: ReadonlyArray<CellAddress>): FillRect | null {
  if (cells.length === 0) return null;
  let top = Infinity;
  let left = Infinity;
  let bottom = -Infinity;
  let right = -Infinity;
  for (const c of cells) {
    if (c.rowIndex < top) top = c.rowIndex;
    if (c.rowIndex > bottom) bottom = c.rowIndex;
    if (c.colIndex < left) left = c.colIndex;
    if (c.colIndex > right) right = c.colIndex;
  }
  return { top, left, bottom, right };
}

/** All cell addresses inside an inclusive rectangle, row-major. */
export function rectCells(rect: FillRect): CellAddress[] {
  const out: CellAddress[] = [];
  for (let r = rect.top; r <= rect.bottom; r++) {
    for (let c = rect.left; c <= rect.right; c++) out.push({ rowIndex: r, colIndex: c });
  }
  return out;
}

/** Whether `cell` is inside an inclusive rectangle. */
export function rectHas(rect: FillRect, cell: CellAddress): boolean {
  return (
    cell.rowIndex >= rect.top &&
    cell.rowIndex <= rect.bottom &&
    cell.colIndex >= rect.left &&
    cell.colIndex <= rect.right
  );
}

/**
 * Project the target rectangle for a drag from `source` to the pointer cell
 * `to`. The fill is constrained to a single axis (whichever the pointer moved
 * furthest along, Excel-style), and snaps so the target always shares the
 * source's cross-axis extent. Returns `{ direction, target }`, or `null` when
 * the pointer is still inside the source (no fill).
 */
export function projectTarget(
  source: FillRect,
  to: CellAddress,
): { direction: FillDirection; target: FillRect } | null {
  // How far the pointer is beyond each edge of the source.
  const below = to.rowIndex - source.bottom; // >0 dragging down
  const above = source.top - to.rowIndex; // >0 dragging up
  const rightOf = to.colIndex - source.right; // >0 dragging right
  const leftOf = source.left - to.colIndex; // >0 dragging left

  const vert = Math.max(below, above);
  const horiz = Math.max(rightOf, leftOf);

  if (vert <= 0 && horiz <= 0) return null;

  // Pick the dominant axis (ties favor vertical, matching spreadsheet feel).
  if (vert >= horiz) {
    if (below > 0) {
      return {
        direction: 'down',
        target: { top: source.bottom + 1, bottom: to.rowIndex, left: source.left, right: source.right },
      };
    }
    return {
      direction: 'up',
      target: { top: to.rowIndex, bottom: source.top - 1, left: source.left, right: source.right },
    };
  }
  if (rightOf > 0) {
    return {
      direction: 'right',
      target: { top: source.top, bottom: source.bottom, left: source.right + 1, right: to.colIndex },
    };
  }
  return {
    direction: 'left',
    target: { top: source.top, bottom: source.bottom, left: to.colIndex, right: source.left - 1 },
  };
}

/** Coerce a raw cell value to a finite number, or null. */
function asNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Coerce a raw cell value to a Date (epoch ms), or null. */
function asDateMs(v: unknown): number | null {
  if (v instanceof Date) {
    const t = v.getTime();
    return Number.isNaN(t) ? null : t;
  }
  if (typeof v === 'string' && v.trim() !== '') {
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

/** A detected linear progression seed. */
interface Series {
  kind: 'number' | 'date';
  /** Value of the LAST source element (the progression continues from here). */
  last: number;
  /** Constant step between consecutive source elements. */
  step: number;
}

/**
 * Detect a constant-step numeric or date series from an ordered list of source
 * values. Returns null when no consistent step exists.
 *
 *   - A single numeric value → step `+1` (Excel single-cell drag).
 *   - A single date value    → step `+1 day`.
 *   - Two+ numbers/dates with a constant difference → that difference.
 */
export function detectSeries(values: ReadonlyArray<unknown>): Series | null {
  if (values.length === 0) return null;

  // Numeric series?
  const nums = values.map(asNumber);
  if (nums.every((n) => n !== null)) {
    const arr = nums as number[];
    if (arr.length === 1) return { kind: 'number', last: arr[0]!, step: 1 };
    const step = arr[1]! - arr[0]!;
    for (let i = 2; i < arr.length; i++) {
      if (!nearlyEqual(arr[i]! - arr[i - 1]!, step)) return null;
    }
    return { kind: 'number', last: arr[arr.length - 1]!, step };
  }

  // Date series?
  const dates = values.map(asDateMs);
  if (dates.every((d) => d !== null)) {
    const arr = dates as number[];
    const DAY = 86_400_000;
    if (arr.length === 1) return { kind: 'date', last: arr[0]!, step: DAY };
    const step = arr[1]! - arr[0]!;
    for (let i = 2; i < arr.length; i++) {
      if (arr[i]! - arr[i - 1]! !== step) return null;
    }
    return { kind: 'date', last: arr[arr.length - 1]!, step };
  }

  return null;
}

function nearlyEqual(a: number, b: number): boolean {
  return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
}

/**
 * Compute the value to write at series step `n` (1-based offset past the
 * source's last element). For numbers returns a number; for dates returns a Date.
 */
export function seriesValueAt(series: Series, n: number): number | Date {
  if (series.kind === 'date') return new Date(series.last + series.step * n);
  // Round to a sensible precision to avoid float dust (1 + 0.1*30 noise).
  const v = series.last + series.step * n;
  return roundLikeStep(v, series.step);
}

function roundLikeStep(v: number, step: number): number {
  if (Number.isInteger(step) && Number.isInteger(v)) return v;
  // Match the step's decimal places (cap at 10) to keep clean increments.
  const dec = decimals(step);
  const f = 10 ** Math.min(dec, 10);
  return Math.round(v * f) / f;
}

function decimals(n: number): number {
  if (Number.isInteger(n)) return 0;
  const s = String(n);
  const i = s.indexOf('.');
  return i < 0 ? 0 : s.length - i - 1;
}

/* ═══════════════════════════════════════════════════════════════════════════
   FillFeature
   ═══════════════════════════════════════════════════════════════════════════ */

export class FillFeature<Row extends Model = Model> implements GridFeature<Row> {
  readonly name = 'fill';

  private api!: GridApi<Row>;
  private readonly disposers = new Disposers();

  private readonly seriesMode: FillSeriesMode;
  private readonly handleSize: number;
  private enabled: boolean;

  /** Body-level presentational overlay hosting the handle + preview. */
  private overlay: HTMLElement | null = null;
  /** The injected fill handle, lazily created. */
  private handle: HTMLElement | null = null;
  /** The dashed preview rectangle drawn during a drag. */
  private preview: HTMLElement | null = null;

  /** Live drag/keyboard session, or null when idle. */
  private session: {
    source: FillRect;
    to: CellAddress;
    pointerId: number | null;
  } | null = null;

  private dragCleanup: (() => void) | null = null;

  constructor(options: FillFeatureOptions = {}) {
    this.seriesMode = options.series ?? DEFAULTS.series;
    this.handleSize = options.handleSize ?? DEFAULTS.handleSize;
    this.enabled = options.enabled ?? DEFAULTS.enabled;
  }

  init(grid: GridApi<Row>): void {
    this.api = grid;
    grid.track(() => this.disposers.dispose());

    grid.el.classList.add('jects-grid--fillable');

    // The interactive handle + dashed preview live in an overlay layer mounted
    // OUTSIDE the grid's `role="grid"` subtree (a `button`/preview is not a valid
    // grid child per WAI-ARIA `aria-required-children`). The overlay is a
    // body-level, fixed-positioned, presentational container; its children are
    // positioned in viewport coordinates so they track the grid cells exactly.
    this.overlay = createEl('div', { className: 'jects-grid-fill-overlay' });
    this.overlay.setAttribute('role', 'presentation');
    document.body.appendChild(this.overlay);

    // Re-anchor the handle whenever selection, viewport, or scroll changes.
    this.disposers.add(grid.on('selectionChange', () => this.reanchor()));
    this.disposers.add(grid.on('viewportChange', () => this.reanchor()));
    this.disposers.add(grid.on('scroll', () => this.reanchor()));

    // Handle-specific pointer/keyboard wiring lives on the overlay (the handle is
    // a child of it), so it works even though the handle is outside the grid root.
    const onPointerDown = (e: Event): void => this.onPointerDown(e as PointerEvent);
    const onKeyDown = (e: Event): void => this.onKeyDown(e as KeyboardEvent);
    this.overlay.addEventListener('pointerdown', onPointerDown);
    this.overlay.addEventListener('keydown', onKeyDown);
    this.disposers.add(() => {
      this.overlay?.removeEventListener('pointerdown', onPointerDown);
      this.overlay?.removeEventListener('keydown', onKeyDown);
    });

    this.reanchor();
  }

  /* ── public API ────────────────────────────────────────────────────────── */

  /** Enable/disable the fill handle. Disabling hides the handle immediately. */
  setEnabled(on: boolean): void {
    this.enabled = on;
    this.reanchor();
  }

  /** The current source range (active selection bounding box), or null. */
  getSourceRect(): FillRect | null {
    return boundingRect(this.api.selection.getSelectedCells());
  }

  /** The fill handle element (visible only when a source range exists), or null. */
  getHandleEl(): HTMLElement | null {
    return this.handle && !this.handle.hidden ? this.handle : null;
  }

  /**
   * Programmatically fill from the current selection into `target` (or in a
   * direction by `count` cells). Emits `beforeFill` (vetoable) then `fill`.
   * Returns the written cells (empty if vetoed / no source).
   */
  fill(spec: { direction: FillDirection; count: number }): CellAddress[] {
    const source = this.getSourceRect();
    if (!source) return [];
    const to = this.cellInDirection(source, spec.direction, spec.count);
    const proj = projectTarget(source, to);
    if (!proj) return [];
    return this.applyFill(source, proj.target, proj.direction);
  }

  /* ── handle anchoring ──────────────────────────────────────────────────── */

  /** Position the handle on the source range's bottom-right cell, or hide it. */
  private reanchor(): void {
    if (this.session) return; // don't move the handle mid-drag
    const source = this.enabled ? this.getSourceRect() : null;
    if (!source) {
      this.hideHandle();
      return;
    }
    const cellEl = this.cellEl(source.bottom, source.right);
    if (!cellEl) {
      this.hideHandle();
      return;
    }
    // Keep the handle inside the grid's scroll viewport (clipped cells shouldn't
    // float a handle over the header/other chrome).
    if (!this.cellWithinViewport(cellEl)) {
      this.hideHandle();
      return;
    }
    const handle = this.ensureHandle();
    const r = cellEl.getBoundingClientRect();
    // Anchor to the bottom-right corner of the cell, in viewport (fixed) coords.
    handle.style.top = `${r.bottom}px`;
    handle.style.left = `${r.right}px`;
    handle.hidden = false;
    // Tie the handle (which lives in a body-level overlay, outside the grid's
    // focus subtree) BACK to the active cell so AT announces it WITH positional
    // context instead of as an orphan at the end of <body>:
    //   - the active cell `aria-owns` the handle (logical containment), and
    //   - the handle `aria-describedby` the active cell (describes what it acts on).
    this.anchorAria(handle, cellEl);
  }

  /** Cell element the handle is currently aria-associated with (for cleanup). */
  private ariaOwnerCell: HTMLElement | null = null;

  /**
   * Wire the active-cell ↔ handle ARIA relationship, moving it off any prior
   * cell first. Gives both nodes stable ids on demand.
   */
  private anchorAria(handle: HTMLElement, cellEl: HTMLElement): void {
    if (this.ariaOwnerCell && this.ariaOwnerCell !== cellEl) {
      this.ariaOwnerCell.removeAttribute('aria-owns');
    }
    const handleId = handle.id || (handle.id = `${this.api.el.id || 'jects-grid'}-fill-handle`);
    if (!cellEl.id) cellEl.id = `${handleId}-cell-${cellEl.dataset['colIndex'] ?? '0'}-${Date.now()}`;
    cellEl.setAttribute('aria-owns', handleId);
    handle.setAttribute('aria-describedby', cellEl.id);
    this.ariaOwnerCell = cellEl;
  }

  /** Drop the active-cell ↔ handle ARIA relationship (on hide/destroy). */
  private clearAria(): void {
    if (this.ariaOwnerCell) {
      this.ariaOwnerCell.removeAttribute('aria-owns');
      this.ariaOwnerCell = null;
    }
    this.handle?.removeAttribute('aria-describedby');
  }

  private ensureHandle(): HTMLElement {
    if (this.handle) return this.handle;
    const handle = createEl('div', { className: 'jects-grid__fill-handle' });
    handle.dataset['fillHandle'] = '';
    handle.tabIndex = 0;
    handle.setAttribute('role', 'button');
    handle.setAttribute('aria-label', 'Fill handle — drag or use arrow keys to fill adjacent cells');
    handle.style.inlineSize = `${this.handleSize}px`;
    handle.style.blockSize = `${this.handleSize}px`;
    (this.overlay ?? this.api.el).appendChild(handle);
    this.handle = handle;
    return handle;
  }

  /** Whether a cell element is within the grid body's visible scroll area. */
  private cellWithinViewport(cellEl: HTMLElement): boolean {
    const body = this.api.el.querySelector<HTMLElement>('.jects-grid__body');
    if (!body) return true;
    const cr = cellEl.getBoundingClientRect();
    const br = body.getBoundingClientRect();
    // Require the cell's bottom-right corner (where the handle sits) to be inside.
    return cr.bottom <= br.bottom + 1 && cr.right <= br.right + 1 && cr.bottom >= br.top;
  }

  private hideHandle(): void {
    if (this.handle) this.handle.hidden = true;
    this.clearAria();
  }

  /* ── pointer drag ──────────────────────────────────────────────────────── */

  private onPointerDown(event: PointerEvent): void {
    const target = event.target as HTMLElement;
    if (!target.closest('[data-fill-handle]')) return;
    const source = this.getSourceRect();
    if (!source) return;

    event.preventDefault();
    event.stopPropagation();

    this.session = { source, to: { rowIndex: source.bottom, colIndex: source.right }, pointerId: event.pointerId };
    this.api.el.classList.add('jects-grid--filling');
    try {
      this.handle?.setPointerCapture(event.pointerId);
    } catch {
      /* jsdom: no pointer capture — window listeners below cover it */
    }

    const onMove = (e: Event): void => this.onPointerMove(e as PointerEvent);
    const onUp = (e: Event): void => this.onPointerUp(e as PointerEvent);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    const cleanup = (): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
    this.dragCleanup = cleanup;
    this.disposers.add(cleanup);
  }

  private onPointerMove(event: PointerEvent): void {
    const s = this.session;
    if (!s || (s.pointerId != null && event.pointerId !== s.pointerId)) return;
    const cell = this.cellFromPoint(event.clientX, event.clientY);
    if (cell) {
      s.to = cell;
      this.drawPreview(s.source, cell);
    }
  }

  private onPointerUp(event: PointerEvent): void {
    const s = this.session;
    if (!s || (s.pointerId != null && event.pointerId !== s.pointerId)) return;
    this.endDrag();
    const proj = projectTarget(s.source, s.to);
    this.session = null;
    if (proj) this.applyFill(s.source, proj.target, proj.direction);
    this.reanchor();
  }

  private endDrag(): void {
    this.dragCleanup?.();
    this.dragCleanup = null;
    this.api.el.classList.remove('jects-grid--filling');
    this.clearPreview();
  }

  /* ── keyboard ──────────────────────────────────────────────────────────── */

  private onKeyDown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement;
    if (!target.closest('[data-fill-handle]')) return;

    // Start (or continue) a keyboard session anchored on the current selection.
    if (!this.session) {
      const source = this.getSourceRect();
      if (!source) return;
      this.session = { source, to: { rowIndex: source.bottom, colIndex: source.right }, pointerId: null };
    }
    const s = this.session;

    const dir = arrowDirection(event.key);
    if (dir) {
      event.preventDefault();
      s.to = this.step(s.source, s.to, dir);
      this.drawPreview(s.source, s.to);
      return;
    }
    if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
      event.preventDefault();
      const proj = projectTarget(s.source, s.to);
      this.clearPreview();
      this.session = null;
      if (proj) this.applyFill(s.source, proj.target, proj.direction);
      this.reanchor();
      // Keep keyboard focus reachable after the repaint.
      this.handle?.focus();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      this.clearPreview();
      this.session = null;
      this.reanchor();
      this.handle?.focus();
    }
  }

  /** Step the keyboard target one cell along/against the active axis. */
  private step(source: FillRect, to: CellAddress, dir: FillDirection): CellAddress {
    const rows = this.api.getRowCount();
    const cols = this.api.columns.length;
    const next = { ...to };
    if (dir === 'down') next.rowIndex = Math.min(rows - 1, to.rowIndex + 1);
    else if (dir === 'up') next.rowIndex = Math.max(0, to.rowIndex - 1);
    else if (dir === 'right') next.colIndex = Math.min(cols - 1, to.colIndex + 1);
    else next.colIndex = Math.max(0, to.colIndex - 1);
    // Constrain to a single axis: arrows along the cross-axis reset it to source.
    if (dir === 'down' || dir === 'up') next.colIndex = source.right;
    else next.rowIndex = source.bottom;
    return next;
  }

  /* ── fill application ──────────────────────────────────────────────────── */

  /**
   * Apply a fill from `source` onto `target` along `direction`. Emits the
   * vetoable `beforeFill`, writes coerced values via `store.update`, then emits
   * `fill`. Returns the written cells.
   */
  private applyFill(source: FillRect, target: FillRect, direction: FillDirection): CellAddress[] {
    const clipped = this.clipRect(target);
    if (!clipped) return [];

    const kind = this.kindFor(source, direction);

    // Vetoable gate (cells not yet known → empty).
    const proceed = this.api.emit('beforeFill', {
      source,
      target: clipped,
      direction,
      kind,
      cells: [],
    } as FillEvent<Row>);
    if (proceed === false) return [];

    // Coalesce the N per-cell `store.update` writes into ONE undo step when the
    // UndoRedoFeature is installed (so a drag-fill over a range is a single undo,
    // matching the parity claim). Falls back to direct writes otherwise.
    const label = fillLabel(clipped, kind);
    let written: CellAddress[] = [];
    this.withUndoBatch(label, () => {
      written = this.writeFill(source, clipped, direction, kind);
    });
    if (written.length) this.api.refresh();

    this.api.emit('fill', {
      source,
      target: clipped,
      direction,
      kind,
      cells: written,
      rows: this.rowsForCells(written),
    } as FillEvent<Row>);

    return written;
  }

  /** Distinct row models for a set of written cells (for the `fill` payload). */
  private rowsForCells(cells: ReadonlyArray<CellAddress>): Row[] {
    const seen = new Set<number>();
    const out: Row[] = [];
    for (const c of cells) {
      if (seen.has(c.rowIndex)) continue;
      seen.add(c.rowIndex);
      const row = this.api.getRow(c.rowIndex);
      if (row) out.push(row);
    }
    return out;
  }

  /** Resolve the fill kind for a source/direction given the series mode. */
  private kindFor(source: FillRect, direction: FillDirection): FillKind {
    if (this.seriesMode === 'never') return 'copy';
    const along = direction === 'down' || direction === 'up' ? 'row' : 'col';
    // Series only makes sense for a 1-wide source along the fill axis.
    const thin = along === 'row' ? source.left === source.right : source.top === source.bottom;
    if (!thin) return 'copy';
    const seq = this.sourceSequence(source, direction);
    if (detectSeries(seq)) return 'series';
    // `'always'` *forces* a series for a thin numeric source even when the steps
    // are inconsistent (detectSeries → null), so the mode is meaningful and not a
    // silent alias of `'auto'`. We can only force a series when a numeric seed can
    // actually be derived; a non-numeric (string/date-less) source still copies.
    if (this.seriesMode === 'always' && this.forcedSeries(seq) != null) return 'series';
    return 'copy';
  }

  /**
   * Build a forced numeric series from a thin source for `series: 'always'` when
   * {@link detectSeries} found no consistent step. Uses the LAST numeric value as
   * the seed and infers the step from the last consecutive numeric pair (falling
   * back to `+1`, Excel's single-cell drag). Returns `null` when the source has no
   * numeric values to seed from (those copy instead).
   */
  private forcedSeries(seq: ReadonlyArray<unknown>): Series | null {
    const nums: number[] = [];
    for (const v of seq) {
      const n = asNumber(v);
      if (n != null) nums.push(n);
    }
    if (nums.length === 0) return null;
    const last = nums[nums.length - 1]!;
    const step = nums.length >= 2 ? nums[nums.length - 1]! - nums[nums.length - 2]! : 1;
    return { kind: 'number', last, step: step === 0 ? 1 : step };
  }

  /**
   * The series used to write a `series`-kind fill: a detected constant-step
   * progression, or — under `series: 'always'` — a forced numeric series when no
   * consistent step was detectable. Mirrors {@link kindFor} so the kind decision
   * and the values written stay consistent.
   */
  private resolveSeries(source: FillRect, direction: FillDirection): Series | null {
    const seq = this.sourceSequence(source, direction);
    return detectSeries(seq) ?? (this.seriesMode === 'always' ? this.forcedSeries(seq) : null);
  }

  /**
   * Run `fn` (the batch of per-cell `store.update` writes) inside the
   * UndoRedoFeature's `transact()` when that feature is installed, so the whole
   * fill is one reversible step. When no undo feature is present, `fn` runs
   * directly — the feature stays fully usable standalone.
   */
  private withUndoBatch(label: string, fn: () => void): void {
    const undo = this.api.features.get('undoRedo') as UndoRedoFeature<Row> | undefined;
    if (undo && typeof undo.transact === 'function') undo.transact(label, fn);
    else fn();
  }

  /**
   * The ordered source values along the fill axis, in the direction values will
   * progress (so an "up" fill reverses the source so the series counts upward).
   */
  private sourceSequence(source: FillRect, direction: FillDirection): unknown[] {
    const out: unknown[] = [];
    if (direction === 'down') {
      for (let r = source.top; r <= source.bottom; r++) out.push(this.cellValue(r, source.left));
    } else if (direction === 'up') {
      for (let r = source.bottom; r >= source.top; r--) out.push(this.cellValue(r, source.left));
    } else if (direction === 'right') {
      for (let c = source.left; c <= source.right; c++) out.push(this.cellValue(source.top, c));
    } else {
      for (let c = source.right; c >= source.left; c--) out.push(this.cellValue(source.top, c));
    }
    return out;
  }

  /** Write the projected values into the target cells. */
  private writeFill(
    source: FillRect,
    target: FillRect,
    direction: FillDirection,
    kind: FillKind,
  ): CellAddress[] {
    const written: CellAddress[] = [];
    const vertical = direction === 'down' || direction === 'up';

    if (kind === 'series' && vertical) {
      const series = this.resolveSeries(source, direction)!;
      const col = source.left;
      const ordered = direction === 'down'
        ? rangeAsc(target.top, target.bottom)
        : rangeDesc(target.bottom, target.top);
      ordered.forEach((r, i) => {
        if (this.setCell({ rowIndex: r, colIndex: col }, series ? seriesValueAt(series, i + 1) : '')) {
          written.push({ rowIndex: r, colIndex: col });
        }
      });
      return written;
    }
    if (kind === 'series' && !vertical) {
      const series = this.resolveSeries(source, direction)!;
      const row = source.top;
      const ordered = direction === 'right'
        ? rangeAsc(target.left, target.right)
        : rangeDesc(target.right, target.left);
      ordered.forEach((c, i) => {
        if (this.setCell({ rowIndex: row, colIndex: c }, series ? seriesValueAt(series, i + 1) : '')) {
          written.push({ rowIndex: row, colIndex: c });
        }
      });
      return written;
    }

    // copy/tile fill: map each target cell back into the source block.
    const srcRows = source.bottom - source.top + 1;
    const srcCols = source.right - source.left + 1;
    for (let r = target.top; r <= target.bottom; r++) {
      for (let c = target.left; c <= target.right; c++) {
        const sr = source.top + mod(r - source.top, srcRows);
        const sc = source.left + mod(c - source.left, srcCols);
        const value = this.cellValue(sr, sc);
        if (this.setCell({ rowIndex: r, colIndex: c }, value)) written.push({ rowIndex: r, colIndex: c });
      }
    }
    return written;
  }

  /* ── data access ───────────────────────────────────────────────────────── */

  private cellValue(rowIndex: number, colIndex: number): unknown {
    const row = this.api.getRow(rowIndex);
    const col = this.api.columns[colIndex];
    if (!row || !col || !col.field) return undefined;
    return (row as Record<string, unknown>)[col.field];
  }

  /** Write a coerced value into a cell via the store. Returns true if written. */
  private setCell(cell: CellAddress, value: unknown): boolean {
    const row = this.api.getRow(cell.rowIndex);
    const col = this.api.columns[cell.colIndex];
    if (!row || !col || !col.field) return false;
    const id = (row as Record<string, unknown>)[this.api.store.idField] as RecordId;
    this.api.store.update(id, { [col.field]: coerceForColumn(value, col.type) } as Partial<Row>);
    return true;
  }

  /* ── DOM geometry helpers ──────────────────────────────────────────────── */

  /** Find the painted cell element at a (rowIndex, colIndex). */
  private cellEl(rowIndex: number, colIndex: number): HTMLElement | null {
    const rowEl = this.api.el.querySelector<HTMLElement>(
      `.jects-grid__row[data-row-index="${rowIndex}"]`,
    );
    if (!rowEl) return null;
    return rowEl.querySelector<HTMLElement>(`.jects-grid__cell[data-col-index="${colIndex}"]`);
  }

  /** Resolve a cell address from a viewport point (drag tracking). */
  private cellFromPoint(clientX: number, clientY: number): CellAddress | null {
    const els = typeof document.elementsFromPoint === 'function'
      ? document.elementsFromPoint(clientX, clientY)
      : ([document.elementFromPoint?.(clientX, clientY)].filter(Boolean) as Element[]);

    // Fast path: the point landed directly on a painted cell.
    for (const el of els) {
      const cell = (el as HTMLElement).closest?.<HTMLElement>('.jects-grid__cell');
      const rowEl = cell?.closest<HTMLElement>('.jects-grid__row');
      if (cell && rowEl) {
        const r = Number(rowEl.dataset['rowIndex']);
        const c = Number(cell.dataset['colIndex']);
        if (!Number.isNaN(r) && !Number.isNaN(c)) return { rowIndex: r, colIndex: c };
      }
    }

    // Cells are absolutely positioned, so a fast fling can land the hit on the
    // row (or the grid body) without a cell in the stack. Resolve the row at Y,
    // then the column whose box contains X (clamped to the row's cell extents).
    let rowEl: HTMLElement | null = null;
    for (const el of els) {
      const r = (el as HTMLElement).closest?.<HTMLElement>('.jects-grid__row');
      if (r && r.dataset['rowIndex'] != null) {
        rowEl = r;
        break;
      }
    }
    if (!rowEl) {
      // Last resort: scan painted rows for the one spanning Y.
      for (const r of this.api.el.querySelectorAll<HTMLElement>('.jects-grid__row[data-row-index]')) {
        if (r.hidden) continue;
        const rr = r.getBoundingClientRect();
        if (clientY >= rr.top && clientY <= rr.bottom) {
          rowEl = r;
          break;
        }
      }
    }
    if (!rowEl) return null;
    const rowIndex = Number(rowEl.dataset['rowIndex']);
    if (Number.isNaN(rowIndex)) return null;

    const cells = rowEl.querySelectorAll<HTMLElement>('.jects-grid__cell[data-col-index]');
    let colIndex = -1;
    for (const cell of cells) {
      if (cell.hidden) continue;
      const cr = cell.getBoundingClientRect();
      if (clientX >= cr.left && clientX <= cr.right) {
        colIndex = Number(cell.dataset['colIndex']);
        break;
      }
    }
    // Outside any cell box horizontally → snap to the nearest edge column.
    if (colIndex < 0 && cells.length > 0) {
      const first = cells[0]!.getBoundingClientRect();
      const last = cells[cells.length - 1]!.getBoundingClientRect();
      colIndex = clientX < first.left
        ? Number(cells[0]!.dataset['colIndex'])
        : clientX > last.right
          ? Number(cells[cells.length - 1]!.dataset['colIndex'])
          : Number(cells[0]!.dataset['colIndex']);
    }
    if (colIndex < 0 || Number.isNaN(colIndex)) return null;
    return { rowIndex, colIndex };
  }

  /** A cell `count` steps from the source edge in a direction. */
  private cellInDirection(source: FillRect, dir: FillDirection, count: number): CellAddress {
    if (dir === 'down') return { rowIndex: source.bottom + count, colIndex: source.right };
    if (dir === 'up') return { rowIndex: source.top - count, colIndex: source.left };
    if (dir === 'right') return { rowIndex: source.bottom, colIndex: source.right + count };
    return { rowIndex: source.top, colIndex: source.left - count };
  }

  /** Clip a target rectangle to the grid bounds; null when fully out of range. */
  private clipRect(rect: FillRect): FillRect | null {
    const rows = this.api.getRowCount();
    const cols = this.api.columns.length;
    const top = Math.max(0, rect.top);
    const left = Math.max(0, rect.left);
    const bottom = Math.min(rows - 1, rect.bottom);
    const right = Math.min(cols - 1, rect.right);
    if (top > bottom || left > right) return null;
    return { top, left, bottom, right };
  }

  /** Draw the dashed preview rectangle spanning source∪target for a drag/keyboard step. */
  private drawPreview(source: FillRect, to: CellAddress): void {
    const proj = projectTarget(source, to);
    if (!proj) {
      this.clearPreview();
      return;
    }
    const clipped = this.clipRect(proj.target);
    if (!clipped) {
      this.clearPreview();
      return;
    }
    const union: FillRect = {
      top: Math.min(source.top, clipped.top),
      left: Math.min(source.left, clipped.left),
      bottom: Math.max(source.bottom, clipped.bottom),
      right: Math.max(source.right, clipped.right),
    };
    const tl = this.cellEl(union.top, union.left);
    const br = this.cellEl(union.bottom, union.right);
    if (!tl || !br) return;
    // Fixed/viewport coordinates so the preview tracks the cells exactly even
    // though it lives in the body-level overlay.
    const a = tl.getBoundingClientRect();
    const b = br.getBoundingClientRect();
    const preview = this.ensurePreview();
    preview.style.top = `${a.top}px`;
    preview.style.left = `${a.left}px`;
    preview.style.inlineSize = `${b.right - a.left}px`;
    preview.style.blockSize = `${b.bottom - a.top}px`;
    preview.hidden = false;
  }

  private ensurePreview(): HTMLElement {
    if (this.preview) return this.preview;
    const preview = createEl('div', { className: 'jects-grid__fill-preview' });
    preview.setAttribute('aria-hidden', 'true');
    (this.overlay ?? this.api.el).appendChild(preview);
    this.preview = preview;
    return preview;
  }

  private clearPreview(): void {
    if (this.preview) this.preview.hidden = true;
  }

  destroy(): void {
    this.endDrag();
    this.session = null;
    this.clearAria();
    this.api?.el.classList.remove('jects-grid--fillable', 'jects-grid--filling');
    this.handle?.remove();
    this.handle = null;
    this.preview?.remove();
    this.preview = null;
    this.overlay?.remove();
    this.overlay = null;
    this.disposers.dispose();
  }
}

/** Convenience factory. */
export function fillFeature<Row extends Model = Model>(
  options?: FillFeatureOptions,
): FillFeature<Row> {
  return new FillFeature<Row>(options);
}

/* ═══════════════════════════════════════════════════════════════════════════
   small utilities
   ═══════════════════════════════════════════════════════════════════════════ */

function arrowDirection(key: string): FillDirection | null {
  switch (key) {
    case 'ArrowDown':
      return 'down';
    case 'ArrowUp':
      return 'up';
    case 'ArrowRight':
      return 'right';
    case 'ArrowLeft':
      return 'left';
    default:
      return null;
  }
}

/** Positive modulo (handles negative dividends). */
function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

/** Human-readable undo label for a committed fill (e.g. `"Fill 4 cells"`). */
function fillLabel(target: FillRect, kind: FillKind): string {
  const n = (target.bottom - target.top + 1) * (target.right - target.left + 1);
  const verb = kind === 'series' ? 'Series fill' : 'Fill';
  return `${verb} ${n} cell${n === 1 ? '' : 's'}`;
}

function rangeAsc(from: number, to: number): number[] {
  const out: number[] = [];
  for (let i = from; i <= to; i++) out.push(i);
  return out;
}

function rangeDesc(from: number, to: number): number[] {
  const out: number[] = [];
  for (let i = from; i >= to; i--) out.push(i);
  return out;
}

/**
 * Coerce a fill value to the column's typed value. Numbers/dates produced by
 * series math pass through; strings are coerced per the column type (mirrors the
 * clipboard/paste coercion so fill and paste stay consistent).
 */
function coerceForColumn(value: unknown, type: ColumnType | undefined): unknown {
  if (value instanceof Date) return value;
  if (typeof value === 'number') {
    if (type === 'date') return new Date(value);
    return value;
  }
  if (type === 'number') {
    if (value == null || value === '') return null;
    const n = Number(value);
    return Number.isNaN(n) ? value : n;
  }
  if (type === 'date') {
    if (value == null || value === '') return null;
    const d = new Date(value as string);
    return Number.isNaN(d.getTime()) ? value : d;
  }
  if (type === 'check') {
    if (typeof value === 'boolean') return value;
    const s = String(value).toLowerCase();
    return s === 'true' || s === '1' || s === 'yes';
  }
  return value;
}

/* ═══════════════════════════════════════════════════════════════════════════
   Module augmentation — make `beforeFill` (vetoable) and `fill` first-class,
   typed grid events. Purely additive to the frozen contract (no edits to
   contract.ts), mirroring the row-resize feature's augmentation pattern.
   ═══════════════════════════════════════════════════════════════════════════ */
declare module '../contract.js' {
  // The `Row` type param merges with the base `GridEvents<Row>` declaration and
  // flows into the `FillEvent<Row>` payloads below.
  interface GridEvents<Row extends Model> {
    /** Vetoable: a range fill is about to write (return `false` to cancel). */
    beforeFill: FillEvent<Row>;
    /** A range fill committed (values written through `store.update`). */
    fill: FillEvent<Row>;
  }
}
