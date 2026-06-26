/**
 * RowReorderFeature — drag-to-reorder rows for @jects/grid, including dragging
 * rows BETWEEN two grids (Bryntum/DHTMLX "RowReorder" parity).
 *
 * What it does
 * ────────────
 *  - Pointer-drags a row. The whole row is draggable by default; set
 *    `handleSelector` to restrict the grab to a drag-handle cell/column (e.g.
 *    a `rownumber`/action column rendering `data-row-reorder-handle`).
 *  - Shows a floating drag proxy that follows the pointer and a horizontal drop
 *    indicator between rows (above/below the row under the pointer).
 *  - On drop: same-grid moves go through `store.move`; cross-grid transfers
 *    remove the record from the source store and `add` it into the target store
 *    at the drop index.
 *  - Veto: emits the vetoable `beforeRowReorder` first; a handler returning
 *    `false` cancels the move. On success emits the `rowReorder` notification.
 *  - Cross-grid protocol: a tiny module-level registry of "active drag" state
 *    plus a per-feature `accepts` predicate / `group` tag lets a target grid
 *    decide whether to accept a drop coming from another grid.
 *
 * Everything is confined to `GridApi`; `destroy()` releases every listener,
 * floating element, and the cross-grid registration. Token-pure styles live in
 * `features.css` (`.jects-grid-rowdrag*`).
 */

import type { Model, RecordId } from '@jects/core';
import { createEl } from '@jects/core';
import type { GridApi, GridFeature, RowReorderPayload } from '../contract.js';
import { Disposers } from './shared.js';

/** Where a drop lands relative to the row under the pointer. */
export type DropPosition = 'before' | 'after';

/** A resolved drop target: a row index + which side of it. */
export interface DropTarget {
  /** View index of the row the pointer is over (or row count for end-of-list). */
  rowIndex: number;
  /** Drop above (`'before'`) or below (`'after'`) that row. */
  position: DropPosition;
}

/** Live state of the in-flight drag, shared across grids for transfers. */
interface ActiveDrag<Row extends Model = Model> {
  /** The feature that started the drag (owns the source grid). */
  source: RowReorderFeature<Row>;
  /** The dragged row model. */
  row: Row;
  /** Id of the dragged row. */
  recordId: RecordId;
  /** Source view index. */
  fromIndex: number;
  /** Cross-grid group tag the source belongs to. */
  group: string;
  /** Pointer id that owns this drag (for setPointerCapture / filtering). */
  pointerId: number;
}

/**
 * Module-level registry of the single active drag. Row reorder is inherently a
 * one-pointer gesture, so a single slot is sufficient and lets a *different*
 * grid's feature observe the same drag to implement cross-grid acceptance.
 */
let CURRENT_DRAG: ActiveDrag | null = null;

export interface RowReorderFeatureOptions<Row extends Model = Model> {
  /**
   * Master enable. Default `true`. When `false`, no drag listeners are wired.
   */
  enabled?: boolean;
  /**
   * CSS selector (matched with `closest`) that restricts which element starts a
   * drag. When omitted, the whole row is a drag source. Use a drag-handle column
   * that renders an element matching this selector to require a handle grab.
   */
  handleSelector?: string;
  /**
   * Cross-grid transfer group. Grids that share a `group` accept each other's
   * rows (subject to `accepts`). Default `'default'`. Set distinct groups to
   * keep two unrelated grids from exchanging rows.
   */
  group?: string;
  /**
   * Allow rows to be transferred OUT of this grid to another grid. Default
   * `true`. When `false` the row can still be reordered within this grid.
   */
  allowDragOut?: boolean;
  /**
   * Predicate deciding whether THIS grid will accept a drop from `dragMeta`.
   * Defaults to accepting any drag in the same `group`. Return `false` to reject
   * (no drop indicator is shown, drop is a no-op).
   */
  accepts?: (dragMeta: RowDragMeta<Row>, target: GridApi<Row>) => boolean;
  /**
   * Pixels of pointer travel before a press is treated as a drag (vs a click).
   * Default `4`.
   */
  threshold?: number;
}

/** Metadata describing the row being dragged, handed to `accepts`. */
export interface RowDragMeta<Row extends Model = Model> {
  row: Row;
  recordId: RecordId;
  fromIndex: number;
  group: string;
  sourceGrid: GridApi<Row>;
}

const DEFAULT_GROUP = 'default';

export class RowReorderFeature<Row extends Model = Model> implements GridFeature<Row> {
  readonly name = 'rowReorder';

