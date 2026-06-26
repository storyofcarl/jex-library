/**
 * GroupFeature + summary aggregations for @jects/grid.
 *
 * Groups the current (filtered/sorted) rows by one or more column ids into a
 * collapsible hierarchy and computes per-group aggregations (`GroupSummary`).
 * The flattened, expansion-aware result is exposed as a list of `GroupViewRow`s
 * (group-header rows interleaved with leaf data rows) that an engine renderer
 * consumes. A grand-total footer `Summary` is computed over the whole view.
 *
 * Aggregators: `sum | avg | min | max | count` plus custom reducers. Grouping
 * is a *view-model* concern (it changes which rows render and in what order),
 * so this feature owns the model and emits the contract `groupChange` event;
 * the engine reads `getViewRows()` / `getFooter()` to paint.
 */

import type { Model } from '@jects/core';
import type { ColumnDef, GridApi, GridFeature, GroupState } from '../contract.js';
import type { RowSource } from '../engine/row-model.js';
import { Disposers, getValue, readRows, toNumber } from './shared.js';
import { GroupRowSource } from './group-row-source.js';

/**
 * Optional engine seam a host `GridApi` may expose: install/clear a
 * {@link RowSource} that supplies the visible row list. The keystone `Grid`
 * implements this (delegating to `GridEngine.setRowSource`); test harnesses /
 * minimal hosts may omit it, in which case grouping still computes its view
 * model but cannot drive the body paint.
 */
export interface GroupRowSourceHost<Row extends Model = Model> {
  setRowSource?(source: RowSource<Row> | null): void;
}

/** Built-in aggregation kinds. */
export type AggregatorKind = 'sum' | 'avg' | 'min' | 'max' | 'count';

/** A custom reducer over the rows of a group/footer. */
export type CustomAggregator<Row extends Model> = (rows: Row[], column: ColumnDef<Row>) => unknown;

/** Per-column aggregation spec for group + footer summaries. */
export type AggregatorSpec<Row extends Model> = AggregatorKind | CustomAggregator<Row>;

/** Computed aggregate values for a set of rows, keyed by column id. */
export type SummaryRow = Record<string, unknown>;

/** A node in the grouped view (header or leaf). */
export type GroupViewRow<Row extends Model> =
  | {
      kind: 'group';
      /** Stable key for this group node (path-joined). */
      key: string;
      /** The column id this level groups by. */
      columnId: string;
      /** The shared group value. */
      value: unknown;
      /** Nesting depth (0 = top level). */
      depth: number;
      /** Number of leaf rows under this group (recursive). */
      count: number;
      /** Whether the group is collapsed. */
      collapsed: boolean;
      /** Per-column aggregates for this group. */
      summary: SummaryRow;
    }
  | {
      kind: 'row';
      row: Row;
      depth: number;
      /** Index of this row within the full (ungrouped) view. */
      rowIndex: number;
    };

interface GroupNode<Row extends Model> {
  key: string;
  columnId: string;
  value: unknown;
  depth: number;
  rows: Row[];
  children: GroupNode<Row>[];
}

export interface GroupFeatureOptions<Row extends Model = Model> {
  initial?: GroupState;
  /** Per-column aggregation specs (column id → aggregator). */
  aggregations?: Record<string, AggregatorSpec<Row>>;
  /** Footer (grand total) aggregations; defaults to `aggregations`. */
  footerAggregations?: Record<string, AggregatorSpec<Row>>;
}

export class GroupFeature<Row extends Model = Model> implements GridFeature<Row> {
  readonly name = 'group';

  private api!: GridApi<Row>;
  private readonly disposers = new Disposers();
  private columnIds: string[] = [];
  private readonly collapsed = new Set<string>();
  private aggregations: Record<string, AggregatorSpec<Row>>;
  private footerAggregations: Record<string, AggregatorSpec<Row>> | null;

  private viewRows: GroupViewRow<Row>[] = [];
  private footer: SummaryRow = {};
  private dirty = true;
  private rowSource: GroupRowSource<Row> | null = null;

  constructor(options: GroupFeatureOptions<Row> = {}) {
    this.aggregations = options.aggregations ?? {};
    this.footerAggregations = options.footerAggregations ?? null;
    if (options.initial) {
      this.columnIds = [...options.initial.columnIds];
      for (const k of options.initial.collapsed ?? []) this.collapsed.add(k);
    }
  }

