/**
 * RowResizeFeature — per-row height drag for @jects/grid.
 *
 * Mirrors the Bryntum `RowResize` / DHTMLX row-height-drag affordance: the user
 * grabs the **bottom edge** of a data row and drags it up/down to set that row's
 * height. The engine already supports variable row heights (core `OffsetIndex`
 * via `GridEngine.measureRow`); this feature adds the missing *user affordance*
 * and the `rowResize` event, plus keyboard operability for a11y.
 *
 * Design (concurrency-safe — additive, talks to the grid only through `GridApi`):
 *   - A thin draggable handle is injected at the bottom edge of every painted
 *     data row (delegated; survives row recycling because the grid repaints rows
 *     and we re-decorate after each `viewportChange`).
 *   - Pointer drag updates a *live* preview height on the row element for instant
 *     feedback, then commits on pointer-up: the new height is clamped to
 *     `[minHeight, maxHeight]`, stored per row id, pushed to the engine through
 *     the `applySize` hook (default wires `engine.measureRow` + a repaint), and
 *     the `rowResize` event is emitted.
 *   - Keyboard: the handle is focusable; ArrowUp/ArrowDown nudge the row height
 *     by `keyboardStep` px (Shift = ×4), Home resets to the default height.
 *
 * The feature persists heights in its own `Map<RecordId, number>` so the state
 * survives scroll/recycle and can be serialized by the integrator. It releases
 * every listener/observer it created on `destroy()`.
 */

import { createEl, type Model, type RecordId } from '@jects/core';
import type { GridApi, GridFeature } from '../contract.js';
import { Disposers } from './shared.js';

/**
 * Payload for the `rowResize` grid event. Augments the contract's `GridEvents`
 * (see the module augmentation at the bottom of this file) so consumers get a
 * fully typed `grid.on('rowResize', …)`.
 */
export interface RowResizeEvent<Row extends Model = Model> {
  /** The resized row model. */
  row: Row;
  /** The resized row's id. */
  id: RecordId;
  /** Absolute (post sort/filter) view index of the row at commit time. */
  rowIndex: number;
  /** The committed (clamped) height in px. */
  height: number;
  /** The previous height in px (the engine/default height before this drag). */
  oldHeight: number;
}

/**
 * Hook the integrator can supply to persist a measured height into the engine.
 * Receives the absolute row index, the row id and the clamped height. The
 * default (when omitted) sets the live row DOM height and, when the grid engine
 * is reachable, calls `engine.measureRow(rowIndex, height)` then repaints.
 */
export type ApplyRowSize<Row extends Model = Model> = (
  ctx: { api: GridApi<Row>; rowIndex: number; id: RecordId; height: number },
) => void;

export interface RowResizeFeatureOptions<Row extends Model = Model> {
  /** Minimum row height in px. Default `20`. */
  minHeight?: number;
  /** Maximum row height in px. Default `400`. */
  maxHeight?: number;
  /** Default/baseline height used to compute `oldHeight` and Home-reset. */
  defaultHeight?: number;
  /** Pixels nudged per Arrow keypress (×4 with Shift). Default `4`. */
  keyboardStep?: number;
  /** Thickness (px) of the drag hit-area at the row's bottom edge. Default `6`. */
  handleSize?: number;
  /**
   * Persist a committed height into the engine. When omitted a sensible default
   * is used (live DOM height + `engine.measureRow` when reachable + repaint).
   */
  applySize?: ApplyRowSize<Row>;
}

const DEFAULTS = {
  minHeight: 20,
  maxHeight: 400,
  defaultHeight: 36,
  keyboardStep: 4,
  handleSize: 6,
} as const;

/** Minimal structural view of the engine the default `applySize` may reach. */
interface EngineLike {
  measureRow?: (rowIndex: number, height: number) => void;
  rowSize?: (rowIndex: number) => number;
}

export class RowResizeFeature<Row extends Model = Model> implements GridFeature<Row> {
  readonly name = 'rowResize';

  private api!: GridApi<Row>;
  private readonly disposers = new Disposers();

  private readonly minHeight: number;
  private readonly maxHeight: number;
  private readonly defaultHeight: number;
  private readonly keyboardStep: number;
  private readonly handleSize: number;
  private readonly applySizeHook?: ApplyRowSize<Row>;

  /** Per-row committed heights, keyed by row id. */
  private readonly heights = new Map<RecordId, number>();

  /** Live drag session, or `null` when idle. */
  private drag: {
    rowEl: HTMLElement;
    rowIndex: number;
    id: RecordId;
    startY: number;
    startHeight: number;
    pointerId: number;
  } | null = null;

