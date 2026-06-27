/**
 * `GanttTaskTree` — the LEFT pane: the task-tree grid. It reuses `@jects/grid`
 * in tree mode over the SAME `TreeStore` the Gantt widget owns, with the standard
 * project columns (name / WBS / start / end / duration / percent / predecessors).
 *
 * The grid is imported lazily so the timeline-and-bridge core of the Gantt UI
 * (and its jsdom unit tests) does not hard-couple to the grid build, which
 * evolves in a concurrent workflow. Until/if the grid mounts, the tree pane still
 * exposes the authoritative visible-row layout (`getVisibleRows`) the Gantt
 * widget reads to keep the two panes' vertical row windows in lockstep.
 *
 * The grid is the source of truth for expand/collapse and scrolling; the tree
 * forwards `rowExpand` / `scroll` to the Gantt widget through callbacks so the
 * timeline can re-window and re-align.
 */

import { createEl, type Model, type RecordId, type TreeStore } from '@jects/core';
import type { TaskModel, GanttColumnConfig } from '../contract.js';
import {
  AssignmentColumnRenderer,
  ASSIGNMENT_COLUMN_FIELD,
  ASSIGNMENT_COLUMN_HEADER,
  type AssignmentStore,
} from './resource-assignment.js';
import { formatEffort, formatUnits } from './effort-scheduling.js';
import {
  SUCCESSORS_COLUMN,
  SUCCESSORS_COLUMN_FIELD,
  isSuccessorsField,
} from './successors-column.js';
import {
  ROLLUP_COLUMN_FIELD,
  buildRollupCell,
  formatRollupCell,
  resolveRollupCell,
  getRollupColumnConfig,
  rollupFlagPatch,
  type RollupColumnConfig,
  type RollupTreeSource,
} from './rollup-column.js';

const MS_PER_DAY = 86_400_000;

/** Format a task's assigned-units cell, preferring an engine-resolved Σ units. */
function formatTreeUnits<T extends Model = Model>(
  task: TaskModel<T>,
  unitsOf?: (id: RecordId) => number | undefined,
): string {
  const u = unitsOf?.(task.id);
  if (u != null) return formatUnits(u);
  // Fall back to one full-time unit (100%) per assigned resource when no engine
  // resolution is available.
  const n = task.resourceIds?.length ?? 0;
  return n > 0 ? formatUnits(n * 100) : '';
}

/** A laid-out, currently-visible task row (after tree expansion). */
export interface VisibleTaskRow<T extends Model = Model> {
  task: TaskModel<T>;
  depth: number;
  /** Absolute top within the scroll content, px. */
  top: number;
  /** Row height, px. */
  height: number;
}

export interface TaskTreeOptions<T extends Model = Model> {
  store: TreeStore<TaskModel<T> & { children?: TaskModel<T>[] }>;
  columns?: GanttColumnConfig[];
  /**
   * Optional {@link AssignmentStore}. When provided, the tree renders a
   * "Resources" column (avatar/initials chips in the grid; comma-joined names in
   * the accessible fallback table) that reflects live assignments — call
   * {@link GanttTaskTree.refresh} after a store `change` to repaint. When a
   * `resources` column is already declared in `columns`, that column is wired to
   * this store; otherwise one is appended automatically.
   */
  assignmentStore?: AssignmentStore;
  /** Working hours/day for the Effort column's person-day conversion. Default 8. */
  hoursPerDay?: number;
  /** Resolve a task's combined assigned units (Σ) for the Units column. */
  unitsOf?(taskId: RecordId): number | undefined;
  rowHeight: number;
  headerHeight: number;
  width: number;
  predecessorsOf(taskId: RecordId): string;
  /**
   * Resolve a task's **successors** notation string (the links OUT of the task,
   * `task → other`) for the symmetric "Successors" column. When omitted, a
   * declared `successors` column renders empty. Mirror of {@link predecessorsOf};
   * the Gantt widget wires it to its dependency map (see `gantt.ts`).
   */
  successorsOf?(taskId: RecordId): string;
  /**
   * Configuration for the `'rollup'` task-tree column (Bryntum/DHTMLX parity).
   * When omitted, a declared `rollup` column falls back to the last-built
   * {@link rollupColumn} config (or the default flag/check). See `rollup-column.ts`.
   */
  rollupColumnConfig?: RollupColumnConfig<T>;
  /**
   * Apply a task's `rollup`-flag toggle (flag-mode rollup column). The Gantt
   * widget wires this to the engine/store so toggling the flag re-propagates and
   * repaints both the data column and the visual bar-rollup overlay. When omitted
   * the flag still renders but is read-only.
   */
  onRollupToggle?(taskId: RecordId, next: boolean): void;
  onRowExpand?(id: RecordId, expanded: boolean): void;
  onScroll?(scrollTop: number): void;
  onTaskClick?(taskId: RecordId): void;
  onTaskDblClick?(taskId: RecordId): void;
}