  private api!: GridApi<Row>;
  private readonly disposers = new Disposers();

  private readonly enabled: boolean;
  private readonly handleSelector: string | undefined;
  private readonly group: string;
  private readonly allowDragOut: boolean;
  private readonly threshold: number;
  private readonly acceptsFn?: RowReorderFeatureOptions<Row>['accepts'];

  /** The press that may become a drag (before the threshold is crossed). */
  private pending: { x: number; y: number; rowIndex: number; pointerId: number } | null = null;
  /** Whether a drag is currently dragging (threshold crossed). */
  private dragging = false;
  /** Floating proxy that follows the pointer. */
  private proxy: HTMLElement | null = null;
  /** Horizontal drop indicator line. */
  private indicator: HTMLElement | null = null;

  constructor(options: RowReorderFeatureOptions<Row> = {}) {
    this.enabled = options.enabled ?? true;
    this.handleSelector = options.handleSelector;
    this.group = options.group ?? DEFAULT_GROUP;
    this.allowDragOut = options.allowDragOut ?? true;
    this.threshold = options.threshold ?? 4;
    this.acceptsFn = options.accepts;
  }

  init(grid: GridApi<Row>): void {
    this.api = grid;
    grid.track(() => this.disposers.dispose());
    // Register for cross-grid hit-testing regardless of enabled state so a
    // disabled grid still can't be silently picked as a transfer target.
    RowReorderFeature.byElement.set(grid.el, this as RowReorderFeature);
    if (!this.enabled) return;

    const root = grid.el;

    const onPointerDown = (e: Event): void => this.handlePointerDown(e as PointerEvent);
    root.addEventListener('pointerdown', onPointerDown);
    this.disposers.add(() => root.removeEventListener('pointerdown', onPointerDown));

    // Pointer move/up are bound on the document so a fast drag that outruns the
    // pointer (or crosses into another grid) is still tracked.
    const onMove = (e: Event): void => this.handlePointerMove(e as PointerEvent);
    const onUp = (e: Event): void => this.handlePointerUp(e as PointerEvent);
    const onCancel = (): void => this.cancelDrag();
    document.addEventListener('pointermove', onMove, true);
    document.addEventListener('pointerup', onUp, true);
    document.addEventListener('pointercancel', onCancel, true);
    this.disposers.add(() => {
      document.removeEventListener('pointermove', onMove, true);
      document.removeEventListener('pointerup', onUp, true);
      document.removeEventListener('pointercancel', onCancel, true);
    });
  }

  /* ── public / testable surface ─────────────────────────────────────────── */

  /** Whether a drag is currently in flight (started by this feature). */
  isDragging(): boolean {
    return this.dragging;
  }

  /** Metadata for the active drag, if any (regardless of which grid started it). */
  getActiveDrag(): RowDragMeta<Row> | null {
    const drag = CURRENT_DRAG as ActiveDrag<Row> | null;
    if (!drag) return null;
    return {
      row: drag.row,
      recordId: drag.recordId,
      fromIndex: drag.fromIndex,
      group: drag.group,
      sourceGrid: drag.source.api,
    };
  }

  /**
   * Whether this grid would accept a drop from the given drag. Same-grid drags
   * are always acceptable; cross-grid drags require a matching `group` and pass
   * the `accepts` predicate (default: same group accepts).
   */
  accepts(dragMeta: RowDragMeta<Row>): boolean {
    if (dragMeta.sourceGrid === this.api) return true;
    if (dragMeta.group !== this.group) return false;
    if (this.acceptsFn) return this.acceptsFn(dragMeta, this.api);
    return true;
  }

  /**
   * Begin a drag programmatically (used by the pointer handler and by tests).
   * Captures the dragged row and registers the cross-grid drag state.
   */
  startDrag(rowIndex: number, pointerId = -1): boolean {
    if (!this.enabled || this.dragging) return false;
    const row = this.api.getRow(rowIndex);
    if (!row) return false;
    const recordId = (row as Model)[this.api.store.idField] as RecordId;
    const drag: ActiveDrag<Row> = {
      source: this,
      row,
      recordId,
      fromIndex: rowIndex,
      group: this.group,
      pointerId,
    };
    CURRENT_DRAG = drag as ActiveDrag;
    this.dragging = true;
    this.api.el.classList.add('jects-grid--row-dragging');
    return true;
  }

