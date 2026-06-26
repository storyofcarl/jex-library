/**
 * ColumnFeature — a `GridFeature` plugin that gives the engine user-driven column
 * operations (resize, reorder, hide/show, freeze, auto-width) on top of the
 * `ColumnModel`. It talks to the engine ONLY through `GridApi` (per the contract):
 * it reads `api.columns`, applies changes via `api.setColumns`/`api.updateColumn`,
 * and emits the contract `columnResize`/`columnReorder` events.
 *
 * The actual pointer/drag DOM wiring lives in the engine (it owns the header DOM);
 * this feature exposes the imperative operations + state the engine calls into,
 * keeping the geometry math here and decoupled.
 */

import type { Model } from '@jects/core';
import type { ColumnDef, FrozenSide, GridApi, GridFeature } from '../contract.js';
import { ColumnModel, columnId, type ColumnLayout } from './column-model.js';

/** Config for the column feature. */
export interface ColumnFeatureConfig {
  /** Allow resizing globally (per-column `resizable` still applies). Default true. */
  resize?: boolean;
  /** Allow reordering globally (per-column `reorderable` still applies). Default true. */
  reorder?: boolean;
  /** Padding (px) added when auto-sizing to content. Default 24. */
  autoSizePadding?: number;
}

export class ColumnFeature<Row extends Model = Model> implements GridFeature<Row> {
  readonly name = 'columns';
  private api!: GridApi<Row>;
  private model!: ColumnModel<Row>;
  private cfg: Required<ColumnFeatureConfig>;

  constructor(config: ColumnFeatureConfig = {}) {
    this.cfg = {
      resize: config.resize ?? true,
      reorder: config.reorder ?? true,
      autoSizePadding: config.autoSizePadding ?? 24,
    };
  }

  init(api: GridApi<Row>): void {
    this.api = api;
    this.model = new ColumnModel<Row>([...api.columns]);
  }

  /** The backing column model (for the engine / tests). */
  getModel(): ColumnModel<Row> {
    return this.model;
  }

  /** Resolve geometry for an available width (frozen split + flex). */
  layout(availableWidth: number): ColumnLayout<Row> {
    return this.model.resolve(availableWidth);
  }

  /** Resize a column; clamps, persists, emits `columnResize`, repaints. */
  resize(id: string, width: number): number {
    if (!this.cfg.resize) return width;
    const col = this.find(id);
    if (col && col.resizable === false) return width;
    const w = this.model.setWidth(id, width);
    this.commit();
    this.api.emit('columnResize', { columnId: id, width: w });
    return w;
  }

  /** Reorder a column from one display index to another; emits `columnReorder`. */
  reorder(fromIndex: number, toIndex: number): boolean {
    if (!this.cfg.reorder) return false;
    const before = this.model.getColumns();
    const moving = before[fromIndex];
    if (moving && moving.reorderable === false) return false;
    const res = this.model.move(fromIndex, toIndex);
    if (!res) return false;
    this.commit();
    this.api.emit('columnReorder', {
      columnId: columnId(moving!, fromIndex),
      fromIndex: res.fromIndex,
      toIndex: res.toIndex,
    });
    return true;
  }

  /** Move a column to sit before another column (by id). */
  reorderBefore(id: string, beforeId: string): boolean {
    if (!this.cfg.reorder) return false;
    const res = this.model.moveBefore(id, beforeId);
    if (!res) return false;
    this.commit();
    this.api.emit('columnReorder', { columnId: id, fromIndex: res.fromIndex, toIndex: res.toIndex });
    return true;
  }

  /** Hide/show a column. */
  setHidden(id: string, hidden: boolean): void {
    this.model.setHidden(id, hidden);
    this.commit();
  }

  /** Toggle a column's visibility; returns new hidden state. */
  toggleHidden(id: string): boolean {
    const next = this.model.toggleHidden(id);
    this.commit();
    return next;
  }

  /** Pin/unpin a column to an edge. */
  setFrozen(id: string, frozen: FrozenSide | null): void {
    this.model.setFrozen(id, frozen);
    this.commit();
  }

  /** Auto-size a column using an engine-supplied content measurer. */
  autoSize(id: string, measure: (def: ColumnDef<Row>) => number): number {
    const col = this.find(id);
    if (col && col.resizable === false) return col.width ?? 0;
    const w = this.model.autoSize(id, measure, this.cfg.autoSizePadding);
    this.commit();
    this.api.emit('columnResize', { columnId: id, width: w });
    return w;
  }

  destroy(): void {
    // No persistent listeners/DOM owned here; the engine owns header DOM.
  }

  private find(id: string): ColumnDef<Row> | undefined {
    return this.model.find(id)?.def;
  }

  /** Push the model's column defs back to the engine + repaint. */
  private commit(): void {
    this.api.setColumns([...this.model.getColumns()]);
    this.api.invalidateLayout();
    this.api.refresh();
  }
}

/** Factory helper. */
export function columnFeature<Row extends Model = Model>(
  config?: ColumnFeatureConfig,
): ColumnFeature<Row> {
  return new ColumnFeature<Row>(config);
}
