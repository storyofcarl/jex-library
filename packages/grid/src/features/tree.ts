/**
 * TreeFeature — tree-grid mode for @jects/grid.
 *
 * Binds a core `TreeStore` to the grid: rows render in depth-first,
 * expansion-aware order; the configured tree column gets an expand/collapse
 * toggle and depth indentation; children load lazily through the store's
 * `loader` on first expand. The flattened visible rows (with per-row depth and
 * leaf/expanded metadata) are exposed via `getViewRows()` for the engine
 * renderer, and the contract `rowExpand` event fires on toggle.
 *
 * The feature confines itself to `GridApi` + the bound `TreeStore`; it adds a
 * single delegated click listener for the toggle affordance and a markup helper
 * (`renderTreeCell`) renderers can call for the indented toggle + value.
 */

import type { Model, RecordId, TreeStore } from '@jects/core';
import type { ColumnDef, GridApi, GridFeature } from '../contract.js';
import { Disposers, escapeHtml, getValue } from './shared.js';

/** A flattened, visible tree row. */
export interface TreeViewRow<Row extends Model> {
  row: Row;
  id: RecordId;
  depth: number;
  expanded: boolean;
  leaf: boolean;
  /** Index within the flattened visible list. */
  index: number;
}

export interface TreeFeatureOptions {
  /** Column id hosting the expand/collapse affordance. Defaults to first column. */
  treeColumn?: string;
  /** Indentation px per depth level. Default `16`. */
  indent?: number;
  /** Initially expanded node ids. */
  expanded?: RecordId[];
  /** Lazy children: defer to the store loader on first expand. Default `true`. */
  lazy?: boolean;
}

function isTreeStore<Row extends Model>(store: unknown): store is TreeStore<Row & { children?: Row[] }> {
  return (
    !!store &&
    typeof (store as { getVisible?: unknown }).getVisible === 'function' &&
    typeof (store as { toggle?: unknown }).toggle === 'function'
  );
}

export class TreeFeature<Row extends Model = Model> implements GridFeature<Row> {
  readonly name = 'tree';

  private api!: GridApi<Row>;
  private store!: TreeStore<Row & { children?: Row[] }>;
  private readonly disposers = new Disposers();
  private readonly indent: number;
  private readonly lazy: boolean;
  private treeColumnId: string | null;
  private viewRows: TreeViewRow<Row>[] = [];
  private dirty = true;

  constructor(options: TreeFeatureOptions = {}) {
    this.indent = options.indent ?? 16;
    this.lazy = options.lazy ?? true;
    this.treeColumnId = options.treeColumn ?? null;
    this.pendingExpanded = options.expanded ?? [];
  }

  private pendingExpanded: RecordId[];

  init(grid: GridApi<Row>): void {
    this.api = grid;
    if (!isTreeStore<Row>(grid.store)) {
      throw new Error('TreeFeature requires the grid data source to be a TreeStore.');
    }
    this.store = grid.store as unknown as TreeStore<Row & { children?: Row[] }>;
    grid.track(() => this.disposers.dispose());

    if (this.treeColumnId == null) {
      const treeCol = grid.columns.find((c) => c.type === 'tree') ?? grid.columns[0];
      this.treeColumnId = treeCol ? treeCol.id ?? treeCol.field ?? null : null;
    }

    // Honor initial expansion (the store may already have its own; expand any extra).
    for (const id of this.pendingExpanded) {
      if (!this.store.isExpanded(id)) void this.store.expand(id);
    }
    this.pendingExpanded = [];

    // Recompute the flattened view whenever the store changes.
    const off = this.store.events.on('change', () => {
      this.dirty = true;
    });
    this.disposers.add(off);

    // Delegated toggle click.
    const onClick = (e: Event): void => this.handleClick(e as MouseEvent);
    grid.el.addEventListener('click', onClick);
    this.disposers.add(() => grid.el.removeEventListener('click', onClick));

    this.dirty = true;
  }

  /** Column id that hosts the tree affordance. */
  get treeColumn(): string | null {
    return this.treeColumnId;
  }

  /** Whether children are loaded lazily (deferred to the store loader). */
  isLazy(): boolean {
    return this.lazy;
  }

  /** Flattened visible rows in display order. */
  getViewRows(): TreeViewRow<Row>[] {
    if (this.dirty) this.recompute();
    return this.viewRows;
  }

  /** Number of visible rows. */
  getViewRowCount(): number {
    return this.getViewRows().length;
  }