  /**
   * Resolve the drop target under a client point within THIS grid, or `null` if
   * the point is not over an acceptable drop zone. Exposed for tests.
   */
  resolveDropTarget(clientX: number, clientY: number): DropTarget | null {
    const drag = CURRENT_DRAG as ActiveDrag<Row> | null;
    if (!drag) return null;
    if (!this.accepts(this.metaOf(drag))) return null;

    const root = this.api.el;
    const rootRect = root.getBoundingClientRect();
    // Reject points clearly outside this grid's box.
    if (
      clientX < rootRect.left - 1 ||
      clientX > rootRect.right + 1 ||
      clientY < rootRect.top - 1 ||
      clientY > rootRect.bottom + 1
    ) {
      return null;
    }

    const rowEls = this.rowElements();
    if (rowEls.length === 0) {
      // Empty grid (e.g. cross-grid drop into an empty target): drop at index 0.
      return { rowIndex: 0, position: 'before' };
    }

    for (const el of rowEls) {
      const rect = el.getBoundingClientRect();
      if (clientY >= rect.top && clientY <= rect.bottom) {
        const rowIndex = Number(el.dataset['rowIndex']);
        if (Number.isNaN(rowIndex)) continue;
        const position: DropPosition = clientY < rect.top + rect.height / 2 ? 'before' : 'after';
        return { rowIndex, position };
      }
    }

    // Below the last row → append after it. Above the first → before it.
    const first = rowEls[0]!.getBoundingClientRect();
    if (clientY < first.top) {
      return { rowIndex: Number(rowEls[0]!.dataset['rowIndex'] ?? 0), position: 'before' };
    }
    const lastEl = rowEls[rowEls.length - 1]!;
    return { rowIndex: Number(lastEl.dataset['rowIndex'] ?? 0), position: 'after' };
  }

  /**
   * Commit a drop at the given target within THIS grid (this grid is the drop
   * target). Returns `true` if the move/transfer happened, `false` if vetoed or
   * invalid. This is the heart of the same-grid + cross-grid protocol and is
   * directly testable.
   */
  drop(target: DropTarget): boolean {
    const drag = CURRENT_DRAG as ActiveDrag<Row> | null;
    if (!drag) return false;
    const meta = this.metaOf(drag);
    if (!this.accepts(meta)) return false;

    const sourceApi = drag.source.api;
    const targetApi = this.api;
    const crossGrid = sourceApi !== targetApi;
    if (crossGrid && !drag.source.allowDragOut) return false;

    // Resolve the absolute insertion index in the TARGET store.
    let toIndex = this.insertionIndex(target);

    if (!crossGrid) {
      // Same-grid: a move past its own old slot shifts the index down by one,
      // because removing the row first compacts everything above the target.
      const fromIndex = drag.fromIndex;
      if (toIndex > fromIndex) toIndex -= 1;
      if (toIndex === fromIndex) {
        // No-op move (dropped onto its own position). Treat as a successful,
        // side-effect-free reorder so callers can clean up.
        return true;
      }
    }

    const payload: RowReorderPayload<Row> = {
      row: drag.row,
      recordId: drag.recordId,
      fromIndex: drag.fromIndex,
      toIndex,
      position: target.position,
      sourceGrid: sourceApi,
      targetGrid: targetApi,
      crossGrid,
    };

    // Vetoable: fire on the TARGET grid (the grid receiving the row). A handler
    // returning false cancels.
    if (!targetApi.emit('beforeRowReorder', payload)) {
      return false;
    }

    if (crossGrid) {
      // Remove from source, then add into target at the resolved index.
      sourceApi.store.remove(drag.recordId);
      const added = targetApi.store.add(drag.row);
      // Position the newly-added record at toIndex (Store.add appends).
      const addedAt = targetApi.store.indexOf(drag.recordId);
      if (addedAt !== -1 && addedAt !== toIndex) {
        const clamped = Math.min(Math.max(toIndex, 0), targetApi.store.count - 1);
        targetApi.store.move(addedAt, clamped);
      }
      void added;
      sourceApi.refresh();
      targetApi.refresh();
    } else {
      targetApi.store.move(drag.fromIndex, toIndex);
      targetApi.refresh();
    }

    // Notification (non-vetoable) on the target grid.
    targetApi.emit('rowReorder', payload);
    // And on the source grid too, so a cross-grid source can react to losing it.
    if (crossGrid) sourceApi.emit('rowReorder', payload);
    return true;
  }

  /* ── pointer pipeline ──────────────────────────────────────────────────── */

