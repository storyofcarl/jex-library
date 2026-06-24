/**
 * TreeStore (TreeCollection) — a hierarchical Store. Records carry nested
 * `children` (configurable), expose expand/collapse state, leaf detection, and
 * lazy child loading.
 */

import { Store, type StoreConfig, type Model, type RecordId } from './store.js';

export interface TreeNode extends Model {
  children?: TreeNode[];
}

export interface TreeStoreConfig<T extends TreeNode> extends StoreConfig<T> {
  /** Field holding child records. Default `'children'`. */
  childrenField?: string;
  /** Lazy loader for a node's children; called by `loadChildren`. */
  loader?: (node: T) => Promise<T[]>;
  /** Ids expanded by default. */
  expanded?: RecordId[];
}

export class TreeStore<T extends TreeNode = TreeNode> extends Store<T> {
  readonly childrenField: string;
  protected readonly loader?: (node: T) => Promise<T[]>;
  protected readonly expandedIds = new Set<RecordId>();
  protected readonly loadedIds = new Set<RecordId>();

  constructor(config: TreeStoreConfig<T> = {}) {
    super(config);
    this.childrenField = config.childrenField ?? 'children';
    if (config.loader) this.loader = config.loader;
    if (config.expanded) for (const id of config.expanded) this.expandedIds.add(id);
    // Index the full tree (Store only indexes the top level).
    this.reindexTree();
  }

  protected childrenOf(node: T): T[] {
    return (node[this.childrenField] as T[] | undefined) ?? [];
  }

  /** Re-index every node in the tree (depth-first), not just roots. */
  protected reindexTree(): void {
    this.index.clear();
    const walk = (nodes: T[]): void => {
      for (const n of nodes) {
        this.index.set(this.idOf(n), n);
        walk(this.childrenOf(n));
      }
    };
    walk(this.all);
  }

  /** Root-level nodes (`items`). */
  get items(): T[] {
    return this.all;
  }

  /** Direct children of a node (by node or id). */
  getChildren(node: T | RecordId): T[] {
    const n = typeof node === 'object' ? node : this.getById(node);
    return n ? this.childrenOf(n) : [];
  }

  /** All nodes flattened depth-first (respecting nothing — full tree). */
  getItems(): T[] {
    const out: T[] = [];
    const walk = (nodes: T[]): void => {
      for (const n of nodes) {
        out.push(n);
        walk(this.childrenOf(n));
      }
    };
    walk(this.all);
    return out;
  }

  /** Visible nodes in display order — children included only under expanded ancestors. */
  getVisible(): Array<{ node: T; depth: number }> {
    const out: Array<{ node: T; depth: number }> = [];
    const walk = (nodes: T[], depth: number): void => {
      for (const n of nodes) {
        out.push({ node: n, depth });
        if (this.isExpanded(n)) walk(this.childrenOf(n), depth + 1);
      }
    };
    walk(this.all, 0);
    return out;
  }

  isLeaf(node: T | RecordId): boolean {
    const n = typeof node === 'object' ? node : this.getById(node);
    if (!n) return true;
    // A node with an async loader that hasn't loaded yet is not necessarily a leaf.
    if (this.loader && !this.loadedIds.has(this.idOf(n)) && n['leaf'] !== true) {
      return n['leaf'] === true;
    }
    return this.childrenOf(n).length === 0;
  }

  isExpanded(node: T | RecordId): boolean {
    const id = typeof node === 'object' ? this.idOf(node) : node;
    return this.expandedIds.has(id);
  }

  /** Expand a node. If a loader is configured and children aren't loaded, loads them. */
  async expand(node: T | RecordId): Promise<void> {
    const n = typeof node === 'object' ? node : this.getById(node);
    if (!n) return;
    const id = this.idOf(n);
    this.expandedIds.add(id);
    if (this.loader && !this.loadedIds.has(id) && this.childrenOf(n).length === 0) {
      await this.loadChildren(n);
    }
    this.events.emit('change', { action: 'update' });
  }

  collapse(node: T | RecordId): void {
    const id = typeof node === 'object' ? this.idOf(node) : node;
    this.expandedIds.delete(id);
    this.events.emit('change', { action: 'update' });
  }

  /** Toggle expansion. */
  async toggle(node: T | RecordId): Promise<void> {
    if (this.isExpanded(node)) this.collapse(node);
    else await this.expand(node);
  }

  /** Lazily load a node's children via the configured loader. */
  async loadChildren(node: T): Promise<T[]> {
    if (!this.loader) return this.childrenOf(node);
    const children = await this.loader(node);
    (node as Model)[this.childrenField] = children;
    this.loadedIds.add(this.idOf(node));
    for (const c of children) this.index.set(this.idOf(c), c);
    this.events.emit('change', { action: 'update' });
    return children;
  }

  override parse(data: T[]): void {
    super.parse(data);
    this.reindexTree();
  }
}