  /** Row at a flattened visible index. */
  getRowAt(index: number): TreeViewRow<Row> | undefined {
    return this.getViewRows()[index];
  }

  /** Whether a node is expanded. */
  isExpanded(id: RecordId): boolean {
    return this.store.isExpanded(id);
  }

  /** Whether a node is a leaf (no children / not expandable). */
  isLeaf(id: RecordId): boolean {
    return this.store.isLeaf(id);
  }

  /** Expand a node (loads children lazily when configured). Resolves when done. */
  async expand(id: RecordId): Promise<void> {
    if (this.store.isExpanded(id)) return;
    await this.store.expand(id);
    this.dirty = true;
    this.api.refresh();
    const row = this.api.getRowById(id);
    if (row) this.api.emit('rowExpand', { row, id, expanded: true });
  }

  /** Collapse a node. */
  collapse(id: RecordId): void {
    if (!this.store.isExpanded(id)) return;
    this.store.collapse(id);
    this.dirty = true;
    this.api.refresh();
    const row = this.api.getRowById(id);
    if (row) this.api.emit('rowExpand', { row, id, expanded: false });
  }

  /** Toggle expansion. */
  async toggle(id: RecordId): Promise<void> {
    if (this.store.isExpanded(id)) this.collapse(id);
    else await this.expand(id);
  }

  /** Expand every node currently in the tree (eager). */
  async expandAll(): Promise<void> {
    for (const node of this.store.getItems()) {
      const id = node[this.store.idField] as RecordId;
      if (!this.store.isLeaf(id) && !this.store.isExpanded(id)) {
        await this.store.expand(id);
      }
    }
    this.dirty = true;
    this.api.refresh();
  }

  /** Collapse every node. */
  collapseAll(): void {
    for (const node of this.store.getItems()) {
      const id = node[this.store.idField] as RecordId;
      if (this.store.isExpanded(id)) this.store.collapse(id);
    }
    this.dirty = true;
    this.api.refresh();
  }

  /**
   * Markup for the tree cell of a row: an indentation spacer, a toggle (or
   * leaf spacer), and the escaped cell value. Renderers can drop this into the
   * tree column cell.
   */
  renderTreeCell(view: TreeViewRow<Row>, column: ColumnDef<Row>): string {
    const pad = view.depth * this.indent;
    const value = getValue(view.row, column);
    const text = value == null ? '' : escapeHtml(String(value));
    const toggle = view.leaf
      ? `<span class="jects-grid-tree__spacer" aria-hidden="true"></span>`
      : [
          `<button type="button" class="jects-grid-tree__toggle" `,
          `data-tree-toggle="${escapeHtml(String(view.id))}" `,
          `aria-expanded="${view.expanded}" `,
          `aria-label="${view.expanded ? 'Collapse' : 'Expand'} row">`,
          `<span class="jects-grid-tree__chevron${view.expanded ? ' jects-grid-tree__chevron--open' : ''}" aria-hidden="true"></span>`,
          `</button>`,
        ].join('');
    return [
      `<span class="jects-grid-tree__cell" style="padding-inline-start:${pad}px">`,
      toggle,
      `<span class="jects-grid-tree__label">${text}</span>`,
      `</span>`,
    ].join('');
  }

  private recompute(): void {
    this.dirty = false;
    const visible = this.store.getVisible();
    this.viewRows = visible.map(({ node, depth }, index) => {
      const id = node[this.store.idField] as RecordId;
      return {
        row: node as unknown as Row,
        id,
        depth,
        expanded: this.store.isExpanded(id),
        leaf: this.store.isLeaf(id),
        index,
      };
    });
  }

  private handleClick(event: MouseEvent): void {
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-tree-toggle]');
    if (!target) return;
    const raw = target.dataset['treeToggle'];
    if (raw == null) return;
    event.preventDefault();
    event.stopPropagation();
    const id = this.resolveId(raw);
    void this.toggle(id);
  }

  /** data-* attributes are strings; recover the original id type from the store. */
  private resolveId(raw: string): RecordId {
    if (this.store.getById(raw) !== undefined) return raw;
    const asNum = Number(raw);
    if (!Number.isNaN(asNum) && this.store.getById(asNum) !== undefined) return asNum;
    return raw;
  }

  destroy(): void {
    this.disposers.dispose();
    this.viewRows = [];
  }
}

/** Convenience factory. */
export function treeFeature<Row extends Model = Model>(
  options?: TreeFeatureOptions,
): TreeFeature<Row> {
  return new TreeFeature<Row>(options);
}