/** The default task-tree columns when the consumer does not specify any. */
export const DEFAULT_GANTT_COLUMNS: GanttColumnConfig[] = [
  { field: 'name', header: 'Task name', width: 220 },
  { field: 'wbs', header: 'WBS', width: 64 },
  { field: 'start', header: 'Start', width: 100 },
  { field: 'end', header: 'Finish', width: 100 },
  { field: 'duration', header: 'Duration', width: 90 },
  { field: 'percentDone', header: '% Done', width: 70 },
  { field: 'predecessors', header: 'Predecessors', width: 120 },
];

/**
 * The default columns PLUS the symmetric read-only "Successors" column (the
 * links OUT of each task). Use this in place of {@link DEFAULT_GANTT_COLUMNS}
 * when the grid should show predecessors AND successors side by side, matching
 * Bryntum/DHTMLX. The Successors cell resolves through {@link TaskTreeOptions.successorsOf}.
 */
export const DEFAULT_GANTT_COLUMNS_WITH_SUCCESSORS: GanttColumnConfig[] = [
  ...DEFAULT_GANTT_COLUMNS,
  { field: SUCCESSORS_COLUMN.field, header: SUCCESSORS_COLUMN.header, width: SUCCESSORS_COLUMN.width },
];

export class GanttTaskTree<T extends Model = Model> {
  readonly el: HTMLElement;
  private readonly opts: TaskTreeOptions<T>;
  private readonly columns: GanttColumnConfig[];
  /** Live "Resources" column renderer, when an assignment store is configured. */
  private readonly assignmentRenderer: AssignmentColumnRenderer<T> | null;
  private grid: { destroy(): void; el: HTMLElement; refresh(): void } | null = null;
  private gridScroller: HTMLElement | null = null;
  private destroyed = false;
  private disposers: Array<() => void> = [];
  /** Fallback treegrid: the row id holding the roving tabindex (keyboard cursor). */
  private focusId: RecordId | null = null;

  constructor(opts: TaskTreeOptions<T>) {
    this.opts = opts;
    const baseColumns = opts.columns ?? DEFAULT_GANTT_COLUMNS;
    // When an assignment store is wired, ensure a "Resources" column exists
    // (append one if the consumer's columns don't already declare it).
    if (opts.assignmentStore) {
      this.assignmentRenderer = new AssignmentColumnRenderer<T>(opts.assignmentStore, {
        max: 3,
        showNames: true,
        isOverAllocated: (r) => opts.assignmentStore!.isOverAllocated(r.id),
      });
      this.columns = baseColumns.some((c) => c.field === ASSIGNMENT_COLUMN_FIELD)
        ? baseColumns
        : [
            ...baseColumns,
            { field: ASSIGNMENT_COLUMN_FIELD, header: ASSIGNMENT_COLUMN_HEADER, width: 160 },
          ];
    } else {
      this.assignmentRenderer = null;
      this.columns = baseColumns;
    }
    this.el = createEl('div', { className: 'jects-gantt__tree' });
    this.el.style.width = `${opts.width}px`;
    // Render a lightweight, accessible fallback table immediately so the pane is
    // populated and a11y-valid even before (or without) the grid engine.
    this.renderFallback();
  }

