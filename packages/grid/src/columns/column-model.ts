/**
 * Column model — resolve declarative `ColumnDef`s into runtime column geometry,
 * and provide the imperative operations the engine wires to user gestures:
 * resize, reorder, hide/show, frozen left/right split regions, and auto-width.
 *
 * This module is framework-free and DOM-light: it computes positions/widths from
 * the column defs + an available width, and returns plain data the renderer can
 * paint. It is consumed by the engine (3A) which owns the DOM; here we own the
 * MATH and the column state transitions only.
 *
 * Contract surfaces used: `ColumnDef`, `FrozenSide`, `ColumnAlign`.
 */

import type { Model } from '@jects/core';
import type { ColumnDef, FrozenSide } from '../contract.js';

/** Default fallback width (px) for a column with no width/flex. */
export const DEFAULT_COLUMN_WIDTH = 150;
/** Default minimum width (px) applied when a column omits `minWidth`. */
export const DEFAULT_MIN_WIDTH = 40;

/** A column def resolved to concrete geometry for one layout pass. */
export interface ResolvedColumn<Row extends Model = Model> {
  /** The originating column definition. */
  def: ColumnDef<Row>;
  /** Stable id (def.id ?? def.field ?? generated). */
  id: string;
  /** Index among visible columns (left → right, frozen regions first/last). */
  index: number;
  /** Index in the ORIGINAL columns array (display order before reorder). */
  sourceIndex: number;
  /** Computed pixel width. */
  width: number;
  /** Left offset in px within its scroll region. */
  left: number;
  /** Resolved alignment. */
  align: 'start' | 'center' | 'end';
  /** Which frozen region the column lives in, or `null` for the scrolling body. */
  frozen: FrozenSide | null;
}

/** The full resolved layout, split into the three horizontal regions. */
export interface ColumnLayout<Row extends Model = Model> {
  /** Frozen-left columns (left → right), positioned from x=0. */
  left: ResolvedColumn<Row>[];
  /** Scrolling-body columns (left → right), positioned from x=0 of the scroller. */
  center: ResolvedColumn<Row>[];
  /** Frozen-right columns (left → right), positioned from x=0 of the right rail. */
  right: ResolvedColumn<Row>[];
  /** All visible columns in visual order (left ++ center ++ right). */
  all: ResolvedColumn<Row>[];
  /** Total width of the frozen-left region. */
  leftWidth: number;
  /** Total width of the scrolling-body region (sum of center widths). */
  centerWidth: number;
  /** Total width of the frozen-right region. */
  rightWidth: number;
}

/** Resolve a column's stable id. */
export function columnId<Row extends Model>(def: ColumnDef<Row>, fallbackIndex: number): string {
  return def.id ?? (def.field as string | undefined) ?? `col-${fallbackIndex}`;
}

/** Clamp a width into the column's [minWidth, maxWidth] band. */
export function clampWidth<Row extends Model>(def: ColumnDef<Row>, width: number): number {
  const min = def.minWidth ?? DEFAULT_MIN_WIDTH;
  const max = def.maxWidth ?? Infinity;
  return Math.max(min, Math.min(max, width));
}

/**
 * The mutable column-model state the engine holds. It is created from the user's
 * `ColumnDef[]` and supports in-place mutation (resize/reorder/hide/freeze) while
 * preserving the ability to re-resolve geometry against any available width.
 */
export class ColumnModel<Row extends Model = Model> {
  /** Columns in current DISPLAY order (after any reorder). */
  private cols: ColumnDef<Row>[];
  /** Per-id explicit width overrides set by resize/auto-width (px). */
  private widths = new Map<string, number>();

  constructor(columns: ColumnDef<Row>[]) {
    this.cols = columns.map((c) => ({ ...c }));
  }

  /** Snapshot of the current column defs (display order). */
  getColumns(): ReadonlyArray<ColumnDef<Row>> {
    return this.cols;
  }

  /** Visible (non-hidden) columns in display order. */
  getVisible(): ColumnDef<Row>[] {
    return this.cols.filter((c) => !c.hidden);
  }

  /** Find a column by id/field; returns the def and its display index. */
  find(id: string): { def: ColumnDef<Row>; index: number } | undefined {
    for (let i = 0; i < this.cols.length; i++) {
      const def = this.cols[i]!;
      if (columnId(def, i) === id) return { def, index: i };
    }
    return undefined;
  }

  /** Replace all columns (re-resolve from scratch; keeps explicit width overrides by id). */
  setColumns(columns: ColumnDef<Row>[]): void {
    this.cols = columns.map((c) => ({ ...c }));
  }

  /** Patch one column in place (width/hidden/frozen/align/...). */
  updateColumn(id: string, patch: Partial<ColumnDef<Row>>): void {
    const hit = this.find(id);
    if (!hit) return;
    this.cols[hit.index] = { ...hit.def, ...patch };
    if (patch.width != null) this.widths.set(id, patch.width);
  }

  /** Set an explicit pixel width (resize gesture). Clamped to the column band. */
  setWidth(id: string, width: number): number {
    const hit = this.find(id);
    if (!hit) return width;
    const w = clampWidth(hit.def, width);
    this.widths.set(id, w);
    const next = { ...hit.def, width: w };
    delete next.flex; // an explicit width wins over flex
    this.cols[hit.index] = next;
    return w;
  }

  /** Hide or show a column without removing it from the model. */
  setHidden(id: string, hidden: boolean): void {
    const hit = this.find(id);
    if (!hit) return;
    this.cols[hit.index] = { ...hit.def, hidden };
  }

  /** Toggle a column's hidden state; returns the new state. */
  toggleHidden(id: string): boolean {
    const hit = this.find(id);
    if (!hit) return false;
    const next = !hit.def.hidden;
    this.setHidden(id, next);
    return next;
  }

