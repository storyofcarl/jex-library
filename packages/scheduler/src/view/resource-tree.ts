/**
 * ResourceTree — hierarchical / grouped resource lanes for the Scheduler.
 *
 * Brings the Scheduler to Bryntum/DHTMLX parity for **resource tree / grouping**:
 * resources nest under a `parentId` (or arrive pre-nested), render with
 * expand/collapse, depth indentation in the locked columns, and group headers;
 * events under a *collapsed* parent aggregate up onto the parent lane so no
 * bars are lost when a subtree is folded. This mirrors the grid's tree mode
 * (`packages/grid/src/features/tree.ts`).
 *
 * Design (concurrency-safe): this is a self-contained feature class, NOT a
 * destructive edit of `Scheduler`. It owns a `ResourceTreeStore` and exposes:
 *
 *   - a `RowProvider`-compatible facade (`count` / `rowAt` / `indexOf`) the
 *     scheduler's virtualizer + `rowWindow` delegate to;
 *   - a flattened, expansion-aware view (`getViewRows()`), each row carrying
 *     `depth` / `leaf` / `expanded` / `isGroup`;
 *   - tree-cell markup for the locked columns (`renderTreeCell`) — indentation
 *     spacer + chevron toggle (or group header);
 *   - event aggregation: `resourceIdsForRow(id)` returns the lane id plus, when
 *     a row is collapsed, every hidden descendant id, so the paint loop can pull
 *     their events onto the visible ancestor;
 *   - toggle handling (`toggle` / `expand` / `collapse` / `expandAll` /
 *     `collapseAll`) with a typed `resourceToggle` event surface.
 *
 * The feature is framework-free + token-pure: it emits CSS classes
 * (`jects-scheduler-tree__*`) styled in `resource-tree.css`, references only
 * `--jects-*` tokens, and disposes its single delegated listener on `destroy()`.
 */

import { EventEmitter, type RecordId, type EventMap } from '@jects/core';
import type { TimelineRow } from '@jects/timeline-core';
import type { ResourceModel, ResourceColumnConfig } from '../contract.js';
import {
  buildResourceTreeStore,
  type ResourceTreeStore,
  type ResourceTreeNode,
} from '../stores/resource-tree-store.js';

/* ── small markup helper (no DOM dependency) ─────────────────────────────── */

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ── public types ────────────────────────────────────────────────────────── */

/** A flattened, visible resource-tree row in display order. */
export interface ResourceTreeRow {
  /** The backing resource record. */
  record: ResourceTreeNode;
  /** Resource id. */
  id: RecordId;
  /** Depth from the root (0 = root lane / top-level group). */
  depth: number;
  /** Whether this node is expanded (only meaningful when not a leaf). */
  expanded: boolean;
  /** Whether this node has no children (no toggle, no aggregation). */
  leaf: boolean;
  /**
   * Whether this row is a *group header* — a non-leaf parent rendered as a
   * heading band rather than a normal lane. A node is a group when it has
   * children; its own events (if any) still render on its lane.
   */
  isGroup: boolean;
  /** Index within the flattened visible list. */
  index: number;
}

/** Typed event surface for the tree feature. */
export interface ResourceTreeEvents extends EventMap {
  /** A node was expanded or collapsed. */
  resourceToggle: { id: RecordId; resource: ResourceModel; expanded: boolean };
  /** The flattened view changed (after a toggle / data change). */
  viewChange: { rows: number };
}

export interface ResourceTreeOptions {
  /** Indentation px per depth level. Default `16`. */
  indent?: number;
  /** Initially-expanded node ids. When omitted, every parent starts expanded. */
  expanded?: RecordId[];
  /**
   * Render non-leaf parents as bold group-header bands. Default `true`. When
   * `false`, parents render as ordinary indented lanes with a toggle.
   */
  groupHeaders?: boolean;
  /**
   * Aggregate events of hidden descendants onto a collapsed ancestor's lane.
   * Default `true` — matches Bryntum's "roll up child events to the collapsed
   * parent" behaviour so folding a subtree never hides its bars.
   */
  aggregate?: boolean;
}

/* ── feature ─────────────────────────────────────────────────────────────── */

export class ResourceTree {
  /** Typed event emitter (`resourceToggle` / `viewChange`). */
  readonly events = new EventEmitter<ResourceTreeEvents>();

  readonly store: ResourceTreeStore;
  private readonly indent: number;
  private readonly groupHeaders: boolean;
  private readonly aggregate: boolean;

  private viewRows: ResourceTreeRow[] = [];
  private dirty = true;
  private disposed = false;
  private readonly offStore: () => void;