  /** Currently-visible rows with absolute geometry (the lockstep layout seam). */
  getVisibleRows(): VisibleTaskRow<T>[] {
    const visible = this.opts.store.getVisible();
    const out: VisibleTaskRow<T>[] = [];
    let top = 0;
    for (const { node, depth } of visible) {
      out.push({ task: node, depth, top, height: this.opts.rowHeight });
      top += this.opts.rowHeight;
    }
    return out;
  }

  /** Total scroll-content height of all visible rows, px. */
  contentHeight(): number {
    return this.opts.store.getVisible().length * this.opts.rowHeight;
  }

  /** Mirror an external vertical scroll into the tree pane. */
  syncScrollTop(scrollTop: number): void {
    const sc = this.gridScroller ?? this.el.querySelector('.jects-gantt__tree-scroller');
    if (sc instanceof HTMLElement && sc.scrollTop !== scrollTop) sc.scrollTop = scrollTop;
  }

  /** Try to upgrade the fallback to the real `@jects/grid` tree grid. */
  async mountGrid(): Promise<void> {
    if (this.destroyed || this.grid) return;
    try {
      const mod = await import('@jects/grid');
      if (this.destroyed) return;
      const { Grid, treeFeature } = mod as unknown as {
        Grid: new (host: HTMLElement, options: Record<string, unknown>) => {
          destroy(): void;
          el: HTMLElement;
          refresh(): void;
          on(evt: string, fn: (p: Record<string, unknown>) => void): () => void;
        };
        treeFeature?: (cfg?: Record<string, unknown>) => unknown;
      };

      const gridHost = createEl('div', { className: 'jects-gantt__tree-grid' });
      this.el.replaceChildren();
      this.el.append(gridHost);

      const columns = this.columns.map((c) => ({
        field: c.field,
        header: c.header ?? c.field,
        width: c.width,
        renderer: this.rendererFor(c.field),
      }));

      const plugins = typeof treeFeature === 'function' ? [treeFeature()] : undefined;
      const grid = new Grid(gridHost, {
        data: this.opts.store,
        columns,
        rowHeight: this.opts.rowHeight,
        headerHeight: this.opts.headerHeight,
        treeMode: { enabled: true, treeColumn: 'name' },
        plugins,
      });
      this.grid = grid;

      this.disposers.push(
        grid.on('rowExpand', (p) => {
          this.opts.onRowExpand?.(p.id as RecordId, !!p.expanded);
        }),
      );
      this.disposers.push(
        grid.on('scroll', (p) => this.opts.onScroll?.((p.scrollTop as number) ?? 0)),
      );
      this.disposers.push(
        grid.on('cellClick', (p) => {
          const row = p.row as TaskModel<T> | undefined;
          if (row) this.opts.onTaskClick?.(row.id);
        }),
      );
      this.disposers.push(
        grid.on('cellDblClick', (p) => {
          const row = p.row as TaskModel<T> | undefined;
          if (row) this.opts.onTaskDblClick?.(row.id);
        }),
      );
      this.gridScroller = grid.el.querySelector('.jects-grid__viewport') as HTMLElement | null;
    } catch {
      // Grid unavailable — keep the accessible fallback table.
    }
  }

  private rendererFor(field: string): ((ctx: { row: TaskModel<T> }) => string) | undefined {
    const fmt = this.formatField.bind(this);
    // The "Resources" column renders avatar/initials chips (HTML). The grid's
    // string renderer accepts markup, so hand it the chip group's outerHTML.
    if (field === ASSIGNMENT_COLUMN_FIELD && this.assignmentRenderer) {
      const renderer = this.assignmentRenderer;
      return (ctx) => renderer.renderCell(ctx.row).outerHTML;
    }
    if (
      field === 'start' ||
      field === 'end' ||
      field === 'duration' ||
      field === 'percentDone' ||
      field === 'wbs' ||
      field === 'predecessors' ||
      isSuccessorsField(field) ||
      field === ROLLUP_COLUMN_FIELD ||
      field === 'effort' ||
      field === 'units'
    ) {
      return (ctx) => fmt(field, ctx.row);
    }
    return undefined;
  }

