/**
 * HeaderGroupsFeature — grouped / multi-level (stacked) column headers for
 * @jects/grid, implemented as a `GridFeature` plugin (additive; no edits to the
 * engine or the package barrel). Brings the grid to Bryntum/DHTMLX parity for
 * "grouped/multi-level headers" (PARITY.md, Grid section).
 *
 * It replaces the flat single-row header the `DomRenderer` paints with a stacked
 * header of N rows: spanning group cells on top, leaf column headers on the
 * bottom, each group cell carrying `aria-colspan` over its descendant leaves and
 * `rowSpan` filling empty rows. Spanning is band-aware — a group never crosses a
 * frozen-band boundary, so the stacked header stays pixel-aligned over the
 * frozen-left / scrolling / frozen-right regions.
 *
 * Wiring: install with `grid.use(headerGroupsFeature({ ... }))` (or via
 * `plugins: [...]`). The feature reads geometry/columns ONLY through `GridApi`
 * (+ the grid root element it owns) and re-paints the stacked header whenever the
 * layout changes (resize / column resize / reorder / hide / sort). It restores
 * the original flat header and releases every listener on `destroy()`.
 */

import { createEl, type Model } from '@jects/core';
import type { ColumnAlign, ColumnDef, GridApi, GridFeature } from '../contract.js';
import { Disposers, colId } from '../features/shared.js';
import {
  resolveHeaderTree,
  hasHeaderGroups,
  type GroupedColumnDef,
  type HeaderBand,
  type HeaderCell,
  type HeaderGroup,
  type HeaderTree,
  type LeafColumnInput,
} from './header-tree.js';

/** Options for {@link HeaderGroupsFeature}. */
export interface HeaderGroupsFeatureOptions<Row extends Model = Model> {
  /**
   * Explicit header-group tree. When omitted, the feature derives grouping from
   * each column's own `group` / `groupPath` (see {@link GroupedColumnDef}).
   */
  headerGroups?: HeaderGroup[];
  /**
   * Force the stacked header even when no grouping is declared (renders a single
   * leaf row). Default `false` — with no grouping the feature stays inert and
   * leaves the engine's flat header untouched.
   */
  always?: boolean;
  /** Called after each stacked-header (re)paint with the resolved tree. */
  onRender?: (tree: HeaderTree, api: GridApi<Row>) => void;
}

/** Grid-side surface the feature reaches for geometry the public API omits. */
interface BandGeom {
  leftWidth: number;
  rightWidth: number;
}

const ROW_CLASS = 'jects-grid__header-row';
const GROUP_ROW_CLASS = 'jects-grid__header-grouprow';
const GROUP_CELL_CLASS = 'jects-grid__header-group';
const HEADER_CLASS = 'jects-grid__header';
const GROUPED_FLAG = 'jects-grid__header--grouped';

/**
 * Grouped / multi-level header feature.
 */
export class HeaderGroupsFeature<Row extends Model = Model> implements GridFeature<Row> {
  readonly name = 'headerGroups';

  private api: GridApi<Row> | null = null;
  private readonly disposers = new Disposers();
  private headerEl: HTMLElement | null = null;
  private rafId: number | null = null;
  private active = false;

  constructor(private readonly options: HeaderGroupsFeatureOptions<Row> = {}) {}

  init(api: GridApi<Row>): void {
    this.api = api;
    this.headerEl = api.el.querySelector<HTMLElement>(`.${HEADER_CLASS}`);

    // Re-paint whenever geometry/columns change. The engine repaints the flat
    // header on these too, so we re-impose the stacked header right after.
    const repaint = (): void => this.schedule();
    this.disposers.add(api.on('viewportChange', repaint));
    this.disposers.add(api.on('columnResize', repaint));
    this.disposers.add(api.on('columnReorder', repaint));
    this.disposers.add(api.on('sortChange', repaint));
    this.disposers.add(api.on('render', repaint));

    // Initial paint (after the engine has built its header).
    this.schedule();

    // On teardown, drop any pending frame and restore the flat header.
    this.disposers.add(() => {
      if (this.rafId != null) cancelAnimationFrame(this.rafId);
      this.rafId = null;
    });
    this.disposers.add(() => this.restoreFlatHeader());
  }

  destroy(): void {
    this.disposers.dispose();
    this.api = null;
    this.headerEl = null;
  }

  /* ── public inspection (tests / advanced consumers) ──────────────────── */

  /** Resolve the current header tree without painting (pure). */
  resolveTree(): HeaderTree {
    return resolveHeaderTree(this.leafInputs(), this.options.headerGroups);
  }

  /** Whether the stacked header is currently imposed. */
  get isActive(): boolean {
    return this.active;
  }

  /* ── internals ───────────────────────────────────────────────────────── */

  private schedule(): void {
    if (typeof requestAnimationFrame !== 'function') {
      this.paint();
      return;
    }
    if (this.rafId != null) return;
    this.rafId = requestAnimationFrame(() => {
      this.rafId = null;
      this.paint();
    });
  }