  /** Pin a column to an edge, or unpin (`null`). */
  setFrozen(id: string, frozen: FrozenSide | null): void {
    const hit = this.find(id);
    if (!hit) return;
    const next = { ...hit.def };
    if (frozen) next.frozen = frozen;
    else delete next.frozen;
    this.cols[hit.index] = next;
  }

  /**
   * Move a column from one DISPLAY index to another (reorder gesture).
   * Returns `{ fromIndex, toIndex }` actually applied, or `null` if no-op.
   */
  move(fromIndex: number, toIndex: number): { fromIndex: number; toIndex: number } | null {
    const n = this.cols.length;
    if (fromIndex < 0 || fromIndex >= n || toIndex < 0 || toIndex >= n || fromIndex === toIndex) {
      return null;
    }
    const [moved] = this.cols.splice(fromIndex, 1);
    this.cols.splice(toIndex, 0, moved!);
    return { fromIndex, toIndex };
  }

  /** Move a column identified by id before/after another column id. */
  moveBefore(id: string, beforeId: string): { fromIndex: number; toIndex: number } | null {
    const from = this.find(id);
    const before = this.find(beforeId);
    if (!from || !before) return null;
    // Account for the splice shift when moving rightward.
    const target = from.index < before.index ? before.index - 1 : before.index;
    return this.move(from.index, target);
  }

  /**
   * Auto-size a column to fit its content. The engine supplies a `measure`
   * callback (it owns the DOM/canvas text metrics); we just clamp + persist.
   */
  autoSize(id: string, measure: (def: ColumnDef<Row>) => number, padding = 24): number {
    const hit = this.find(id);
    if (!hit) return 0;
    const content = Math.ceil(measure(hit.def)) + padding;
    return this.setWidth(id, content);
  }

  /**
   * Resolve current columns into geometry for an available width. Performs the
   * frozen left/right split, flex distribution over the remaining space, and
   * computes per-region left offsets.
   */
  resolve(availableWidth: number): ColumnLayout<Row> {
    const visible = this.getVisible();

    const left: ColumnDef<Row>[] = [];
    const center: ColumnDef<Row>[] = [];
    const right: ColumnDef<Row>[] = [];
    for (const def of visible) {
      if (def.frozen === 'left') left.push(def);
      else if (def.frozen === 'right') right.push(def);
      else center.push(def);
    }

    // Base widths (explicit/override/default) for non-flex columns; flex columns
    // get their min as a base and share leftover space.
    const baseWidth = (def: ColumnDef<Row>, id: string): number => {
      const override = this.widths.get(id);
      if (override != null) return clampWidth(def, override);
      if (def.flex != null && def.flex > 0) return def.minWidth ?? DEFAULT_MIN_WIDTH;
      return clampWidth(def, def.width ?? DEFAULT_COLUMN_WIDTH);
    };

    // Sum fixed (non-flex, all regions) to know how much is left for flex.
    let fixedTotal = 0;
    const flexCols: { def: ColumnDef<Row>; id: string; flex: number }[] = [];
    visible.forEach((def, i) => {
      const id = columnId(def, this.sourceIndexOf(def, i));
      const hasOverride = this.widths.get(id) != null;
      if (!hasOverride && def.flex != null && def.flex > 0) {
        flexCols.push({ def, id, flex: def.flex });
        fixedTotal += def.minWidth ?? DEFAULT_MIN_WIDTH;
      } else {
        fixedTotal += baseWidth(def, id);
      }
    });

    const leftover = Math.max(0, availableWidth - fixedTotal);
    const flexTotal = flexCols.reduce((s, c) => s + c.flex, 0);
    const flexExtra = new Map<string, number>();
    if (flexTotal > 0 && leftover > 0) {
      for (const c of flexCols) {
        flexExtra.set(c.id, (leftover * c.flex) / flexTotal);
      }
    }

    const widthOf = (def: ColumnDef<Row>, id: string): number => {
      const base = baseWidth(def, id);
      const extra = flexExtra.get(id) ?? 0;
      return clampWidth(def, base + extra);
    };

    let visualIndex = 0;
    const build = (defs: ColumnDef<Row>[], region: FrozenSide | null): ResolvedColumn<Row>[] => {
      let x = 0;
      return defs.map((def) => {
        const srcIndex = this.cols.indexOf(def);
        const id = columnId(def, srcIndex < 0 ? visualIndex : srcIndex);
        const width = widthOf(def, id);
        const resolved: ResolvedColumn<Row> = {
          def,
          id,
          index: visualIndex++,
          sourceIndex: srcIndex,
          width,
          left: x,
          align: def.align ?? defaultAlign(def),
          frozen: region,
        };
        x += width;
        return resolved;
      });
    };

    const leftR = build(left, 'left');
    const centerR = build(center, null);
    const rightR = build(right, 'right');

    const sum = (r: ResolvedColumn<Row>[]) => r.reduce((s, c) => s + c.width, 0);
    return {
      left: leftR,
      center: centerR,
      right: rightR,
      all: [...leftR, ...centerR, ...rightR],
      leftWidth: sum(leftR),
      centerWidth: sum(centerR),
      rightWidth: sum(rightR),
    };
  }

  private sourceIndexOf(def: ColumnDef<Row>, fallback: number): number {
    const i = this.cols.indexOf(def);
    return i < 0 ? fallback : i;
  }
}

/** Default alignment by type: numbers right-aligned, checks centered, else start. */
function defaultAlign<Row extends Model>(def: ColumnDef<Row>): 'start' | 'center' | 'end' {
  if (def.type === 'number') return 'end';
  if (def.type === 'check' || def.type === 'action') return 'center';
  return 'start';
}
