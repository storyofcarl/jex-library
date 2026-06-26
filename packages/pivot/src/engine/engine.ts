/**
 * PivotEngine — framework-free cross-tab aggregation over a flat dataset.
 *
 * Given a flat array of rows and a field configuration (`rows`/`columns`/
 * `values`/`filters`), it produces a {@link PivotResult}: a hierarchical (tree)
 * or flattened (flat) matrix of aggregated cells, with optional grand totals
 * and per-axis subtotals.
 *
 * The engine is pure DOM-free logic so it is fully unit-testable. The
 * {@link PivotTable} widget consumes a `PivotResult` and projects it onto
 * @jects/grid columns/rows.
 */

import type { Model } from '@jects/core';
import {
  AggregatorRegistry,
  AGGREGATOR_LABELS,
  type Aggregator,
  type AggregatorName,
} from './aggregators.js';

/** A field placed on the row or column axis. */
export interface PivotField<Row extends Model = Model> {
  /** Path into the row model. */
  field: keyof Row & string;
  /** Display label. Defaults to `field`. */
  label?: string;
  /** Sort direction for this field's members. Default `'asc'`. */
  sort?: 'asc' | 'desc' | 'none';
  /** Custom member formatter (header label for a member value). */
  format?: (value: unknown) => string;
}

/** A value field with an aggregation. */
export interface PivotValue<Row extends Model = Model> {
  /** Path into the row model holding the measure. */
  field: keyof Row & string;
  /** Aggregation to apply. A registered name or an inline reducer. */
  aggregator?: AggregatorName | string | Aggregator;
  /** Display label. Defaults to "<Agg> of <field>". */
  label?: string;
  /** Number formatter for cell values (locale-aware). */
  format?: (value: number | null) => string;
}

/** A filter directive restricting the source rows before pivoting. */
export interface PivotFilter<Row extends Model = Model> {
  /** Path into the row model. */
  field: keyof Row & string;
  /** Comparison operator. Default `'in'` when `values` is given, else `'eq'`. */
  operator?: PivotFilterOperator;
  /** Operand for scalar operators. */
  value?: unknown;
  /** Allow-list of member values (for `in` / `notin`). */
  values?: unknown[];
}

export type PivotFilterOperator =
  | 'eq'
  | 'ne'
  | 'lt'
  | 'lte'
  | 'gt'
  | 'gte'
  | 'in'
  | 'notin'
  | 'contains'
  | 'empty'
  | 'notempty';

/** Which totals to compute. */
export interface PivotTotals {
  /** Grand total cell (bottom-right). Default `true`. */
  grand?: boolean;
  /** Per-row-group totals column. Default `true`. */
  rows?: boolean;
  /** Per-column-group totals row. Default `true`. */
  columns?: boolean;
}

/** Pivot output layout. `tree` keeps the grouping hierarchy; `flat` flattens it. */
export type PivotMode = 'tree' | 'flat';

/**
 * Collapse state for the row/column header trees. A node is collapsed (its
 * descendants pruned from the output) when its identity `key` appears in
 * `rows`/`columns`, OR when its depth is at/below the matching `expandLevel`
 * (an `expandLevel` of `0` collapses everything below the top level; omit it —
 * or use a negative value — to leave every node expanded by default).
 *
 * Collapsing a node keeps the node itself (and, in tree mode, its subtotal
 * cell, which already aggregates the whole subtree) but stops the engine from
 * emitting its children — so totals always reconcile with the expanded view.
 */
export interface PivotCollapse {
  /** Collapsed row-node identity keys. */
  rows?: Iterable<string>;
  /** Collapsed column-node identity keys. */
  columns?: Iterable<string>;
  /** Auto-collapse every row node deeper than this depth (0-based). */
  rowExpandLevel?: number;
  /** Auto-collapse every column node deeper than this depth (0-based). */
  columnExpandLevel?: number;
}