  /** Resolve the rollup column config (explicit opt, else last-built/default). */
  private rollupConfig(): RollupColumnConfig<T> {
    return (this.opts.rollupColumnConfig ?? getRollupColumnConfig()) as RollupColumnConfig<T>;
  }

  /** A {@link RollupTreeSource} adapter over the task tree's `TreeStore`. */
  private rollupSource(): RollupTreeSource<T> {
    const store = this.opts.store;
    return {
      getChildren: (taskId: RecordId) =>
        store.getChildren(taskId) as ReadonlyArray<TaskModel<T>>,
    };
  }

  /**
   * Toggle a task's `rollup` flag from the grid. Prefers the injected
   * {@link TaskTreeOptions.onRollupToggle} (the Gantt widget routes it through the
   * engine/store so dependents + the visual overlay re-read the flag); otherwise
   * writes the flag straight onto the `TreeStore` and repaints the fallback so the
   * column is self-contained when used standalone.
   */
  private toggleRollup(taskId: RecordId, next: boolean): void {
    if (this.opts.onRollupToggle) {
      this.opts.onRollupToggle(taskId, next);
      return;
    }
    this.opts.store.update(taskId, rollupFlagPatch(next) as Partial<TaskModel<T>>);
    if (!this.grid) this.renderFallback();
  }

  private formatField(field: string, task: TaskModel<T>): string {
    switch (field) {
      case 'start':
        return task.start != null ? new Date(task.start).toISOString().slice(0, 10) : '';
      case 'end':
        return task.end != null ? new Date(task.end).toISOString().slice(0, 10) : '';
      case 'duration':
        return task.duration != null ? `${Math.round(task.duration / MS_PER_DAY)}d` : '';
      case 'percentDone':
        return task.percentDone != null ? `${Math.round(task.percentDone * 100)}%` : '';
      case 'wbs':
        return this.wbsOf(task.id);
      case 'predecessors':
        return this.opts.predecessorsOf(task.id);
      case SUCCESSORS_COLUMN_FIELD:
        // Symmetric read-only successors cell (links OUT of the task). Resolves
        // through the injected resolver; empty when no resolver is wired.
        return this.opts.successorsOf?.(task.id) ?? '';
      case ROLLUP_COLUMN_FIELD: {
        // The 'rollup' data column: a check (flag mode) or aggregated value
        // (summary mode). This is the plain-text rendering used by the grid's
        // string renderer + the accessible fallback's text cells; the fallback
        // upgrades flag-mode cells to an interactive checkbox (see renderFallback).
        const cfg = this.rollupConfig();
        const value = resolveRollupCell(task, this.rollupSource(), cfg);
        return formatRollupCell(value, task, cfg);
      }
      case 'effort':
        return formatEffort(task.effort, this.opts.hoursPerDay);
      case 'units':
        return formatTreeUnits(task, this.opts.unitsOf);
      case ASSIGNMENT_COLUMN_FIELD:
        return this.assignmentRenderer ? this.assignmentRenderer.renderText(task) : '';
      default:
        return task.name ?? String(task.id);
    }
  }

  /**
   * Outline number ("1.2.1") for a task, derived from its position in the tree.
   * Uses the store's tree structure (parent → children) rather than the optional
   * `parentId` field, since a nested-`children` `TreeStore` may not set it.
   */
  private wbsOf(id: RecordId): string {
    const { parentOf, indexOf } = this.tableIndex();
    const parts: number[] = [];
    let cur: RecordId | undefined = id;
    const seen = new Set<RecordId>();
    while (cur != null && !seen.has(cur)) {
      seen.add(cur);
      parts.unshift((indexOf.get(cur) ?? 0) + 1);
      cur = parentOf.get(cur);
    }
    return parts.join('.');
  }