  private handlePointerDown(e: PointerEvent): void {
    if (e.button !== 0) return; // primary button only
    const rowEl = this.rowElementFromEvent(e);
    if (!rowEl) return;
    // Handle restriction: when a handle selector is configured, the press must
    // land on (or inside) a matching handle.
    if (this.handleSelector) {
      const handle = (e.target as HTMLElement).closest(this.handleSelector);
      if (!handle || !rowEl.contains(handle)) return;
    }
    const rowIndex = Number(rowEl.dataset['rowIndex']);
    if (Number.isNaN(rowIndex)) return;
    this.pending = { x: e.clientX, y: e.clientY, rowIndex, pointerId: e.pointerId };
  }

  private handlePointerMove(e: PointerEvent): void {
    if (this.pending && !this.dragging) {
      if (e.pointerId !== this.pending.pointerId) return;
      const dx = e.clientX - this.pending.x;
      const dy = e.clientY - this.pending.y;
      if (Math.hypot(dx, dy) < this.threshold) return;
      // Threshold crossed → promote to a real drag.
      if (!this.startDrag(this.pending.rowIndex, e.pointerId)) {
        this.pending = null;
        return;
      }
      this.buildFloatingUi();
    }
    const drag = CURRENT_DRAG;
    if (!drag) return;

    // Only the SOURCE grid's feature drives the floating proxy (there is exactly
    // one proxy per gesture). Every feature in the drag group — source AND
    // potential cross-grid targets — receives this same document-level event and
    // independently shows/hides ITS OWN drop indicator depending on whether the
    // pointer is over its grid. That makes the indicator appear in whichever grid
    // the pointer currently hovers, which is the cross-grid affordance.
    if (this.isSource(drag)) {
      this.moveProxy(e.clientX, e.clientY);
    } else if (drag.group !== this.group) {
      // Not in the drag's group → never a target; keep our indicator hidden.
      this.hideIndicator();
      return;
    }

    const target = this.resolveDropTarget(e.clientX, e.clientY);
    if (target) {
      this.showIndicator(target);
    } else {
      this.hideIndicator();
    }
  }

  private handlePointerUp(e: PointerEvent): void {
    // The source feature owns commit. Non-source features clear their indicator.
    const drag = CURRENT_DRAG;
    if (!drag) {
      this.pending = null;
      return;
    }
    const isSource = this.isSource(drag);
    if (!isSource) {
      // A different grid: the SOURCE feature owns the commit (it resolves the
      // grid under the pointer via featureUnderPoint). We just clear visuals.
      this.hideIndicator();
      return;
    }
    if (e.pointerId !== drag.pointerId && drag.pointerId !== -1) return;

    // Find the grid + target under the pointer at release. The source resolves
    // its own target; if the pointer is over a *different* accepting grid we need
    // that grid's feature to compute the target. We locate it via the element
    // under the pointer.
    const targetFeature = this.featureUnderPoint(e.clientX, e.clientY);
    let committed = false;
    if (targetFeature) {
      const tgt = targetFeature.resolveDropTarget(e.clientX, e.clientY);
      if (tgt) committed = targetFeature.drop(tgt);
    }
    this.endDrag();
    void committed;
  }

  /* ── floating UI ───────────────────────────────────────────────────────── */

  private buildFloatingUi(): void {
    const drag = CURRENT_DRAG as ActiveDrag<Row> | null;
    if (!drag) return;
    const proxy = createEl('div', { className: 'jects-grid-rowdrag-proxy' });
    proxy.setAttribute('aria-hidden', 'true');
    const label = this.rowLabel(drag.row);
    proxy.textContent = label;
    document.body.appendChild(proxy);
    this.proxy = proxy;
  }

  private moveProxy(x: number, y: number): void {
    if (!this.proxy) return;
    this.proxy.style.transform = `translate(${x + 12}px, ${y + 8}px)`;
  }

  private showIndicator(target: DropTarget): void {
    const rowEls = this.rowElements();
    let topPx: number;
    const rootRect = this.api.el.getBoundingClientRect();
    const match = rowEls.find((el) => Number(el.dataset['rowIndex']) === target.rowIndex);
    if (match) {
      const r = match.getBoundingClientRect();
      topPx = (target.position === 'before' ? r.top : r.bottom) - rootRect.top;
    } else {
      topPx = 0;
    }
    if (!this.indicator) {
      this.indicator = createEl('div', { className: 'jects-grid-rowdrag-indicator' });
      this.indicator.setAttribute('aria-hidden', 'true');
      // Position the indicator relative to the grid root.
      const root = this.api.el;
      if (getComputedStyle(root).position === 'static') {
        root.style.position = 'relative';
      }
      root.appendChild(this.indicator);
    }
    this.indicator.style.top = `${topPx}px`;
    this.indicator.hidden = false;
  }