/** Full pivot configuration. */
export interface PivotConfig<Row extends Model = Model> {
  rows?: Array<PivotField<Row> | (keyof Row & string)>;
  columns?: Array<PivotField<Row> | (keyof Row & string)>;
  values?: Array<PivotValue<Row> | (keyof Row & string)>;
  filters?: PivotFilter<Row>[];
  /** Tree (hierarchical) or flat output. Default `'tree'`. */
  mode?: PivotMode;
  /** Totals configuration (or `false` to disable all). */
  totals?: PivotTotals | boolean;
  /** Custom aggregator registry (defaults to a fresh one with built-ins). */
  aggregators?: AggregatorRegistry;
  /** Per-node expand/collapse state for the row/column header trees. */
  collapse?: PivotCollapse;
}

/* ── Result shapes ──────────────────────────────────────────────────────── */

/** A node in the row or column header tree. */
export interface PivotAxisNode {
  /** The member value at this level. */
  value: unknown;
  /** Display label for the member. */
  label: string;
  /** Field id this level groups by. */
  field: string;
  /** Nesting depth (0 = top level). */
  depth: number;
  /** Path of member keys from the root to this node (joined identity). */
  path: string[];
  /** Stable identity key. */
  key: string;
  /** Child nodes (empty at leaf level). */
  children: PivotAxisNode[];
  /** Whether this node is a totals/subtotal node. */
  isTotal?: boolean;
  /**
   * Whether this node is collapsed — it has children in the source data but
   * the engine pruned them from the output. A collapsed node still renders a
   * toggle affordance so consumers can expand it again. Absent for leaf nodes
   * (nothing to collapse) and for expanded interior nodes.
   */
  collapsed?: boolean;
}

/** A leaf column descriptor in the flattened output matrix. */
export interface PivotColumnLeaf {
  /** Column header path (member labels per column field). */
  path: string[];
  /** Column member key path (identity). */
  keyPath: string[];
  /** Index of the value field this leaf represents. */
  valueIndex: number;
  /** Value field label. */
  valueLabel: string;
  /** Source field id of the value measure (`undefined` for count-only leaves). */
  valueField?: string;
  /** Stable identity for the leaf. */
  key: string;
  /** Whether this leaf is a (column) grand-total. */
  isTotal?: boolean;
}

/** One materialized output row of the pivot matrix. */
export interface PivotMatrixRow {
  /** Row header member labels (one per row field), padded for subtotal rows. */
  headers: string[];
  /** Row member key path. */
  keyPath: string[];
  /** Nesting depth of the row (for tree-mode indentation). */
  depth: number;
  /** Whether this row is a subtotal/grand-total row. */
  isTotal?: boolean;
  /**
   * Whether this row's tree node is collapsible — i.e. it has children in the
   * source data (so a toggle should render). Combined with `collapsed`.
   */
  collapsible?: boolean;
  /** Whether this row's tree node is currently collapsed (children pruned). */
  collapsed?: boolean;
  /** Identity key of this row's tree node (for collapse toggles). */
  nodeKey?: string;
  /** Aggregated cell values keyed by column-leaf key. */
  cells: Record<string, number | null>;
}

/** The fully computed pivot result. */
export interface PivotResult {
  /** The row header tree (hierarchical members). */
  rowTree: PivotAxisNode[];
  /** The column header tree (hierarchical members). */
  columnTree: PivotAxisNode[];
  /** Flattened, ordered column leaves (one per column member × value field). */
  columnLeaves: PivotColumnLeaf[];
  /** Materialized matrix rows in display order. */
  matrix: PivotMatrixRow[];
  /** Resolved value field labels (index-aligned with the config). */
  valueLabels: string[];
  /** Number of row-axis fields. */
  rowFieldCount: number;
  /** Number of column-axis fields. */
  columnFieldCount: number;
  /** Whether a grand-total row is present (last matrix row). */
  hasGrandTotalRow: boolean;
}

/* ── Internal normalization ─────────────────────────────────────────────── */

