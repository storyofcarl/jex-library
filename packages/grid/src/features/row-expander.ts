/**
 * RowExpanderFeature — row expander / master-detail for @jects/grid
 * (Bryntum "RowExpander" / DHTMLX "sub-row / master-detail" parity).
 *
 * Adds an expandable detail region per row: an expander affordance in a dedicated
 * "widget detail column", an expanded-rows set, and — for every expanded master
 * row — an extra full-width **detail row** injected directly beneath it whose
 * content is produced by a consumer-supplied renderer/widget. The detail row's
 * pixel height is reported to the engine through the row-source height seam so
 * virtualization geometry (offsets, total scroll height, the painted window) is
 * correct even in an otherwise fixed-height grid.
 *
 * Architecture (mirrors {@link GroupFeature}):
 *   - The feature owns the model (expanded set, per-row detail height).
 *   - It installs a {@link RowSource} (the engine "row-source seam", shared with
 *     grouping) that interleaves master `kind: 'row'` entries with injected
 *     `kind: 'detail'` entries. The {@link DomRenderer} paints detail rows via
 *     `paintDetailRow` when it sees a `kind: 'detail'` entry.
 *   - The expander affordance is a per-row toggle button, painted by a cell
 *     renderer on an auto-prepended expander column. A single delegated click /
 *     keyboard listener on the grid root toggles the row (no edit to the keystone
 *     Grid class required — same self-contained wiring as TreeFeature/GroupFeature).
 *
 * The feature confines all interaction to {@link GridApi} (+ the optional
 * `setRowSource` seam the keystone Grid exposes) and releases everything it
 * created in `destroy()`.
 */

import { createEl, type Model, type RecordId } from '@jects/core';
import type {
  CellRenderContext,
  ColumnDef,
  GridApi,
  GridEvents,
  GridFeature,
} from '../contract.js';
import type { DetailRowData, RowEntry, RowSource } from '../engine/row-model.js';
import { Disposers } from './shared.js';

export {
  DETAIL_ROW_CLASS,
  DETAIL_CELL_CLASS,
  DETAIL_BODY_CLASS,
} from '../engine/detail-row-paint.js';

/**
 * The optional engine seam a host `GridApi` may expose: install/clear a
 * {@link RowSource} that supplies the visible row list. The keystone `Grid`
 * implements this; minimal test hosts may omit it (the feature still computes its
 * model but cannot drive the body paint).
 */
export interface RowSourceHost<Row extends Model = Model> {
  setRowSource?(source: RowSource<Row> | null): void;
}

/** Context handed to the consumer's detail renderer for one expanded row. */
export interface DetailRenderContext<Row extends Model = Model> {
  /** The master (expanded) row model. */
  row: Row;
  /** Id of the master row. */
  id: RecordId;
  /** The container element to populate (mutate in place, or return new content). */
  el: HTMLElement;
  /** The grid public API, for renderers that need state/services. */
  api: GridApi<Row>;
}

/**
 * Consumer detail renderer. Returning a string sets text, returning an element
 * replaces the body content, returning `void` means the renderer mutated `el`.
 */
export type DetailRenderer<Row extends Model = Model> = (
  ctx: DetailRenderContext<Row>,
) => string | HTMLElement | void;

/** Events the RowExpanderFeature emits on the grid (alongside grid events). */
export interface RowExpanderEvents<Row extends Model = Model> {
  /** Vetoable: a row is about to expand (handler returning `false` cancels). */
  beforeRowExpand: { row: Row; id: RecordId };
  /** Vetoable: a row is about to collapse (handler returning `false` cancels). */
  beforeRowCollapse: { row: Row; id: RecordId };
  /** A row's expand/collapse state changed. */
  rowExpand: { row: Row; id: RecordId; expanded: boolean };
}