  private leafInputs(): LeafColumnInput[] {
    const api = this.api;
    if (!api) return [];
    // `api.columns` is the resolved, ordered, visible column list. Index is the
    // visible column index used for aria-colindex elsewhere in the grid.
    return api.columns.map((def, index) => {
      const gdef = def as GroupedColumnDef;
      const input: LeafColumnInput = {
        id: colId(def as ColumnDef<Row>),
        index,
        def: gdef,
      };
      if (gdef.frozen) input.frozen = gdef.frozen;
      return input;
    });
  }

  private paint(): void {
    const api = this.api;
    const headerEl = this.headerEl ?? api?.el.querySelector<HTMLElement>(`.${HEADER_CLASS}`) ?? null;
    if (!api || !headerEl) return;
    this.headerEl = headerEl;

    const leaves = this.leafInputs();
    const grouped = this.options.always === true || hasHeaderGroups(leaves, this.options.headerGroups);
    if (!grouped) {
      // Nothing to do — leave the engine's flat header in place.
      this.active = false;
      headerEl.classList.remove(GROUPED_FLAG);
      return;
    }

    const tree = resolveHeaderTree(leaves, this.options.headerGroups);
    const geom = this.bandGeom(leaves);
    const widths = this.leafWidths(leaves);
    const lefts = this.leafLefts(leaves, geom);

    const headerHeight = headerEl.getBoundingClientRect().height || headerEl.offsetHeight;
    const levelCount = tree.levelCount;
    // Distribute the header height evenly across levels for row positioning.
    const rowHeight = levelCount > 0 ? 100 / levelCount : 100;

    headerEl.classList.add(GROUPED_FLAG);
    headerEl.replaceChildren();
    // NOTE: `aria-rowcount` is NOT set here — it is only valid on the grid/table
    // root (the Grid widget already exposes it). The header is a `rowgroup`;
    // each stacked row carries its own 1-based `aria-rowindex` instead.

    for (let level = 0; level < levelCount; level++) {
      const rowEl = createEl('div', {
        className: level < levelCount - 1 ? `${ROW_CLASS} ${GROUP_ROW_CLASS}` : ROW_CLASS,
      });
      rowEl.setAttribute('role', 'row');
      rowEl.setAttribute('aria-rowindex', String(level + 1));
      rowEl.style.position = 'absolute';
      rowEl.style.insetInlineStart = '0';
      rowEl.style.insetBlockStart = `${level * rowHeight}%`;
      rowEl.style.height = `${rowHeight}%`;
      rowEl.style.width = '100%';

      // Cells whose `depth === level` start on this row.
      const cells = this.cellsStartingAt(tree, level);
      for (const cell of cells) {
        const cellEl = this.buildCell(cell, level, rowHeight, lefts, widths, geom, headerHeight);
        rowEl.appendChild(cellEl);
      }
      headerEl.appendChild(rowEl);
    }

    this.active = true;
    this.options.onRender?.(tree, api);
  }

  private cellsStartingAt(tree: HeaderTree, level: number): HeaderCell[] {
    const out: HeaderCell[] = [];
    (['left', 'center', 'right'] as HeaderBand[]).forEach((band) => {
      const row = tree.bands[band][level];
      if (row) out.push(...row);
    });
    return out;
  }

  private buildCell(
    cell: HeaderCell,
    level: number,
    rowHeightPct: number,
    lefts: Map<number, number>,
    widths: Map<number, number>,
    geom: BandGeom,
    headerHeightPx: number,
  ): HTMLElement {
    const isLeaf = cell.isLeaf;
    const el = createEl('div', {
      className: isLeaf ? 'jects-grid__header-cell' : `jects-grid__header-cell ${GROUP_CELL_CLASS}`,
    });
    el.setAttribute('role', 'columnheader');

    // Horizontal geometry: span from the first leaf's left to the last leaf's
    // right edge, measured within the cell's band.
    const left = lefts.get(cell.leafStart) ?? 0;
    let width = 0;
    for (let i = cell.leafStart; i <= cell.leafEnd; i++) width += widths.get(i) ?? 0;
    el.style.position = 'absolute';
    el.style.width = `${width}px`;
    this.positionInBand(el, cell.band, left, width, geom);

    // Vertical geometry: a leaf shallower than the deepest level spans down.
    const heightPct = rowHeightPct * cell.rowSpan;
    el.style.height = `${heightPct}%`;
    el.style.insetBlockStart = '0';

    // ARIA: spanning width + the cell's own column position.
    el.setAttribute('aria-colindex', String(cell.leafStart + 1));
    if (cell.colSpan > 1) el.setAttribute('aria-colspan', String(cell.colSpan));
    if (cell.rowSpan > 1) el.setAttribute('aria-rowspan', String(cell.rowSpan));

    el.dataset['colId'] = cell.id;
    el.dataset['headerDepth'] = String(level);
    el.dataset['colSpan'] = String(cell.colSpan);
    if (isLeaf) {
      el.dataset['colIndex'] = String(cell.leafStart);
      el.dataset['leaf'] = '';
    } else {
      el.dataset['group'] = '';
    }

    this.applyAlign(el, cell.align);
    if (cell.band !== 'center') el.classList.add('jects-grid__cell--frozen');

    // Leaf cells keep the engine's sortable affordance so keyboard/AT users can
    // still operate sort from the stacked header.
    if (isLeaf && cell.def && (cell.def as ColumnDef).sortable !== false) {
      el.classList.add('jects-grid__header-cell--sortable');
      el.dataset['sortable'] = '';
      el.tabIndex = 0;
      el.setAttribute('aria-sort', 'none');
    }

    el.textContent = cell.label;
    void headerHeightPx; // reserved for future absolute-px layout mode
    return el;
  }

