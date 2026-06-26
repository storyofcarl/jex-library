/**
 * Row model — the row-index ↔ data bridge for the grid engine.
 *
 * Normalizes the three accepted data sources (raw array, {@link Store},
 * {@link TreeStore}) into a uniform, sortable/filterable view that the engine
 * addresses purely by absolute row index. In tree mode the visible rows are the
 * depth-first expansion from {@link TreeStore.getVisible}; otherwise they are the
 * store's current (filtered/sorted) view.
 *
 * Heights are tracked with a core {@link OffsetIndex} only when variable row
 * heights are enabled; otherwise the fixed-size {@link computeWindow} path is
 * used by the engine and this model only answers count/lookup queries.
 */

import { Store, TreeStore, type Model, type RecordId } from '@jects/core';
import type { GridDataSource } from '../contract.js';

/**
 * The kind of visible row at an index. `'row'` is an ordinary leaf data row
 * (the default — preserves prior behavior for every consumer that ignores the
 * field). `'group'` is a full-width group-header band injected by a grouping
 * feature via the {@link RowSource} seam.
 */
export type RowKind = 'row' | 'group' | 'detail';

/**
 * Master-detail metadata attached to a {@link RowEntry} of kind `'detail'`. A
 * row-expander feature injects one of these directly beneath the master row it
 * expands, via the {@link RowSource} seam. The renderer reads this to paint a
 * full-width detail region; the feature owns the rendering of `el`.
 */
export interface DetailRowData<Row extends Model = Model> {
  /** Id of the master (parent) row this detail belongs to. */
  masterId: RecordId;
  /** The master row model (for the consumer's detail renderer). */
  masterRow: Row;
  /** Pixel height the detail region occupies (drives virtualization math). */
  height: number;
  /**
   * Paint the detail content into the supplied container. Called by the renderer
   * once per (re)paint of the detail row; the feature delegates to the
   * consumer-provided renderer/widget. Returning an element replaces the
   * container content; returning void means the callback mutated `host` directly.
   */
  render(host: HTMLElement): HTMLElement | void;
}

/**
 * Group-header metadata attached to a {@link RowEntry} of kind `'group'`. The
 * grouping feature owns the model; the renderer reads this to paint the band
 * (toggle chevron, group value, leaf count, per-column aggregate cells) and the
 * engine/widget read `key` to wire click-to-collapse back to the feature.
 */
export interface GroupRowData {
  /** Stable key of the group node (the feature's collapse-state key). */
  key: string;
  /** The column id this level groups by. */
  columnId: string;
  /** The shared group value. */
  value: unknown;
  /** Nesting depth (0 = top level). */
  depth: number;
  /** Number of leaf rows under this group (recursive). */
  count: number;
  /** Whether the group is currently collapsed. */
  collapsed: boolean;
  /** Per-column aggregates for this group, keyed by column id. */
  summary: Record<string, unknown>;
}

/**
 * A row plus its tree depth (0 for flat grids).
 *
 * `kind`/`group` are optional and absent for ordinary rows, so every existing
 * consumer keeps working unchanged; only group-aware code branches on them.
 */
export interface RowEntry<Row extends Model = Model> {
  row: Row;
  id: RecordId;
  depth: number;
  /** Whether this tree row has (or may have) children. */
  hasChildren: boolean;
  /** Whether this tree row is currently expanded. */
  expanded: boolean;
  /** Row kind. Absent/`'row'` for ordinary data rows. */
  kind?: RowKind;
  /** Present only when `kind === 'group'`: the group-header model. */
  group?: GroupRowData;
  /** Present only when `kind === 'detail'`: the master-detail model. */
  detail?: DetailRowData<Row>;
}

/**
 * A pluggable provider of the engine's visible row list (the "row-source seam").
 *
 * Normally the {@link RowModel} materializes its visible rows directly from the
 * backing store / tree. A feature (e.g. grouping) can instead install a
 * `RowSource` that supplies interleaved group-header + leaf {@link RowEntry}s,
 * letting the engine render a view the store alone cannot express. The source is
 * pulled lazily on (re)materialize and re-pulled after {@link RowModel.invalidate}.
 */
export interface RowSource<Row extends Model = Model> {
  /** Produce the ordered, expansion-aware visible row entries. */
  getRowEntries(): RowEntry<Row>[];
  /**
   * Optional per-row height override (px) for a visible index, or `undefined` to
   * use the grid's default row height. A source that injects variable-height rows
   * (e.g. tall master-detail regions) implements this so virtualization geometry
   * accounts for them WITHOUT requiring `variableRowHeight` mode. Sources that
   * only emit uniform-height rows (e.g. grouping) omit it.
   */
  heightOf?(index: number): number | undefined;
}

/**
 * Wraps a data source and exposes index-addressable, view-aware row access.
 */