  private hideIndicator(): void {
    if (this.indicator) this.indicator.hidden = true;
  }

  /* ── helpers ───────────────────────────────────────────────────────────── */

  /** The feature (in the same drag group) whose grid is under the given point. */
  private featureUnderPoint(x: number, y: number): RowReorderFeature<Row> | null {
    // Self first (most common: same-grid reorder).
    const selfRect = this.api.el.getBoundingClientRect();
    if (x >= selfRect.left && x <= selfRect.right && y >= selfRect.top && y <= selfRect.bottom) {
      return this;
    }
    // Otherwise scan the DOM for any element under the point that belongs to a
    // grid with a registered RowReorderFeature in the same group.
    const stack = typeof document.elementsFromPoint === 'function'
      ? document.elementsFromPoint(x, y)
      : [document.elementFromPoint?.(x, y)].filter(Boolean) as Element[];
    for (const el of stack) {
      const gridEl = (el as HTMLElement).closest?.('.jects-grid');
      if (!gridEl) continue;
      const feat = RowReorderFeature.byElement.get(gridEl as HTMLElement);
      if (feat && (feat as RowReorderFeature<Row>) !== this && feat.group === this.group) {
        return feat as RowReorderFeature<Row>;
      }
    }
    return null;
  }

  /** Compute the absolute store insertion index for a resolved drop target. */
  private insertionIndex(target: DropTarget): number {
    const count = this.api.store.count;
    if (count === 0) return 0;
    let idx = target.rowIndex;
    if (target.position === 'after') idx += 1;
    return Math.min(Math.max(idx, 0), count);
  }

  /** Whether THIS feature started the given active drag (reference identity). */
  private isSource(drag: ActiveDrag): boolean {
    return (drag.source as RowReorderFeature<Row>) === this;
  }

  private metaOf(drag: ActiveDrag<Row>): RowDragMeta<Row> {
    return {
      row: drag.row,
      recordId: drag.recordId,
      fromIndex: drag.fromIndex,
      group: drag.group,
      sourceGrid: drag.source.api,
    };
  }

  /** All rendered data-row elements of this grid, in DOM order. */
  private rowElements(): HTMLElement[] {
    return Array.from(
      this.api.el.querySelectorAll<HTMLElement>('.jects-grid__row[data-row-index]'),
    ).filter((el) => !el.hidden);
  }

  private rowElementFromEvent(e: Event): HTMLElement | null {
    const t = e.target as HTMLElement | null;
    return t?.closest<HTMLElement>('.jects-grid__row[data-row-index]') ?? null;
  }

  /** A human label for the drag proxy (first text-bearing cell, else the id). */
  private rowLabel(row: Row): string {
    const firstCol = this.api.columns.find((c) => c.field);
    if (firstCol?.field) {
      const v = (row as Model)[firstCol.field];
      if (v != null) return String(v);
    }
    const idField = this.api.store.idField;
    return idField ? String((row as Model)[idField] ?? '') : '';
  }

  private endDrag(): void {
    this.dragging = false;
    this.pending = null;
    CURRENT_DRAG = null;
    this.api.el.classList.remove('jects-grid--row-dragging');
    this.proxy?.remove();
    this.proxy = null;
    this.hideIndicator();
  }

  private cancelDrag(): void {
    this.endDrag();
  }

  destroy(): void {
    // If THIS feature owns the active drag, abort it cleanly.
    if (CURRENT_DRAG && this.isSource(CURRENT_DRAG)) {
      CURRENT_DRAG = null;
    }
    this.endDrag();
    this.indicator?.remove();
    this.indicator = null;
    if (this.api) RowReorderFeature.byElement.delete(this.api.el);
    this.disposers.dispose();
  }

  /**
   * Registry of grid root element → feature, used for cross-grid hit-testing on
   * drop. Populated on `init`, cleaned up on `destroy`.
   */
  private static readonly byElement = new WeakMap<HTMLElement, RowReorderFeature>();

  /** Expose the bound api for cross-grid metadata reads. */
  get gridApi(): GridApi<Row> {
    return this.api;
  }
}

/** Convenience factory. */
export function rowReorderFeature<Row extends Model = Model>(
  options?: RowReorderFeatureOptions<Row>,
): RowReorderFeature<Row> {
  return new RowReorderFeature<Row>(options);
}