  /**
   * Cache: for each visible row id, the set of resource ids whose events render
   * on that lane (the row itself + hidden collapsed descendants). Recomputed
   * with the view.
   */
  private aggregatedIds = new Map<RecordId, RecordId[]>();

  constructor(
    src:
      | ResourceTreeStore
      | ResourceModel[]
      | { toArray(): ResourceModel[] },
    options: ResourceTreeOptions = {},
  ) {
    this.indent = options.indent ?? 16;
    this.groupHeaders = options.groupHeaders ?? true;
    this.aggregate = options.aggregate ?? true;
    this.store = buildResourceTreeStore(
      src as ResourceTreeStore | ResourceModel[],
      options.expanded ? { expanded: options.expanded } : {},
    );
    // Recompute the flattened view whenever the store mutates (add/remove/
    // expand/collapse all emit `change`).
    this.offStore = this.store.events.on('change', () => {
      this.dirty = true;
    });
  }

  /* ── RowProvider-compatible facade ─────────────────────────────────────── */

  /** Number of visible rows (the virtualizer / rowWindow count). */
  count(): number {
    return this.getViewRows().length;
  }

  /**
   * Resolve a `TimelineRow` at a flattened visible index — drop-in for the
   * scheduler's `rowAt(i)`. Carries `depth`/`expanded` for the engine.
   */
  rowAt(index: number, defaultHeight: number): TimelineRow<ResourceModel> | undefined {
    const view = this.getViewRows()[index];
    if (!view) return undefined;
    return {
      id: view.id,
      record: view.record,
      height: view.record.rowHeight ?? defaultHeight,
      depth: view.depth,
      expanded: view.expanded,
    };
  }

  /** Absolute visible index of a resource id, or -1. */
  indexOf(id: RecordId): number {
    return this.getViewRows().findIndex((r) => r.id === id);
  }

  /** The visible record at an index (locked-column paint convenience). */
  recordAt(index: number): ResourceTreeNode | undefined {
    return this.getViewRows()[index]?.record;
  }

  /** The visible view row at an index. */
  viewAt(index: number): ResourceTreeRow | undefined {
    return this.getViewRows()[index];
  }

  /* ── view ──────────────────────────────────────────────────────────────── */

  /** Flattened, expansion-aware rows in display order. */
  getViewRows(): ResourceTreeRow[] {
    if (this.dirty) this.recompute();
    return this.viewRows;
  }

  private recompute(): void {
    this.dirty = false;
    const visible = this.store.getVisible();
    this.viewRows = visible.map(({ node, depth }, index) => {
      const id = node.id;
      const leaf = this.store.isLeaf(id);
      return {
        record: node,
        id,
        depth,
        leaf,
        expanded: this.store.isExpanded(id),
        isGroup: !leaf && this.groupHeaders,
        index,
      };
    });
    this.recomputeAggregation();
    this.events.emit('viewChange', { rows: this.viewRows.length });
  }

  /**
   * For every visible row, compute the set of resource ids whose events should
   * paint on its lane. A row owns its own events always; when it is collapsed
   * (a non-leaf that is not expanded) and aggregation is on, it also owns every
   * descendant id hidden beneath it.
   */
  private recomputeAggregation(): void {
    this.aggregatedIds = new Map();
    for (const view of this.viewRows) {
      const ids: RecordId[] = [view.id];
      if (this.aggregate && !view.leaf && !view.expanded) {
        this.collectDescendantIds(view.record, ids);
      }
      this.aggregatedIds.set(view.id, ids);
    }
  }

  private collectDescendantIds(node: ResourceTreeNode, out: RecordId[]): void {
    for (const child of this.store.getChildren(node) as ResourceTreeNode[]) {
      out.push(child.id);
      this.collectDescendantIds(child, out);
    }
  }

  /**
   * The resource ids whose events render on the lane of `id`. For an expanded
   * or leaf row this is just `[id]`; for a collapsed parent (aggregation on) it
   * additionally includes every hidden descendant id. Unknown ids fall back to
   * `[id]` so callers always get a usable list.
   */
  resourceIdsForRow(id: RecordId): RecordId[] {
    this.getViewRows();
    return this.aggregatedIds.get(id) ?? [id];
  }

  /* ── expansion ─────────────────────────────────────────────────────────── */

  isExpanded(id: RecordId): boolean {
    return this.store.isExpanded(id);
  }
  isLeaf(id: RecordId): boolean {
    return this.store.isLeaf(id);
  }