  /** Build (and cache per refresh) the parent-of + sibling-index maps. */
  private tableIndex(): {
    parentOf: Map<RecordId, RecordId | undefined>;
    indexOf: Map<RecordId, number>;
  } {
    const parentOf = new Map<RecordId, RecordId | undefined>();
    const indexOf = new Map<RecordId, number>();
    const store = this.opts.store;
    const roots = store.items;
    const walk = (
      nodes: Array<TaskModel<T> & { children?: TaskModel<T>[] }>,
      parent: RecordId | undefined,
    ): void => {
      nodes.forEach((node, i) => {
        parentOf.set(node.id, parent);
        indexOf.set(node.id, i);
        const kids = store.getChildren(node) as Array<
          TaskModel<T> & { children?: TaskModel<T>[] }
        >;
        if (kids.length) walk(kids, node.id);
      });
    };
    walk(roots as Array<TaskModel<T> & { children?: TaskModel<T>[] }>, undefined);
    return { parentOf, indexOf };
  }

  /** A token-pure, accessible HTML-table fallback (also the a11y baseline). */
  private renderFallback(): void {
    this.el.replaceChildren();
    const scroller = createEl('div', { className: 'jects-gantt__tree-scroller' });
    const table = createEl('table', { className: 'jects-gantt__tree-table' });
    table.setAttribute('role', 'treegrid');
    table.setAttribute('aria-label', 'Task tree');

    const thead = createEl('thead');
    const hrow = createEl('tr');
    for (const c of this.columns) {
      const th = createEl('th', { className: 'jects-gantt__tree-th' });
      th.scope = 'col';
      th.textContent = c.header ?? c.field;
      hrow.append(th);
    }
    thead.append(hrow);
    table.append(thead);

    const tbody = createEl('tbody');
    const store = this.opts.store;
    const visible = store.getVisible();

    // Sibling counts (aria-setsize / aria-posinset) per parent, for the rows AT.
    const { parentOf } = this.tableIndex();
    const siblingTotals = new Map<RecordId | undefined, number>();
    const siblingPos = new Map<RecordId, number>();
    for (const { node } of visible) {
      const parent = parentOf.get(node.id);
      const n = (siblingTotals.get(parent) ?? 0) + 1;
      siblingTotals.set(parent, n);
      siblingPos.set(node.id, n);
    }

    // Establish/refresh the roving-tabindex cursor (first row by default).
    if (this.focusId == null || !visible.some((v) => String(v.node.id) === String(this.focusId))) {
      this.focusId = visible[0]?.node.id ?? null;
    }

    for (const { node, depth } of visible) {
      const tr = createEl('tr', { className: 'jects-gantt__tree-row' });
      tr.dataset.taskId = String(node.id);
      tr.setAttribute('role', 'row');
      tr.setAttribute('aria-level', String(depth + 1));
      // Roving tabindex: exactly one row in the tab order; the rest via arrows.
      tr.tabIndex = this.isFocusRow(node.id) ? 0 : -1;
      const parent = parentOf.get(node.id);
      tr.setAttribute('aria-setsize', String(siblingTotals.get(parent) ?? 1));
      tr.setAttribute('aria-posinset', String(siblingPos.get(node.id) ?? 1));
      const hasChildren = !store.isLeaf(node);
      if (hasChildren) {
        tr.setAttribute('aria-expanded', String(store.isExpanded(node)));
      }

      const onClick = (): void => {
        this.focusId = node.id;
        this.opts.onTaskClick?.(node.id);
      };
      const onDbl = (): void => this.opts.onTaskDblClick?.(node.id);
      const onKeyDown = (e: KeyboardEvent): void => this.handleRowKeyDown(e, node, hasChildren);
      tr.addEventListener('click', onClick);
      tr.addEventListener('dblclick', onDbl);
      tr.addEventListener('keydown', onKeyDown);
      this.disposers.push(() => {
        tr.removeEventListener('click', onClick);
        tr.removeEventListener('dblclick', onDbl);
        tr.removeEventListener('keydown', onKeyDown);
      });
      this.columns.forEach((c, i) => {
        const td = createEl('td', { className: 'jects-gantt__tree-td' });
        td.setAttribute('role', 'gridcell');
        td.dataset.field = c.field;
        if (i === 0 && c.field === 'name') {
          td.style.paddingInlineStart = `${depth * 16 + 8}px`;
        }
        if (c.field === ASSIGNMENT_COLUMN_FIELD && this.assignmentRenderer) {
          // Avatar/initials chips; the chip group carries its own accessible
          // name (comma-joined assignees), so no extra text node is needed.
          td.append(this.assignmentRenderer.renderCell(node));
        } else if (c.field === ROLLUP_COLUMN_FIELD) {
          // The 'rollup' data column: a real checkbox toggle (flag mode) or a
          // labelled aggregate (summary mode). Flag toggles route through
          // onRollupToggle (defaulting to a store update so the visual overlay
          // re-reads the same task.rollup flag).
          const cell = buildRollupCell(
            node,
            this.rollupSource(),
            this.rollupConfig(),
            (id, next) => this.toggleRollup(id, next),
          );
          td.append(cell.el);
          this.disposers.push(() => cell.dispose());
        } else {
          td.textContent = this.formatField(c.field, node);
        }
        tr.append(td);
      });
      tbody.append(tr);
    }
    table.append(tbody);
    scroller.append(table);
    this.el.append(scroller);
    this.gridScroller = scroller;
  }

