/**
 * SummaryFeature — a footer summary row for @jects/grid.
 *
 * Standalone grand-total footer (works without grouping). Renders a sticky
 * footer row beneath the grid body with per-column aggregates
 * (`sum | avg | min | max | count` or custom reducers) over the current
 * filtered view, recomputed on data/filter changes. If a `GroupFeature` is
 * installed it can defer to that feature's `getFooter()`; otherwise it computes
 * its own.
 */

import type { Model } from '@jects/core';
import { createEl } from '@jects/core';
import type { GridApi, GridFeature } from '../contract.js';
import {
  type AggregatorSpec,
  type SummaryRow,
  computeAggregate,
} from './group.js';
import { Disposers, colId, escapeHtml, readRows } from './shared.js';

export interface SummaryFeatureOptions<Row extends Model = Model> {
  /** Per-column aggregator specs (column id → kind/reducer). */
  aggregations: Record<string, AggregatorSpec<Row>>;
  /** Format an aggregate for display. Default: `String`, `''` for null. */
  format?: (value: unknown, columnId: string) => string;
  /** Label shown in the first cell. Default `'Total'`. */
  label?: string;
}

const defaultFormat = (value: unknown): string =>
  value == null
    ? ''
    : typeof value === 'number'
      ? Number.isInteger(value)
        ? String(value)
        : value.toFixed(2)
      : String(value);

export class SummaryFeature<Row extends Model = Model> implements GridFeature<Row> {
  readonly name = 'summary';

  private api!: GridApi<Row>;
  private readonly disposers = new Disposers();
  private root: HTMLElement | null = null;
  private readonly aggregations: Record<string, AggregatorSpec<Row>>;
  private readonly format: (value: unknown, columnId: string) => string;
  private readonly label: string;
  private current: SummaryRow = {};

  constructor(options: SummaryFeatureOptions<Row>) {
    this.aggregations = { ...options.aggregations };
    this.format = options.format ?? defaultFormat;
    this.label = options.label ?? 'Total';
  }

  init(grid: GridApi<Row>): void {
    this.api = grid;
    grid.track(() => this.disposers.dispose());

    this.root = createEl('div', { className: 'jects-grid-summary' });
    this.root.setAttribute('role', 'row');
    this.root.setAttribute('aria-label', 'Summary');
    grid.el.appendChild(this.root);
    this.disposers.add(() => {
      this.root?.remove();
      this.root = null;
    });

    const recompute = (): void => {
      this.recompute();
      this.render();
    };
    const offChange = grid.store.events.on('change', recompute);
    this.disposers.add(offChange);
    const offFilter = grid.on('filterChange', recompute);
    this.disposers.add(offFilter);

    this.recompute();
    this.render();
  }

  /** Current computed aggregates keyed by column id. */
  getSummary(): SummaryRow {
    return { ...this.current };
  }

  /** Aggregate for a single column id. */
  valueOf(columnId: string): unknown {
    return this.current[columnId];
  }

  /** Recompute aggregates over the current view (or defer to GroupFeature). */
  recompute(): void {
    const group = this.api.features.get('group') as
      | { getFooter?: () => SummaryRow }
      | undefined;
    if (group && typeof group.getFooter === 'function') {
      // Reuse the group feature's grand-total footer when available.
      const footer = group.getFooter();
      // Only adopt keys this summary actually tracks.
      const out: SummaryRow = {};
      for (const key of Object.keys(this.aggregations)) {
        out[key] = key in footer ? footer[key] : this.computeOne(key);
      }
      this.current = out;
      return;
    }
    const out: SummaryRow = {};
    for (const key of Object.keys(this.aggregations)) out[key] = this.computeOne(key);
    this.current = out;
  }

  private computeOne(columnId: string): unknown {
    const rows = readRows(this.api);
    const column = this.api.getColumn(columnId);
    return computeAggregate(rows, column, this.aggregations[columnId]!);
  }

  private render(): void {
    if (!this.root) return;
    const cells: string[] = [];
    let first = true;
    for (const column of this.api.columns) {
      if (column.hidden) continue;
      const id = colId(column);
      const width =
        column.width != null ? `flex:0 0 ${column.width}px` : 'flex:1 1 0';
      const align = column.align ?? (column.type === 'number' ? 'end' : 'start');
      const hasAgg = id in this.aggregations;
      const text = hasAgg
        ? this.format(this.current[id], id)
        : first
          ? this.label
          : '';
      cells.push(
        [
          `<div class="jects-grid-summary__cell jects-grid-summary__cell--${align}" `,
          `style="${width}">`,
          escapeHtml(text),
          `</div>`,
        ].join(''),
      );
      first = false;
    }
    this.root.innerHTML = cells.join('');
  }

  /** The footer root element. */
  get element(): HTMLElement | null {
    return this.root;
  }

  destroy(): void {
    this.disposers.dispose();
    this.current = {};
  }
}

/** Convenience factory. */
export function summaryFeature<Row extends Model = Model>(
  options: SummaryFeatureOptions<Row>,
): SummaryFeature<Row> {
  return new SummaryFeature<Row>(options);
}