  /** Expand a node (loads children lazily when the store has a loader). */
  async expand(id: RecordId): Promise<void> {
    if (this.store.isExpanded(id)) return;
    await this.store.expand(id);
    this.dirty = true;
    this.fireToggle(id, true);
  }

  /** Collapse a node. */
  collapse(id: RecordId): void {
    if (!this.store.isExpanded(id)) return;
    this.store.collapse(id);
    this.dirty = true;
    this.fireToggle(id, false);
  }

  /** Toggle expansion of a node. */
  async toggle(id: RecordId): Promise<void> {
    if (this.store.isExpanded(id)) this.collapse(id);
    else await this.expand(id);
  }

  /** Expand every non-leaf node. */
  async expandAll(): Promise<void> {
    for (const node of this.store.getItems()) {
      if (!this.store.isLeaf(node.id) && !this.store.isExpanded(node.id)) {
        await this.store.expand(node.id);
      }
    }
    this.dirty = true;
  }

  /** Collapse every node. */
  collapseAll(): void {
    for (const node of this.store.getItems()) {
      if (this.store.isExpanded(node.id)) this.store.collapse(node.id);
    }
    this.dirty = true;
  }

  private fireToggle(id: RecordId, expanded: boolean): void {
    const resource = this.store.getById(id);
    if (resource) this.events.emit('resourceToggle', { id, resource, expanded });
  }

  /* ── locked-column markup ──────────────────────────────────────────────── */

  /**
   * Markup for a tree column cell: an indentation spacer sized to the row's
   * depth, then either a chevron toggle (non-leaf) or a leaf spacer, then the
   * escaped value. A column renderer takes precedence over the raw field value.
   *
   * Group-header rows additionally get the `--group` modifier so CSS can render
   * them as a heading band.
   */
  renderTreeCell(view: ResourceTreeRow, column: ResourceColumnConfig): string {
    const pad = view.depth * this.indent;
    const raw = column.renderer
      ? column.renderer(view.record)
      : escapeHtml(String(view.record[column.field] ?? ''));
    const toggle = view.leaf
      ? `<span class="jects-scheduler-tree__spacer" aria-hidden="true"></span>`
      : [
          `<button type="button" class="jects-scheduler-tree__toggle"`,
          ` data-resource-toggle="${escapeHtml(String(view.id))}"`,
          ` aria-expanded="${view.expanded}"`,
          ` aria-label="${view.expanded ? 'Collapse' : 'Expand'} ${escapeHtml(view.record.name ?? 'group')}">`,
          `<span class="jects-scheduler-tree__chevron${view.expanded ? ' jects-scheduler-tree__chevron--open' : ''}" aria-hidden="true"></span>`,
          `</button>`,
        ].join('');
    const groupCls = view.isGroup ? ' jects-scheduler-tree__cell--group' : '';
    return [
      `<span class="jects-scheduler-tree__cell${groupCls}" style="padding-inline-start:${pad}px">`,
      toggle,
      `<span class="jects-scheduler-tree__label">${raw}</span>`,
      `</span>`,
    ].join('');
  }

  /** Indentation px for a depth (exposed for bar indentation / tests). */
  indentFor(depth: number): number {
    return depth * this.indent;
  }

  /**
   * Handle a delegated click on the locked-columns panel: if it landed on a
   * toggle affordance, toggle that node and return `true` (so the caller can
   * stop propagation / repaint). Returns `false` for clicks elsewhere.
   */
  handleToggleClick(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    const btn = target.closest<HTMLElement>('[data-resource-toggle]');
    if (!btn) return false;
    const raw = btn.dataset['resourceToggle'];
    if (raw == null) return false;
    void this.toggle(this.resolveId(raw));
    return true;
  }

  /** Recover the original id type (data-* are strings) from the store. */
  private resolveId(raw: string): RecordId {
    if (this.store.getById(raw) !== undefined) return raw;
    const asNum = Number(raw);
    if (!Number.isNaN(asNum) && this.store.getById(asNum) !== undefined) return asNum;
    return raw;
  }

  /* ── lifecycle ─────────────────────────────────────────────────────────── */

  /** Force a view recompute on the next read (after external store edits). */
  invalidate(): void {
    this.dirty = true;
  }

  /** Dispose the store listener + emitter. Idempotent. */
  destroy(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.offStore();
    this.events.clear();
    this.viewRows = [];
    this.aggregatedIds.clear();
  }
}

/** Convenience factory. */
export function resourceTree(
  src: ResourceTreeStore | ResourceModel[] | { toArray(): ResourceModel[] },
  options?: ResourceTreeOptions,
): ResourceTree {
  return new ResourceTree(src, options);
}