  private positionInBand(
    el: HTMLElement,
    band: HeaderBand,
    bandLeft: number,
    width: number,
    geom: BandGeom,
  ): void {
    if (band === 'left') {
      el.style.left = `${bandLeft}px`;
      el.style.right = 'auto';
      el.style.zIndex = '2';
    } else if (band === 'right') {
      const rightInset = geom.rightWidth - bandLeft - width;
      el.style.right = `${rightInset}px`;
      el.style.left = 'auto';
      el.style.zIndex = '2';
    } else {
      el.style.left = `${bandLeft + geom.leftWidth}px`;
      el.style.right = 'auto';
    }
  }

  private applyAlign(el: HTMLElement, align: ColumnAlign): void {
    if (align === 'center') el.classList.add('jects-grid__header-cell--center');
    else if (align === 'end') el.classList.add('jects-grid__header-cell--end');
  }

  /** Per-leaf resolved pixel width keyed by visible column index. */
  private leafWidths(leaves: ReadonlyArray<LeafColumnInput>): Map<number, number> {
    const api = this.api;
    const m = new Map<number, number>();
    if (!api) return m;
    // Prefer the engine's measured cell width when available, else fall back to
    // the def width. Read it off the rendered flat header / body if present.
    const layoutWidths = this.measuredWidths();
    for (const leaf of leaves) {
      const measured = layoutWidths.get(leaf.id);
      m.set(leaf.index, measured ?? leaf.def.width ?? 150);
    }
    return m;
  }

  /** Per-leaf band-relative left offset keyed by visible column index. */
  private leafLefts(
    leaves: ReadonlyArray<LeafColumnInput>,
    _geom: BandGeom,
  ): Map<number, number> {
    const widths = this.leafWidths(leaves);
    const m = new Map<number, number>();
    let leftX = 0;
    let centerX = 0;
    let rightX = 0;
    for (const leaf of leaves) {
      const band: HeaderBand = leaf.frozen === 'left' ? 'left' : leaf.frozen === 'right' ? 'right' : 'center';
      const w = widths.get(leaf.index) ?? 0;
      if (band === 'left') {
        m.set(leaf.index, leftX);
        leftX += w;
      } else if (band === 'right') {
        m.set(leaf.index, rightX);
        rightX += w;
      } else {
        m.set(leaf.index, centerX);
        centerX += w;
      }
    }
    return m;
  }

  /** Read resolved widths off the flat header cells the engine already painted. */
  private measuredWidths(): Map<string, number> {
    const m = new Map<string, number>();
    const headerEl = this.headerEl;
    if (!headerEl) return m;
    headerEl
      .querySelectorAll<HTMLElement>('.jects-grid__header-cell[data-col-id]')
      .forEach((cell) => {
        const id = cell.dataset['colId'];
        if (id == null) return;
        const w = cell.style.width ? parseFloat(cell.style.width) : cell.offsetWidth;
        if (!Number.isNaN(w) && w > 0) m.set(id, w);
      });
    return m;
  }

  private bandGeom(leaves: ReadonlyArray<LeafColumnInput>): BandGeom {
    const widths = this.leafWidths(leaves);
    let leftWidth = 0;
    let rightWidth = 0;
    for (const leaf of leaves) {
      const w = widths.get(leaf.index) ?? 0;
      if (leaf.frozen === 'left') leftWidth += w;
      else if (leaf.frozen === 'right') rightWidth += w;
    }
    return { leftWidth, rightWidth };
  }

  private restoreFlatHeader(): void {
    const headerEl = this.headerEl;
    if (!headerEl) return;
    headerEl.classList.remove(GROUPED_FLAG);
    // Ask the grid to repaint its flat header. `invalidateLayout` rebuilds the
    // single-row header via the engine path.
    this.api?.invalidateLayout();
  }
}

/** Factory — `grid.use(headerGroupsFeature({ headerGroups }))`. */
export function headerGroupsFeature<Row extends Model = Model>(
  options?: HeaderGroupsFeatureOptions<Row>,
): HeaderGroupsFeature<Row> {
  return new HeaderGroupsFeature<Row>(options);
}