  constructor(options: RowResizeFeatureOptions<Row> = {}) {
    this.minHeight = options.minHeight ?? DEFAULTS.minHeight;
    this.maxHeight = options.maxHeight ?? DEFAULTS.maxHeight;
    this.defaultHeight = options.defaultHeight ?? DEFAULTS.defaultHeight;
    this.keyboardStep = options.keyboardStep ?? DEFAULTS.keyboardStep;
    this.handleSize = options.handleSize ?? DEFAULTS.handleSize;
    if (options.applySize) this.applySizeHook = options.applySize;
  }

  init(grid: GridApi<Row>): void {
    this.api = grid;
    grid.track(() => this.disposers.dispose());

    grid.el.classList.add('jects-grid--row-resizable');

    // Re-decorate rows after every viewport repaint (rows are recycled).
    const offViewport = grid.on('viewportChange', () => this.decorateRows());
    this.disposers.add(offViewport);

    // Delegated pointer + keyboard handling on the grid root.
    const onPointerDown = (e: Event): void => this.onPointerDown(e as PointerEvent);
    const onKeyDown = (e: Event): void => this.onKeyDown(e as KeyboardEvent);
    grid.el.addEventListener('pointerdown', onPointerDown);
    grid.el.addEventListener('keydown', onKeyDown);
    this.disposers.add(() => {
      grid.el.removeEventListener('pointerdown', onPointerDown);
      grid.el.removeEventListener('keydown', onKeyDown);
    });

    // Decorate whatever is already painted.
    this.decorateRows();
  }

  /* ── public API ──────────────────────────────────────────────────────── */

  /** The committed height for a row id, or `undefined` if never resized. */
  getHeight(id: RecordId): number | undefined {
    return this.heights.get(id);
  }