function normField<Row extends Model>(
  f: PivotField<Row> | (keyof Row & string),
): Required<Pick<PivotField<Row>, 'field'>> & PivotField<Row> {
  if (typeof f === 'string') return { field: f, sort: 'asc' };
  return { sort: 'asc', ...f };
}

function normValue<Row extends Model>(
  v: PivotValue<Row> | (keyof Row & string),
): PivotValue<Row> {
  if (typeof v === 'string') return { field: v, aggregator: 'sum' };
  return { aggregator: 'sum', ...v };
}

function normTotals(t: PivotTotals | boolean | undefined): Required<PivotTotals> {
  if (t === false) return { grand: false, rows: false, columns: false };
  if (t === true || t === undefined) return { grand: true, rows: true, columns: true };
  return { grand: t.grand ?? true, rows: t.rows ?? true, columns: t.columns ?? true };
}

/** Read a (dotted-or-plain) field path from a row. */
export function readField(row: Model, field: string): unknown {
  if (field.indexOf('.') === -1) return row[field];
  let cur: unknown = row;
  for (const part of field.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

/** Stable string key for a member value (distinguishes types & null). */
function memberKey(value: unknown): string {
  if (value == null) return ' null';
  if (value instanceof Date) return `d:${value.getTime()}`;
  return `${typeof value}:${String(value)}`;
}

function defaultLabel(value: unknown): string {
  if (value == null) return '(blank)';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value);
}

/* ── Filtering ──────────────────────────────────────────────────────────── */

function matchFilter(row: Model, filter: PivotFilter): boolean {
  const v = readField(row, filter.field);
  const op =
    filter.operator ?? (filter.values !== undefined ? 'in' : 'eq');
  switch (op) {
    case 'eq':
      return v === filter.value;
    case 'ne':
      return v !== filter.value;
    case 'lt':
      return cmp(v, filter.value) < 0;
    case 'lte':
      return cmp(v, filter.value) <= 0;
    case 'gt':
      return cmp(v, filter.value) > 0;
    case 'gte':
      return cmp(v, filter.value) >= 0;
    case 'in':
      return (filter.values ?? []).includes(v);
    case 'notin':
      return !(filter.values ?? []).includes(v);
    case 'contains':
      return String(v ?? '')
        .toLowerCase()
        .includes(String(filter.value ?? '').toLowerCase());
    case 'empty':
      return v == null || v === '';
    case 'notempty':
      return v != null && v !== '';
    default:
      return true;
  }
}

function cmp(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  return String(a).localeCompare(String(b));
}

/* ── The engine ─────────────────────────────────────────────────────────── */

/**
 * The pivot computation engine. Construct with the source data; call
 * {@link compute} with a {@link PivotConfig} to obtain a {@link PivotResult}.
 * Data and config can be swapped with {@link setData} / re-calling `compute`.
 */
export class PivotEngine<Row extends Model = Model> {
  private data: Row[];
  /** Default registry used when a config doesn't supply its own. */
  readonly aggregators: AggregatorRegistry;

  constructor(data: Row[] = [], aggregators?: AggregatorRegistry) {
    this.data = data.slice();
    this.aggregators = aggregators ?? new AggregatorRegistry();
  }

  /** Replace the source dataset. */
  setData(data: Row[]): this {
    this.data = data.slice();
    return this;
  }

  /** The current source dataset. */
  getData(): readonly Row[] {
    return this.data;
  }

  /** Register a custom aggregator on the engine's default registry. */
  addMathMethod(name: string, fn: Aggregator): this {
    this.aggregators.add(name, fn);
    return this;
  }

  /** Resolve a value field's aggregator function. */
  private resolveAggregator(
    spec: PivotValue<Row>['aggregator'],
    registry: AggregatorRegistry,
  ): Aggregator {
    if (typeof spec === 'function') return spec;
    const name = spec ?? 'sum';
    const fn = registry.get(name);
    if (!fn) {
      throw new Error(`[pivot] unknown aggregator "${name}"`);
    }
    return fn;
  }

  private valueLabel(v: PivotValue<Row>): string {
    if (v.label) return v.label;
    const agg = typeof v.aggregator === 'function' ? 'custom' : v.aggregator ?? 'sum';
    const aggLabel = AGGREGATOR_LABELS[agg as AggregatorName] ?? capitalize(String(agg));
    return `${aggLabel} of ${v.field}`;
  }

  /**
   * Compute the pivot for the given configuration.
   */
  compute(config: PivotConfig<Row> = {}): PivotResult {
    const registry = config.aggregators ?? this.aggregators;
    const rowFields = (config.rows ?? []).map(normField);
    const colFields = (config.columns ?? []).map(normField);
    const valueSpecs = (config.values ?? []).map(normValue);
    const totals = normTotals(config.totals);
    const mode: PivotMode = config.mode ?? 'tree';

    // Apply filters.
    const filters = config.filters ?? [];
    const rows =
      filters.length === 0
        ? this.data
        : this.data.filter((r) => filters.every((f) => matchFilter(r, f as PivotFilter)));

    const valueLabels = valueSpecs.map((v) => this.valueLabel(v));
    const aggregators = valueSpecs.map((v) => this.resolveAggregator(v.aggregator, registry));

    // Build the member trees for both axes.
    const rowTree = buildAxisTree(rows, rowFields);
    const columnTree = buildAxisTree(rows, colFields);

    // Resolve collapse state and stamp `collapsed` onto interior nodes whose
    // descendants will be pruned from the output.
    const rowCollapsed = makeCollapsePredicate(config.collapse?.rows, config.collapse?.rowExpandLevel);
    const colCollapsed = makeCollapsePredicate(
      config.collapse?.columns,
      config.collapse?.columnExpandLevel,
    );
    markCollapsed(rowTree, rowCollapsed);
    markCollapsed(columnTree, colCollapsed);

    // Flatten column leaves: each column-member leaf × each value field. Pruned
    // by the column collapse set (children of a collapsed column node are not
    // emitted; the collapsed node itself becomes the leaf).
    const columnLeaves = this.buildColumnLeaves(columnTree, colFields, valueSpecs, valueLabels, totals);

    // Build matrix rows.
    const matrix = this.buildMatrix(
      rows,
      rowTree,
      rowFields,
      colFields,
      valueSpecs,
      aggregators,
      columnLeaves,
      totals,
      mode,
    );

    return {
      rowTree,
      columnTree,
      columnLeaves,
      matrix,
      valueLabels,
      rowFieldCount: rowFields.length,
      columnFieldCount: colFields.length,
      hasGrandTotalRow: totals.grand && matrix.length > 0 && !!matrix[matrix.length - 1]!.isTotal,
    };
  }

  /** Flatten the column header tree into ordered leaves (× value fields). */
  private buildColumnLeaves(
    columnTree: PivotAxisNode[],
    colFields: PivotField<Row>[],
    valueSpecs: PivotValue<Row>[],
    valueLabels: string[],
    totals: Required<PivotTotals>,
  ): PivotColumnLeaf[] {
    const leaves: PivotColumnLeaf[] = [];
    const valueCount = Math.max(valueSpecs.length, 1);
    const hasValues = valueSpecs.length > 0;

    const emitLeaf = (
      labels: string[],
      keyPath: string[],
      isTotal: boolean,
    ): void => {
      for (let vi = 0; vi < valueCount; vi++) {
        leaves.push({
          path: labels,
          keyPath,
          valueIndex: hasValues ? vi : -1,
          valueLabel: hasValues ? valueLabels[vi]! : 'Value',
          ...(hasValues ? { valueField: valueSpecs[vi]!.field } : {}),
          key: `${keyPath.join('')}${vi}${isTotal ? 'T' : ''}`,
          ...(isTotal ? { isTotal: true } : {}),
        });
      }
    };

    if (colFields.length === 0) {
      // No column fields: a single (implicit) column group per value field.
      emitLeaf([], [], false);
      return leaves;
    }

    // Walk to the leaves of the column tree, accumulating member labels per
    // depth so each leaf carries its full header label path. A collapsed node
    // is treated as a leaf — its descendants are not emitted (the collapsed
    // node's own aggregate becomes the column).
    const stackWalk = (nodes: PivotAxisNode[], labels: string[]): void => {
      for (const node of nodes) {
        const nextLabels = [...labels, node.label];
        if (node.children.length > 0 && !node.collapsed) {
          stackWalk(node.children, nextLabels);
        } else {
          emitLeaf(nextLabels, node.path, false);
        }
      }
    };
    stackWalk(columnTree, []);

    // Column grand total leaves (right-most), if enabled.
    if (totals.columns) {
      emitLeaf(['Total'], ['total'], true);
    }
    return leaves;
  }

  /**
   * Build the materialized matrix rows.
   *
   * Performance: rather than re-`.filter`ing the dataset per (row-node x
   * column-leaf) — which is O(rows x leaves x depth) and quadratic on large
   * inputs — this buckets every source row ONCE into a {@link PivotCube} keyed
   * by (row-key-prefix, column-key-prefix). Each emitted cell then reads its
   * pre-collected raw values straight from the cube and aggregates them. The
   * single bucketing pass is O(rows x rowDepth x colDepth) (depths are tiny),
   * so a 100k-row pivot stays linear in the row count.
   */
  private buildMatrix(
    allRows: Row[],
    rowTree: PivotAxisNode[],
    rowFields: PivotField<Row>[],
    colFields: PivotField<Row>[],
    valueSpecs: PivotValue<Row>[],
    aggregators: Aggregator[],
    columnLeaves: PivotColumnLeaf[],
    totals: Required<PivotTotals>,
    mode: PivotMode,
  ): PivotMatrixRow[] {
    const out: PivotMatrixRow[] = [];
    const hasValues = valueSpecs.length > 0;
    const valueCount = hasValues ? valueSpecs.length : 1;

    // Reduce each value field for a bucket once (count-only when no values).
    const countAgg: Aggregator = (vals) => vals.length;
    const aggregateBucket = (values: unknown[][]): (number | null)[] => {
      const result: (number | null)[] = [];
      for (let vi = 0; vi < valueCount; vi++) {
        const agg = hasValues ? aggregators[vi]! : countAgg;
        result.push(agg(values[vi]!));
      }
      return result;
    };

    // Single pass: bucket the dataset by every (row-prefix, col-prefix) combo.
    const cube = buildCube(allRows, rowFields, colFields, valueSpecs, valueCount);

    // Resolve a single cell value from the cube for a row-prefix x column leaf.
    const cellValue = (
      rowKey: string,
      leaf: PivotColumnLeaf,
      cache: Map<string, (number | null)[]>,
    ): number | null => {
      const colKey = leaf.isTotal || colFields.length === 0 ? '' : leaf.keyPath.join(CUBE_SEP);
      const bucketKey = `${rowKey}${CUBE_AXIS_SEP}${colKey}`;
      let aggregated = cache.get(bucketKey);
      if (!aggregated) {
        const bucket = cube.get(bucketKey);
        aggregated = bucket ? aggregateBucket(bucket) : emptyAggregate(valueCount);
        cache.set(bucketKey, aggregated);
      }
      const vi = hasValues ? leaf.valueIndex : 0;
      return aggregated[vi] ?? null;
    };

    // Compute every column-leaf cell for one row-prefix (cube key path).
    const computeCells = (rowKey: string): Record<string, number | null> => {
      const cells: Record<string, number | null> = {};
      // Cache the per-bucket aggregation so multiple value-field leaves sharing
      // the same column member reuse one reduce.
      const cache = new Map<string, (number | null)[]>();
      for (const leaf of columnLeaves) {
        cells[leaf.key] = cellValue(rowKey, leaf, cache);
      }
      return cells;
    };

    if (rowFields.length === 0) {
      // Single (grand) row spanning the whole dataset (empty row prefix).
      out.push({
        headers: padHeaders(['Total'], 1),
        keyPath: [],
        depth: 0,
        cells: computeCells(''),
      });
      return out;
    }

    // Walk the row tree emitting rows, pruning the children of collapsed nodes.
    const emit = (nodes: PivotAxisNode[], labels: string[]): void => {
      for (const node of nodes) {
        const nextLabels = [...labels, node.label];
        const isLeaf = node.children.length === 0;
        const isCollapsed = !!node.collapsed;
        const rowKey = node.path.join(CUBE_SEP);
        if (mode === 'flat' && !isCollapsed) {
          if (isLeaf) {
            out.push({
              headers: padHeaders(nextLabels, rowFields.length),
              keyPath: node.path,
              depth: node.depth,
              cells: computeCells(rowKey),
            });
          } else {
            emit(node.children, nextLabels);
          }
        } else {
          // tree mode (or a collapsed flat group): emit a row for every node
          // (group + leaves), with subtotals. A collapsed group keeps its
          // subtotal cell (the cube already aggregates the whole subtree) but
          // does not emit its descendants.
          const isGroup = !isLeaf;
          out.push({
            headers: padHeaders(nextLabels, rowFields.length),
            keyPath: node.path,
            depth: node.depth,
            ...(isGroup ? { collapsible: true, collapsed: isCollapsed, nodeKey: node.key } : {}),
            ...(isGroup && totals.rows ? { isTotal: true } : {}),
            cells: computeCells(rowKey),
          });
          if (isGroup && !isCollapsed) emit(node.children, nextLabels);
        }
      }
    };
    emit(rowTree, []);

    // Grand total row (spans the whole dataset -> the empty row-prefix bucket).
    if (totals.grand) {
      out.push({
        headers: padHeaders(['Grand Total'], rowFields.length),
        keyPath: ['grand'],
        depth: 0,
        isTotal: true,
        cells: computeCells(''),
      });
    }

    return out;
  }
}

/* -- Cube bucketing (single-pass aggregation source) -- */

/** Separator between member keys within one axis path inside a cube key. */
const CUBE_SEP = '';
/** Separator between the row-prefix and column-prefix halves of a cube key. */
const CUBE_AXIS_SEP = '';

/**
 * Per-bucket raw values: one array per value field (so non-decomposable
 * aggregates like average/median/stddev see every underlying value). The cube
 * maps the (row-prefix + col-prefix) key to such a bucket.
 */
type PivotCube = Map<string, unknown[][]>;

/** A fresh aggregate array of all-null cells (for an absent bucket). */
function emptyAggregate(valueCount: number): (number | null)[] {
  return new Array<number | null>(valueCount).fill(null);
}

/**
 * Bucket the dataset once into a cube keyed by every (row-key-prefix,
 * column-key-prefix) combination. Each source row contributes to
 * (rowDepth + 1) x (colDepth + 1) buckets -- including the empty prefixes used
 * by grand/subtotal cells -- so totals reconcile without any re-filtering.
 */
function buildCube<Row extends Model>(
  rows: Row[],
  rowFields: PivotField<Row>[],
  colFields: PivotField<Row>[],
  valueSpecs: PivotValue<Row>[],
  valueCount: number,
): PivotCube {
  const cube: PivotCube = new Map();
  const hasValues = valueSpecs.length > 0;
  const valueFields = hasValues ? valueSpecs.map((v) => v.field) : null;

  for (const row of rows) {
    // The cumulative row/column key prefixes this row falls under ('' = root).
    const rowPrefixes: string[] = [''];
    let acc = '';
    for (const rf of rowFields) {
      const mk = memberKey(readField(row, rf.field));
      acc = acc === '' ? mk : `${acc}${CUBE_SEP}${mk}`;
      rowPrefixes.push(acc);
    }
    const colPrefixes: string[] = [''];
    acc = '';
    for (const cf of colFields) {
      const mk = memberKey(readField(row, cf.field));
      acc = acc === '' ? mk : `${acc}${CUBE_SEP}${mk}`;
      colPrefixes.push(acc);
    }

    // The raw values to fold in for this row, one per value field (1 = count).
    const cellValues: unknown[] = valueFields ? valueFields.map((f) => readField(row, f)) : [1];

    for (const rp of rowPrefixes) {
      for (const cp of colPrefixes) {
        const key = `${rp}${CUBE_AXIS_SEP}${cp}`;
        let bucket = cube.get(key);
        if (!bucket) {
          bucket = Array.from({ length: valueCount }, () => [] as unknown[]);
          cube.set(key, bucket);
        }
        for (let vi = 0; vi < valueCount; vi++) bucket[vi]!.push(cellValues[vi]);
      }
    }
  }
  return cube;
}

/* ── Collapse state ─────────────────────────────────────────────────────── */

/**
 * Build a predicate deciding whether a tree node (by identity `key` + `depth`)
 * is collapsed. A node is collapsed when its key is in the explicit set OR when
 * its depth is at/beyond `expandLevel` (so children below that level are
 * pruned). A negative/absent `expandLevel` leaves every node expanded.
 */
function makeCollapsePredicate(
  keys: Iterable<string> | undefined,
  expandLevel: number | undefined,
): (node: PivotAxisNode) => boolean {
  const set = keys ? new Set(keys) : null;
  const level = expandLevel ?? -1;
  return (node) =>
    (set !== null && set.has(node.key)) || (level >= 0 && node.depth >= level);
}

/**
 * Stamp `collapsed: true` onto every interior node the predicate collapses (a
 * node with children whose descendants will be pruned). Leaf nodes are never
 * marked. Mutates the tree in place.
 */
function markCollapsed(
  nodes: PivotAxisNode[],
  isCollapsed: (node: PivotAxisNode) => boolean,
): void {
  for (const node of nodes) {
    if (node.children.length > 0) {
      if (isCollapsed(node)) {
        node.collapsed = true;
      } else {
        markCollapsed(node.children, isCollapsed);
      }
    }
  }
}

/* ── Axis tree construction ─────────────────────────────────────────────── */

function buildAxisTree<Row extends Model>(
  rows: Row[],
  fields: PivotField<Row>[],
): PivotAxisNode[] {
  if (fields.length === 0) return [];
  return groupLevel(rows, fields, 0, []);
}

function groupLevel<Row extends Model>(
  rows: Row[],
  fields: PivotField<Row>[],
  depth: number,
  parentPath: string[],
): PivotAxisNode[] {
  const field = fields[depth];
  if (!field) return [];
  const order: unknown[] = [];
  const buckets = new Map<string, Row[]>();
  for (const row of rows) {
    const value = readField(row, field.field);
    const k = memberKey(value);
    let bucket = buckets.get(k);
    if (!bucket) {
      bucket = [];
      buckets.set(k, bucket);
      order.push(value);
    }
    bucket.push(row);
  }

  // Sort members.
  if (field.sort !== 'none') {
    order.sort((a, b) => cmp(a, b) * (field.sort === 'desc' ? -1 : 1));
  }

  const nodes: PivotAxisNode[] = [];
  for (const value of order) {
    const k = memberKey(value);
    const bucket = buckets.get(k)!;
    const path = [...parentPath, k];
    const label = field.format ? field.format(value) : defaultLabel(value);
    nodes.push({
      value,
      label,
      field: field.field,
      depth,
      path,
      key: path.join(''),
      children:
        depth + 1 < fields.length ? groupLevel(bucket, fields, depth + 1, path) : [],
    });
  }
  return nodes;
}

/* ── helpers ────────────────────────────────────────────────────────────── */

function padHeaders(labels: string[], width: number): string[] {
  const out = labels.slice(0, width);
  while (out.length < width) out.push('');
  return out;
}

function capitalize(s: string): string {
  return s ? s[0]!.toUpperCase() + s.slice(1) : s;
}