  init(grid: GridApi<Row>): void {
    this.api = grid;
    grid.track(() => this.disposers.dispose());
    // The adapter that feeds our grouped view rows into the engine's row model.
    this.rowSource = new GroupRowSource<Row>(this, grid.store.idField);
    // Re-group whenever the underlying data changes.
    const off = grid.store.events.on('change', () => {
      this.dirty = true;
    });
    this.disposers.add(off);
    // Ensure the row source is torn down with the feature.
    this.disposers.add(() => this.host()?.setRowSource?.(null));

    // Click-to-collapse: a delegated listener on the grid root toggles the group
    // whose header band (or toggle chevron) was activated. Mirrors TreeFeature's
    // self-contained toggle wiring (no edit to the keystone Grid required).
    const onClick = (e: Event): void => this.handleGroupClick(e as MouseEvent);
    grid.el.addEventListener('click', onClick);
    this.disposers.add(() => grid.el.removeEventListener('click', onClick));

    // Keyboard activation (Enter/Space) on the focused toggle button.
    const onKey = (e: Event): void => this.handleGroupKey(e as KeyboardEvent);
    grid.el.addEventListener('keydown', onKey);
    this.disposers.add(() => grid.el.removeEventListener('keydown', onKey));

    this.dirty = true;
    // If grouping was configured with an initial state, drive the body now.
    this.syncRowSource();
  }

  /** Resolve the group key from an activated header band / toggle, or null. */
  private groupKeyFromEvent(e: Event): string | null {
    const target = e.target as HTMLElement | null;
    const band = target?.closest<HTMLElement>('.jects-grid-group-row');
    if (!band) return null;
    return band.dataset['groupKey'] ?? null;
  }

  private handleGroupClick(e: MouseEvent): void {
    const key = this.groupKeyFromEvent(e);
    if (key == null) return;
    e.preventDefault();
    e.stopPropagation();
    this.toggleGroup(key);
  }

  private handleGroupKey(e: KeyboardEvent): void {
    if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
    const target = e.target as HTMLElement | null;
    if (!target?.closest('[data-group-toggle]')) return;
    const key = this.groupKeyFromEvent(e);
    if (key == null) return;
    e.preventDefault();
    this.toggleGroup(key);
  }

  /** The engine row-source seam, if the host exposes it. */
  private host(): GroupRowSourceHost<Row> | undefined {
    const h = this.api as unknown as GroupRowSourceHost<Row>;
    return typeof h.setRowSource === 'function' ? h : undefined;
  }

  /**
   * Install (when grouping is active) or clear (when not) the row-source override
   * so the engine renders our interleaved group-header + leaf view. Invalidating
   * + installing is idempotent; the engine pulls `getViewRows()` lazily on paint.
   */
  private syncRowSource(): void {
    const host = this.host();
    host?.setRowSource?.(this.isActive() ? this.rowSource : null);
  }

  /** Current grouping columns (ordered). */
  getColumns(): string[] {
    return [...this.columnIds];
  }

  /** Whether grouping is active. */
  isActive(): boolean {
    return this.columnIds.length > 0;
  }

  /** Current grouping state. */
  getState(): GroupState {
    return { columnIds: [...this.columnIds], collapsed: [...this.collapsed] };
  }

  /** Replace the group-by columns. */
  setGroups(columnIds: string[]): void {
    this.columnIds = [...columnIds];
    this.dirty = true;
    this.recompute();
    this.syncRowSource();
    this.api.refresh();
    this.emitChange();
  }

  /** Add a column to the end of the group-by list. */
  groupBy(columnId: string): void {
    if (this.columnIds.includes(columnId)) return;
    this.setGroups([...this.columnIds, columnId]);
  }

  /** Remove a column from the group-by list. */
  ungroup(columnId: string): void {
    this.setGroups(this.columnIds.filter((id) => id !== columnId));
  }

  /** Clear all grouping. */
  clear(): void {
    if (this.columnIds.length === 0) return;
    this.columnIds = [];
    this.collapsed.clear();
    this.dirty = true;
    this.recompute();
    this.syncRowSource();
    this.api.refresh();
    this.emitChange();
  }

  /** Set/replace per-column aggregations. */
  setAggregations(agg: Record<string, AggregatorSpec<Row>>): void {
    this.aggregations = { ...agg };
    this.dirty = true;
    this.recompute();
    this.api.refresh();
  }

  /** Collapse / expand a group node by key. */
  toggleGroup(key: string): void {
    if (this.collapsed.has(key)) this.collapsed.delete(key);
    else this.collapsed.add(key);
    this.dirty = true;
    this.recompute();
    // The visible row list changed shape; re-pull it into the engine + repaint.
    this.syncRowSource();
    this.api.refresh();
    this.emitChange();
  }

  isCollapsed(key: string): boolean {
    return this.collapsed.has(key);
  }

  /** The flattened, expansion-aware view rows the renderer paints. */
  getViewRows(): GroupViewRow<Row>[] {
    if (this.dirty) this.recompute();
    return this.viewRows;
  }