  /** Snapshot of all committed heights (for state persistence). */
  getState(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [id, h] of this.heights) out[String(id)] = h;
    return out;
  }

  /** Restore previously serialized heights and repaint. */
  setState(state: Record<string, number>): void {
    this.heights.clear();
    for (const [id, h] of Object.entries(state)) {
      this.heights.set(coerceId(id), this.clamp(h));
    }
    // Re-apply each into the engine.
    for (const [id, h] of this.heights) {
      const rowIndex = this.api.getRowIndex(id);
      if (rowIndex >= 0) this.applySize(rowIndex, id, h);
    }
    this.api.refresh();
    this.decorateRows();
  }

  /**
   * Programmatically resize a row by id to `height` (clamped). Emits
   * `rowResize`. Returns the committed height.
   */
  resizeRow(id: RecordId, height: number): number {
    const rowIndex = this.api.getRowIndex(id);
    const row = this.api.getRowById(id);
    if (rowIndex < 0 || !row) return this.defaultHeight;
    const oldHeight = this.currentHeight(rowIndex, id);
    const next = this.clamp(height);
    this.commit(rowIndex, id, row, next, oldHeight);
    return next;
  }

  /** Reset a row id to the default height (removes its override). Emits. */
  resetRow(id: RecordId): void {
    const rowIndex = this.api.getRowIndex(id);
    const row = this.api.getRowById(id);
    if (rowIndex < 0 || !row) return;
    const oldHeight = this.currentHeight(rowIndex, id);
    this.heights.delete(id);
    this.applySize(rowIndex, id, this.defaultHeight);
    this.api.refresh();
    this.decorateRows();
    this.emitResize(row, id, rowIndex, this.defaultHeight, oldHeight);
  }

  /* ── decoration (inject the drag handle into painted rows) ───────────── */

  private decorateRows(): void {
    const rows = this.api.el.querySelectorAll<HTMLElement>('.jects-grid__row');
    rows.forEach((rowEl) => {
      if (rowEl.hidden) return;
      let cell = rowEl.querySelector<HTMLElement>(':scope > .jects-grid__row-resizer-cell');
      let handle = cell?.querySelector<HTMLElement>(':scope > .jects-grid__row-resizer') ?? null;
      if (!handle) {
        // The row carries `role="row"`, whose only allowed children are
        // grid/columnheader/rowheader cells — a bare `role="separator"` child
        // breaks the `aria-required-children` contract (axe critical). Wrap the
        // separator in a `role="gridcell"` host so the row owns a valid cell and
        // the separator lives one level down (allowed as generic cell content).
        // The wrapper is the full-width positioned box (its containing block is
        // the absolutely-positioned row), so the resize hit-area still spans the
        // whole row's bottom edge.
        cell = createEl('div', { className: 'jects-grid__row-resizer-cell' });
        cell.setAttribute('role', 'gridcell');
        cell.style.height = `${this.handleSize}px`;
        handle = createEl('div', { className: 'jects-grid__row-resizer' });
        handle.dataset['rowResizer'] = '';
        handle.setAttribute('role', 'separator');
        handle.setAttribute('aria-orientation', 'horizontal');
        handle.setAttribute('aria-label', 'Resize row height');
        handle.tabIndex = 0;
        cell.appendChild(handle);
        rowEl.appendChild(cell);
      }
      // Keep ARIA value reflecting the current height for AT.
      const rowIndex = Number(rowEl.dataset['rowIndex']);
      if (!Number.isNaN(rowIndex)) {
        const id = rowEl.dataset['rowId'];
        const h = id != null ? this.heightForRowEl(rowEl) : this.defaultHeight;
        handle.setAttribute('aria-valuenow', String(Math.round(h)));
        handle.setAttribute('aria-valuemin', String(this.minHeight));
        handle.setAttribute('aria-valuemax', String(this.maxHeight));
      }
    });
  }

  private heightForRowEl(rowEl: HTMLElement): number {
    const px = parseFloat(rowEl.style.height);
    if (!Number.isNaN(px) && px > 0) return px;
    return rowEl.getBoundingClientRect().height || this.defaultHeight;
  }

  /* ── pointer drag ────────────────────────────────────────────────────── */

  private onPointerDown(event: PointerEvent): void {
    const handle = (event.target as HTMLElement).closest<HTMLElement>(
      '[data-row-resizer]',
    );
    if (!handle) return;
    const rowEl = handle.closest<HTMLElement>('.jects-grid__row');
    if (!rowEl) return;
    const rowIndex = Number(rowEl.dataset['rowIndex']);
    const rawId = rowEl.dataset['rowId'];
    if (Number.isNaN(rowIndex) || rawId == null) return;
    const id = this.resolveId(rowIndex, rawId);
    if (id == null) return;

    event.preventDefault();
    event.stopPropagation();

    const startHeight = this.heightForRowEl(rowEl);
    this.drag = {
      rowEl,
      rowIndex,
      id,
      startY: event.clientY,
      startHeight,
      pointerId: event.pointerId,
    };
    rowEl.classList.add('jects-grid__row--resizing');
    try {
      handle.setPointerCapture(event.pointerId);
    } catch {
      /* setPointerCapture unsupported (jsdom) — fall back to window listeners */
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

  private dragCleanup: (() => void) | null = null;

  private onPointerMove(event: PointerEvent): void {
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    const delta = event.clientY - drag.startY;
    const preview = this.clamp(drag.startHeight + delta);
    // Live preview on the row element only (no engine churn mid-drag).
    drag.rowEl.style.height = `${preview}px`;
    const handle = drag.rowEl.querySelector<HTMLElement>('[data-row-resizer]');
    handle?.setAttribute('aria-valuenow', String(Math.round(preview)));
  }

  private onPointerUp(event: PointerEvent): void {
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    this.dragCleanup?.();
    this.dragCleanup = null;
    drag.rowEl.classList.remove('jects-grid__row--resizing');

    const delta = event.clientY - drag.startY;
    const next = this.clamp(drag.startHeight + delta);
    const row = this.api.getRowById(drag.id);
    this.drag = null;
    if (!row) return;
    // Re-resolve the row index in case the view shifted during the drag.
    const rowIndex = this.api.getRowIndex(drag.id);
    this.commit(rowIndex >= 0 ? rowIndex : drag.rowIndex, drag.id, row, next, drag.startHeight);
  }

  /* ── keyboard ────────────────────────────────────────────────────────── */

  private onKeyDown(event: KeyboardEvent): void {
    const handle = (event.target as HTMLElement).closest<HTMLElement>(
      '[data-row-resizer]',
    );
    if (!handle) return;
    const rowEl = handle.closest<HTMLElement>('.jects-grid__row');
    if (!rowEl) return;
    const rowIndex = Number(rowEl.dataset['rowIndex']);
    const rawId = rowEl.dataset['rowId'];
    if (Number.isNaN(rowIndex) || rawId == null) return;
    const id = this.resolveId(rowIndex, rawId);
    if (id == null) return;
    const row = this.api.getRowById(id);
    if (!row) return;

    const step = this.keyboardStep * (event.shiftKey ? 4 : 1);
    const current = this.currentHeight(rowIndex, id);
    let next: number | null = null;
    switch (event.key) {
      case 'ArrowDown':
        next = current + step;
        break;
      case 'ArrowUp':
        next = current - step;
        break;
      case 'Home':
        next = this.defaultHeight;
        break;
      default:
        return;
    }
    event.preventDefault();
    this.commit(rowIndex, id, row, this.clamp(next), current);
    // Keep keyboard focus on the (recycled) handle for the same row.
    this.refocusHandle(id);
  }

  private refocusHandle(id: RecordId): void {
    const rowEl = this.api.el.querySelector<HTMLElement>(
      `.jects-grid__row[data-row-id="${cssEscape(String(id))}"]`,
    );
    rowEl?.querySelector<HTMLElement>('[data-row-resizer]')?.focus();
  }

  /* ── commit + engine wiring ──────────────────────────────────────────── */

  private commit(
    rowIndex: number,
    id: RecordId,
    row: Row,
    height: number,
    oldHeight: number,
  ): void {
    // No-op when the height is unchanged (drag with zero delta, repeated nudge
    // at a clamp boundary, etc.) — avoid spurious repaints + events.
    if (height === oldHeight && (this.heights.get(id) ?? oldHeight) === height) return;
    this.heights.set(id, height);
    this.applySize(rowIndex, id, height);
    this.api.refresh();
    this.decorateRows();
    this.emitResize(row, id, rowIndex, height, oldHeight);
  }

  /** Push a height into the engine (custom hook, else best-effort default). */
  private applySize(rowIndex: number, id: RecordId, height: number): void {
    if (this.applySizeHook) {
      this.applySizeHook({ api: this.api, rowIndex, id, height });
      return;
    }
    // Default: set live DOM height for the painted row…
    const rowEl = this.api.el.querySelector<HTMLElement>(
      `.jects-grid__row[data-row-id="${cssEscape(String(id))}"]`,
    );
    if (rowEl) rowEl.style.height = `${height}px`;
    // …and persist into the engine's variable-height index when reachable. The
    // real `Grid` keeps the engine private; we reach it best-effort so the
    // height survives scroll/recycle. The integrator can override via `applySize`.
    const engine = (this.api as unknown as { engine?: EngineLike }).engine;
    if (engine?.measureRow) engine.measureRow(rowIndex, height);
  }

  private currentHeight(rowIndex: number, id: RecordId): number {
    const stored = this.heights.get(id);
    if (stored != null) return stored;
    const engine = (this.api as unknown as { engine?: EngineLike }).engine;
    if (engine?.rowSize) {
      const s = engine.rowSize(rowIndex);
      if (s > 0) return s;
    }
    const rowEl = this.api.el.querySelector<HTMLElement>(
      `.jects-grid__row[data-row-id="${cssEscape(String(id))}"]`,
    );
    if (rowEl) return this.heightForRowEl(rowEl);
    return this.defaultHeight;
  }

  private emitResize(
    row: Row,
    id: RecordId,
    rowIndex: number,
    height: number,
    oldHeight: number,
  ): void {
    this.api.emit('rowResize', {
      row,
      id,
      rowIndex,
      height,
      oldHeight,
    } as RowResizeEvent<Row>);
  }

  /* ── helpers ─────────────────────────────────────────────────────────── */

  private clamp(h: number): number {
    return Math.max(this.minHeight, Math.min(this.maxHeight, Math.round(h)));
  }

  /** Resolve a row id from its DOM dataset (string) back to the store's id type. */
  private resolveId(rowIndex: number, rawId: string): RecordId | null {
    // Prefer the actual record id (preserves number vs string identity).
    const row = this.api.getRow(rowIndex);
    if (row) {
      const idField = this.api.store.idField;
      const real = (row as Model)[idField];
      if (real != null && String(real) === rawId) return real as RecordId;
    }
    // Fall back to a numeric coercion when the raw looks numeric.
    return coerceId(rawId);
  }

  destroy(): void {
    this.dragCleanup?.();
    this.dragCleanup = null;
    this.drag = null;
    this.api?.el.classList.remove('jects-grid--row-resizable');
    // Remove injected handles (and their gridcell wrappers) so the DOM is left clean.
    this.api?.el
      .querySelectorAll<HTMLElement>('.jects-grid__row-resizer-cell')
      .forEach((h) => h.remove());
    this.heights.clear();
    this.disposers.dispose();
  }
}

/** Convenience factory. */
export function rowResizeFeature<Row extends Model = Model>(
  options?: RowResizeFeatureOptions<Row>,
): RowResizeFeature<Row> {
  return new RowResizeFeature<Row>(options);
}

/** Coerce a dataset id string back to number when it round-trips cleanly. */
function coerceId(raw: string): RecordId {
  if (raw !== '' && String(Number(raw)) === raw) return Number(raw);
  return raw;
}

/** Minimal CSS.escape shim (jsdom may lack it for attribute selectors). */
function cssEscape(value: string): string {
  const fn = (globalThis as { CSS?: { escape?: (s: string) => string } }).CSS?.escape;
  if (typeof fn === 'function') return fn(value);
  return value.replace(/["\\\]]/g, '\\$&');
}

/* ═══════════════════════════════════════════════════════════════════════════
   Module augmentation — make `rowResize` a first-class, typed grid event so
   consumers get `grid.on('rowResize', e => …)` with a typed payload. This is
   purely additive to the frozen contract (no edits to contract.ts).
   ═══════════════════════════════════════════════════════════════════════════ */
declare module '../contract.js' {
  interface GridEvents<Row extends Model> {
    /** A row finished resizing (per-row height drag / keyboard nudge). */
    rowResize: RowResizeEvent<Row>;
  }
}
