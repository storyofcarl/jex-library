/**
 * ResponsiveFeature — viewport-width-based column auto-hide for @jects/grid
 * (Bryntum "responsive levels" / DHTMLX adaptive-columns parity).
 *
 * Observes the grid root with a `ResizeObserver` and, as the available width
 * crosses thresholds, hides/shows columns so the grid degrades gracefully on
 * narrow viewports. Two modes (combinable):
 *
 *   1. Priority mode (default): each column declares a `responsivePriority`
 *      (lower = dropped first) and/or a `minGridWidth` (hide below this width).
 *      When the content's natural width exceeds the viewport, the feature hides
 *      the lowest-priority columns until it fits (or none remain droppable).
 *   2. Explicit breakpoints: `{ breakpoints: [{ maxWidth, hide: [id,…] }] }`
 *      hides exactly the listed column ids whenever width ≤ maxWidth. Breakpoints
 *      are matched cumulatively (every breakpoint whose `maxWidth` is met applies).
 *
 * Hiding goes through `GridApi.updateColumn(id, { hidden })`, so the engine
 * re-resolves geometry and repaints the header in place (no full rebuild). The
 * feature remembers each column's author-declared `hidden` so re-showing never
 * reveals a column the consumer hid deliberately. The observer and all subscriptions
 * are released on `destroy()`.
 */

import type { Model } from '@jects/core';
import type { ColumnDef, GridApi, GridFeature } from '../contract.js';
import { Disposers, colId } from './shared.js';

/** An explicit responsive breakpoint: hide `hide` columns at/below `maxWidth`px. */
export interface ResponsiveBreakpoint {
  /** Apply when the grid width is ≤ this many px. */
  maxWidth: number;
  /** Column ids to hide while the breakpoint is active. */
  hide: string[];
}

export interface ResponsiveFeatureOptions {
  /**
   * Explicit breakpoints (px → column ids to hide). When omitted, the feature
   * runs in priority mode using each column's `responsivePriority`/`minGridWidth`.
   */
  breakpoints?: ResponsiveBreakpoint[];
  /**
   * Estimated px width used for a column with no explicit `width` when computing
   * the natural content width in priority mode. Default `120`.
   */
  defaultColumnWidth?: number;
}

const DEFAULT_COLUMN_WIDTH = 120;

export class ResponsiveFeature<Row extends Model = Model> implements GridFeature<Row> {
  readonly name = 'responsive';

  private api!: GridApi<Row>;
  private readonly disposers = new Disposers();
  private readonly breakpoints: ResponsiveBreakpoint[];
  private readonly defaultColumnWidth: number;
  private observer: ResizeObserver | null = null;
  /** Column ids THIS feature hid (so we only un-hide what we hid). */
  private autoHidden = new Set<string>();
  /** Last applied set, to skip redundant `updateColumn` churn. */
  private lastHidden = new Set<string>();

  constructor(options: ResponsiveFeatureOptions = {}) {
    // Sort breakpoints widest-first so cumulative matching is deterministic.
    this.breakpoints = (options.breakpoints ?? [])
      .map((b) => ({ maxWidth: b.maxWidth, hide: [...b.hide] }))
      .sort((a, b) => b.maxWidth - a.maxWidth);
    this.defaultColumnWidth = options.defaultColumnWidth ?? DEFAULT_COLUMN_WIDTH;
  }

  init(grid: GridApi<Row>): void {
    this.api = grid;
    grid.track(() => this.disposers.dispose());

    // Re-evaluate when columns change (e.g. another feature added/removed one).
    const offReorder = grid.on('columnReorder', () => this.evaluate());
    this.disposers.add(offReorder);

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => this.evaluate());
      observer.observe(grid.el);
      this.observer = observer;
      this.disposers.add(() => {
        this.observer?.disconnect();
        this.observer = null;
      });
    }

    // Initial pass (covers SSR/jsdom where ResizeObserver may not fire).
    this.evaluate();
  }

  /** Current grid root width in px (clientWidth falls back when layout is 0). */
  private currentWidth(): number {
    const el = this.api.el;
    const rect = el.getBoundingClientRect();
    return rect.width || el.clientWidth || 0;
  }

  /**
   * Recompute which columns should be auto-hidden for the current width and
   * apply the delta. Public so tests (and consumers) can force a pass without a
   * real resize event (jsdom never fires ResizeObserver).
   */
  evaluate(width = this.currentWidth()): void {
    if (width <= 0) return; // no measurable layout yet — keep current state
    const target =
      this.breakpoints.length > 0 ? this.byBreakpoints(width) : this.byPriority(width);

    // Skip when nothing changed.
    if (sameSet(target, this.lastHidden)) return;

    // Un-hide columns we auto-hid that are no longer targeted.
    for (const id of this.autoHidden) {
      if (!target.has(id)) this.api.updateColumn(id, { hidden: false } as Partial<ColumnDef<Row>>);
    }
    // Hide newly-targeted columns.
    for (const id of target) {
      if (!this.autoHidden.has(id)) this.api.updateColumn(id, { hidden: true } as Partial<ColumnDef<Row>>);
    }
    this.autoHidden = new Set(target);
    this.lastHidden = new Set(target);
  }

  /** Column ids hidden by the matching explicit breakpoints (cumulative). */
  private byBreakpoints(width: number): Set<string> {
    const hide = new Set<string>();
    for (const bp of this.breakpoints) {
      if (width <= bp.maxWidth) for (const id of bp.hide) hide.add(id);
    }
    return hide;
  }

  /**
   * Priority mode: hide each column whose `minGridWidth` exceeds the viewport,
   * then drop the lowest-priority columns until the remaining content fits.
   */
  private byPriority(width: number): Set<string> {
    const hide = new Set<string>();
    const cols = this.api.columns;

    // 1) Hard per-column minimums.
    for (const col of cols) {
      if (col.minGridWidth != null && width < col.minGridWidth) hide.add(colId(col));
    }

    // 2) Drop by priority until the (estimated) content width fits.
    const droppable = cols
      .filter((c) => c.responsivePriority != null && !hide.has(colId(c)))
      .sort((a, b) => (a.responsivePriority ?? 0) - (b.responsivePriority ?? 0));

    let used = this.estimateWidth(cols, hide);
    for (const col of droppable) {
      if (used <= width) break;
      hide.add(colId(col));
      used -= this.widthOf(col);
    }
    return hide;
  }

  private estimateWidth(cols: ReadonlyArray<ColumnDef<Row>>, hidden: ReadonlySet<string>): number {
    let total = 0;
    for (const col of cols) {
      if (col.hidden && !this.autoHidden.has(colId(col))) continue; // author-hidden
      if (hidden.has(colId(col))) continue;
      total += this.widthOf(col);
    }
    return total;
  }

  private widthOf(col: ColumnDef<Row>): number {
    return col.width ?? this.defaultColumnWidth;
  }

  /** Ids the feature is currently auto-hiding (for tests / introspection). */
  getHidden(): string[] {
    return [...this.autoHidden];
  }

  destroy(): void {
    // Restore any columns we auto-hid before tearing down.
    for (const id of this.autoHidden) {
      this.api.updateColumn(id, { hidden: false } as Partial<ColumnDef<Row>>);
    }
    this.autoHidden.clear();
    this.lastHidden.clear();
    this.disposers.dispose();
  }
}

function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

/** Convenience factory. */
export function responsiveFeature<Row extends Model = Model>(
  options?: ResponsiveFeatureOptions,
): ResponsiveFeature<Row> {
  return new ResponsiveFeature<Row>(options);
}