  /** Whether `id` is the row currently holding the roving tabindex. */
  private isFocusRow(id: RecordId): boolean {
    return this.focusId != null && String(this.focusId) === String(id);
  }

  /** Move the roving tabindex to `id`'s row and focus it. */
  private focusRow(id: RecordId): void {
    this.focusId = id;
    const rows = this.el.querySelectorAll<HTMLElement>('.jects-gantt__tree-row');
    let target: HTMLElement | null = null;
    rows.forEach((r) => {
      const on = r.dataset.taskId === String(id);
      r.tabIndex = on ? 0 : -1;
      if (on) target = r;
    });
    (target as HTMLElement | null)?.focus();
  }

  /**
   * Fallback treegrid keyboard model (WAI-ARIA treegrid subset):
   *   - Enter / Space → activate the row (task click),
   *   - ArrowRight → expand (or move into first child),
   *   - ArrowLeft → collapse (or move to parent),
   *   - ArrowDown / ArrowUp → move the focus cursor between visible rows.
   */
  private handleRowKeyDown(
    e: KeyboardEvent,
    node: TaskModel<T> & { children?: TaskModel<T>[] },
    hasChildren: boolean,
  ): void {
    const store = this.opts.store;
    switch (e.key) {
      case 'Enter':
      case ' ':
      case 'Spacebar': {
        e.preventDefault();
        this.opts.onTaskClick?.(node.id);
        return;
      }
      case 'ArrowRight': {
        if (!hasChildren) return;
        e.preventDefault();
        if (!store.isExpanded(node)) {
          void Promise.resolve(store.expand(node)).then(() => {
            this.opts.onRowExpand?.(node.id, true);
          });
        } else {
          const first = (store.getChildren(node)[0] as TaskModel<T> | undefined)?.id;
          if (first != null) this.focusRow(first);
        }
        return;
      }
      case 'ArrowLeft': {
        e.preventDefault();
        if (hasChildren && store.isExpanded(node)) {
          store.collapse(node);
          this.opts.onRowExpand?.(node.id, false);
        } else {
          const { parentOf } = this.tableIndex();
          const parent = parentOf.get(node.id);
          if (parent != null) this.focusRow(parent);
        }
        return;
      }
      case 'ArrowDown': {
        e.preventDefault();
        this.moveRowFocus(node.id, 1);
        return;
      }
      case 'ArrowUp': {
        e.preventDefault();
        this.moveRowFocus(node.id, -1);
        return;
      }
      default:
        return;
    }
  }

  /** Move the focus cursor `delta` rows within the currently-visible rows. */
  private moveRowFocus(fromId: RecordId, delta: number): void {
    const visible = this.opts.store.getVisible();
    const idx = visible.findIndex((v) => String(v.node.id) === String(fromId));
    if (idx === -1) return;
    const next = visible[idx + delta];
    if (next) this.focusRow(next.node.id);
  }

  /** Repaint after a model change (used by the fallback; the grid self-paints). */
  refresh(): void {
    if (this.grid) {
      this.grid.refresh();
    } else {
      this.renderFallback();
    }
  }

  destroy(): void {
    this.destroyed = true;
    for (const d of this.disposers.splice(0)) d();
    this.grid?.destroy();
    this.grid = null;
    this.el.remove();
  }
}