  /** Number of view rows (group headers + visible leaves). */
  getViewRowCount(): number {
    return this.getViewRows().length;
  }

  /** Grand-total footer aggregates over the full (filtered) view. */
  getFooter(): SummaryRow {
    if (this.dirty) this.recompute();
    return this.footer;
  }

  private recompute(): void {
    this.dirty = false;
    const rows = readRows(this.api);

    // Footer is computed regardless of grouping (footer Summary always works).
    this.footer = this.aggregate(rows, this.footerAggregations ?? this.aggregations);

    if (this.columnIds.length === 0) {
      this.viewRows = rows.map((row, rowIndex) => ({
        kind: 'row' as const,
        row,
        depth: 0,
        rowIndex,
      }));
      return;
    }

    const tree = this.buildTree(rows, this.columnIds, 0, []);
    this.viewRows = [];
    let rowIndex = 0;
    const emit = (nodes: GroupNode<Row>[]): void => {
      for (const node of nodes) {
        const collapsed = this.collapsed.has(node.key);
        this.viewRows.push({
          kind: 'group',
          key: node.key,
          columnId: node.columnId,
          value: node.value,
          depth: node.depth,
          count: node.rows.length,
          collapsed,
          summary: this.aggregate(node.rows, this.aggregations),
        });
        if (collapsed) continue;
        if (node.children.length) {
          emit(node.children);
        } else {
          for (const row of node.rows) {
            this.viewRows.push({ kind: 'row', row, depth: node.depth + 1, rowIndex: rowIndex++ });
          }
        }
      }
    };
    emit(tree);
  }

  private buildTree(
    rows: Row[],
    columnIds: string[],
    depth: number,
    parentPath: string[],
  ): GroupNode<Row>[] {
    const [columnId, ...rest] = columnIds;
    if (!columnId) return [];
    const column = this.api.getColumn(columnId);

    // Stable grouping: preserve first-seen order of group values.
    const order: unknown[] = [];
    const buckets = new Map<string, Row[]>();
    for (const row of rows) {
      const value = column ? getValue(row, column) : undefined;
      const k = groupKeyOf(value);
      let bucket = buckets.get(k);
      if (!bucket) {
        bucket = [];
        buckets.set(k, bucket);
        order.push(value);
      }
      bucket.push(row);
    }

    const nodes: GroupNode<Row>[] = [];
    for (const value of order) {
      const k = groupKeyOf(value);
      const bucket = buckets.get(k)!;
      const path = [...parentPath, k];
      const key = path.join(' ');
      const node: GroupNode<Row> = {
        key,
        columnId,
        value,
        depth,
        rows: bucket,
        children: rest.length ? this.buildTree(bucket, rest, depth + 1, path) : [],
      };
      nodes.push(node);
    }
    return nodes;
  }

  /** Compute a summary row for `rows` per the aggregator specs. */
  aggregate(rows: Row[], specs: Record<string, AggregatorSpec<Row>>): SummaryRow {
    const out: SummaryRow = {};
    for (const [columnId, spec] of Object.entries(specs)) {
      const column = this.api.getColumn(columnId);
      out[columnId] = computeAggregate(rows, column, spec);
    }
    return out;
  }

  private emitChange(): void {
    this.api.emit('groupChange', { group: this.getState() });
  }

  destroy(): void {
    this.disposers.dispose();
    this.viewRows = [];
    this.footer = {};
    this.collapsed.clear();
  }
}

/** Compute one aggregate value. Exposed for the footer-only `SummaryFeature`. */
export function computeAggregate<Row extends Model>(
  rows: Row[],
  column: ColumnDef<Row> | undefined,
  spec: AggregatorSpec<Row>,
): unknown {
  if (typeof spec === 'function') {
    return column ? spec(rows, column) : spec(rows, { } as ColumnDef<Row>);
  }
  if (spec === 'count') return rows.length;
  if (!column) return null;

  const nums: number[] = [];
  for (const row of rows) {
    const n = toNumber(getValue(row, column));
    if (n != null) nums.push(n);
  }
  switch (spec) {
    case 'sum':
      return nums.reduce((a, b) => a + b, 0);
    case 'avg':
      return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
    case 'min':
      return nums.length ? Math.min(...nums) : null;
    case 'max':
      return nums.length ? Math.max(...nums) : null;
    default:
      return null;
  }
}

function groupKeyOf(value: unknown): string {
  if (value == null) return ' null';
  if (value instanceof Date) return `d:${value.getTime()}`;
  return `${typeof value}:${String(value)}`;
}

/** Convenience factory. */
export function groupFeature<Row extends Model = Model>(
  options?: GroupFeatureOptions<Row>,
): GroupFeature<Row> {
  return new GroupFeature<Row>(options);
}