export interface RowExpanderFeatureOptions<Row extends Model = Model> {
  /** Renderer/widget that paints the detail region for an expanded row. Required. */
  renderer: DetailRenderer<Row>;
  /** Detail region height in px. Default `160`. Can be a per-row function. */
  detailHeight?: number | ((row: Row, id: RecordId) => number);
  /** Initially expanded master-row ids. */
  expanded?: RecordId[];
  /** Allow only one row expanded at a time (accordion). Default `false`. */
  single?: boolean;
  /**
   * Auto-prepend a dedicated expander column hosting the toggle. Default `true`.
   * Set `false` to host the toggle yourself (call {@link renderExpanderCell}).
   */
  column?: boolean;
  /** Id of the auto-prepended expander column. Default `'__expander'`. */
  columnId?: string;
  /** Width (px) of the auto-prepended expander column. Default `40`. */
  columnWidth?: number;
}

const DEFAULT_DETAIL_HEIGHT = 160;
const DEFAULT_COLUMN_ID = '__expander';
const DEFAULT_COLUMN_WIDTH = 40;

export class RowExpanderFeature<Row extends Model = Model>
  implements GridFeature<Row>
{
  readonly name = 'rowExpander';

  private api!: GridApi<Row>;
  private readonly disposers = new Disposers();
  private readonly expanded = new Set<RecordId>();
  private readonly renderer: DetailRenderer<Row>;
  private readonly detailHeight: number | ((row: Row, id: RecordId) => number);
  private readonly single: boolean;
  private readonly wantColumn: boolean;
  private readonly columnId: string;
  private readonly columnWidth: number;

  /** Cached materialized entries + their heights, rebuilt on demand. */
  private entries: RowEntry<Row>[] = [];
  private dirty = true;
  private installedColumn = false;
  private rowSource: RowSource<Row> | null = null;

  constructor(options: RowExpanderFeatureOptions<Row>) {
    if (typeof options?.renderer !== 'function') {
      throw new Error('RowExpanderFeature requires a `renderer` function.');
    }
    this.renderer = options.renderer;
    this.detailHeight = options.detailHeight ?? DEFAULT_DETAIL_HEIGHT;
    this.single = options.single ?? false;
    this.wantColumn = options.column !== false;
    this.columnId = options.columnId ?? DEFAULT_COLUMN_ID;
    this.columnWidth = options.columnWidth ?? DEFAULT_COLUMN_WIDTH;
    for (const id of options.expanded ?? []) this.expanded.add(id);
  }

  init(grid: GridApi<Row>): void {
    this.api = grid;
    grid.track(() => this.disposers.dispose());

    // Build the row-source that injects detail rows beneath expanded masters.
    this.rowSource = {
      getRowEntries: () => this.getEntries(),
      heightOf: (index: number) => this.heightOfIndex(index),
    };

    // Re-materialize whenever the underlying data changes.
    const off = grid.store.events.on('change', () => {
      this.dirty = true;
    });
    this.disposers.add(off);

    // Auto-prepend the expander column (idempotent; restored on destroy).
    if (this.wantColumn) this.installColumn();

    // Delegated activation (click + keyboard) on the toggle affordance.
    const onClick = (e: Event): void => this.handleToggleEvent(e as MouseEvent);
    grid.el.addEventListener('click', onClick);
    this.disposers.add(() => grid.el.removeEventListener('click', onClick));

    const onKey = (e: Event): void => this.handleKey(e as KeyboardEvent);
    grid.el.addEventListener('keydown', onKey);
    this.disposers.add(() => grid.el.removeEventListener('keydown', onKey));

    // Tear down the row source with the feature.
    this.disposers.add(() => this.host()?.setRowSource?.(null));

    this.dirty = true;
    this.syncRowSource();
  }

  /* ── public model API ─────────────────────────────────────────────────── */

  /** Whether a master row is currently expanded. */
  isExpanded(id: RecordId): boolean {
    return this.expanded.has(id);
  }

  /** Ids of all currently expanded master rows (insertion order). */
  getExpanded(): RecordId[] {
    return [...this.expanded];
  }

  /** Expand a master row (vetoable). Returns `true` if it became expanded. */
  expand(id: RecordId): boolean {
    if (this.expanded.has(id)) return true;
    const row = this.api.getRowById(id);
    if (row === undefined) return false;
    if (!this.emit('beforeRowExpand', { row, id })) return false;
    if (this.single) {
      for (const other of [...this.expanded]) this.collapse(other);
    }
    this.expanded.add(id);
    this.invalidateAndRepaint();
    this.emit('rowExpand', { row, id, expanded: true });
    return true;
  }

  /** Collapse a master row (vetoable). Returns `true` if it became collapsed. */
  collapse(id: RecordId): boolean {
    if (!this.expanded.has(id)) return true;
    const row = this.api.getRowById(id);
    if (!this.emit('beforeRowCollapse', { row: row as Row, id })) return false;
    this.expanded.delete(id);
    this.invalidateAndRepaint();
    if (row !== undefined) this.emit('rowExpand', { row, id, expanded: false });
    return true;
  }

  /** Toggle a master row's expansion. */
  toggle(id: RecordId): void {
    if (this.expanded.has(id)) this.collapse(id);
    else this.expand(id);
  }

  /** Expand every row in the current store view. */
  expandAll(): void {
    if (this.single) return;
    for (const row of this.api.store.toArray()) {
      const id = row[this.api.store.idField] as RecordId;
      if (!this.expanded.has(id)) this.expanded.add(id);
    }
    this.invalidateAndRepaint();
  }

  /** Collapse every expanded row. */
  collapseAll(): void {
    if (this.expanded.size === 0) return;
    this.expanded.clear();
    this.invalidateAndRepaint();
  }

  /**
   * Markup-free DOM for the expander toggle of a master row. Consumers hosting
   * the affordance themselves (`column: false`) call this from their own cell
   * renderer. Returns a button wired for the feature's delegated handler.
   */
  renderExpanderCell(id: RecordId): HTMLElement {
    const expanded = this.expanded.has(id);
    const btn = createEl('button', { className: 'jects-grid-expander__toggle' });
    btn.type = 'button';
    btn.dataset['expanderToggle'] = String(id);
    btn.setAttribute('aria-expanded', String(expanded));
    btn.setAttribute('aria-label', expanded ? 'Collapse row detail' : 'Expand row detail');
    const chevron = createEl('span', { className: 'jects-grid-expander__chevron' });
    if (expanded) chevron.classList.add('jects-grid-expander__chevron--open');
    btn.appendChild(chevron);
    return btn;
  }

  /* ── row-source materialization ───────────────────────────────────────── */

  /** Build (lazily) the interleaved master + detail entries. */
  private getEntries(): RowEntry<Row>[] {
    if (this.dirty) this.recompute();
    return this.entries;
  }

  private recompute(): void {
    this.dirty = false;
    const out: RowEntry<Row>[] = [];
    const store = this.api.store;
    const idField = store.idField;
    store.forEach((row) => {
      const id = row[idField] as RecordId;
      out.push({ row, id, depth: 0, hasChildren: false, expanded: false, kind: 'row' });
      if (this.expanded.has(id)) {
        const height = this.resolveHeight(row, id);
        const detail: DetailRowData<Row> = {
          masterId: id,
          masterRow: row,
          height,
          render: (hostEl) => this.paintDetail(hostEl, row, id),
        };
        out.push({
          row,
          id,
          depth: 0,
          hasChildren: false,
          expanded: true,
          kind: 'detail',
          detail,
        });
      }
    });
    this.entries = out;
  }

  /** Per-index height override consumed by the engine (detail rows are tall). */
  private heightOfIndex(index: number): number | undefined {
    const entry = this.getEntries()[index];
    if (entry?.kind === 'detail' && entry.detail) return entry.detail.height;
    return undefined;
  }

  private resolveHeight(row: Row, id: RecordId): number {
    const h = typeof this.detailHeight === 'function' ? this.detailHeight(row, id) : this.detailHeight;
    return Number.isFinite(h) && h > 0 ? h : DEFAULT_DETAIL_HEIGHT;
  }

  /** Invoke the consumer renderer into the detail body host. */
  private paintDetail(hostEl: HTMLElement, row: Row, id: RecordId): HTMLElement | void {
    const ctx: DetailRenderContext<Row> = { row, id, el: hostEl, api: this.api };
    const result = this.renderer(ctx);
    if (typeof result === 'string') {
      hostEl.textContent = result;
      return;
    }
    return result ?? undefined;
  }

  /* ── expander column ──────────────────────────────────────────────────── */

  private installColumn(): void {
    if (this.installedColumn) return;
    const existing = this.api.columns.map((c) => ({ ...c }));
    if (existing.some((c) => (c.id ?? c.field) === this.columnId)) return;
    const expanderCol: ColumnDef<Row> = {
      id: this.columnId,
      header: '',
      width: this.columnWidth,
      type: 'template',
      sortable: false,
      filterable: false,
      resizable: false,
      reorderable: false,
      align: 'center',
      renderer: (ctx: CellRenderContext<Row>) => {
        const id = (ctx.row as Model)[this.api.store.idField] as RecordId;
        ctx.el.replaceChildren(this.renderExpanderCell(id));
      },
    };
    this.api.setColumns([expanderCol, ...existing]);
    this.installedColumn = true;
    // Restore the original columns on teardown.
    this.disposers.add(() => {
      if (!this.installedColumn) return;
      const cur = this.api.columns
        .filter((c) => (c.id ?? c.field) !== this.columnId)
        .map((c) => ({ ...c }));
      this.api.setColumns(cur);
      this.installedColumn = false;
    });
  }

  /* ── wiring ───────────────────────────────────────────────────────────── */

  private host(): RowSourceHost<Row> | undefined {
    const h = this.api as unknown as RowSourceHost<Row>;
    return typeof h.setRowSource === 'function' ? h : undefined;
  }

  /** Install the row-source whenever any row is expanded; clear when none are. */
  private syncRowSource(): void {
    const host = this.host();
    host?.setRowSource?.(this.expanded.size > 0 ? this.rowSource : null);
  }

  private invalidateAndRepaint(): void {
    this.dirty = true;
    this.recompute();
    this.syncRowSource();
    this.api.refresh();
  }

  /** Resolve the master-row id from an activated toggle, or null. */
  private idFromEvent(e: Event): RecordId | null {
    const target = e.target as HTMLElement | null;
    const toggle = target?.closest<HTMLElement>('[data-expander-toggle]');
    const raw = toggle?.dataset['expanderToggle'];
    if (raw == null) return null;
    return this.resolveId(raw);
  }

  private handleToggleEvent(e: MouseEvent): void {
    const id = this.idFromEvent(e);
    if (id == null) return;
    e.preventDefault();
    e.stopPropagation();
    this.toggle(id);
  }

  private handleKey(e: KeyboardEvent): void {
    if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
    const target = e.target as HTMLElement | null;
    if (!target?.closest('[data-expander-toggle]')) return;
    const id = this.idFromEvent(e);
    if (id == null) return;
    e.preventDefault();
    this.toggle(id);
  }

  /** data-* attributes are strings; recover the original id type from the store. */
  private resolveId(raw: string): RecordId {
    if (this.api.getRowById(raw) !== undefined) return raw;
    const asNum = Number(raw);
    if (!Number.isNaN(asNum) && this.api.getRowById(asNum) !== undefined) return asNum;
    return raw;
  }

  /** Emit a feature event through the grid emitter (vetoable for `beforeX`). */
  private emit<K extends keyof RowExpanderEvents<Row>>(
    event: K,
    payload: RowExpanderEvents<Row>[K],
  ): boolean {
    return this.api.emit(
      event as unknown as keyof GridEvents<Row>,
      payload as unknown as GridEvents<Row>[keyof GridEvents<Row>],
    );
  }

  destroy(): void {
    this.disposers.dispose();
    this.expanded.clear();
    this.entries = [];
    this.rowSource = null;
  }
}

/** Convenience factory. */
export function rowExpanderFeature<Row extends Model = Model>(
  options: RowExpanderFeatureOptions<Row>,
): RowExpanderFeature<Row> {
  return new RowExpanderFeature<Row>(options);
}