export class RowModel<Row extends Model = Model> {
  readonly store: Store<Row>;
  /** Whether the backing store is a TreeStore and tree mode is active. */
  readonly tree: boolean;

  private cache: RowEntry<Row>[] = [];
  private idToIndex = new Map<RecordId, number>();
  private dirty = true;
  /** Active row-source override (e.g. grouping), or null for the store view. */
  private rowSource: RowSource<Row> | null = null;

  constructor(data: GridDataSource<Row>, opts: { idField?: string; treeMode?: boolean } = {}) {
    if (data instanceof TreeStore) {
      this.store = data as unknown as Store<Row>;
      this.tree = opts.treeMode !== false;
    } else if (data instanceof Store) {
      this.store = data;
      this.tree = false;
    } else if (opts.treeMode === true) {
      // Raw array + tree mode → wrap in a fresh TreeStore so callers can write
      // `new Grid(el, { data: array, treeMode: true })` without constructing a
      // TreeStore themselves (mirrors the flat-Store auto-wrap below).
      this.store = new TreeStore<Row & { children?: Row[] }>({
        data: data as (Row & { children?: Row[] })[],
        ...(opts.idField ? { idField: opts.idField } : {}),
      }) as unknown as Store<Row>;
      this.tree = true;
    } else {
      // Raw array → wrap in a fresh Store.
      this.store = new Store<Row>({
        data: data as Row[],
        ...(opts.idField ? { idField: opts.idField } : {}),
      });
      this.tree = false;
    }
  }

  /** Mark the materialized view stale (call on store change / expand-collapse). */
  invalidate(): void {
    this.dirty = true;
  }

  /**
   * Install (or clear, with `null`) a {@link RowSource} that supplies the visible
   * row list instead of the store/tree. Marks the view stale so the next access
   * re-materializes from the source. Idempotent for the same source.
   */
  setRowSource(source: RowSource<Row> | null): void {
    if (this.rowSource === source) return;
    this.rowSource = source;
    this.dirty = true;
  }

  /** Whether a row-source override is currently active. */
  hasRowSource(): boolean {
    return this.rowSource != null;
  }

  /** Whether the active row-source supplies per-row height overrides. */
  hasRowHeights(): boolean {
    return typeof this.rowSource?.heightOf === 'function';
  }

  /**
   * Per-row height override (px) from the active row-source, or `undefined` when
   * none applies (no source, source has no `heightOf`, or it returned undefined).
   */
  heightOf(index: number): number | undefined {
    return this.rowSource?.heightOf?.(index);
  }

  /** Lazily (re)materialize the visible row list. */
  private materialize(): RowEntry<Row>[] {
    if (!this.dirty) return this.cache;
    // A row-source override (e.g. grouping) fully owns the visible row list.
    if (this.rowSource) {
      const sourced = this.rowSource.getRowEntries();
      this.cache = sourced;
      this.idToIndex = new Map();
      // Only data rows are addressable by id; group bands are not in the store.
      sourced.forEach((e, i) => {
        if (e.kind !== 'group') this.idToIndex.set(e.id, i);
      });
      this.dirty = false;
      return sourced;
    }
    const out: RowEntry<Row>[] = [];
    if (this.tree) {
      const ts = this.store as unknown as TreeStore<Row & { children?: Row[] }>;
      for (const { node, depth } of ts.getVisible()) {
        const id = node[ts.idField] as RecordId;
        out.push({
          row: node as unknown as Row,
          id,
          depth,
          hasChildren: !ts.isLeaf(node),
          expanded: ts.isExpanded(node),
        });
      }
    } else {
      const idField = this.store.idField;
      this.store.forEach((row, _i) => {
        out.push({
          row,
          id: row[idField] as RecordId,
          depth: 0,
          hasChildren: false,
          expanded: false,
        });
      });
    }
    this.cache = out;
    this.idToIndex = new Map(out.map((e, i) => [e.id, i]));
    this.dirty = false;
    return out;
  }

  /** Number of rows in the current view. */
  get count(): number {
    return this.materialize().length;
  }

  /** Row entry at an absolute view index. */
  entryAt(index: number): RowEntry<Row> | undefined {
    return this.materialize()[index];
  }

  /** Row model at an absolute view index. */
  rowAt(index: number): Row | undefined {
    return this.materialize()[index]?.row;
  }

  /** Row model by id. */
  rowById(id: RecordId): Row | undefined {
    return this.store.getById(id);
  }

  /** Absolute view index of an id, or -1. */
  indexOf(id: RecordId): number {
    this.materialize();
    return this.idToIndex.get(id) ?? -1;
  }

  /** Snapshot of the visible entries (cheap; shares row references). */
  entries(): ReadonlyArray<RowEntry<Row>> {
    return this.materialize();
  }
}
