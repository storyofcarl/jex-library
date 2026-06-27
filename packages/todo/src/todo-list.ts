/**
 * TodoList — a To-Do / checklist manager with a parent-child task hierarchy.
 *
 * Mirrors the reference Button pattern: extends `Widget<Config, Events>`,
 * `defaults()` supplies component defaults, `buildEl()` builds the root once and
 * wires listeners with bound methods (NOT class-field arrows, because `super()`
 * runs `buildEl()` before subclass field initializers), and `render()`
 * idempotently syncs the DOM to the current model + config.
 *
 * Hierarchy / state live in a headless `TodoModel` (wrapping @jects/core
 * `TreeStore`). Reuses @jects/widgets `Checkbox` (done toggle), `TextField`
 * (inline title editor) and `DatePicker` (inline due editor). Registers with the
 * factory as type `todolist`. CSS is token-pure, in `@layer jects.components`.
 *
 * a11y: the list is a `role="tree"` of `role="treeitem"` rows with
 * `aria-level` / `aria-expanded` / `aria-selected`; full keyboard support
 * (arrows to move focus, Enter to edit, Space to toggle done, Tab/Shift+Tab to
 * indent/outdent while a row is active, Delete to remove).
 */

import {
  Widget,
  createEl,
  register,
  escape,
  sanitizeHtml,
  type RecordId,
} from '@jects/core';
import { TextField, DatePicker } from '@jects/widgets';
import { renderIcon, type IconName } from '@jects/icons';

import type {
  TodoListConfig,
  TodoListEvents,
  TodoListApi,
  TodoTask,
  TodoFilter,
  TodoProgress,
  TodoPriority,
  TodoStatus,
  TodoView,
  TodoSort,
  TodoSortField,
  TodoGroupBy,
  TodoFilterCriteria,
  TodoDueFilter,
  TodoSavedFilter,
  TodoChange,
  TodoExportOptions,
  TodoComment,
  TodoAttachment,
  TodoTableColumn,
  TodoTableField,
  TodoTimelineZoom,
  TodoImportOptions,
  TodoTag,
} from './contract.js';
import { TodoModel, nextTaskId } from './todo-model.js';
import {
  childrenOf,
  effectiveDone,
  effectiveStatus,
  computeProgress,
  subtreeProgress,
  passesFilter,
  priorityLabel,
  formatDue,
  isoToDate,
  dateToIso,
  dueStatus,
  dueStatusLabel,
  matchesSearch,
  matchesCriteria,
  sortTree,
  groupKeysOf,
  groupOrder,
  tasksToCsv,
  tasksToJson,
  tasksFromCsv,
  tasksFromJson,
  monthGridDays,
  weekDays,
  timelineBounds,
  dayDiff,
  addDays,
  indexTasks,
  hasOpenBlockers,
  wouldCreateCycle,
  isLeaf,
  DEFAULT_STATUSES,
  PRIORITIES,
  type TodoGroupKey,
} from './todo-utils.js';
import { describeRecurrence } from './todo-recurrence.js';
import {
  mergeMessages,
  formatMessage,
  formatDateLocale,
  formatMonthTitle,
  weekdayNames,
  type TodoMessages,
} from './todo-i18n.js';

const FILTERS: readonly TodoFilter[] = ['all', 'active', 'done'];
const VIEWS: readonly TodoView[] = ['list', 'board', 'calendar', 'timeline', 'table'];
const GROUP_OPTIONS: readonly TodoGroupBy[] = ['none', 'status', 'assignee', 'priority', 'tag', 'due'];
/** Swimlane axes (board second axis) — status is excluded (it is the columns). */
const SWIMLANE_OPTIONS: readonly TodoGroupBy[] = ['none', 'assignee', 'priority', 'tag', 'due'];
const SORT_OPTIONS: readonly TodoSortField[] = ['manual', 'title', 'due', 'startDate', 'priority', 'status', 'created'];
const ZOOMS: readonly TodoTimelineZoom[] = ['day', 'week', 'month'];

/** Default Table-view columns. */
const DEFAULT_TABLE_COLUMNS: readonly TodoTableColumn[] = [
  { field: 'title', label: 'Title', width: 240 },
  { field: 'status', label: 'Status', width: 130 },
  { field: 'priority', label: 'Priority', width: 110 },
  { field: 'assignees', label: 'Assignees', width: 160 },
  { field: 'due', label: 'Due', width: 130 },
  { field: 'startDate', label: 'Start', width: 130 },
  { field: 'estimate', label: 'Est (h)', width: 80 },
  { field: 'timeSpent', label: 'Spent (h)', width: 90 },
];

interface VisibleRow {
  task: TodoTask;
  depth: number;
}

/** Smallest a Table-view column may be dragged. */
const MIN_COLUMN_WIDTH = 56;

export class TodoList extends Widget<TodoListConfig, TodoListEvents> implements TodoListApi {
  private declare model: TodoModel;
  private declare listEl: HTMLElement;
  private declare bodyEl: HTMLElement;
  /** The persistent, LIST-only labeled column header (above the tree body). */
  private declare headerEl: HTMLElement;
  private declare progressEl: HTMLElement | null;
  private declare addInput: HTMLInputElement | null;

  // NOTE: these are assigned in `buildEl()` (which runs inside `super()` BEFORE
  // subclass field initializers). Declaring them with `!` rather than an
  // initializer avoids the field-init-order trap where an initializer would run
  // after the base constructor's first `render()` and clobber the assignment.
  // `declare` (not `!`) is essential: under `useDefineForClassFields`, a plain
  // `field!: T` STILL emits `this.field = undefined` AFTER super() runs, which
  // would clobber the assignment buildEl() makes during super(). `declare`
  // emits nothing, so buildEl()'s assignment survives.
  /** The active inline editor (title field + optional due picker), if any. */
  private declare editor: { id: RecordId; title: TextField; due: DatePicker } | null;
  /** Id of the row that currently owns keyboard focus (roving tabindex). */
  private declare focusedId: RecordId | null;
  /** Drag state for reorder. */
  private declare dragId: RecordId | null;

  // ── enterprise state ──────────────────────────────────────────────────────
  /** Multi-selected task ids. */
  private declare selected: Set<RecordId>;
  /** Last clicked id (anchor for shift-range selection). */
  private declare selectionAnchor: RecordId | null;
  /** The board-view container (built lazily). */
  private declare boardEl: HTMLElement | null;
  /** Calendar / timeline / table view containers (built lazily). */
  private declare calendarEl: HTMLElement | null;
  private declare timelineEl: HTMLElement | null;
  private declare tableEl: HTMLElement | null;
  /** The bulk-action bar (built lazily). */
  private declare bulkBarEl: HTMLElement | null;
  /** The detail side-panel host + the task it edits. */
  private declare detailEl: HTMLElement | null;
  private declare detailId: RecordId | null;
  /** Per-(task,kind) reminder keys already fired (so each fires once). */
  private declare remindedKeys: Set<string>;
  /** Detail-panel field widgets to dispose on close. */
  private declare detailWidgets: Array<{ destroy(): void }>;

  // ── parity additions ───────────────────────────────────────────────────────
  /** Resolved message catalog (English defaults + config overrides). */
  private declare messages: TodoMessages;
  /** Calendar/timeline anchor (the focused month/week). */
  private declare viewAnchor: Date;
  /** The open inline picker / popover (single at a time). */
  private declare popover: HTMLElement | null;
  /** Cleanup for the open popover's outside-click listener. */
  private declare popoverCleanup: (() => void) | null;
  /** Board card drag tracking: the card being dragged over (for Y-reorder). */
  private declare cardDropTarget: { id: RecordId; before: boolean } | null;
  /** Cleanup for an in-flight Table-view column-resize pointer drag. */
  private declare colResizeCleanup: (() => void) | null;

  protected override defaults(): Partial<TodoListConfig> {
    return {
      tasks: [],
      filter: 'all',
      toolbar: true,
      progress: true,
      reorderable: true,
      rollUp: true,
      idField: 'id',
      addPlaceholder: 'Add a task…',
      statuses: DEFAULT_STATUSES.map((s) => ({ ...s })),
      customFieldDefs: [],
      assignees: [],
      view: 'list',
      sortBy: [{ field: 'manual' }],
      groupBy: 'none',
      filters: {},
      search: '',
      savedFilters: [],
      detailPanel: true,
      selectable: true,
      history: true,
      dueSoonDays: 3,
      boardSwimlane: 'none',
      wipEnforce: false,
      timelineZoom: 'week',
      calendarMode: 'month',
    };
  }

  protected buildEl(): HTMLElement {
    // Initialize mutable state HERE. buildEl() runs inside super() before any
    // subclass field initializer, so doing it here (not via field initializers)
    // guarantees the base constructor's first render() sees valid state and that
    // a post-super initializer cannot clobber what render() established.
    this.editor = null;
    this.focusedId = null;
    this.dragId = null;
    this.selected = new Set<RecordId>();
    this.selectionAnchor = null;
    this.colResizeCleanup = null;
    this.boardEl = null;
    this.calendarEl = null;
    this.timelineEl = null;
    this.tableEl = null;
    this.bulkBarEl = null;
    this.detailEl = null;
    this.detailId = null;
    this.remindedKeys = new Set<string>();
    this.detailWidgets = [];
    this.messages = mergeMessages(this.config.messages);
    this.viewAnchor = this.config.now ? this.config.now() : new Date();
    this.popover = null;
    this.popoverCleanup = null;
    this.cardDropTarget = null;

    const root = createEl('div', { className: 'jects-todo' });

    // The model is created here (buildEl runs before field initializers would
    // overwrite it, and render() needs it). config is already merged by super().
    this.model = new TodoModel(
      (this.config.tasks as TodoTask[]) ?? [],
      this.config.idField ?? 'id',
      this.config.statuses,
    );
    this.model.historyEnabled = this.config.history !== false;
    this.model.currentUser = this.config.currentUser;
    this.track(
      this.model.store.events.on('change', () => {
        if (!this.isDestroyed) this.syncBody();
      }),
    );

    // Delegated interactions on the list body.
    root.addEventListener('click', (e) => this.handleClick(e));
    root.addEventListener('keydown', (e) => this.handleKeydown(e));
    root.addEventListener('focusin', (e) => this.handleFocusIn(e));
    root.addEventListener('change', (e) => this.handleChange(e));
    root.addEventListener('input', (e) => this.handleInput(e));
    root.addEventListener('dblclick', (e) => this.handleDblClick(e));
    root.addEventListener('pointerdown', (e) => this.handlePointerDown(e as PointerEvent));

    // Kick off a data-provider load if one is configured (async, after mount).
    if (this.config.dataProvider?.load) {
      queueMicrotask(() => {
        if (!this.isDestroyed) void this.reload();
      });
    }

    // The root element exists now, so delegated DnD listeners can be wired here
    // (they fire only after render() has populated rows). NOTE: `this.el` is not
    // assigned until buildEl() returns, so we wire onto the local `root`.
    this.bindDnd(root);

    return root;
  }

  protected override render(): void {
    const { toolbar = true, progress = true } = this.config;

    this.el.className = ['jects-todo', this.config.cls ?? ''].filter(Boolean).join(' ');

    // Build the stable skeleton once: [toolbar?] [list] [progress?].
    if (!this.bodyEl) {
      if (toolbar) this.el.append(this.buildToolbar());

      // The scrollable area holds either the list (tree) or the board.
      const area = createEl('div', { className: 'jects-todo__area' });

      this.listEl = createEl('div', {
        className: 'jects-todo__list',
        attrs: { role: 'tree', 'aria-label': 'Task list', tabindex: '-1' },
      });
      this.bodyEl = createEl('div', { className: 'jects-todo__body' });
      // A persistent labeled column header sits ABOVE the tree body (list view
      // only). It is appended before the body so the columns read top-down.
      this.headerEl = this.buildListHeader();
      this.listEl.append(this.headerEl, this.bodyEl);

      const empty = createEl('div', {
        className: 'jects-todo__empty',
        attrs: { hidden: 'hidden' },
      });
      empty.textContent = this.t('emptyState');
      this.listEl.append(empty);

      this.boardEl = createEl('div', {
        className: 'jects-todo__board',
        attrs: { hidden: 'hidden', 'aria-label': 'Task board' },
      });

      this.calendarEl = createEl('div', {
        className: 'jects-todo__calendar',
        attrs: { hidden: 'hidden', 'aria-label': 'Task calendar' },
      });
      this.timelineEl = createEl('div', {
        className: 'jects-todo__timeline',
        attrs: { hidden: 'hidden', 'aria-label': 'Task timeline' },
      });
      this.tableEl = createEl('div', {
        className: 'jects-todo__table-wrap',
        attrs: { hidden: 'hidden', 'aria-label': 'Task table' },
      });

      area.append(this.listEl, this.boardEl, this.calendarEl, this.timelineEl, this.tableEl);
      this.el.append(area);

      // Bulk action bar (hidden until a multi-selection exists).
      this.bulkBarEl = this.buildBulkBar();
      this.el.append(this.bulkBarEl);

      if (progress) {
        this.progressEl = this.buildProgress();
        this.el.append(this.progressEl);
      } else {
        this.progressEl = null;
      }
    }

    this.syncFilterButtons();
    this.syncToolbarState();
    this.syncBody();
  }

  // ── toolbar ────────────────────────────────────────────────────────────

  private buildToolbar(): HTMLElement {
    const bar = createEl('div', {
      className: 'jects-todo__toolbar',
      attrs: { role: 'toolbar', 'aria-label': 'Todo controls' },
    });

    const addWrap = createEl('div', { className: 'jects-todo__add' });
    const input = createEl('input', {
      className: 'jects-todo__add-input',
      attrs: {
        type: 'text',
        'aria-label': this.t('addTask'),
        placeholder: this.config.addPlaceholder ?? this.t('addPlaceholder'),
      },
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.commitAdd();
      }
    });
    this.addInput = input;
    const addBtn = createEl('button', {
      className: 'jects-todo__add-btn',
      html: `${renderIcon('plus', { size: 16 })}<span class="jects-todo__sr">${escapeHtml(this.t('addTask'))}</span>`,
      attrs: { type: 'button', 'data-todo-action': 'add', 'aria-label': this.t('addTask') },
    });
    addWrap.append(input, addBtn);

    const filters = createEl('div', {
      className: 'jects-todo__filters',
      attrs: { role: 'group', 'aria-label': 'Filter tasks' },
    });
    for (const f of FILTERS) {
      const btn = createEl('button', {
        className: 'jects-todo__filter',
        attrs: {
          type: 'button',
          'data-todo-filter': f,
          'aria-pressed': 'false',
        },
      });
      btn.textContent = f === 'all' ? this.t('filterAll') : f === 'active' ? this.t('filterActive') : this.t('filterDone');
      filters.append(btn);
    }

    bar.append(addWrap, filters);

    // ── search ──
    const searchWrap = createEl('div', { className: 'jects-todo__search' });
    searchWrap.innerHTML = renderIcon('search', { size: 15 });
    const search = createEl('input', {
      className: 'jects-todo__search-input',
      attrs: { type: 'search', 'data-todo-search': '', 'aria-label': this.t('search'), placeholder: this.t('search') },
    });
    search.value = this.config.search ?? '';
    searchWrap.append(search);
    bar.append(searchWrap);

    // ── group-by + sort ──
    const groupSel = this.buildSelect('data-todo-group', this.t('groupPrefix'), GROUP_OPTIONS.map((g) => ({
      value: g,
      label: g === 'none' ? this.t('noGrouping') : `${this.t('groupPrefix')}: ${capitalize(g)}`,
    })));
    const sortSel = this.buildSelect('data-todo-sort', this.t('sortPrefix'), SORT_OPTIONS.map((s) => ({
      value: s,
      label: s === 'manual' ? this.t('manualOrder') : `${this.t('sortPrefix')}: ${capitalize(s)}`,
    })));
    const sortDir = createEl('button', {
      className: 'jects-todo__sortdir',
      html: renderIcon('arrow-down', { size: 15 }),
      attrs: { type: 'button', 'data-todo-action': 'sortdir', 'aria-label': 'Toggle sort direction', 'aria-pressed': 'false' },
    });
    bar.append(groupSel, sortSel, sortDir);

    // ── view toggle ──
    const views = createEl('div', {
      className: 'jects-todo__views',
      attrs: { role: 'group', 'aria-label': 'View' },
    });
    for (const v of VIEWS) {
      const btn = createEl('button', {
        className: 'jects-todo__view',
        attrs: { type: 'button', 'data-todo-view': v, 'aria-pressed': 'false' },
      });
      btn.textContent = this.viewLabel(v);
      views.append(btn);
    }
    bar.append(views);

    // ── board swimlane (second axis) ──
    const swimSel = this.buildSelect('data-todo-swimlane', this.t('swimlanePrefix'), SWIMLANE_OPTIONS.map((g) => ({
      value: g,
      label: g === 'none' ? this.t('noSwimlane') : `${this.t('swimlanePrefix')}: ${capitalize(g)}`,
    })));
    bar.append(swimSel);

    // ── multi-sort + filter builder + table columns ──
    const multiSortBtn = createEl('button', {
      className: 'jects-todo__toolbtn',
      html: `${renderIcon('menu', { size: 15 })}<span class="jects-todo__sr">${escapeHtml(this.t('addSort'))}</span>`,
      attrs: { type: 'button', 'data-todo-action': 'multi-sort', 'aria-label': this.t('addSort') },
    });
    const filterBtn = createEl('button', {
      className: 'jects-todo__toolbtn',
      html: `${renderIcon('filter', { size: 15 })}<span class="jects-todo__sr">${escapeHtml(this.t('filterBuilder'))}</span>`,
      attrs: { type: 'button', 'data-todo-action': 'filter-builder', 'aria-label': this.t('filterBuilder') },
    });
    const columnsBtn = createEl('button', {
      className: 'jects-todo__toolbtn',
      html: `${renderIcon('more-vertical', { size: 15 })}<span class="jects-todo__sr">${escapeHtml(this.t('columns'))}</span>`,
      attrs: { type: 'button', 'data-todo-action': 'columns', 'aria-label': this.t('columns') },
    });
    bar.append(multiSortBtn, filterBtn, columnsBtn);

    // ── saved filters ──
    const savedSel = this.buildSelect('data-todo-saved', 'Saved filters', [{ value: '', label: 'Saved filters…' }]);
    const saveBtn = createEl('button', {
      className: 'jects-todo__save',
      html: renderIcon('filter', { size: 15 }),
      attrs: { type: 'button', 'data-todo-action': 'save-filter', 'aria-label': 'Save current filter' },
    });
    bar.append(savedSel, saveBtn);

    // ── undo / redo ──
    const undoBtn = createEl('button', {
      className: 'jects-todo__hist',
      html: `${renderIcon('chevron-left', { size: 15 })}<span class="jects-todo__sr">${escapeHtml(this.t('undo'))}</span>`,
      attrs: { type: 'button', 'data-todo-action': 'undo', 'aria-label': this.t('undo'), disabled: 'disabled' },
    });
    const redoBtn = createEl('button', {
      className: 'jects-todo__hist',
      html: `${renderIcon('chevron-right', { size: 15 })}<span class="jects-todo__sr">${escapeHtml(this.t('redo'))}</span>`,
      attrs: { type: 'button', 'data-todo-action': 'redo', 'aria-label': this.t('redo'), disabled: 'disabled' },
    });
    bar.append(undoBtn, redoBtn);

    return bar;
  }

  /** Build a labelled native `<select>` with the given option list. */
  private buildSelect(
    dataAttr: string,
    ariaLabel: string,
    options: Array<{ value: string; label: string }>,
  ): HTMLSelectElement {
    const sel = createEl('select', {
      className: 'jects-todo__select',
      attrs: { [dataAttr]: '', 'aria-label': ariaLabel },
    }) as HTMLSelectElement;
    for (const o of options) {
      const opt = document.createElement('option');
      opt.value = o.value;
      opt.textContent = o.label;
      sel.append(opt);
    }
    return sel;
  }

  /** Reflect current view/group/sort/history into the toolbar controls. */
  private syncToolbarState(): void {
    if (this.config.toolbar === false) return;
    const view = this.getView();
    for (const btn of this.el.querySelectorAll<HTMLElement>('[data-todo-view]')) {
      const on = btn.dataset.todoView === view;
      btn.setAttribute('aria-pressed', String(on));
      btn.classList.toggle('jects-todo__view--active', on);
    }
    const groupSel = this.el.querySelector<HTMLSelectElement>('[data-todo-group]');
    if (groupSel) groupSel.value = this.getGroupBy();
    const swimSel = this.el.querySelector<HTMLSelectElement>('[data-todo-swimlane]');
    if (swimSel) {
      swimSel.value = this.getBoardSwimlane();
      // The swimlane axis only applies to the board view.
      swimSel.hidden = view !== 'board';
    }
    // The table-column menu button only applies to the table view.
    const colsBtn = this.el.querySelector<HTMLElement>('[data-todo-action="columns"]');
    if (colsBtn) colsBtn.hidden = view !== 'table';
    const sort = this.getSort()[0] ?? { field: 'manual' };
    const sortSel = this.el.querySelector<HTMLSelectElement>('[data-todo-sort]');
    if (sortSel) sortSel.value = sort.field;
    const sortDir = this.el.querySelector<HTMLElement>('[data-todo-action="sortdir"]');
    if (sortDir) {
      const desc = sort.dir === 'desc';
      sortDir.setAttribute('aria-pressed', String(desc));
      sortDir.innerHTML = renderIcon(desc ? 'arrow-up' : 'arrow-down', { size: 15 });
    }
    // Saved filters menu.
    const savedSel = this.el.querySelector<HTMLSelectElement>('[data-todo-saved]');
    if (savedSel) {
      const saved = this.getSavedFilters();
      savedSel.replaceChildren();
      const head = document.createElement('option');
      head.value = '';
      head.textContent = this.t('savedFilters');
      savedSel.append(head);
      for (const f of saved) {
        const opt = document.createElement('option');
        opt.value = f.id;
        opt.textContent = f.name;
        savedSel.append(opt);
      }
    }
    // Undo/redo enablement.
    const undoBtn = this.el.querySelector<HTMLButtonElement>('[data-todo-action="undo"]');
    const redoBtn = this.el.querySelector<HTMLButtonElement>('[data-todo-action="redo"]');
    if (undoBtn) undoBtn.disabled = !this.canUndo();
    if (redoBtn) redoBtn.disabled = !this.canRedo();
  }

  private syncFilterButtons(): void {
    const active = this.getFilter();
    for (const btn of this.el.querySelectorAll<HTMLElement>('[data-todo-filter]')) {
      const on = btn.dataset.todoFilter === active;
      btn.setAttribute('aria-pressed', String(on));
      btn.classList.toggle('jects-todo__filter--active', on);
    }
  }

  // ── progress ─────────────────────────────────────────────────────────────

  private buildProgress(): HTMLElement {
    const wrap = createEl('div', { className: 'jects-todo__progress' });
    const bar = createEl('div', {
      className: 'jects-todo__progress-track',
      attrs: {
        role: 'progressbar',
        'aria-label': 'Tasks complete',
        'aria-valuemin': '0',
        'aria-valuemax': '100',
        'aria-valuenow': '0',
      },
    });
    const fill = createEl('div', { className: 'jects-todo__progress-fill' });
    bar.append(fill);
    const label = createEl('span', {
      className: 'jects-todo__progress-label',
      attrs: { 'aria-hidden': 'true' },
    });
    label.textContent = '0 / 0';
    wrap.append(bar, label);
    return wrap;
  }

  private syncProgress(progress: TodoProgress): void {
    if (!this.progressEl) return;
    const bar = this.progressEl.querySelector('.jects-todo__progress-track') as HTMLElement;
    const fill = this.progressEl.querySelector('.jects-todo__progress-fill') as HTMLElement;
    const label = this.progressEl.querySelector('.jects-todo__progress-label') as HTMLElement;
    bar.setAttribute('aria-valuenow', String(progress.percent));
    bar.setAttribute('aria-valuetext', `${progress.done} of ${progress.total} tasks complete`);
    fill.style.inlineSize = `${progress.percent}%`;
    label.textContent = `${progress.done} / ${progress.total}`;
  }

  // ── list body ────────────────────────────────────────────────────────────

  /** Roots as a sort-applied view (clones when a sort is active, else the live tree). */
  private sortedRoots(): TodoTask[] {
    const sort = this.getSort();
    return sortTree(this.model.roots, sort, this.statuses());
  }

  /** Whether search / multi-criteria filtering is currently narrowing results. */
  private isQueryActive(): boolean {
    if ((this.config.search ?? '').trim()) return true;
    const c = this.config.filters;
    return !!(c && (c.status?.length || c.priority?.length || c.assignees?.length || c.tags?.length || (c.due && c.due !== 'any') || c.milestone !== undefined));
  }

  /** A task itself matches the active search + multi-criteria filter. */
  private taskMatchesQuery(task: TodoTask): boolean {
    if (!matchesSearch(task, this.config.search ?? '')) return false;
    if (!matchesCriteria(task, this.config.filters, this.statuses(), this.now(), this.config.dueSoonDays ?? 3)) return false;
    return true;
  }

  /** True when a task or any descendant matches the active query. */
  private subtreeMatchesQuery(task: TodoTask): boolean {
    if (this.taskMatchesQuery(task)) return true;
    return childrenOf(task).some((c) => this.subtreeMatchesQuery(c));
  }

  /**
   * Compute the visible rows for the LIST view (filtered + sorted, respecting
   * expansion). The legacy `filter` is a hard per-subtree gate (unchanged); the
   * search + multi-criteria query keeps ANCESTORS of matches visible and expands
   * the path to them even when a parent is collapsed.
   */
  private visibleRows(): VisibleRow[] {
    const filter = this.getFilter();
    const queryActive = this.isQueryActive();
    const rows: VisibleRow[] = [];
    const walk = (tasks: TodoTask[], depth: number): void => {
      for (const task of tasks) {
        if (!passesFilter(task, filter)) continue;
        if (queryActive && !this.subtreeMatchesQuery(task)) continue;
        rows.push({ task, depth });
        const kids = childrenOf(task);
        if (!kids.length) continue;
        const expanded = this.model.isExpanded(this.idOf(task));
        // When a query is active, reveal the path to matches regardless of the
        // stored expansion state.
        if (expanded || (queryActive && kids.some((c) => this.subtreeMatchesQuery(c)))) {
          walk(kids, depth + 1);
        }
      }
    };
    walk(this.sortedRoots(), 0);
    return rows;
  }

  /** Flat list of every task that itself matches the legacy filter + query. */
  private matchingTasks(): TodoTask[] {
    const filter = this.getFilter();
    const out: TodoTask[] = [];
    const walk = (tasks: TodoTask[]): void => {
      for (const task of tasks) {
        if (passesFilter(task, filter) && (!this.isQueryActive() || this.taskMatchesQuery(task))) {
          out.push(task);
        }
        walk(childrenOf(task));
      }
    };
    walk(this.sortedRoots());
    return out;
  }

  /** Dispatch rendering to the active view, then sync derived chrome. */
  private syncBody(): void {
    if (!this.bodyEl || !this.boardEl || !this.calendarEl || !this.timelineEl || !this.tableEl) return;

    const view = this.getView();
    // Hide every view container, then reveal + render the active one.
    this.listEl.hidden = true;
    this.boardEl.hidden = true;
    this.calendarEl.hidden = true;
    this.timelineEl.hidden = true;
    this.tableEl.hidden = true;

    if (view === 'board') {
      this.boardEl.hidden = false;
      this.syncBoard();
    } else if (view === 'calendar') {
      this.calendarEl.hidden = false;
      this.syncCalendar();
    } else if (view === 'timeline') {
      this.timelineEl.hidden = false;
      this.syncTimeline();
    } else if (view === 'table') {
      this.tableEl.hidden = false;
      this.syncTable();
    } else {
      this.listEl.hidden = false;
      if (this.getGroupBy() === 'none') this.syncListTree();
      else this.syncListGrouped();
    }

    this.syncBulkBar();
    this.syncToolbarState();
    this.refreshDetail();

    const progress = this.getProgress();
    this.syncProgress(progress);
    this.emit('progress', { list: this, ...progress });
    this.checkReminders();
  }

  /** Render the hierarchical tree list (the default view). */
  private syncListTree(): void {
    // If a row currently holds DOM focus, restore it after the rebuild so the
    // keyboard user is not dumped back to the document body.
    const active = this.bodyEl.contains(document.activeElement)
      ? (document.activeElement as HTMLElement).closest<HTMLElement>('[data-todo-id]')
      : null;
    const refocusId = active?.dataset.todoId ? this.resolveId(active.dataset.todoId) : null;

    this.teardownRows();
    this.bodyEl.replaceChildren();

    const rows = this.visibleRows();
    const ids = rows.map((r) => this.idOf(r.task));

    // Keep roving focus valid.
    if (this.focusedId == null || !ids.includes(this.focusedId)) {
      this.focusedId = ids[0] ?? null;
    }

    for (const row of rows) this.bodyEl.append(this.buildRow(row));

    const empty = this.el.querySelector('.jects-todo__empty') as HTMLElement | null;
    if (empty) empty.hidden = rows.length > 0;
    // Show the labeled column header only when there are rows to label.
    this.headerEl.hidden = rows.length === 0;

    // An empty `role="tree"` violates aria-required-children. Only expose the
    // tree role when there is at least one treeitem; otherwise the list is a
    // plain group containing the empty-state message.
    if (rows.length > 0) {
      this.listEl.setAttribute('role', 'tree');
    } else {
      this.listEl.removeAttribute('role');
    }

    // Restore DOM focus to the row that had it (now a fresh element).
    if (refocusId != null && ids.includes(refocusId)) {
      this.focusedId = refocusId;
      this.syncRoving();
      this.rowEl(refocusId)?.focus();
    }
  }

  /** Render a flat, group-by-axis list with group headers + counts. */
  private syncListGrouped(): void {
    this.teardownRows();
    this.bodyEl.replaceChildren();

    const groupBy = this.getGroupBy();
    const tasks = this.matchingTasks();
    const groups = this.bucketByGroup(tasks, groupBy);

    const ids: RecordId[] = [];
    for (const g of groups) {
      const header = createEl('div', {
        className: 'jects-todo__group-header',
        attrs: { role: 'presentation' },
      });
      const swatch = g.color
        ? `<span class="jects-todo__group-swatch" style="background:oklch(${g.color})"></span>`
        : '';
      header.innerHTML = `${swatch}<span class="jects-todo__group-label">${escapeHtml(g.label)}</span><span class="jects-todo__group-count">${g.tasks.length}</span>`;
      this.bodyEl.append(header);
      for (const task of g.tasks) {
        ids.push(this.idOf(task));
        this.bodyEl.append(this.buildRow({ task, depth: 0 }));
      }
    }

    if (this.focusedId == null || !ids.includes(this.focusedId)) {
      this.focusedId = ids[0] ?? null;
    }
    const empty = this.el.querySelector('.jects-todo__empty') as HTMLElement | null;
    if (empty) empty.hidden = ids.length > 0;
    this.headerEl.hidden = ids.length === 0;
    if (ids.length > 0) this.listEl.setAttribute('role', 'tree');
    else this.listEl.removeAttribute('role');
    this.syncRoving();
  }

  /** Group a flat task list by an axis into ordered, labelled buckets. */
  private bucketByGroup(
    tasks: TodoTask[],
    groupBy: TodoGroupBy,
  ): Array<TodoGroupKey & { tasks: TodoTask[] }> {
    const map = new Map<string, TodoGroupKey & { tasks: TodoTask[] }>();
    const now = this.now();
    const soon = this.config.dueSoonDays ?? 3;
    for (const task of tasks) {
      for (const key of groupKeysOf(task, groupBy, this.statuses(), now, soon)) {
        let bucket = map.get(key.key);
        if (!bucket) {
          bucket = { ...key, tasks: [] };
          map.set(key.key, bucket);
        }
        bucket.tasks.push(task);
      }
    }
    // Order by the axis' canonical order, then any extras alphabetically.
    const order = groupOrder(groupBy, this.statuses());
    const out = [...map.values()];
    out.sort((a, b) => {
      const ia = order.indexOf(a.key);
      const ib = order.indexOf(b.key);
      if (ia !== -1 || ib !== -1) return (ia === -1 ? 1e9 : ia) - (ib === -1 ? 1e9 : ib);
      return a.label.localeCompare(b.label);
    });
    return out;
  }

  /** Tear down any open inline editor before re-rendering rows. */
  private teardownRows(): void {
    this.closeEditor(false);
  }

  private buildRow(row: VisibleRow): HTMLElement {
    const { task, depth } = row;
    const id = this.idOf(task);
    const idStr = String(id);
    const kids = childrenOf(task);
    const hasKids = kids.length > 0;
    const expanded = hasKids && this.model.isExpanded(id);
    const done = effectiveDone(task);
    const priority = (task.priority ?? 'none') as TodoPriority;
    const isFocused = this.focusedId === id;
    const isSelected = this.selected.has(id);
    const status = effectiveStatus(task, this.statuses());
    const ds = done ? 'none' : dueStatus(task.due, this.now(), this.config.dueSoonDays ?? 3);

    const rowEl = createEl('div', {
      className: [
        'jects-todo__row',
        done ? 'jects-todo__row--done' : '',
        hasKids ? 'jects-todo__row--parent' : '',
        priority !== 'none' ? `jects-todo__row--p-${priority}` : '',
        isSelected ? 'jects-todo__row--selected' : '',
        ds !== 'none' && ds !== 'upcoming' ? `jects-todo__row--due-${ds}` : '',
      ]
        .filter(Boolean)
        .join(' '),
      attrs: {
        role: 'treeitem',
        'data-todo-id': idStr,
        'aria-level': String(depth + 1),
        'aria-selected': String(isFocused),
        tabindex: isFocused ? '0' : '-1',
      },
    });
    rowEl.style.setProperty('--_todo-depth', String(depth));
    if (hasKids) rowEl.setAttribute('aria-expanded', String(expanded));
    if (this.config.reorderable !== false) rowEl.setAttribute('draggable', 'true');

    // Multi-select affordance (pointer-only; aria-hidden so the row stays a
    // single composite treeitem). Keyboard selection is via ctrl/shift handlers.
    if (this.config.selectable !== false) {
      const selBox = createEl('span', {
        className: ['jects-todo__rowsel', isSelected ? 'jects-todo__rowsel--on' : ''].filter(Boolean).join(' '),
        html: isSelected ? renderIcon('check', { size: 13 }) : '',
        attrs: { 'data-todo-select': '', 'aria-hidden': 'true', title: this.t('selectTask') },
      });
      rowEl.append(selBox);
    }

    // Twisty (expand/collapse) — a redundant POINTER affordance only. Expansion
    // is exposed on the row itself via `aria-expanded` and operated from the
    // keyboard with ArrowRight/ArrowLeft, so the twisty is `aria-hidden` to keep
    // the row a single composite `treeitem` (no nested interactive a11y nodes).
    const twisty = createEl('button', {
      className: 'jects-todo__twisty',
      attrs: {
        type: 'button',
        tabindex: '-1',
        'data-todo-action': 'twisty',
        'aria-hidden': 'true',
        'aria-label': expanded ? 'Collapse' : 'Expand',
      },
    });
    // jects-safe-html: renderIcon output (static icon markup) or empty string
    twisty.innerHTML = hasKids
      ? renderIcon(expanded ? 'chevron-down' : 'chevron-right', { size: 16 })
      : '';
    if (!hasKids) twisty.disabled = true;
    // NOTE: the twisty is appended INSIDE the Task cell (below) so depth
    // indentation stays inside that grid column and the columns stay aligned.

    // Done toggle — a labeled button that literally reads "Done" so its purpose
    // is obvious without a tooltip (a checkbox would just be an unlabeled box).
    // Toggles completion and reflects done / partially-done state. Pointer
    // affordance (aria-hidden): the keyboard path is Space on the row, keeping
    // the row a single composite `treeitem` with no nested interactive a11y node.
    const donePartial = hasKids && !done && kids.some((c) => effectiveDone(c));
    const doneBtn = createEl('button', {
      className: [
        'jects-todo__done',
        done ? 'jects-todo__done--on' : '',
        donePartial ? 'jects-todo__done--partial' : '',
      ]
        .filter(Boolean)
        .join(' '),
      attrs: {
        type: 'button',
        tabindex: '-1',
        'aria-hidden': 'true',
        'aria-pressed': String(done),
        'data-todo-action': 'done',
        title: this.t('markComplete'),
      },
    });
    // jects-safe-html: renderIcon output + escapeHtml'd label only
    doneBtn.innerHTML =
      `<span class="jects-todo__done-mark" aria-hidden="true">${done ? renderIcon('check', { size: 12 }) : ''}</span>` +
      `<span class="jects-todo__done-text">${escapeHtml(this.t('colDone'))}</span>`;
    rowEl.append(doneBtn);

    // Status pill (cycles through the workflow on click). Pointer affordance —
    // aria-hidden; the status is conveyed to SR in the title status text.
    if (this.statuses().length > 1) {
      const pill = createEl('button', {
        className: 'jects-todo__status',
        attrs: { type: 'button', tabindex: '-1', 'aria-hidden': 'true', 'data-todo-inline': 'status', title: formatMessage(this.t('changeStatus'), { status: status.label }) },
      });
      if (status.color) pill.style.setProperty('--_status-color', status.color);
      pill.textContent = status.label;
      rowEl.append(pill);
    }

    // ── Task cell (column 4) ─────────────────────────────────────────────
    // Holds the twisty + title on the first line and a wrapped SECONDARY line
    // of chips (tags / effort / recurrence / deps / custom fields) beneath.
    // Depth indentation lives HERE (not on the row) so the grid columns stay
    // aligned with the header regardless of nesting depth.
    const taskCell = createEl('div', { className: 'jects-todo__task' });
    taskCell.append(twisty);

    const main = createEl('div', { className: 'jects-todo__main' });
    const titleEl = createEl('span', {
      className: 'jects-todo__title',
      attrs: this.config.detailPanel !== false ? { 'data-todo-action': 'detail' } : {},
    });
    titleEl.textContent = task.title || '(untitled)';
    // Surface completion / status to assistive tech (the visible cue is the
    // checkbox + strike-through, both decorative for SR). Keeps the row's
    // accessible name describing its done/active state without a nested control.
    const srStatus = createEl('span', {
      className: 'jects-todo__sr',
      attrs: { 'data-todo-status': '' },
    });
    const dsLabel = dueStatusLabel(ds);
    srStatus.textContent = `, ${status.label}${dsLabel ? `, ${dsLabel}` : ''}`;
    // Milestone marker (a diamond) before the title text.
    if (task.milestone) {
      const ms = createEl('span', { className: 'jects-todo__milestone', attrs: { 'aria-hidden': 'true', title: this.t('milestone') } });
      titleEl.prepend(ms);
    }
    titleEl.append(srStatus);
    main.append(titleEl);
    // Parent progress badge (done/total + mini bar) computed from descendants.
    if (hasKids) main.append(this.buildProgressBadge(task));
    taskCell.append(main);

    // Secondary chips line — wraps beneath the title INSIDE the Task cell so
    // tags / custom fields do not need their own header columns.
    const meta = createEl('span', { className: 'jects-todo__meta', attrs: { 'aria-hidden': 'false' } });
    // Tags — only render the chip row when the task actually HAS tags, so simple
    // tasks stay a single compact line (no lone "+" forcing a second row). Tags
    // are added/edited from the detail panel or by clicking an existing tag.
    if (task.tags?.length) {
      const tagWrap = createEl('button', {
        className: 'jects-todo__tags jects-todo__inline',
        attrs: { type: 'button', tabindex: '-1', 'aria-hidden': 'true', 'data-todo-inline': 'tag' },
      });
      for (const tag of task.tags) {
        const tEl = createEl('span', { className: 'jects-todo__tag' });
        if (tag.color) tEl.style.setProperty('--_tag-color', tag.color);
        tEl.textContent = tag.text;
        tagWrap.append(tEl);
      }
      meta.append(tagWrap);
    }
    // Effort / estimate.
    if (task.estimate != null || task.timeSpent != null) {
      const eEl = createEl('span', { className: 'jects-todo__effort' });
      const spent = task.timeSpent != null ? `${task.timeSpent}h` : '0h';
      const est = task.estimate != null ? `${task.estimate}h` : '—';
      eEl.innerHTML = `${renderIcon('clock', { size: 12 })}<span>${escapeHtml(spent)} / ${escapeHtml(est)}</span>`;
      meta.append(eEl);
    }
    // Running-timer indicator.
    if (task.timerStartedAt != null) {
      const tEl = createEl('span', { className: 'jects-todo__timer-on', attrs: { title: this.t('timerRunning') } });
      tEl.innerHTML = `${renderIcon('clock', { size: 12 })}`;
      meta.append(tEl);
    }
    // Recurrence indicator.
    if (task.recurrence) {
      const rEl = createEl('span', { className: 'jects-todo__recur', attrs: { title: describeRecurrence(task.recurrence) } });
      rEl.textContent = '↻';
      meta.append(rEl);
    }
    // Dependency indicator.
    const blockedBy = task.dependencies?.blockedBy?.length ?? 0;
    if (blockedBy > 0) {
      const dEl = createEl('span', { className: 'jects-todo__dep' });
      dEl.innerHTML = `${renderIcon('alert-triangle', { size: 12 })}<span>${blockedBy}</span>`;
      meta.append(dEl);
    }
    // Custom fields flagged for the row.
    for (const def of this.config.customFieldDefs ?? []) {
      if (!def.showOnRow) continue;
      const v = task.customFields?.[def.id];
      if (v == null || v === '' || v === false) continue;
      const cEl = createEl('span', { className: 'jects-todo__cf' });
      cEl.textContent = `${def.label}: ${String(v)}`;
      meta.append(cEl);
    }
    if (meta.childElementCount) taskCell.append(meta);
    rowEl.append(taskCell);

    // ── Assignees cell (column 5) ────────────────────────────────────────
    const av = createEl('button', {
      className: 'jects-todo__avatars jects-todo__inline',
      attrs: { type: 'button', tabindex: '-1', 'aria-hidden': 'true', 'data-todo-inline': 'assignee' },
    });
    for (const a of (task.assignees ?? []).slice(0, 4)) {
      const chip = createEl('span', { className: 'jects-todo__avatar', attrs: { title: a } });
      chip.textContent = initials(a);
      chip.style.setProperty('--_avatar-color', avatarColor(a));
      av.append(chip);
    }
    // jects-safe-html: static markup; no interpolation
    if (!(task.assignees?.length)) av.innerHTML = `<span class="jects-todo__avatar jects-todo__avatar--add">+</span>`;
    rowEl.append(av);

    // ── Due cell (column 6) ──────────────────────────────────────────────
    const dueEl = createEl('button', {
      className: ['jects-todo__due', 'jects-todo__inline', ds !== 'none' && ds !== 'upcoming' ? `jects-todo__due--${ds}` : ''].filter(Boolean).join(' '),
      attrs: { type: 'button', tabindex: '-1', 'aria-hidden': 'true', 'data-todo-inline': 'due' },
    });
    dueEl.innerHTML = `${renderIcon('calendar', { size: 13 })}<span>${escapeHtml(task.due ? this.fmtDate(task.due) : '—')}</span>`;
    rowEl.append(dueEl);

    // ── Priority cell (column 7) ─────────────────────────────────────────
    const pEl = createEl('button', {
      className: `jects-todo__priority jects-todo__inline jects-todo__priority--${priority}`,
      attrs: { type: 'button', tabindex: '-1', 'aria-hidden': 'true', 'data-todo-inline': 'priority' },
    });
    pEl.textContent = priority === 'none' ? '—' : priorityLabel(priority);
    rowEl.append(pEl);

    // ── Actions cell (column 8) ──────────────────────────────────────────
    // All actions are ALWAYS visible (subtle at rest, stronger on hover) — the
    // "+ subtask" affordance leads so adding a nested todo is discoverable.
    const actions = createEl('span', { className: 'jects-todo__actions' });
    actions.append(this.addSubtaskButton());
    if (this.config.detailPanel !== false) {
      actions.append(this.actionButton('detail', 'more-horizontal', 'Open details'));
    }
    actions.append(
      this.actionButton('edit', 'edit', 'Edit task'),
      this.actionButton('delete', 'trash', 'Delete task'),
    );
    rowEl.append(actions);

    return rowEl;
  }

  /**
   * Build the persistent, LIST-only labeled column header. It is a visual /
   * pointer affordance (`aria-hidden`) so it never appears as a child of the
   * `role="tree"` body — which must own only `treeitem` children — and so it
   * cannot break `aria-required-children` or the roving-tabindex focus order.
   * Screen-reader users get the same data from each row's accessible name.
   */
  private buildListHeader(): HTMLElement {
    const header = createEl('div', {
      className: 'jects-todo__header',
      attrs: { 'aria-hidden': 'true', role: 'presentation', hidden: 'hidden' },
    });

    // Leading cell: a "select all" checkbox (pointer affordance — keyboard
    // users select via ctrl/shift-click or the public selectAll/clearSelection).
    if (this.config.selectable !== false) {
      const selAll = createEl('span', {
        className: 'jects-todo__rowsel jects-todo__selall',
        attrs: { 'data-todo-select-all': '', title: this.t('selectAll') },
      });
      header.append(selAll);
    } else {
      header.append(createEl('span', { className: 'jects-todo__hcell jects-todo__hcell--lead' }));
    }

    const col = (key: keyof TodoMessages, mod: string): HTMLElement =>
      createEl('span', { className: `jects-todo__hcell jects-todo__hcell--${mod}`, text: this.t(key) });

    header.append(
      col('colDone', 'done'),
      col('colStatus', 'status'),
      col('colTask', 'task'),
      col('colPeople', 'people'),
      col('colDue', 'due'),
      col('colPriority', 'priority'),
      createEl('span', { className: 'jects-todo__hcell jects-todo__hcell--actions' }),
    );
    return header;
  }

  /**
   * The always-visible "+ subtask" affordance. A pointer extra (`aria-hidden`,
   * `tabindex=-1`) to keep the row a single composite `treeitem`; the keyboard
   * equivalent is Shift+Enter on the focused row.
   */
  private addSubtaskButton(): HTMLElement {
    const label = this.t('addSubtask');
    return createEl('button', {
      className: 'jects-todo__addsub',
      html: `${renderIcon('plus', { size: 14 })}<span class="jects-todo__addsub-text">${escapeHtml(label)}</span>`,
      attrs: {
        type: 'button',
        tabindex: '-1',
        'aria-hidden': 'true',
        'data-todo-action': 'addsub',
        'aria-label': label,
        title: label,
      },
    });
  }

  private actionButton(action: string, icon: IconName, label: string): HTMLElement {
    // Redundant POINTER affordances: every row action has a keyboard equivalent
    // bound on the row itself (Enter = edit, Delete/Backspace = remove), so the
    // buttons are `aria-hidden` to keep the row a single composite `treeitem`
    // with no separately-focusable interactive descendants in the a11y tree.
    return createEl('button', {
      className: 'jects-todo__action',
      html: `${renderIcon(icon, { size: 15 })}<span class="jects-todo__sr">${escapeHtml(label)}</span>`,
      attrs: {
        type: 'button',
        tabindex: '-1',
        'aria-hidden': 'true',
        'data-todo-action': action,
        'aria-label': label,
      },
    });
  }

  // ── inline add / edit ─────────────────────────────────────────────────────

  private commitAdd(): void {
    const input = this.addInput;
    if (!input) return;
    const title = input.value.trim();
    if (!title) return;
    const created = this.addTask({ title });
    if (created) {
      input.value = '';
      input.focus();
    }
  }

  /**
   * Add a child task under `parentId`, expand the parent so the new row shows
   * nested, then open the inline title editor on it. Backs the always-visible
   * "+ subtask" row affordance and the Shift+Enter keyboard shortcut.
   */
  private addSubtask(parentId: RecordId): void {
    const created = this.addTask({ title: '' }, parentId);
    if (!created) return;
    // Expand the parent (model 'change' triggers a re-render via the store
    // subscription, so the new child row exists before we open the editor).
    if (!this.model.isExpanded(parentId)) this.expand(parentId);
    const childId = this.idOf(created);
    this.focusedId = childId;
    if (this.rowEl(childId)) this.openEditor(childId);
  }

  /** Open an inline editor (title + due) over a row. */
  private openEditor(id: RecordId): void {
    const task = this.model.getTask(id);
    if (!task) return;
    this.closeEditor(false);

    const rowEl = this.rowEl(id);
    if (!rowEl) return;
    rowEl.classList.add('jects-todo__row--editing');

    const editEl = createEl('div', { className: 'jects-todo__editor' });
    const titleHost = createEl('div', { className: 'jects-todo__editor-title' });
    const dueHost = createEl('div', { className: 'jects-todo__editor-due' });
    editEl.append(titleHost, dueHost);

    const main = rowEl.querySelector('.jects-todo__main') as HTMLElement;
    main.hidden = true;
    main.after(editEl);

    const title = new TextField(titleHost, {
      value: task.title,
      ariaLabel: 'Task title',
      cls: 'jects-todo__editor-field',
    });
    const due = new DatePicker(dueHost, {
      value: isoToDate(task.due),
    });

    const commit = (): void => this.commitEditor();
    title.on('change', commit);
    // Enter inside the title field commits; Escape cancels.
    title.el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.commitEditor();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.closeEditor(true);
      }
    });
    due.on('change', commit);

    this.editor = { id, title, due };
    title.focus();
  }

  private commitEditor(): void {
    if (!this.editor) return;
    const { id, title, due } = this.editor;
    const changes: Partial<TodoTask> = {
      title: title.getValue().trim() || '(untitled)',
      due: dateToIso(due.getConfig().value ?? null),
    };
    this.editor = null;
    title.destroy();
    due.destroy();
    this.updateTask(id, changes);
  }

  /** Close the editor without committing. `restoreFocus` re-focuses the row. */
  private closeEditor(restoreFocus: boolean): void {
    if (!this.editor) return;
    const { id, title, due } = this.editor;
    this.editor = null;
    title.destroy();
    due.destroy();
    const rowEl = this.rowEl(id);
    if (rowEl) {
      rowEl.classList.remove('jects-todo__row--editing');
      const editEl = rowEl.querySelector('.jects-todo__editor');
      editEl?.remove();
      const main = rowEl.querySelector('.jects-todo__main') as HTMLElement | null;
      if (main) main.hidden = false;
      if (restoreFocus) this.focusRow(id);
    }
  }

  // ── DOM event handlers ─────────────────────────────────────────────────────

  /** Begin a Table-view column-resize drag when a header edge handle is pressed. */
  private handlePointerDown(event: PointerEvent): void {
    if (event.button !== 0) return;
    const handle = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-table-resize]');
    if (!handle) return;
    event.preventDefault();
    this.startColumnResize(handle, event.clientX, event.pointerId);
  }

  private handleClick(event: Event): void {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    const mouse = event as MouseEvent;

    const filterBtn = target.closest<HTMLElement>('[data-todo-filter]');
    if (filterBtn) {
      this.setFilter(filterBtn.dataset.todoFilter as TodoFilter);
      return;
    }

    const viewBtn = target.closest<HTMLElement>('[data-todo-view]');
    if (viewBtn) {
      this.setView(viewBtn.dataset.todoView as TodoView);
      return;
    }

    // Bulk-action bar buttons (carry data-todo-bulk).
    const bulkBtn = target.closest<HTMLElement>('[data-todo-bulk]');
    if (bulkBtn) {
      const action = bulkBtn.dataset.todoBulk ?? '';
      if (action === 'assign') {
        this.openAssigneePicker(bulkBtn, [], (next) => this.bulkAssign(next));
      } else {
        this.runBulk(action);
      }
      return;
    }

    // "Select all" header checkbox — toggles between select-all / clear.
    const selAll = target.closest<HTMLElement>('[data-todo-select-all]');
    if (selAll) {
      const ids = this.renderedIds();
      const allSelected = ids.length > 0 && ids.every((i) => this.selected.has(i));
      if (allSelected) this.clearSelection();
      else this.selectAll();
      return;
    }

    // Multi-select toggle (the leading select box).
    const selBox = target.closest<HTMLElement>('[data-todo-select]');
    if (selBox) {
      const rowEl = selBox.closest<HTMLElement>('[data-todo-id]');
      if (rowEl?.dataset.todoId) this.select(this.resolveId(rowEl.dataset.todoId), { additive: true });
      return;
    }

    // Detail-panel collaboration / dependency / picker controls.
    if (this.detailId != null && this.detailEl?.contains(target)) {
      if (this.handleDetailClick(target)) return;
    }

    // Inline field editors (status pill, priority, assignees, tags, due).
    const inlineEl = target.closest<HTMLElement>('[data-todo-inline]');
    if (inlineEl) {
      const rowEl = inlineEl.closest<HTMLElement>('[data-todo-id]');
      if (rowEl?.dataset.todoId) {
        this.openInlineEditor(inlineEl.dataset.todoInline ?? '', this.resolveId(rowEl.dataset.todoId), inlineEl);
      }
      return;
    }

    const actionBtn = target.closest<HTMLElement>('[data-todo-action]');
    if (actionBtn) {
      const action = actionBtn.dataset.todoAction;
      // Global (non-row) toolbar actions.
      if (action === 'add') return void this.commitAdd();
      if (action === 'undo') return void this.undo();
      if (action === 'redo') return void this.redo();
      if (action === 'sortdir') return void this.toggleSortDir();
      if (action === 'save-filter') return void this.promptSaveFilter();
      if (action === 'detail-close') return void this.closeDetail();
      if (action === 'multi-sort') return void this.openSortPopover(actionBtn);
      if (action === 'filter-builder') return void this.openFilterPopover(actionBtn);
      if (action === 'columns') return void this.openColumnsPopover(actionBtn);
      if (action === 'cal-prev') return void this.shiftCalendar(-1);
      if (action === 'cal-next') return void this.shiftCalendar(1);
      if (action === 'cal-today') return void this.setCalendarDate(this.now());
      if (action === 'cal-mode') { this.config.calendarMode = this.config.calendarMode === 'week' ? 'month' : 'week'; return void this.syncBody(); }
      if (action === 'tl-zoom') return void this.cycleZoom();

      const rowEl = actionBtn.closest<HTMLElement>('[data-todo-id]');
      const id = rowEl?.dataset.todoId;
      if (!id) return;
      const taskId = this.resolveId(id);
      if (action === 'twisty') this.toggleExpand(taskId);
      else if (action === 'addsub') this.addSubtask(taskId);
      else if (action === 'edit') this.openEditor(taskId);
      else if (action === 'delete') this.removeTask(taskId);
      else if (action === 'detail') this.openDetail(taskId);
      else if (action === 'done') this.toggleTask(taskId);
      else if (action === 'status') this.cycleStatus(taskId);
      else if (action === 'timer') this.toggleTimer(taskId);
      return;
    }

    // Plain click on a row body with a modifier toggles/extends selection.
    if (this.config.selectable !== false) {
      const rowEl = target.closest<HTMLElement>('[data-todo-id]');
      if (rowEl?.dataset.todoId && (mouse.ctrlKey || mouse.metaKey || mouse.shiftKey)) {
        event.preventDefault();
        this.select(this.resolveId(rowEl.dataset.todoId), {
          additive: mouse.ctrlKey || mouse.metaKey,
          range: mouse.shiftKey,
        });
      }
    }
  }

  /** Delegated `change` on the toolbar selects (group / sort / saved filters). */
  private handleChange(event: Event): void {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    if (target.matches('[data-todo-group]')) {
      this.setGroupBy((target as HTMLSelectElement).value as TodoGroupBy);
    } else if (target.matches('[data-todo-swimlane]')) {
      this.setBoardSwimlane((target as HTMLSelectElement).value as TodoGroupBy);
    } else if (target.matches('[data-todo-sort]')) {
      const field = (target as HTMLSelectElement).value as TodoSortField;
      const dir = this.getSort()[0]?.dir ?? 'asc';
      this.setSort(field === 'manual' ? { field } : { field, dir });
    } else if (target.matches('[data-todo-saved]')) {
      const id = (target as HTMLSelectElement).value;
      if (id) this.applySavedFilter(id);
    } else if (target.matches('[data-todo-bulk-status]')) {
      const v = (target as HTMLSelectElement).value;
      if (v) { this.bulkSetStatus(v); (target as HTMLSelectElement).value = ''; }
    } else if (target.matches('[data-todo-bulk-priority]')) {
      const v = (target as HTMLSelectElement).value as TodoPriority;
      if (v) { this.bulkSetPriority(v); (target as HTMLSelectElement).value = ''; }
    } else if (target.matches('[data-dep-add]')) {
      const sel = target as HTMLSelectElement;
      if (sel.value && this.detailId != null) {
        const ok = this.addDependency(this.detailId, this.resolveId(sel.value));
        sel.value = '';
        if (ok) this.openDetail(this.detailId);
      }
    } else if (target.matches('[data-detail-field]')) {
      this.commitDetailField((target as HTMLElement).dataset.detailField ?? '', target);
    }
  }

  /** Delegated `input` for the search box. */
  private handleInput(event: Event): void {
    const target = event.target as HTMLElement | null;
    if (target?.matches('[data-todo-search]')) {
      this.setSearch((target as HTMLInputElement).value);
    }
  }

  /** Double-click a row opens the detail panel. */
  private handleDblClick(event: Event): void {
    if (this.config.detailPanel === false) return;
    const rowEl = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-todo-id]');
    if (rowEl?.dataset.todoId) this.openDetail(this.resolveId(rowEl.dataset.todoId));
  }

  private handleFocusIn(event: Event): void {
    const rowEl = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-todo-id]');
    if (rowEl?.dataset.todoId) {
      const id = this.resolveId(rowEl.dataset.todoId);
      if (id !== this.focusedId) {
        this.focusedId = id;
        this.syncRoving();
      }
    }
  }

  private handleKeydown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null;

    // Table-view column-resize handle: arrow keys nudge width, ±10 with Shift.
    const resizeHandle = target?.closest<HTMLElement>('[data-table-resize]');
    if (resizeHandle && target === resizeHandle) {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        const field = resizeHandle.dataset.tableResize;
        const th = resizeHandle.closest<HTMLElement>('th[data-table-col]');
        if (field && th) {
          const step = (event.shiftKey ? 10 : 2) * (event.key === 'ArrowRight' ? 1 : -1);
          // Base the nudge on the stored width (rendered width is unreliable in
          // headless DOMs); fall back to the measured width when none is stored.
          const stored = this.getTableColumns().find((c) => c.field === field)?.width;
          const base = stored ?? Math.round(th.getBoundingClientRect().width);
          const next = Math.max(MIN_COLUMN_WIDTH, base + step);
          this.setColumnWidth(field as TodoTableField, next);
          // Re-focus the (rebuilt) handle so repeated presses keep nudging.
          // Field values never contain a double-quote, so this attr selector is safe.
          const sel = `[data-table-resize="${field}"]`;
          this.tableEl?.querySelector<HTMLElement>(sel)?.focus();
        }
      }
      return;
    }

    // Select checkbox (list or table): Enter/Space toggles selection.
    const selBoxKey = target?.closest<HTMLElement>('[data-todo-select], [data-todo-select-all]');
    if (selBoxKey && target === selBoxKey && (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar')) {
      event.preventDefault();
      if (selBoxKey.matches('[data-todo-select-all]')) {
        const ids = this.renderedIds();
        const allSelected = ids.length > 0 && ids.every((i) => this.selected.has(i));
        if (allSelected) this.clearSelection(); else this.selectAll();
      } else {
        const row = selBoxKey.closest<HTMLElement>('[data-todo-id]');
        if (row?.dataset.todoId) this.select(this.resolveId(row.dataset.todoId), { additive: true });
      }
      return;
    }

    // Only handle keys when a row itself is focused (not the add box or editors).
    const rowEl = target?.closest<HTMLElement>('[data-todo-id]');
    if (!rowEl || target !== rowEl) return;
    if (this.editor) return;

    const id = this.resolveId(rowEl.dataset.todoId!);
    const rows = this.visibleRows().map((r) => this.idOf(r.task));
    const pos = rows.indexOf(id);

    switch (event.key) {
      case 'ArrowDown': {
        event.preventDefault();
        const next = rows[Math.min(pos + 1, rows.length - 1)];
        if (next != null) this.focusRow(next);
        break;
      }
      case 'ArrowUp': {
        event.preventDefault();
        const prev = rows[Math.max(pos - 1, 0)];
        if (prev != null) this.focusRow(prev);
        break;
      }
      case 'ArrowRight': {
        event.preventDefault();
        const task = this.model.getTask(id);
        if (task && childrenOf(task).length) {
          if (!this.model.isExpanded(id)) this.expand(id);
          else {
            const firstChild = childrenOf(task)[0];
            if (firstChild) this.focusRow(this.idOf(firstChild));
          }
        }
        break;
      }
      case 'ArrowLeft': {
        event.preventDefault();
        const task = this.model.getTask(id);
        if (task && childrenOf(task).length && this.model.isExpanded(id)) {
          this.collapse(id);
        } else {
          const parent = this.model.parentOf(id);
          if (parent) this.focusRow(this.idOf(parent));
        }
        break;
      }
      case ' ':
      case 'Spacebar': {
        event.preventDefault();
        const task = this.model.getTask(id);
        if (task) this.toggleTask(id, !effectiveDone(task));
        break;
      }
      case 'Enter': {
        event.preventDefault();
        // Shift+Enter adds a nested subtask (keyboard equivalent of the
        // always-visible "+ subtask" row button); Enter edits the row.
        if (event.shiftKey) this.addSubtask(id);
        else this.openEditor(id);
        break;
      }
      case 'Delete':
      case 'Backspace': {
        event.preventDefault();
        this.removeTask(id);
        break;
      }
      case 'Tab': {
        if (this.config.reorderable === false) break;
        // Tab indents, Shift+Tab outdents — only while a row is the active
        // element, so normal tabbing out of the widget still works from other
        // controls.
        event.preventDefault();
        if (event.shiftKey) this.outdent(id);
        else this.indent(id);
        this.focusRow(id);
        break;
      }
      default:
        break;
    }
  }

  // ── drag & drop reorder ────────────────────────────────────────────────────
  // Wired lazily (delegated) so it costs nothing when reorderable is off.

  /**
   * Wire delegated drag-and-drop listeners on the root. Called from `buildEl()`
   * (during super()) — handlers are plain methods invoked through inline arrows,
   * so there is no class-field-arrow init-order trap.
   */
  private bindDnd(root: HTMLElement): void {
    if (this.config.reorderable === false) return;
    const dragstart = (e: DragEvent): void => this.onDragStart(e);
    const dragover = (e: DragEvent): void => this.onDragOver(e);
    const drop = (e: DragEvent): void => this.onDrop(e);
    const dragend = (): void => this.onDragEnd();
    root.addEventListener('dragstart', dragstart as EventListener);
    root.addEventListener('dragover', dragover as EventListener);
    root.addEventListener('drop', drop as EventListener);
    root.addEventListener('dragend', dragend as EventListener);
    this.track(() => {
      root.removeEventListener('dragstart', dragstart as EventListener);
      root.removeEventListener('dragover', dragover as EventListener);
      root.removeEventListener('drop', drop as EventListener);
      root.removeEventListener('dragend', dragend as EventListener);
    });
  }

  private onDragStart(event: DragEvent): void {
    const rowEl = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-todo-id]');
    if (!rowEl?.dataset.todoId) return;
    this.dragId = this.resolveId(rowEl.dataset.todoId);
    rowEl.classList.add('jects-todo__row--dragging');
    event.dataTransfer?.setData('text/plain', rowEl.dataset.todoId);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  }

  private onDragOver(event: DragEvent): void {
    if (this.dragId == null) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    const target = event.target as HTMLElement | null;

    const view = this.getView();
    if (view === 'calendar') {
      for (const el of this.el.querySelectorAll('.jects-todo__cal-cell--drop')) el.classList.remove('jects-todo__cal-cell--drop');
      const cell = target?.closest<HTMLElement>('[data-todo-day]');
      if (cell) cell.classList.add('jects-todo__cal-cell--drop');
      return;
    }
    if (view === 'board') {
      // Board: highlight the column being hovered + track the card insertion point.
      for (const el of this.el.querySelectorAll('.jects-todo__col--drop')) {
        el.classList.remove('jects-todo__col--drop');
      }
      const col = target?.closest<HTMLElement>('[data-todo-status]');
      if (col) col.classList.add('jects-todo__col--drop');
      // Track Y position relative to the hovered card for within-column reorder.
      const overCard = target?.closest<HTMLElement>('.jects-todo__card[data-todo-id]');
      if (overCard?.dataset.todoId) {
        const r = overCard.getBoundingClientRect();
        const before = event.clientY < r.top + r.height / 2;
        this.cardDropTarget = { id: this.resolveId(overCard.dataset.todoId), before };
      } else {
        this.cardDropTarget = null;
      }
      return;
    }

    const rowEl = target?.closest<HTMLElement>('[data-todo-id]');
    for (const el of this.bodyEl.querySelectorAll('.jects-todo__row--drop')) {
      el.classList.remove('jects-todo__row--drop');
    }
    if (rowEl) rowEl.classList.add('jects-todo__row--drop');
  }

  private onDrop(event: DragEvent): void {
    if (this.dragId == null) return;
    event.preventDefault();
    const target = event.target as HTMLElement | null;
    const dragId = this.dragId;

    const view = this.getView();
    if (view === 'calendar') {
      // Calendar: dropping onto a day cell reschedules the task's due date.
      const cell = target?.closest<HTMLElement>('[data-todo-day]');
      if (cell?.dataset.todoDay) this.updateTask(dragId, { due: cell.dataset.todoDay });
      this.clearDropMarkers();
      return;
    }
    if (view === 'board') {
      // Board: dropping onto a column sets the card's workflow status; dropping
      // near a specific card additionally reorders within that column.
      const col = target?.closest<HTMLElement>('[data-todo-status]');
      const statusId = col?.dataset.todoStatus;
      const drop = this.cardDropTarget;
      this.cardDropTarget = null;
      if (statusId) {
        const status = this.statuses().find((s) => s.id === statusId);
        const count = this.matchingTasks().filter((t) => effectiveStatus(t, this.statuses()).id === statusId).length;
        // WIP enforcement: veto a cross-column drop that would exceed the limit.
        const crossing = effectiveStatus(this.model.getTask(dragId)!, this.statuses()).id !== statusId;
        if (this.config.wipEnforce && status?.wipLimit != null && crossing && count >= status.wipLimit) {
          this.clearDropMarkers();
          return;
        }
        this.setStatus(dragId, statusId);
        // Reorder within the column relative to the card dropped near (when they
        // share a parent — sibling reorder).
        if (drop && drop.id !== dragId) {
          const dragParent = this.model.parentOf(dragId);
          const targetParent = this.model.parentOf(drop.id);
          const sameParent = (dragParent ? this.idOf(dragParent) : null) === (targetParent ? this.idOf(targetParent) : null);
          if (sameParent) {
            const loc = this.model.locate(drop.id);
            const parentId = targetParent ? this.idOf(targetParent) : null;
            this.moveTask(dragId, parentId, drop.before ? loc.index : loc.index + 1);
          }
        }
      }
      this.clearDropMarkers();
      return;
    }

    const rowEl = target?.closest<HTMLElement>('[data-todo-id]');
    const overId = rowEl?.dataset.todoId ? this.resolveId(rowEl.dataset.todoId) : null;
    if (overId != null && overId !== dragId && !this.model.isDescendant(overId, dragId)) {
      // Drop as a sibling immediately before the row dropped onto.
      const parent = this.model.parentOf(overId);
      const parentId = parent ? this.idOf(parent) : null;
      const loc = this.model.locate(overId);
      this.moveTask(dragId, parentId, loc.index);
    }
    this.clearDropMarkers();
  }

  private onDragEnd(): void {
    this.dragId = null;
    this.clearDropMarkers();
  }

  private clearDropMarkers(): void {
    for (const el of this.el.querySelectorAll(
      '.jects-todo__row--drop, .jects-todo__row--dragging, .jects-todo__col--drop, .jects-todo__card--dragging, .jects-todo__cal-cell--drop',
    )) {
      el.classList.remove(
        'jects-todo__row--drop',
        'jects-todo__row--dragging',
        'jects-todo__col--drop',
        'jects-todo__card--dragging',
        'jects-todo__cal-cell--drop',
      );
    }
  }

  // ── public API (TodoListApi) ───────────────────────────────────────────────

  addTask(task: Partial<TodoTask>, parentId: RecordId | null = null): TodoTask | undefined {
    const candidate = normalizeForEvent(task, this.config.idField ?? 'id');
    if (this.emit('beforeAdd', { list: this, task: candidate, parentId }) === false) {
      return undefined;
    }
    const created = this.model.add(candidate, parentId);
    this.emit('add', { list: this, task: created, parentId });
    this.notifyChange({ action: 'add', ids: [this.idOf(created)] });
    return created;
  }

  removeTask(id: RecordId): TodoTask | undefined {
    const task = this.model.getTask(id);
    if (!task) return undefined;
    if (this.emit('beforeRemove', { list: this, task }) === false) return undefined;
    const wasFocused = this.focusedId === id;
    const rows = this.visibleRows().map((r) => this.idOf(r.task));
    const pos = rows.indexOf(id);
    const removed = this.model.remove(id);
    if (removed && wasFocused) {
      const nextRows = this.visibleRows().map((r) => this.idOf(r.task));
      const next = nextRows[Math.min(pos, nextRows.length - 1)];
      this.focusedId = next ?? null;
      if (next != null) requestAnimationFrame(() => this.focusRow(next));
    }
    if (removed) {
      this.selected.delete(id);
      this.emit('remove', { list: this, task: removed });
      this.notifyChange({ action: 'remove', ids: [id] });
    }
    return removed;
  }

  updateTask(id: RecordId, changes: Partial<TodoTask>): TodoTask | undefined {
    // `done` and hierarchy are not patched here.
    const { done: _done, children: _children, ...rest } = changes;
    const updated = this.model.update(id, rest as Partial<TodoTask>);
    if (updated) {
      this.emit('update', { list: this, task: updated, changes: rest as Partial<TodoTask> });
      this.notifyChange({ action: 'update', ids: [id] });
    }
    return updated;
  }

  toggleTask(id: RecordId, done?: boolean): TodoTask[] {
    const task = this.model.getTask(id);
    if (!task) return [];
    const next = done ?? !effectiveDone(task);
    // Snapshot recurrence intent BEFORE the model mutates the task in place.
    const recurring = next && !effectiveDone(task) && !!task.recurrence;
    const affected = this.model.setDone(id, next, this.config.rollUp !== false);
    if (affected.length) {
      this.emit('toggle', { list: this, task, done: next, affected });
      // Completing a recurring task spawns its next occurrence.
      if (recurring) {
        const spawned = this.model.spawnNext(id, this.nowIso());
        if (spawned) this.emit('recur', { list: this, task, next: spawned });
      }
      this.notifyChange({ action: 'toggle', ids: affected.map((t) => this.idOf(t)) });
    } else {
      // Even a no-op toggle should refresh derived UI (e.g. parent indeterminate).
      this.syncBody();
    }
    return affected;
  }

  reorder(id: RecordId, index: number): boolean {
    const ok = this.model.reorder(id, index);
    if (ok) this.emitMove(id);
    return ok;
  }

  indent(id: RecordId): boolean {
    if (this.config.reorderable === false) return false;
    const ok = this.model.indent(id);
    if (ok) this.emitMove(id);
    return ok;
  }

  outdent(id: RecordId): boolean {
    if (this.config.reorderable === false) return false;
    const ok = this.model.outdent(id);
    if (ok) this.emitMove(id);
    return ok;
  }

  moveTask(id: RecordId, parentId: RecordId | null, index: number): boolean {
    const ok = this.model.moveTo(id, parentId, index);
    if (ok) this.emitMove(id);
    return ok;
  }

  private emitMove(id: RecordId): void {
    const task = this.model.getTask(id);
    if (!task) return;
    const parent = this.model.parentOf(id);
    const loc = this.model.locate(id);
    this.notifyChange({ action: 'move', ids: [id] });
    this.emit('move', {
      list: this,
      task,
      parentId: parent ? this.idOf(parent) : null,
      index: loc.index,
    });
  }

  expand(id: RecordId): void {
    void this.model.store.expand(id);
  }

  collapse(id: RecordId): void {
    this.model.store.collapse(id);
  }

  toggleExpand(id: RecordId): void {
    if (this.model.isExpanded(id)) this.collapse(id);
    else this.expand(id);
  }

  setFilter(filter: TodoFilter): this {
    if (!FILTERS.includes(filter)) return this; // ignore unknown filters
    if (filter === this.config.filter) return this; // no-op
    this.config.filter = filter;
    this.syncFilterButtons();
    this.syncBody();
    this.emit('filter', { list: this, filter });
    return this;
  }

  getFilter(): TodoFilter {
    return (this.config.filter as TodoFilter) ?? 'all';
  }

  getProgress(): TodoProgress {
    return computeProgress(this.model.roots);
  }

  getTasks(): TodoTask[] {
    return this.model.serialize();
  }

  getTask(id: RecordId): TodoTask | undefined {
    const task = this.model.getTask(id);
    return task ? { ...task } : undefined;
  }

  /**
   * Merge `patch` into config. A `tasks` patch rebuilds the headless model from
   * scratch (replacing the whole tree); other patches re-render in place.
   */
  override update(patch: Partial<TodoListConfig>): this {
    if (this.isDestroyed) return this;
    const replacingTasks = patch.tasks !== undefined;
    super.update(patch);
    // Keep the model's status set in lock-step with a `statuses` patch.
    if (patch.statuses && this.model) this.model.statuses = this.config.statuses ?? DEFAULT_STATUSES;
    if (patch.history !== undefined && this.model) this.model.historyEnabled = patch.history !== false;
    if (patch.currentUser !== undefined && this.model) this.model.currentUser = this.config.currentUser;
    if (patch.messages !== undefined) this.messages = mergeMessages(this.config.messages);
    if (replacingTasks) {
      // Tear down the old model's listener-bound store and rebuild.
      this.model = new TodoModel(
        (this.config.tasks as TodoTask[]) ?? [],
        this.config.idField ?? 'id',
        this.config.statuses,
      );
      this.model.historyEnabled = this.config.history !== false;
      this.model.currentUser = this.config.currentUser;
      this.track(
        this.model.store.events.on('change', () => {
          if (!this.isDestroyed) this.syncBody();
        }),
      );
      this.focusedId = null;
      this.selected.clear();
    }
    this.syncFilterButtons();
    this.syncToolbarState();
    this.syncBody();
    return this;
  }

  // ── statuses / workflow ─────────────────────────────────────────────────────

  /** The active status set (config or the default todo/done pair). */
  private statuses(): readonly TodoStatus[] {
    const s = this.config.statuses;
    return s && s.length ? s : DEFAULT_STATUSES;
  }

  getStatuses(): TodoStatus[] {
    return this.statuses().map((s) => ({ ...s }));
  }

  setStatus(id: RecordId, status: string): TodoTask | undefined {
    const affected = this.model.setStatus(id, status, this.config.rollUp !== false);
    const task = this.model.getTask(id);
    if (!task) return undefined;
    if (affected.length || task.status === status) {
      const recurring = !!task.recurrence && effectiveStatus(task, this.statuses()).isDone;
      if (recurring) {
        const spawned = this.model.spawnNext(id, this.nowIso());
        if (spawned) this.emit('recur', { list: this, task, next: spawned });
      }
      this.emit('status', { list: this, task, status, affected });
      this.notifyChange({ action: 'status', ids: affected.length ? affected.map((t) => this.idOf(t)) : [id] });
    }
    return task;
  }

  /** Advance a task to the next workflow status (wrapping). */
  private cycleStatus(id: RecordId): void {
    const task = this.model.getTask(id);
    if (!task) return;
    const set = this.statuses();
    const cur = set.findIndex((s) => s.id === effectiveStatus(task, set).id);
    const next = set[(cur + 1) % set.length];
    if (next) this.setStatus(id, next.id);
  }

  // ── view / sort / group / filter / search ───────────────────────────────────

  setView(view: TodoView): this {
    if (!VIEWS.includes(view) || view === this.config.view) return this;
    this.config.view = view;
    this.syncBody();
    this.emit('view', { list: this, view });
    return this;
  }

  getView(): TodoView {
    return (this.config.view as TodoView) ?? 'list';
  }

  getBoardSwimlane(): TodoGroupBy {
    return (this.config.boardSwimlane as TodoGroupBy) ?? 'none';
  }

  setBoardSwimlane(axis: TodoGroupBy): this {
    if (!SWIMLANE_OPTIONS.includes(axis) || axis === this.getBoardSwimlane()) return this;
    this.config.boardSwimlane = axis;
    this.syncBody();
    return this;
  }

  getTableColumns(): TodoTableColumn[] {
    const c = this.config.tableColumns;
    return (c && c.length ? c : DEFAULT_TABLE_COLUMNS).map((x) => ({ ...x }));
  }

  setTableColumns(columns: TodoTableColumn[]): this {
    this.config.tableColumns = columns.map((c) => ({ ...c }));
    this.syncBody();
    return this;
  }

  /** Persist a column's width (clamped to the minimum) and re-render the table. */
  setColumnWidth(field: TodoTableField, width: number): this {
    const w = Math.max(MIN_COLUMN_WIDTH, Math.round(width));
    const cols = this.getTableColumns();
    const idx = cols.findIndex((c) => c.field === field);
    if (idx === -1) return this;
    cols[idx] = { ...cols[idx], field, width: w };
    this.config.tableColumns = cols;
    this.syncBody();
    this.emit('columnresize', { list: this, field: String(field), width: w });
    return this;
  }

  getTableRowHeight(): number | null {
    const h = this.config.tableRowHeight;
    return typeof h === 'number' && h > 0 ? Math.round(h) : null;
  }

  setTableRowHeight(height: number | null): this {
    if (height == null || height <= 0) delete this.config.tableRowHeight;
    else this.config.tableRowHeight = Math.round(height);
    this.syncBody();
    return this;
  }

  setTimelineZoom(zoom: TodoTimelineZoom): this {
    if (!ZOOMS.includes(zoom)) return this;
    this.config.timelineZoom = zoom;
    this.syncBody();
    return this;
  }

  setCalendarDate(date: Date): this {
    this.viewAnchor = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    this.syncBody();
    return this;
  }

  getSort(): TodoSort[] {
    const s = this.config.sortBy;
    if (!s) return [{ field: 'manual' }];
    return Array.isArray(s) ? s.slice() : [s];
  }

  setSort(sortBy: TodoSort | TodoSort[]): this {
    this.config.sortBy = Array.isArray(sortBy) ? sortBy.slice() : sortBy;
    this.syncBody();
    this.emit('sort', { list: this, sortBy: this.getSort() });
    return this;
  }

  /** Flip the primary sort direction (no-op for a manual sort). */
  private toggleSortDir(): void {
    const sort = this.getSort();
    const first = sort[0];
    if (!first || first.field === 'manual') return;
    sort[0] = { field: first.field, dir: first.dir === 'desc' ? 'asc' : 'desc' };
    this.setSort(sort);
  }

  getGroupBy(): TodoGroupBy {
    return (this.config.groupBy as TodoGroupBy) ?? 'none';
  }

  setGroupBy(groupBy: TodoGroupBy): this {
    if (!GROUP_OPTIONS.includes(groupBy) || groupBy === this.getGroupBy()) return this;
    this.config.groupBy = groupBy;
    this.syncBody();
    this.emit('group', { list: this, groupBy });
    return this;
  }

  getFilters(): TodoFilterCriteria {
    return { ...(this.config.filters ?? {}) };
  }

  setFilters(filters: TodoFilterCriteria): this {
    this.config.filters = { ...filters };
    this.syncBody();
    this.emit('filters', { list: this, filters: this.getFilters() });
    return this;
  }

  getSearch(): string {
    return this.config.search ?? '';
  }

  setSearch(query: string): this {
    if (query === this.getSearch()) return this;
    this.config.search = query;
    // Keep the search box in sync when set programmatically.
    const box = this.el.querySelector<HTMLInputElement>('[data-todo-search]');
    if (box && box.value !== query) box.value = query;
    this.syncBody();
    this.emit('search', { list: this, query });
    return this;
  }

  getSavedFilters(): TodoSavedFilter[] {
    return (this.config.savedFilters ?? []).map((f) => ({ ...f }));
  }

  saveFilter(name: string): TodoSavedFilter {
    const saved: TodoSavedFilter = {
      id: `sf-${Date.now().toString(36)}`,
      name,
      filters: this.getFilters(),
      filter: this.getFilter(),
      search: this.getSearch(),
      sortBy: this.getSort(),
      groupBy: this.getGroupBy(),
    };
    this.config.savedFilters = [...(this.config.savedFilters ?? []), saved];
    this.syncToolbarState();
    return saved;
  }

  applySavedFilter(id: string): boolean {
    const f = (this.config.savedFilters ?? []).find((x) => x.id === id);
    if (!f) return false;
    if (f.filter) this.config.filter = f.filter;
    this.config.filters = { ...(f.filters ?? {}) };
    this.config.search = f.search ?? '';
    if (f.sortBy) this.config.sortBy = Array.isArray(f.sortBy) ? f.sortBy.slice() : f.sortBy;
    this.config.groupBy = f.groupBy ?? 'none';
    const box = this.el.querySelector<HTMLInputElement>('[data-todo-search]');
    if (box) box.value = this.config.search;
    this.syncFilterButtons();
    this.syncBody();
    return true;
  }

  /** Toolbar "save filter" affordance — prompts for a name when available. */
  private promptSaveFilter(): void {
    let name = `Filter ${(this.config.savedFilters?.length ?? 0) + 1}`;
    if (typeof prompt === 'function') {
      const input = prompt('Save filter as:', name);
      if (input == null) return;
      if (input.trim()) name = input.trim();
    }
    this.saveFilter(name);
  }

  // ── selection / bulk ────────────────────────────────────────────────────────

  getSelected(): RecordId[] {
    return [...this.selected];
  }

  select(id: RecordId, opts?: { additive?: boolean; range?: boolean }): void {
    if (this.config.selectable === false) return;
    if (opts?.range && this.selectionAnchor != null) {
      const order = this.renderedIds();
      const i1 = order.indexOf(this.selectionAnchor);
      const i2 = order.indexOf(id);
      if (i1 !== -1 && i2 !== -1) {
        const [lo, hi] = i1 < i2 ? [i1, i2] : [i2, i1];
        for (let i = lo; i <= hi; i++) {
          const x = order[i];
          if (x != null) this.selected.add(x);
        }
      } else {
        this.selected.add(id);
      }
    } else if (opts?.additive) {
      if (this.selected.has(id)) this.selected.delete(id);
      else this.selected.add(id);
    } else {
      this.selected.clear();
      this.selected.add(id);
    }
    this.selectionAnchor = id;
    this.syncSelectionDom();
    this.emit('select', { list: this, ids: [...this.selected] });
  }

  selectAll(): void {
    if (this.config.selectable === false) return;
    for (const id of this.renderedIds()) this.selected.add(id);
    this.syncSelectionDom();
    this.emit('select', { list: this, ids: [...this.selected] });
  }

  clearSelection(): void {
    if (!this.selected.size) return;
    this.selected.clear();
    this.selectionAnchor = null;
    this.syncSelectionDom();
    this.emit('select', { list: this, ids: [] });
  }

  bulkComplete(done = true): RecordId[] {
    return this.bulkRun('complete', (id) => void this.model.setDone(id, done, this.config.rollUp !== false));
  }

  bulkRemove(): RecordId[] {
    const ids = this.bulkRun('delete', (id) => void this.model.remove(id));
    this.selected.clear();
    this.selectionAnchor = null;
    this.syncBody();
    return ids;
  }

  bulkUpdate(changes: Partial<TodoTask>): RecordId[] {
    const { done: _d, children: _c, ...rest } = changes;
    return this.bulkRun('update', (id) => void this.model.update(id, rest as Partial<TodoTask>));
  }

  bulkSetStatus(status: string): RecordId[] {
    return this.bulkRun('status', (id) => void this.model.setStatus(id, status, this.config.rollUp !== false));
  }

  bulkSetPriority(priority: TodoPriority): RecordId[] {
    return this.bulkRun('priority', (id) => void this.model.update(id, { priority }));
  }

  bulkAssign(assignees: string[]): RecordId[] {
    return this.bulkRun('assign', (id) => void this.model.update(id, { assignees: [...assignees] }));
  }

  /** Run a per-id mutation across the selection as ONE coalesced history step. */
  private bulkRun(action: string, fn: (id: RecordId) => void): RecordId[] {
    const ids = [...this.selected];
    if (!ids.length) return [];
    this.model.beginBatch();
    for (const id of ids) {
      if (this.model.getTask(id)) fn(id);
    }
    this.model.endBatch();
    this.syncBody();
    this.emit('bulk', { list: this, action, ids });
    this.notifyChange({ action: 'bulk', ids });
    return ids;
  }

  /** Dispatch a bulk-bar button. */
  private runBulk(action: string): void {
    switch (action) {
      case 'complete': this.bulkComplete(true); break;
      case 'reopen': this.bulkComplete(false); break;
      case 'delete': this.bulkRemove(); break;
      case 'clear': this.clearSelection(); break;
      default: break;
    }
  }

  // ── undo / redo ─────────────────────────────────────────────────────────────

  undo(): boolean {
    const ok = this.model.undo();
    if (ok) {
      this.pruneSelection();
      this.syncBody();
      this.notifyChange({ action: 'update', ids: [] });
    }
    return ok;
  }

  redo(): boolean {
    const ok = this.model.redo();
    if (ok) {
      this.pruneSelection();
      this.syncBody();
      this.notifyChange({ action: 'update', ids: [] });
    }
    return ok;
  }

  canUndo(): boolean {
    return this.model.canUndo();
  }

  canRedo(): boolean {
    return this.model.canRedo();
  }

  /** Drop selected ids that no longer exist (after undo/redo/remove). */
  private pruneSelection(): void {
    for (const id of [...this.selected]) {
      if (!this.model.getTask(id)) this.selected.delete(id);
    }
  }

  // ── persistence / export ─────────────────────────────────────────────────────

  load(tasks: TodoTask[]): this {
    this.model = new TodoModel(tasks, this.config.idField ?? 'id', this.config.statuses);
    this.model.historyEnabled = this.config.history !== false;
    this.model.currentUser = this.config.currentUser;
    this.config.tasks = tasks;
    this.track(
      this.model.store.events.on('change', () => {
        if (!this.isDestroyed) this.syncBody();
      }),
    );
    this.focusedId = null;
    this.selected.clear();
    this.remindedKeys.clear();
    this.syncBody();
    const snapshot = this.getTasks();
    this.emit('load', { list: this, tasks: snapshot });
    this.notifyChange({ action: 'load', ids: [] });
    return this;
  }

  async reload(): Promise<void> {
    const loader = this.config.dataProvider?.load;
    if (!loader) return;
    const data = await loader();
    if (this.isDestroyed) return;
    this.load(data);
  }

  export(opts: TodoExportOptions): string {
    const tasks = this.getTasks();
    if (opts.format === 'csv') return tasksToCsv(tasks, this.statuses());
    return tasksToJson(tasks, opts.flat ?? false);
  }

  /** Parse `text` (JSON or CSV) and replace/append the task tree. */
  import(text: string, opts: TodoImportOptions): TodoTask[] {
    const parsed = opts.format === 'csv'
      ? tasksFromCsv(text, this.statuses())
      : tasksFromJson(text);
    if (opts.mode === 'append') {
      const added = this.model.appendAll(parsed);
      this.config.tasks = this.getTasks();
      this.syncBody();
      this.emit('load', { list: this, tasks: this.getTasks() });
      this.notifyChange({ action: 'import', ids: added.map((t) => this.idOf(t)) });
      return this.getTasks();
    }
    this.model.replaceAll(parsed);
    this.config.tasks = this.getTasks();
    this.focusedId = null;
    this.selected.clear();
    this.remindedKeys.clear();
    this.syncBody();
    const snapshot = this.getTasks();
    this.emit('load', { list: this, tasks: snapshot });
    this.notifyChange({ action: 'import', ids: [] });
    return snapshot;
  }

  // ── collaboration / time tracking / dependencies ────────────────────────────

  addComment(id: RecordId, text: string, author?: string): TodoComment | undefined {
    const who = author ?? this.config.currentUser ?? 'You';
    const comment = this.model.addComment(id, text, who, this.config.assignees ?? []);
    if (comment) {
      const task = this.model.getTask(id)!;
      this.emit('comment', { list: this, task, comment });
      this.notifyChange({ action: 'comment', ids: [id] });
      if (this.detailId === id) this.openDetail(id);
    }
    return comment;
  }

  addAttachment(id: RecordId, attachment: Partial<TodoAttachment>): TodoAttachment | undefined {
    const att = this.model.addAttachment(id, attachment);
    if (att) {
      const task = this.model.getTask(id)!;
      this.emit('attachment', { list: this, task, attachment: att, removed: false });
      this.notifyChange({ action: 'attachment', ids: [id] });
      if (this.detailId === id) this.openDetail(id);
    }
    return att;
  }

  removeAttachment(id: RecordId, attachmentId: string): boolean {
    const task = this.model.getTask(id);
    const att = task?.attachments?.find((a) => a.id === attachmentId);
    const ok = this.model.removeAttachment(id, attachmentId);
    if (ok && task && att) {
      this.emit('attachment', { list: this, task, attachment: att, removed: true });
      this.notifyChange({ action: 'attachment', ids: [id] });
      if (this.detailId === id) this.openDetail(id);
    }
    return ok;
  }

  startTimer(id: RecordId): boolean {
    const ok = this.model.startTimer(id, this.now().getTime());
    if (ok) {
      const task = this.model.getTask(id)!;
      this.emit('timer', { list: this, task, running: true });
      this.notifyChange({ action: 'timer', ids: [id] });
      if (this.detailId === id) this.openDetail(id);
    }
    return ok;
  }

  stopTimer(id: RecordId): number {
    const hours = this.model.stopTimer(id, this.now().getTime());
    if (hours >= 0 && this.model.getTask(id)) {
      const task = this.model.getTask(id)!;
      this.emit('timer', { list: this, task, running: false });
      this.notifyChange({ action: 'timer', ids: [id] });
      if (this.detailId === id) this.openDetail(id);
    }
    return hours;
  }

  isTimerRunning(id: RecordId): boolean {
    return this.model.isTimerRunning(id);
  }

  addDependency(id: RecordId, blockedById: RecordId): boolean {
    const ok = this.model.addDependency(id, blockedById);
    if (ok) this.notifyChange({ action: 'update', ids: [id] });
    return ok;
  }

  removeDependency(id: RecordId, blockedById: RecordId): boolean {
    const ok = this.model.removeDependency(id, blockedById);
    if (ok) this.notifyChange({ action: 'update', ids: [id] });
    return ok;
  }

  /** Fan a change out to onChange / dataProvider.sync / the change+history events. */
  private notifyChange(change: TodoChange): void {
    const tasks = this.getTasks();
    this.config.onChange?.(tasks, change);
    void this.config.dataProvider?.sync?.(tasks, change);
    this.emit('change', { list: this, tasks, change });
    this.emit('history', { list: this, canUndo: this.canUndo(), canRedo: this.canRedo() });
  }

  // ── reminders ────────────────────────────────────────────────────────────────

  /** Fire a `reminder` event (once per task+kind) for due/overdue/soon tasks. */
  private checkReminders(): void {
    const now = this.now();
    const soon = this.config.dueSoonDays ?? 3;
    const walk = (tasks: TodoTask[]): void => {
      for (const t of tasks) {
        if (!effectiveDone(t)) {
          const src = t.reminder ?? t.due;
          const kind = dueStatus(src, now, soon);
          if (kind === 'overdue' || kind === 'today' || kind === 'soon') {
            const key = `${String(this.idOf(t))}:${kind}`;
            if (!this.remindedKeys.has(key)) {
              this.remindedKeys.add(key);
              this.emit('reminder', { list: this, task: t, kind });
            }
          }
        }
        walk(childrenOf(t));
      }
    };
    walk(this.model.roots);
  }

  // ── board view ───────────────────────────────────────────────────────────────

  /**
   * Render the Kanban board: one column per status. With a `boardSwimlane` axis
   * set, the board becomes a (columns × lanes) grid. Columns surface WIP limits.
   */
  private syncBoard(): void {
    if (!this.boardEl) return;
    this.teardownRows();
    this.boardEl.replaceChildren();
    const statuses = this.statuses();
    const tasks = this.matchingTasks();
    const swimlane = this.getBoardSwimlane();

    if (swimlane === 'none') {
      this.boardEl.classList.remove('jects-todo__board--swimlanes');
      const cols = createEl('div', { className: 'jects-todo__cols' });
      for (const s of statuses) cols.append(this.buildColumn(s, tasks.filter((t) => effectiveStatus(t, statuses).id === s.id), null));
      this.boardEl.append(cols);
      return;
    }

    // Swimlane mode: group tasks into lanes, then columns within each lane.
    this.boardEl.classList.add('jects-todo__board--swimlanes');
    const lanes = this.bucketByGroup(tasks, swimlane);
    // A column header strip across the top.
    const headRow = createEl('div', { className: 'jects-todo__lane jects-todo__lane--head' });
    headRow.append(createEl('div', { className: 'jects-todo__lane-label' }));
    const colsHead = createEl('div', { className: 'jects-todo__cols' });
    for (const s of statuses) {
      const all = tasks.filter((t) => effectiveStatus(t, statuses).id === s.id);
      colsHead.append(this.buildColumnHeader(s, all.length));
    }
    headRow.append(colsHead);
    this.boardEl.append(headRow);

    for (const lane of lanes) {
      const laneEl = createEl('div', { className: 'jects-todo__lane' });
      const label = createEl('div', { className: 'jects-todo__lane-label' });
      const swatch = lane.color ? `<span class="jects-todo__group-swatch" style="background:oklch(${lane.color})"></span>` : '';
      label.innerHTML = `${swatch}<span>${escapeHtml(lane.label)}</span>`;
      laneEl.append(label);
      const cols = createEl('div', { className: 'jects-todo__cols' });
      for (const s of statuses) {
        const list = lane.tasks.filter((t) => effectiveStatus(t, statuses).id === s.id);
        cols.append(this.buildColumn(s, list, lane.key));
      }
      laneEl.append(cols);
      this.boardEl.append(laneEl);
    }
  }

  /** A board column header (title + count/limit, WIP warning). */
  private buildColumnHeader(s: TodoStatus, count: number): HTMLElement {
    const over = s.wipLimit != null && count > s.wipLimit;
    const head = createEl('div', {
      className: ['jects-todo__col-head', over ? 'jects-todo__col-head--over' : ''].filter(Boolean).join(' '),
    });
    const swatch = s.color ? `<span class="jects-todo__group-swatch" style="background:oklch(${s.color})"></span>` : '';
    const countText = s.wipLimit != null ? `${count} / ${s.wipLimit}` : String(count);
    head.innerHTML = `${swatch}<span class="jects-todo__col-title">${escapeHtml(s.label)}</span><span class="jects-todo__group-count">${countText}</span>`;
    return head;
  }

  /** A board column (header optional via `withHead`) holding cards. */
  private buildColumn(s: TodoStatus, list: TodoTask[], laneKey: string | null): HTMLElement {
    const over = s.wipLimit != null && list.length > s.wipLimit;
    const col = createEl('div', {
      className: ['jects-todo__col', over ? 'jects-todo__col--over' : ''].filter(Boolean).join(' '),
      attrs: {
        'data-todo-status': s.id,
        ...(laneKey != null ? { 'data-todo-lane': laneKey } : {}),
        role: 'group',
        'aria-label': s.label,
      },
    });
    // In single-lane mode the column owns its header; in swimlane mode headers
    // live in the top strip.
    if (laneKey == null) col.append(this.buildColumnHeader(s, list.length));
    const body = createEl('div', { className: 'jects-todo__col-body' });
    for (const t of list) body.append(this.buildCard(t));
    col.append(body);
    return col;
  }

  /** A board card (a draggable tile carrying `data-todo-id`). */
  private buildCard(task: TodoTask): HTMLElement {
    const id = this.idOf(task);
    const priority = (task.priority ?? 'none') as TodoPriority;
    const ds = effectiveDone(task) ? 'none' : dueStatus(task.due, this.now(), this.config.dueSoonDays ?? 3);
    const card = createEl('div', {
      className: [
        'jects-todo__card',
        priority !== 'none' ? `jects-todo__card--p-${priority}` : '',
        this.selected.has(id) ? 'jects-todo__card--selected' : '',
      ].filter(Boolean).join(' '),
      attrs: { 'data-todo-id': String(id), tabindex: '0', role: 'button', 'aria-label': task.title || '(untitled)' },
    });
    if (this.config.reorderable !== false) card.setAttribute('draggable', 'true');

    // Multi-select affordance (parity with list rows).
    if (this.config.selectable !== false) {
      const selBox = createEl('span', {
        className: ['jects-todo__rowsel', this.selected.has(id) ? 'jects-todo__rowsel--on' : ''].filter(Boolean).join(' '),
        html: this.selected.has(id) ? renderIcon('check', { size: 13 }) : '',
        attrs: { 'data-todo-select': '', 'aria-hidden': 'true', title: this.t('selectTask') },
      });
      card.append(selBox);
    }

    const title = createEl('div', { className: 'jects-todo__card-title', attrs: { 'data-todo-action': 'detail' } });
    if (task.milestone) {
      const ms = createEl('span', { className: 'jects-todo__milestone', attrs: { 'aria-hidden': 'true', title: this.t('milestone') } });
      title.append(ms);
    }
    const titleText = createEl('span');
    titleText.textContent = task.title || this.t('untitled');
    title.append(titleText);
    card.append(title);

    // Parent progress badge.
    if (!isLeaf(task)) card.append(this.buildProgressBadge(task));

    const meta = createEl('div', { className: 'jects-todo__card-meta' });
    if (task.due) {
      const dueEl = createEl('span', {
        className: ['jects-todo__due', ds !== 'none' && ds !== 'upcoming' ? `jects-todo__due--${ds}` : ''].filter(Boolean).join(' '),
      });
      dueEl.innerHTML = `${renderIcon('calendar', { size: 12 })}<span>${escapeHtml(formatDue(task.due))}</span>`;
      meta.append(dueEl);
    }
    if (priority !== 'none') {
      const pEl = createEl('span', { className: `jects-todo__priority jects-todo__priority--${priority}` });
      pEl.textContent = priorityLabel(priority);
      meta.append(pEl);
    }
    for (const tag of task.tags ?? []) {
      const tEl = createEl('span', { className: 'jects-todo__tag' });
      if (tag.color) tEl.style.setProperty('--_tag-color', tag.color);
      tEl.textContent = tag.text;
      meta.append(tEl);
    }
    if (meta.childElementCount) card.append(meta);

    if (task.assignees?.length) {
      const av = createEl('div', { className: 'jects-todo__avatars' });
      for (const a of task.assignees.slice(0, 4)) {
        const chip = createEl('span', { className: 'jects-todo__avatar', attrs: { title: a } });
        chip.textContent = initials(a);
        chip.style.setProperty('--_avatar-color', avatarColor(a));
        av.append(chip);
      }
      card.append(av);
    }
    return card;
  }

  // ── bulk action bar ──────────────────────────────────────────────────────────

  private buildBulkBar(): HTMLElement {
    const bar = createEl('div', {
      className: 'jects-todo__bulkbar',
      attrs: { hidden: 'hidden', role: 'toolbar', 'aria-label': 'Bulk actions' },
    });
    const count = createEl('span', { className: 'jects-todo__bulk-count' });
    count.textContent = formatMessage(this.t('selectedCount'), { n: 0 });
    const mk = (label: string, bulk: string, icon?: IconName): HTMLElement =>
      createEl('button', {
        className: 'jects-todo__bulk-btn',
        html: `${icon ? renderIcon(icon, { size: 14 }) : ''}<span>${escapeHtml(label)}</span>`,
        attrs: { type: 'button', 'data-todo-bulk': bulk },
      });
    const statusSel = this.buildSelect('data-todo-bulk-status', this.t('setStatus'), [
      { value: '', label: this.t('setStatus') },
      ...this.statuses().map((s) => ({ value: s.id, label: s.label })),
    ]);
    const prioSel = this.buildSelect('data-todo-bulk-priority', this.t('setPriority'), [
      { value: '', label: this.t('setPriority') },
      ...PRIORITIES.map((p) => ({ value: p, label: priorityLabel(p) })),
    ]);
    bar.append(
      count,
      mk(this.t('complete'), 'complete', 'check'),
      mk(this.t('reopen'), 'reopen'),
      statusSel,
      prioSel,
      mk(this.t('setAssignees'), 'assign'),
      mk(this.t('delete'), 'delete', 'trash'),
      mk(this.t('clear'), 'clear', 'x'),
    );
    return bar;
  }

  private syncBulkBar(): void {
    if (!this.bulkBarEl) return;
    const n = this.selected.size;
    this.bulkBarEl.hidden = n === 0 || this.config.selectable === false;
    const count = this.bulkBarEl.querySelector('.jects-todo__bulk-count');
    if (count) count.textContent = formatMessage(this.t('selectedCount'), { n });
  }

  /** Light DOM update for selection state (avoids a full rebuild). */
  private syncSelectionDom(): void {
    for (const el of this.el.querySelectorAll<HTMLElement>('[data-todo-id]')) {
      const id = this.resolveId(el.dataset.todoId!);
      const on = this.selected.has(id);
      el.classList.toggle('jects-todo__row--selected', on && el.classList.contains('jects-todo__row'));
      el.classList.toggle('jects-todo__card--selected', on && el.classList.contains('jects-todo__card'));
      el.classList.toggle('jects-todo__trow--selected', on && el.classList.contains('jects-todo__trow'));
      const box = el.querySelector<HTMLElement>('[data-todo-select]');
      if (box) {
        box.classList.toggle('jects-todo__rowsel--on', on);
        box.innerHTML = on ? renderIcon('check', { size: 13 }) : '';
        if (box.getAttribute('role') === 'checkbox') box.setAttribute('aria-checked', String(on));
      }
    }
    // Reflect aggregate selection on every "select all" checkbox (list header
    // and, in the Table view, the table's own leading header cell).
    const ids = this.renderedIds();
    const selCount = ids.filter((i) => this.selected.has(i)).length;
    const all = ids.length > 0 && selCount === ids.length;
    const some = selCount > 0 && !all;
    for (const selAll of this.el.querySelectorAll<HTMLElement>('[data-todo-select-all]')) {
      selAll.classList.toggle('jects-todo__rowsel--on', all);
      selAll.classList.toggle('jects-todo__rowsel--some', some);
      selAll.innerHTML = all ? renderIcon('check', { size: 13 }) : some ? renderIcon('minus', { size: 13 }) : '';
      if (selAll.getAttribute('role') === 'checkbox') {
        selAll.setAttribute('aria-checked', some ? 'mixed' : String(all));
      }
    }
    this.syncBulkBar();
  }

  /** Ids in current rendered order (list rows, board cards, or table rows). */
  private renderedIds(): RecordId[] {
    const out: RecordId[] = [];
    const view = this.getView();
    const root = view === 'board' ? this.boardEl : view === 'table' ? this.tableEl : this.bodyEl;
    if (!root) return out;
    for (const el of root.querySelectorAll<HTMLElement>('[data-todo-id]')) {
      if (el.dataset.todoId) out.push(this.resolveId(el.dataset.todoId));
    }
    return out;
  }

  // ── detail side panel ────────────────────────────────────────────────────────

  openDetail(id: RecordId): void {
    if (this.config.detailPanel === false) return;
    const task = this.model.getTask(id);
    if (!task) return;
    this.closeDetail();
    this.detailId = id;
    this.detailEl = this.buildDetail(task);
    this.el.append(this.detailEl);
    this.el.classList.add('jects-todo--detail-open');
    const first = this.detailEl.querySelector<HTMLElement>('input, select, textarea');
    first?.focus();
  }

  closeDetail(): void {
    for (const w of this.detailWidgets) {
      try { w.destroy(); } catch { /* ignore */ }
    }
    this.detailWidgets = [];
    if (this.detailEl) {
      this.detailEl.remove();
      this.detailEl = null;
    }
    this.detailId = null;
    this.el.classList.remove('jects-todo--detail-open');
  }

  /** Close the detail panel if its task vanished (e.g. removed / undone). */
  private refreshDetail(): void {
    if (this.detailId != null && !this.model.getTask(this.detailId)) this.closeDetail();
  }

  private buildDetail(task: TodoTask): HTMLElement {
    const panel = createEl('aside', {
      className: 'jects-todo__detail',
      attrs: { role: 'dialog', 'aria-label': 'Task details', 'aria-modal': 'false' },
    });
    const header = createEl('div', { className: 'jects-todo__detail-head' });
    const titleInput = createEl('input', {
      className: 'jects-todo__detail-title',
      attrs: { type: 'text', 'data-detail-field': 'title', 'aria-label': 'Task title', value: task.title ?? '' },
    }) as HTMLInputElement;
    titleInput.value = task.title ?? '';
    const close = createEl('button', {
      className: 'jects-todo__detail-close',
      html: `${renderIcon('x', { size: 16 })}<span class="jects-todo__sr">Close details</span>`,
      attrs: { type: 'button', 'data-todo-action': 'detail-close', 'aria-label': 'Close details' },
    });
    header.append(titleInput, close);
    panel.append(header);

    const body = createEl('div', { className: 'jects-todo__detail-body' });

    // Parent progress (when the task has subtasks).
    if (!isLeaf(task)) {
      const p = subtreeProgress(task);
      const prog = createEl('div', { className: 'jects-todo__detail-field jects-todo__detail-field--full' });
      prog.innerHTML = `<span class="jects-todo__detail-label">${escapeHtml(this.t('progress'))}</span><span class="jects-todo__pbadge"><span class="jects-todo__pbadge-track"><span class="jects-todo__pbadge-fill" style="inline-size:${p.percent}%"></span></span><span class="jects-todo__pbadge-num">${p.done}/${p.total}</span></span>`;
      body.append(prog);
    }
    // Status + priority (selects).
    body.append(this.detailSelect(this.t('status'), 'status', this.statuses().map((s) => ({ value: s.id, label: s.label })), effectiveStatus(task, this.statuses()).id));
    body.append(this.detailSelect(this.t('priority'), 'priority', PRIORITIES.map((p) => ({ value: p, label: priorityLabel(p) })), task.priority ?? 'none'));
    // Milestone toggle.
    body.append(this.detailCheckbox(this.t('milestone'), 'milestone', task.milestone === true));
    // Dates.
    body.append(this.detailInput(this.t('startDate'), 'startDate', 'date', task.startDate ?? ''));
    body.append(this.detailInput(this.t('dueDate'), 'due', 'date', task.due ?? ''));
    body.append(this.detailInput(this.t('reminder'), 'reminder', 'date', (task.reminder ?? '').slice(0, 10)));
    // Effort + timer (estimate vs spent bar + start/stop).
    body.append(this.detailInput(this.t('estimateH'), 'estimate', 'number', task.estimate == null ? '' : String(task.estimate)));
    body.append(this.detailInput(this.t('timeSpentH'), 'timeSpent', 'number', task.timeSpent == null ? '' : String(task.timeSpent)));
    body.append(this.buildTimerSection(task));
    // People + tags (picker triggers — searchable, not comma text).
    body.append(this.buildPickerField(this.t('assignees'), 'assignee', this.assigneeSummary(task)));
    body.append(this.buildPickerField(this.t('tags'), 'tag', (task.tags ?? []).map((t) => t.text).join(', ') || '—'));
    // Recurrence.
    const recurField = this.detailInput(this.t('recurrence'), 'recurrence', 'text', task.recurrence ?? '');
    const recurNote = createEl('div', { className: 'jects-todo__detail-note' });
    recurNote.textContent = describeRecurrence(task.recurrence);
    recurField.append(recurNote);
    body.append(recurField);
    // Dependencies (chains + add control with cycle detection + open-blocker warning).
    body.append(this.buildDependencySection(task));
    // Custom fields.
    for (const def of this.config.customFieldDefs ?? []) {
      const v = task.customFields?.[def.id];
      if (def.type === 'select') {
        body.append(this.detailSelect(def.label, `cf:${def.id}`, [{ value: '', label: '—' }, ...(def.options ?? []).map((o) => ({ value: o, label: o }))], v == null ? '' : String(v)));
      } else if (def.type === 'checkbox') {
        body.append(this.detailCheckbox(def.label, `cf:${def.id}`, v === true));
      } else {
        const t = def.type === 'number' ? 'number' : def.type === 'date' ? 'date' : 'text';
        body.append(this.detailInput(def.label, `cf:${def.id}`, t, v == null ? '' : String(v)));
      }
    }
    // Notes.
    const notesField = createEl('label', { className: 'jects-todo__detail-field jects-todo__detail-field--full' });
    const notesLabel = createEl('span', { className: 'jects-todo__detail-label' });
    notesLabel.textContent = 'Notes';
    const notes = createEl('textarea', {
      className: 'jects-todo__detail-input',
      attrs: { 'data-detail-field': 'notes', rows: '4', 'aria-label': 'Notes' },
    }) as HTMLTextAreaElement;
    notes.value = task.notes ?? '';
    notesField.append(notesLabel, notes);
    body.append(notesField);

    // Collaboration: attachments, comments thread, activity log.
    body.append(this.buildAttachmentsSection(task));
    body.append(this.buildCommentsSection(task));
    body.append(this.buildActivitySection(task));

    panel.append(body);
    return panel;
  }

  /** A read-only field that opens a picker popover when clicked. */
  private buildPickerField(label: string, kind: 'assignee' | 'tag', summary: string): HTMLElement {
    const wrap = createEl('div', { className: 'jects-todo__detail-field' });
    const lab = createEl('span', { className: 'jects-todo__detail-label' });
    lab.textContent = label;
    const btn = createEl('button', {
      className: 'jects-todo__detail-input jects-todo__detail-picker',
      attrs: { type: 'button', 'data-detail-picker': kind },
    });
    btn.textContent = summary;
    wrap.append(lab, btn);
    return wrap;
  }

  private assigneeSummary(task: TodoTask): string {
    return (task.assignees ?? []).join(', ') || '—';
  }

  /** Time tracking: estimate-vs-spent bar + start/stop timer button. */
  private buildTimerSection(task: TodoTask): HTMLElement {
    const id = this.idOf(task);
    const running = task.timerStartedAt != null;
    const est = task.estimate ?? 0;
    const spent = task.timeSpent ?? 0;
    const pct = est > 0 ? Math.min(100, Math.round((spent / est) * 100)) : 0;
    const wrap = createEl('div', { className: 'jects-todo__detail-field jects-todo__detail-field--full jects-todo__timer' });
    const lab = createEl('span', { className: 'jects-todo__detail-label' });
    lab.textContent = `${this.t('timeSpentH')}: ${spent}${est ? ` / ${est}` : ''}`;
    const barWrap = createEl('div', { className: 'jects-todo__timer-bar' });
    // jects-safe-html: static template; numeric pct only
    barWrap.innerHTML = `<span class="jects-todo__timer-fill${pct > 100 ? ' jects-todo__timer-fill--over' : ''}" style="inline-size:${pct}%"></span>`;
    const btn = createEl('button', {
      className: ['jects-todo__timer-btn', running ? 'jects-todo__timer-btn--on' : ''].filter(Boolean).join(' '),
      attrs: { type: 'button', 'data-todo-action': 'timer', 'data-todo-id': String(id) },
    });
    btn.innerHTML = `${renderIcon('clock', { size: 14 })}<span>${escapeHtml(running ? this.t('stopTimer') : this.t('startTimer'))}</span>`;
    wrap.append(lab, barWrap, btn);
    return wrap;
  }

  /** Dependency chains (clickable names) + an add control with cycle guard. */
  private buildDependencySection(task: TodoTask): HTMLElement {
    const id = this.idOf(task);
    const byId = indexTasks(this.model.roots);
    const wrap = createEl('div', { className: 'jects-todo__detail-field jects-todo__detail-field--full jects-todo__deps' });

    const chain = (label: string, ids: RecordId[], kind: 'blockedBy' | 'blocks'): HTMLElement => {
      const block = createEl('div', { className: 'jects-todo__dep-block' });
      const lab = createEl('span', { className: 'jects-todo__detail-label' });
      lab.textContent = label;
      block.append(lab);
      const listEl = createEl('div', { className: 'jects-todo__dep-list' });
      for (const depId of ids) {
        const dep = byId.get(depId as string | number);
        const chip = createEl('span', { className: 'jects-todo__dep-chip' });
        const open = createEl('button', { className: 'jects-todo__dep-name', attrs: { type: 'button', 'data-dep-open': String(depId) } });
        open.textContent = dep?.title ?? String(depId);
        if (dep && !effectiveDone(dep) && kind === 'blockedBy') chip.classList.add('jects-todo__dep-chip--open');
        const rm = createEl('button', { className: 'jects-todo__dep-rm', attrs: { type: 'button', 'data-dep-rm': String(depId), 'data-dep-kind': kind, 'aria-label': this.t('delete') } });
        rm.innerHTML = renderIcon('x', { size: 12 });
        chip.append(open, rm);
        listEl.append(chip);
      }
      block.append(listEl);
      return block;
    };

    wrap.append(chain(this.t('blockedBy'), task.dependencies?.blockedBy ?? [], 'blockedBy'));
    wrap.append(chain(this.t('blocks'), task.dependencies?.blocks ?? [], 'blocks'));

    // Add-blocker select (candidates = every other task; cycle-creating ones disabled).
    const addSel = createEl('select', { className: 'jects-todo__detail-input', attrs: { 'data-dep-add': '', 'aria-label': this.t('blockedBy') } }) as HTMLSelectElement;
    const head = document.createElement('option'); head.value = ''; head.textContent = `+ ${this.t('blockedBy')}`;
    addSel.append(head);
    for (const [cid, ct] of byId) {
      if (cid === id) continue;
      if ((task.dependencies?.blockedBy ?? []).includes(cid as RecordId)) continue;
      const opt = document.createElement('option');
      opt.value = String(cid);
      const cyclic = wouldCreateCycle(this.model.roots, id, cid as RecordId);
      opt.textContent = `${ct.title}${cyclic ? ' (cycle)' : ''}`;
      if (cyclic) opt.disabled = true;
      addSel.append(opt);
    }
    wrap.append(addSel);

    // Open-blocker warning when this task is started while blockers remain open.
    if (!effectiveDone(task) && hasOpenBlockers(task, byId)) {
      const warn = createEl('div', { className: 'jects-todo__dep-warn' });
      warn.innerHTML = `${renderIcon('alert-triangle', { size: 13 })}<span>${escapeHtml(this.t('blockedWarning'))}</span>`;
      wrap.append(warn);
    }
    return wrap;
  }

  /** Attachments list + add-by-name/URL control. */
  private buildAttachmentsSection(task: TodoTask): HTMLElement {
    const id = this.idOf(task);
    const wrap = createEl('div', { className: 'jects-todo__detail-field jects-todo__detail-field--full jects-todo__attach' });
    const lab = createEl('span', { className: 'jects-todo__detail-label' });
    lab.textContent = this.t('attachments');
    wrap.append(lab);
    const listEl = createEl('div', { className: 'jects-todo__attach-list' });
    for (const att of task.attachments ?? []) {
      const item = createEl('div', { className: 'jects-todo__attach-item' });
      // The name is escaped; the link is additionally routed through the core
      // sanitizer so an untrusted attachment URL with a `javascript:` (or other
      // unsafe) scheme is neutralized rather than rendered as a live link.
      const name = att.url
        ? sanitizeHtml(`<a href="${escapeAttr(att.url)}" target="_blank" rel="noopener">${escapeHtml(att.name)}</a>`)
        : `<span>${escapeHtml(att.name)}</span>`;
      item.innerHTML = name;
      const rm = createEl('button', { className: 'jects-todo__attach-rm', attrs: { type: 'button', 'data-attach-rm': att.id, 'aria-label': this.t('delete') } });
      rm.innerHTML = renderIcon('x', { size: 12 });
      item.append(rm);
      listEl.append(item);
    }
    wrap.append(listEl);
    const row = createEl('div', { className: 'jects-todo__attach-add' });
    const input = createEl('input', { className: 'jects-todo__detail-input', attrs: { type: 'text', 'data-attach-input': '', placeholder: this.t('addAttachment'), 'aria-label': this.t('addAttachment') } }) as HTMLInputElement;
    const btn = createEl('button', { className: 'jects-todo__attach-btn', attrs: { type: 'button', 'data-attach-add': String(id) } });
    btn.innerHTML = renderIcon('plus', { size: 14 });
    row.append(input, btn);
    wrap.append(row);
    return wrap;
  }

  /** Comments thread + an input that resolves @mentions. */
  private buildCommentsSection(task: TodoTask): HTMLElement {
    const id = this.idOf(task);
    const wrap = createEl('div', { className: 'jects-todo__detail-field jects-todo__detail-field--full jects-todo__comments' });
    const lab = createEl('span', { className: 'jects-todo__detail-label' });
    lab.textContent = this.t('comments');
    wrap.append(lab);
    const thread = createEl('div', { className: 'jects-todo__comment-thread' });
    for (const c of task.comments ?? []) {
      const item = createEl('div', { className: 'jects-todo__comment' });
      const meta = createEl('div', { className: 'jects-todo__comment-meta' });
      meta.textContent = `${c.author} · ${formatDateLocale(new Date(c.createdAt).toISOString().slice(0, 10), this.locale())}`;
      const text = createEl('div', { className: 'jects-todo__comment-text' });
      // jects-safe-html: renderMentions escapes text + mention labels
      text.innerHTML = this.renderMentions(c.text, c.mentions ?? []);
      item.append(meta, text);
      thread.append(item);
    }
    wrap.append(thread);
    const row = createEl('div', { className: 'jects-todo__comment-add' });
    const input = createEl('input', { className: 'jects-todo__detail-input', attrs: { type: 'text', 'data-comment-input': '', placeholder: this.t('addComment'), 'aria-label': this.t('addComment') } }) as HTMLInputElement;
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && input.value.trim()) { e.preventDefault(); this.addComment(id, input.value.trim()); }
    });
    const btn = createEl('button', { className: 'jects-todo__comment-btn', attrs: { type: 'button', 'data-comment-add': String(id) } });
    btn.innerHTML = renderIcon('plus', { size: 14 });
    row.append(input, btn);
    wrap.append(row);
    return wrap;
  }

  /** Read-only activity / audit timeline. */
  private buildActivitySection(task: TodoTask): HTMLElement {
    const wrap = createEl('div', { className: 'jects-todo__detail-field jects-todo__detail-field--full jects-todo__activity' });
    const lab = createEl('span', { className: 'jects-todo__detail-label' });
    lab.textContent = this.t('activity');
    wrap.append(lab);
    const listEl = createEl('div', { className: 'jects-todo__activity-list' });
    for (const a of [...(task.activity ?? [])].reverse()) {
      const item = createEl('div', { className: 'jects-todo__activity-item' });
      const when = formatDateLocale(new Date(a.when).toISOString().slice(0, 10), this.locale());
      let desc: string;
      if (a.action === 'comment') desc = this.t('comments');
      else if (a.action === 'attachment') desc = `${this.t('attachments')}: ${a.to ?? ''}`;
      else if (a.action === 'status') desc = `${this.t('status')}: ${a.from ?? ''} → ${a.to ?? ''}`;
      else desc = `${a.field ?? ''}: ${a.from || '∅'} → ${a.to || '∅'}`;
      item.textContent = `${a.who ? `${a.who} · ` : ''}${when} — ${desc}`;
      listEl.append(item);
    }
    wrap.append(listEl);
    return wrap;
  }

  /** Highlight resolved @mentions in a comment body. */
  private renderMentions(text: string, mentions: string[]): string {
    let html = escapeHtml(text);
    for (const m of mentions) {
      const safe = escapeHtml(m).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      html = html.replace(new RegExp(`@${safe}`, 'g'), `<span class="jects-todo__mention">@${escapeHtml(m)}</span>`);
    }
    return html;
  }

  private detailInput(label: string, field: string, type: string, value: string): HTMLElement {
    const wrap = createEl('label', { className: 'jects-todo__detail-field' });
    const lab = createEl('span', { className: 'jects-todo__detail-label' });
    lab.textContent = label;
    const input = createEl('input', {
      className: 'jects-todo__detail-input',
      attrs: { type, 'data-detail-field': field, 'aria-label': label },
    }) as HTMLInputElement;
    input.value = value;
    wrap.append(lab, input);
    return wrap;
  }

  private detailSelect(label: string, field: string, options: Array<{ value: string; label: string }>, value: string): HTMLElement {
    const wrap = createEl('label', { className: 'jects-todo__detail-field' });
    const lab = createEl('span', { className: 'jects-todo__detail-label' });
    lab.textContent = label;
    const sel = createEl('select', {
      className: 'jects-todo__detail-input',
      attrs: { 'data-detail-field': field, 'aria-label': label },
    }) as HTMLSelectElement;
    for (const o of options) {
      const opt = document.createElement('option');
      opt.value = o.value;
      opt.textContent = o.label;
      sel.append(opt);
    }
    sel.value = value;
    wrap.append(lab, sel);
    return wrap;
  }

  private detailCheckbox(label: string, field: string, checked: boolean): HTMLElement {
    const wrap = createEl('label', { className: 'jects-todo__detail-field jects-todo__detail-field--check' });
    const input = createEl('input', {
      className: 'jects-todo__detail-check',
      attrs: { type: 'checkbox', 'data-detail-field': field, 'aria-label': label },
    }) as HTMLInputElement;
    input.checked = checked;
    const lab = createEl('span', { className: 'jects-todo__detail-label' });
    lab.textContent = label;
    wrap.append(input, lab);
    return wrap;
  }

  /** Handle a click inside the detail panel. Returns true when handled. */
  private handleDetailClick(target: HTMLElement): boolean {
    const id = this.detailId;
    if (id == null) return false;

    const picker = target.closest<HTMLElement>('[data-detail-picker]');
    if (picker) {
      const task = this.model.getTask(id);
      if (!task) return true;
      const kind = picker.dataset.detailPicker;
      if (kind === 'assignee') {
        this.openAssigneePicker(picker, task.assignees ?? [], (next) => { this.updateTask(id, { assignees: next }); });
      } else if (kind === 'tag') {
        this.openTagPicker(picker, task.tags ?? [], (next) => { this.updateTask(id, { tags: next }); });
      }
      return true;
    }

    const depOpen = target.closest<HTMLElement>('[data-dep-open]');
    if (depOpen?.dataset.depOpen) { this.openDetail(this.resolveId(depOpen.dataset.depOpen)); return true; }

    const depRm = target.closest<HTMLElement>('[data-dep-rm]');
    if (depRm?.dataset.depRm) {
      const depId = this.resolveId(depRm.dataset.depRm);
      if (depRm.dataset.depKind === 'blocks') this.removeDependency(depId, id);
      else this.removeDependency(id, depId);
      this.openDetail(id);
      return true;
    }

    const attachAdd = target.closest<HTMLElement>('[data-attach-add]');
    if (attachAdd) {
      const input = this.detailEl?.querySelector<HTMLInputElement>('[data-attach-input]');
      const raw = input?.value.trim();
      if (raw) {
        const isUrl = /^https?:\/\//i.test(raw);
        this.addAttachment(id, isUrl ? { name: raw.split('/').pop() || raw, url: raw } : { name: raw });
        if (input) input.value = '';
      }
      return true;
    }

    const attachRm = target.closest<HTMLElement>('[data-attach-rm]');
    if (attachRm?.dataset.attachRm) { this.removeAttachment(id, attachRm.dataset.attachRm); this.openDetail(id); return true; }

    const commentAdd = target.closest<HTMLElement>('[data-comment-add]');
    if (commentAdd) {
      const input = this.detailEl?.querySelector<HTMLInputElement>('[data-comment-input]');
      const raw = input?.value.trim();
      if (raw) { this.addComment(id, raw); if (input) input.value = ''; }
      return true;
    }
    return false;
  }

  /** Toggle a task's running timer (start ↔ stop). */
  private toggleTimer(id: RecordId): void {
    if (this.model.isTimerRunning(id)) this.stopTimer(id);
    else this.startTimer(id);
  }

  /** Commit a single detail-panel field edit back into the model. */
  private commitDetailField(field: string, el: HTMLElement): void {
    if (this.detailId == null) return;
    const id = this.detailId;
    const task = this.model.getTask(id);
    if (!task) return;
    const raw = (el as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).value;
    const checked = (el as HTMLInputElement).checked;

    if (field === 'status') {
      this.setStatus(id, raw);
      return;
    }
    const changes: Partial<TodoTask> = {};
    switch (field) {
      case 'title': changes.title = raw.trim() || '(untitled)'; break;
      case 'priority': changes.priority = raw as TodoPriority; break;
      case 'due': changes.due = raw || null; break;
      case 'startDate': changes.startDate = raw || null; break;
      case 'reminder': changes.reminder = raw || null; break;
      case 'estimate': changes.estimate = raw === '' ? null : Number(raw); break;
      case 'timeSpent': changes.timeSpent = raw === '' ? null : Number(raw); break;
      case 'notes': changes.notes = raw; break;
      case 'milestone': changes.milestone = checked; break;
      case 'recurrence': changes.recurrence = raw.trim() || null; break;
      case 'assignees':
        changes.assignees = raw.split(',').map((s) => s.trim()).filter(Boolean);
        break;
      case 'tags':
        changes.tags = raw.split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
          const [text, color] = s.split(':').map((x) => x.trim());
          return color ? { text: text!, color } : { text: text! };
        });
        break;
      case 'dep-blockedBy':
        changes.dependencies = { ...(task.dependencies ?? {}), blockedBy: parseIdList(raw) };
        break;
      case 'dep-blocks':
        changes.dependencies = { ...(task.dependencies ?? {}), blocks: parseIdList(raw) };
        break;
      default:
        if (field.startsWith('cf:')) {
          const cfId = field.slice(3);
          const def = (this.config.customFieldDefs ?? []).find((d) => d.id === cfId);
          let val: string | number | boolean | null;
          if (def?.type === 'checkbox') val = checked;
          else if (def?.type === 'number') val = raw === '' ? null : Number(raw);
          else val = raw === '' ? null : raw;
          changes.customFields = { ...(task.customFields ?? {}), [cfId]: val };
        }
        break;
    }
    this.updateTask(id, changes);
  }

  // ── calendar view ───────────────────────────────────────────────────────────

  /** Render the month/week calendar, placing tasks on their due day. */
  private syncCalendar(): void {
    if (!this.calendarEl) return;
    this.teardownRows();
    this.calendarEl.replaceChildren();
    const mode = this.config.calendarMode ?? 'month';
    const tasks = this.matchingTasks();
    const days = mode === 'week' ? weekDays(this.viewAnchor) : monthGridDays(this.viewAnchor);
    const anchorMonth = this.viewAnchor.getMonth();
    const todayIso = this.nowIso();

    // Sub-toolbar: nav + mode toggle.
    const head = createEl('div', { className: 'jects-todo__cal-head' });
    const title = createEl('span', { className: 'jects-todo__cal-title' });
    title.textContent = formatMonthTitle(this.viewAnchor, this.locale());
    const nav = createEl('div', { className: 'jects-todo__cal-nav' });
    nav.append(
      this.navButton('cal-today', this.t('today'), null),
      this.navButton('cal-prev', this.t('prev'), 'chevron-left'),
      this.navButton('cal-next', this.t('next'), 'chevron-right'),
      this.navButton('cal-mode', mode === 'week' ? this.t('zoomMonth') : this.t('zoomWeek'), null),
    );
    head.append(title, nav);
    this.calendarEl.append(head);

    // Weekday header.
    const grid = createEl('div', { className: `jects-todo__cal-grid jects-todo__cal-grid--${mode}` });
    for (const name of weekdayNames(this.locale())) {
      const dh = createEl('div', { className: 'jects-todo__cal-dow' });
      dh.textContent = name;
      grid.append(dh);
    }
    for (const day of days) {
      const iso = dateToIso(day)!;
      const cell = createEl('div', {
        className: [
          'jects-todo__cal-cell',
          day.getMonth() !== anchorMonth && mode === 'month' ? 'jects-todo__cal-cell--other' : '',
          iso === todayIso ? 'jects-todo__cal-cell--today' : '',
        ].filter(Boolean).join(' '),
        attrs: { 'data-todo-day': iso, role: 'group', 'aria-label': this.fmtDate(iso) },
      });
      const num = createEl('div', { className: 'jects-todo__cal-num' });
      num.textContent = String(day.getDate());
      cell.append(num);
      for (const task of tasks.filter((t) => t.due === iso)) {
        cell.append(this.buildCalendarChip(task));
      }
      grid.append(cell);
    }
    this.calendarEl.append(grid);
  }

  /** A draggable task chip inside a calendar day cell. */
  private buildCalendarChip(task: TodoTask): HTMLElement {
    const id = this.idOf(task);
    const status = effectiveStatus(task, this.statuses());
    const priority = (task.priority ?? 'none') as TodoPriority;
    const chip = createEl('button', {
      className: [
        'jects-todo__cal-chip',
        priority !== 'none' ? `jects-todo__cal-chip--p-${priority}` : '',
        task.milestone ? 'jects-todo__cal-chip--milestone' : '',
      ].filter(Boolean).join(' '),
      attrs: { type: 'button', 'data-todo-id': String(id), 'data-todo-action': 'detail', title: task.title },
    });
    if (status.color) chip.style.setProperty('--_status-color', status.color);
    if (this.config.reorderable !== false) chip.setAttribute('draggable', 'true');
    chip.textContent = task.title || this.t('untitled');
    return chip;
  }

  private navButton(action: string, label: string, icon: IconName | null): HTMLElement {
    return createEl('button', {
      className: 'jects-todo__navbtn',
      html: icon ? `${renderIcon(icon, { size: 15 })}<span class="jects-todo__sr">${escapeHtml(label)}</span>` : escapeHtml(label),
      attrs: { type: 'button', 'data-todo-action': action, 'aria-label': label },
    });
  }

  /** Shift the calendar anchor by ±1 month (or week in week mode). */
  private shiftCalendar(dir: number): void {
    const mode = this.config.calendarMode ?? 'month';
    if (mode === 'week') this.viewAnchor = addDays(this.viewAnchor, dir * 7);
    else this.viewAnchor = new Date(this.viewAnchor.getFullYear(), this.viewAnchor.getMonth() + dir, 1);
    this.syncBody();
  }

  // ── timeline / gantt view ─────────────────────────────────────────────────────

  /** Render horizontal bars from startDate→due with dependency arrows + zoom. */
  private syncTimeline(): void {
    if (!this.timelineEl) return;
    this.teardownRows();
    this.timelineEl.replaceChildren();
    const tasks = this.matchingTasks().filter((t) => t.startDate || t.due);
    const zoom = this.config.timelineZoom ?? 'week';
    const colW = zoom === 'day' ? 36 : zoom === 'week' ? 18 : 6;
    const { min, max } = timelineBounds(tasks, this.now());
    const start = addDays(min, -2);
    const end = addDays(max, 2);
    const totalDays = Math.max(1, dayDiff(start, end) + 1);

    const head = createEl('div', { className: 'jects-todo__tl-head' });
    const zoomBtn = this.navButton('tl-zoom', `${this.t('zoomDay')}/${this.t('zoomWeek')}/${this.t('zoomMonth')}: ${capitalize(zoom)}`, null);
    head.append(zoomBtn);
    this.timelineEl.append(head);

    const scroll = createEl('div', { className: 'jects-todo__tl-scroll' });
    const chart = createEl('div', { className: 'jects-todo__tl-chart' });
    chart.style.position = 'relative';
    chart.style.inlineSize = `${totalDays * colW + 200}px`;

    // Date axis.
    const axis = createEl('div', { className: 'jects-todo__tl-axis' });
    axis.style.marginInlineStart = '200px';
    const step = zoom === 'day' ? 1 : zoom === 'week' ? 7 : 30;
    for (let d = 0; d < totalDays; d += step) {
      const tick = createEl('span', { className: 'jects-todo__tl-tick' });
      tick.style.position = 'absolute';
      tick.style.insetInlineStart = `${200 + d * colW}px`;
      tick.textContent = this.fmtDate(dateToIso(addDays(start, d)));
      axis.append(tick);
    }
    chart.append(axis);

    // Rows + bars. Track bar geometry for dependency arrows.
    const geo = new Map<string, { x: number; w: number; y: number }>();
    let rowIdx = 0;
    for (const task of tasks) {
      const row = createEl('div', { className: 'jects-todo__tl-row', attrs: { 'data-todo-id': String(this.idOf(task)) } });
      const label = createEl('div', { className: 'jects-todo__tl-label', attrs: { 'data-todo-action': 'detail' } });
      label.textContent = task.title || this.t('untitled');
      row.append(label);

      const s = isoToDate(task.startDate) ?? isoToDate(task.due)!;
      const e = isoToDate(task.due) ?? isoToDate(task.startDate)!;
      const x = dayDiff(start, s) * colW;
      const w = Math.max(colW, (dayDiff(s, e) + 1) * colW);
      const status = effectiveStatus(task, this.statuses());
      const bar = createEl('button', {
        className: ['jects-todo__tl-bar', task.milestone ? 'jects-todo__tl-bar--milestone' : ''].filter(Boolean).join(' '),
        attrs: { type: 'button', 'data-todo-id': String(this.idOf(task)), 'data-todo-tlbar': '', title: `${task.title}: ${task.startDate ?? '?'} → ${task.due ?? '?'}` },
      });
      bar.style.position = 'absolute';
      bar.style.insetInlineStart = `${200 + x}px`;
      bar.style.inlineSize = task.milestone ? `${colW}px` : `${w}px`;
      if (status.color) bar.style.setProperty('--_status-color', status.color);
      if (this.config.reorderable !== false) this.bindTimelineDrag(bar, task, colW);
      row.append(bar);
      geo.set(String(this.idOf(task)), { x: 200 + x, w, y: rowIdx });
      chart.append(row);
      rowIdx++;
    }

    // Dependency arrows (blockedBy → this task) drawn as an SVG overlay.
    const arrows = this.buildTimelineArrows(tasks, geo, colW);
    if (arrows) chart.append(arrows);

    scroll.append(chart);
    this.timelineEl.append(scroll);
  }

  /** SVG overlay of dependency edges between timeline bars. */
  private buildTimelineArrows(
    tasks: TodoTask[],
    geo: Map<string, { x: number; w: number; y: number }>,
    colW: number,
  ): SVGElement | null {
    const rowH = 30;
    const edges: Array<[string, string]> = [];
    for (const t of tasks) {
      for (const b of t.dependencies?.blockedBy ?? []) edges.push([String(b), String(this.idOf(t))]);
    }
    if (!edges.length) return null;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'jects-todo__tl-arrows');
    svg.style.position = 'absolute';
    svg.style.insetBlockStart = '28px';
    svg.style.insetInlineStart = '0';
    svg.style.inlineSize = '100%';
    svg.style.blockSize = `${tasks.length * rowH + 40}px`;
    svg.setAttribute('aria-hidden', 'true');
    svg.style.pointerEvents = 'none';
    for (const [from, to] of edges) {
      const g1 = geo.get(from);
      const g2 = geo.get(to);
      if (!g1 || !g2) continue;
      const x1 = g1.x + Math.max(colW, g1.w);
      const y1 = g1.y * rowH + rowH / 2 + 6;
      const x2 = g2.x;
      const y2 = g2.y * rowH + rowH / 2 + 6;
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      const midX = (x1 + x2) / 2;
      path.setAttribute('d', `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`);
      path.setAttribute('class', 'jects-todo__tl-arrow');
      path.setAttribute('fill', 'none');
      svg.append(path);
    }
    return svg;
  }

  private cycleZoom(): void {
    const cur = this.config.timelineZoom ?? 'week';
    const i = ZOOMS.indexOf(cur);
    this.config.timelineZoom = ZOOMS[(i + 1) % ZOOMS.length]!;
    this.syncBody();
  }

  /**
   * Pointer-drag a timeline bar to shift its start/due dates by whole days. The
   * bar translates live; on release the model is patched with the day delta.
   */
  private bindTimelineDrag(bar: HTMLElement, task: TodoTask, colW: number): void {
    const id = this.idOf(task);
    bar.addEventListener('pointerdown', (e: PointerEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const startX = e.clientX;
      const baseLeft = parseFloat(bar.style.insetInlineStart || '0');
      let dayDelta = 0;
      const move = (ev: PointerEvent): void => {
        dayDelta = Math.round((ev.clientX - startX) / colW);
        bar.style.insetInlineStart = `${baseLeft + dayDelta * colW}px`;
        bar.classList.add('jects-todo__tl-bar--dragging');
      };
      const up = (): void => {
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', up);
        if (dayDelta !== 0) {
          const changes: Partial<TodoTask> = {};
          const s = isoToDate(task.startDate);
          const d = isoToDate(task.due);
          if (s) changes.startDate = dateToIso(addDays(s, dayDelta));
          if (d) changes.due = dateToIso(addDays(d, dayDelta));
          this.updateTask(id, changes);
        } else {
          bar.classList.remove('jects-todo__tl-bar--dragging');
        }
      };
      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', up);
    });
  }

  // ── table / grid view ─────────────────────────────────────────────────────────

  /** Render the dense, inline-editable table with configurable columns. */
  private syncTable(): void {
    if (!this.tableEl) return;
    this.teardownRows();
    this.cancelColumnResize();
    this.tableEl.replaceChildren();
    const cols = this.getTableColumns().filter((c) => !c.hidden);
    const tasks = this.matchingTasks();
    const selectable = this.config.selectable !== false;
    const rowHeight = this.getTableRowHeight();

    const table = createEl('table', { className: 'jects-todo__table', attrs: { role: 'grid' } });
    const thead = createEl('thead');
    const hr = createEl('tr');

    // Leading select-all column header (mirrors the list-view "select all" box).
    if (selectable) {
      const selTh = createEl('th', {
        className: 'jects-todo__tcol-sel',
        attrs: { scope: 'col' },
      });
      const selAll = createEl('span', {
        className: 'jects-todo__rowsel jects-todo__selall',
        attrs: { 'data-todo-select-all': '', role: 'checkbox', tabindex: '0', 'aria-checked': 'false', title: this.t('selectAll'), 'aria-label': this.t('selectAll') },
      });
      selTh.append(selAll);
      hr.append(selTh);
    }

    for (const c of cols) {
      const th = createEl('th', {
        className: 'jects-todo__tcol',
        attrs: { scope: 'col', 'data-table-col': String(c.field) },
      });
      if (c.width) th.style.inlineSize = `${c.width}px`;
      const label = createEl('span', { className: 'jects-todo__tcol-label' });
      label.textContent = this.tableColLabel(c);
      th.append(label);
      // Drag-to-resize handle on the column's trailing edge.
      const handle = createEl('span', {
        className: 'jects-todo__tcol-resize',
        attrs: {
          'data-table-resize': String(c.field),
          role: 'separator',
          'aria-orientation': 'vertical',
          tabindex: '0',
          title: this.t('resizeColumn'),
          'aria-label': `${this.t('resizeColumn')}: ${this.tableColLabel(c)}`,
        },
      });
      th.append(handle);
      hr.append(th);
    }
    thead.append(hr);
    table.append(thead);

    const tbody = createEl('tbody');
    for (const task of tasks) {
      const tr = createEl('tr', { className: 'jects-todo__trow', attrs: { 'data-todo-id': String(this.idOf(task)) } });
      if (rowHeight != null) tr.style.setProperty('--_todo-trow-h', `${rowHeight}px`);
      if (selectable) {
        const selTd = createEl('td', { className: 'jects-todo__tcol-sel' });
        const selBox = createEl('span', {
          className: 'jects-todo__rowsel',
          attrs: { 'data-todo-select': '', role: 'checkbox', tabindex: '0', 'aria-checked': 'false', title: this.t('selectTask'), 'aria-label': this.t('selectTask') },
        });
        selTd.append(selBox);
        tr.append(selTd);
      }
      for (const c of cols) {
        const td = createEl('td', { attrs: { 'data-table-field': String(c.field) } });
        td.append(this.buildTableCell(task, c.field));
        tr.append(td);
      }
      tbody.append(tr);
    }
    table.append(tbody);
    if (rowHeight != null) table.classList.add('jects-todo__table--fixed-rows');
    this.tableEl.append(table);
    this.syncSelectionDom();
  }

  /** Begin a pointer drag-resize of a Table-view column from its edge handle. */
  private startColumnResize(handle: HTMLElement, startX: number, pointerId: number): void {
    const field = handle.dataset.tableResize;
    if (!field) return;
    const th = handle.closest<HTMLElement>('th[data-table-col]');
    if (!th) return;
    this.cancelColumnResize();
    const startWidth = th.getBoundingClientRect().width;
    handle.classList.add('jects-todo__tcol-resize--active');
    try { handle.setPointerCapture(pointerId); } catch { /* capture is best-effort */ }

    let width = startWidth;
    const onMove = (e: PointerEvent): void => {
      width = Math.max(MIN_COLUMN_WIDTH, Math.round(startWidth + (e.clientX - startX)));
      th.style.inlineSize = `${width}px`;
    };
    const finish = (commit: boolean): void => {
      this.cancelColumnResize();
      if (commit && Math.round(width) !== Math.round(startWidth)) {
        this.setColumnWidth(field as TodoTableField, width);
      }
    };
    const onUp = (): void => finish(true);
    const onCancel = (): void => finish(false);
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') { th.style.inlineSize = `${startWidth}px`; finish(false); }
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onCancel);
    document.addEventListener('keydown', onKey, true);
    this.colResizeCleanup = (): void => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onCancel);
      document.removeEventListener('keydown', onKey, true);
      handle.classList.remove('jects-todo__tcol-resize--active');
      try { handle.releasePointerCapture(pointerId); } catch { /* may already be released */ }
    };
  }

  /** Tear down any in-flight column-resize drag listeners. */
  private cancelColumnResize(): void {
    this.colResizeCleanup?.();
    this.colResizeCleanup = null;
  }

  private tableColLabel(c: TodoTableColumn): string {
    if (c.label) return c.label;
    const field = String(c.field);
    if (field.startsWith('cf:')) {
      const def = (this.config.customFieldDefs ?? []).find((d) => d.id === field.slice(3));
      return def?.label ?? field;
    }
    return capitalize(field);
  }

  /** A single (inline-editable) table cell for a field. */
  private buildTableCell(task: TodoTask, field: string): HTMLElement {
    const id = this.idOf(task);
    const cell = createEl('span', { className: 'jects-todo__cell', attrs: { 'data-todo-cell': field } });
    const setText = (s: string): void => { cell.textContent = s || '—'; };
    switch (field) {
      case 'title': setText(task.title || this.t('untitled')); cell.dataset.todoAction = 'detail'; break;
      case 'status': {
        const s = effectiveStatus(task, this.statuses());
        cell.classList.add('jects-todo__inline'); cell.dataset.todoInline = 'status';
        if (s.color) cell.style.setProperty('--_status-color', s.color);
        cell.innerHTML = `<span class="jects-todo__status">${escapeHtml(s.label)}</span>`;
        break;
      }
      case 'priority':
        cell.classList.add('jects-todo__inline'); cell.dataset.todoInline = 'priority';
        setText(task.priority && task.priority !== 'none' ? priorityLabel(task.priority) : '—');
        break;
      case 'assignees':
        cell.classList.add('jects-todo__inline'); cell.dataset.todoInline = 'assignee';
        setText((task.assignees ?? []).join(', '));
        break;
      case 'due':
        cell.classList.add('jects-todo__inline'); cell.dataset.todoInline = 'due';
        setText(task.due ? this.fmtDate(task.due) : '—');
        break;
      case 'startDate': setText(task.startDate ? this.fmtDate(task.startDate) : '—'); break;
      case 'estimate': setText(task.estimate == null ? '—' : `${task.estimate}h`); break;
      case 'timeSpent': setText(task.timeSpent == null ? '—' : `${task.timeSpent}h`); break;
      case 'tags':
        cell.classList.add('jects-todo__inline'); cell.dataset.todoInline = 'tag';
        setText((task.tags ?? []).map((t) => t.text).join(', '));
        break;
      default:
        if (field.startsWith('cf:')) {
          const v = task.customFields?.[field.slice(3)];
          setText(v == null ? '—' : String(v));
        } else setText('—');
        break;
    }
    void id;
    return cell;
  }

  // ── popover infrastructure (inline pickers / builders) ──────────────────────

  /**
   * Open a lightweight floating panel anchored under `anchor`. Only one popover
   * is open at a time; clicking outside (or pressing Escape) closes it. The
   * panel is fixed-positioned so it is never clipped by scroll containers.
   */
  private openPopover(anchor: HTMLElement, content: HTMLElement, label: string): HTMLElement {
    this.closePopover();
    const panel = createEl('div', {
      className: 'jects-todo__popover',
      attrs: { role: 'dialog', 'aria-label': label },
    });
    panel.append(content);
    this.el.append(panel);

    const rect = anchor.getBoundingClientRect();
    panel.style.position = 'fixed';
    panel.style.zIndex = '1000';
    // Position below the anchor, then nudge back into the viewport.
    panel.style.top = `${Math.round(rect.bottom + 4)}px`;
    panel.style.left = `${Math.round(rect.left)}px`;
    requestAnimationFrame(() => {
      if (!this.popover) return;
      const pr = panel.getBoundingClientRect();
      if (pr.right > window.innerWidth - 8) panel.style.left = `${Math.max(8, window.innerWidth - pr.width - 8)}px`;
      if (pr.bottom > window.innerHeight - 8) panel.style.top = `${Math.max(8, rect.top - pr.height - 4)}px`;
    });

    const onDown = (e: Event): void => {
      const t = e.target as Node;
      if (!panel.contains(t) && t !== anchor && !anchor.contains(t)) this.closePopover();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') { e.preventDefault(); this.closePopover(); anchor.focus?.(); }
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    this.popoverCleanup = (): void => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
    this.popover = panel;
    const focusable = panel.querySelector<HTMLElement>('input, select, button, [tabindex]');
    focusable?.focus();
    return panel;
  }

  private closePopover(): void {
    this.popoverCleanup?.();
    this.popoverCleanup = null;
    if (this.popover) { this.popover.remove(); this.popover = null; }
  }

  // ── inline field editors ────────────────────────────────────────────────────

  /** Dispatch an inline edit on a row to the right picker. */
  private openInlineEditor(kind: string, id: RecordId, anchor: HTMLElement): void {
    const task = this.model.getTask(id);
    if (!task) return;
    switch (kind) {
      case 'status': this.openStatusPicker(id, anchor); break;
      case 'priority': this.openPriorityPicker(id, anchor); break;
      case 'assignee': this.openAssigneePicker(anchor, task.assignees ?? [], (next) => this.updateTask(id, { assignees: next })); break;
      case 'tag': this.openTagPicker(anchor, task.tags ?? [], (next) => this.updateTask(id, { tags: next })); break;
      case 'due': this.openDuePicker(id, anchor); break;
      default: break;
    }
  }

  /** A simple option-list popover; calls `onPick` with the chosen value. */
  private openListPicker(
    anchor: HTMLElement,
    label: string,
    options: Array<{ value: string; label: string; color?: string; current?: boolean }>,
    onPick: (value: string) => void,
  ): void {
    const list = createEl('div', { className: 'jects-todo__picker', attrs: { role: 'listbox', 'aria-label': label } });
    for (const o of options) {
      const item = createEl('button', {
        className: ['jects-todo__picker-item', o.current ? 'jects-todo__picker-item--on' : ''].filter(Boolean).join(' '),
        attrs: { type: 'button', role: 'option', 'aria-selected': String(!!o.current) },
      });
      const swatch = o.color ? `<span class="jects-todo__group-swatch" style="background:oklch(${o.color})"></span>` : '';
      item.innerHTML = `${swatch}<span>${escapeHtml(o.label)}</span>`;
      item.addEventListener('click', () => { onPick(o.value); this.closePopover(); });
      list.append(item);
    }
    this.openPopover(anchor, list, label);
  }

  private openStatusPicker(id: RecordId, anchor: HTMLElement): void {
    const task = this.model.getTask(id);
    if (!task) return;
    const cur = effectiveStatus(task, this.statuses()).id;
    this.openListPicker(
      anchor,
      this.t('status'),
      this.statuses().map((s) => ({ value: s.id, label: s.label, ...(s.color ? { color: s.color } : {}), current: s.id === cur })),
      (v) => this.setStatus(id, v),
    );
  }

  private openPriorityPicker(id: RecordId, anchor: HTMLElement): void {
    const task = this.model.getTask(id);
    if (!task) return;
    const cur = task.priority ?? 'none';
    this.openListPicker(
      anchor,
      this.t('priority'),
      PRIORITIES.map((p) => ({ value: p, label: priorityLabel(p), current: p === cur })),
      (v) => this.updateTask(id, { priority: v as TodoPriority }),
    );
  }

  private openDuePicker(id: RecordId, anchor: HTMLElement): void {
    const task = this.model.getTask(id);
    if (!task) return;
    const wrap = createEl('div', { className: 'jects-todo__picker' });
    const input = createEl('input', {
      className: 'jects-todo__detail-input',
      attrs: { type: 'date', 'aria-label': this.t('dueDate') },
    }) as HTMLInputElement;
    input.value = task.due ?? '';
    input.addEventListener('change', () => { this.updateTask(id, { due: input.value || null }); this.closePopover(); });
    wrap.append(input);
    this.openPopover(anchor, wrap, this.t('dueDate'));
  }

  /**
   * Searchable, multi-select assignee picker drawn from the known `assignees`
   * config (plus any already on the task). Calls `onCommit` with the new set.
   */
  private openAssigneePicker(anchor: HTMLElement, current: string[], onCommit: (next: string[]) => void): void {
    const known = [...new Set([...(this.config.assignees ?? []), ...current])];
    const selected = new Set(current);
    const wrap = createEl('div', { className: 'jects-todo__picker jects-todo__picker--people' });
    const search = createEl('input', {
      className: 'jects-todo__picker-search',
      attrs: { type: 'search', placeholder: this.t('assignees'), 'aria-label': this.t('assignees') },
    }) as HTMLInputElement;
    const listEl = createEl('div', { className: 'jects-todo__picker-list', attrs: { role: 'listbox', 'aria-multiselectable': 'true' } });
    wrap.append(search, listEl);

    const render = (): void => {
      const q = search.value.trim().toLowerCase();
      listEl.replaceChildren();
      const matches = known.filter((a) => a.toLowerCase().includes(q));
      for (const a of matches) {
        const on = selected.has(a);
        const item = createEl('button', {
          className: ['jects-todo__picker-item', on ? 'jects-todo__picker-item--on' : ''].filter(Boolean).join(' '),
          attrs: { type: 'button', role: 'option', 'aria-selected': String(on) },
        });
        item.innerHTML = `<span class="jects-todo__avatar" style="--_avatar-color:${avatarColor(a)}">${escapeHtml(initials(a))}</span><span>${escapeHtml(a)}</span>${on ? renderIcon('check', { size: 13 }) : ''}`;
        item.addEventListener('click', () => {
          if (selected.has(a)) selected.delete(a); else selected.add(a);
          onCommit([...selected]);
          render();
        });
        listEl.append(item);
      }
      // Offer to create a brand-new assignee from the query.
      if (q && !known.some((a) => a.toLowerCase() === q)) {
        const add = createEl('button', { className: 'jects-todo__picker-item jects-todo__picker-add', attrs: { type: 'button' } });
        add.textContent = `+ ${search.value.trim()}`;
        add.addEventListener('click', () => {
          const name = search.value.trim();
          known.push(name); selected.add(name);
          if (!this.config.assignees?.includes(name)) this.config.assignees = [...(this.config.assignees ?? []), name];
          onCommit([...selected]);
          search.value = '';
          render();
        });
        listEl.append(add);
      }
    };
    search.addEventListener('input', render);
    render();
    this.openPopover(anchor, wrap, this.t('assignees'));
  }

  /** Tag picker: pick from the existing tag library + create-new (with color). */
  private openTagPicker(anchor: HTMLElement, current: TodoTag[], onCommit: (next: TodoTag[]) => void): void {
    const library = this.tagLibrary();
    const selected = new Map(current.map((t) => [t.text, t] as const));
    const wrap = createEl('div', { className: 'jects-todo__picker jects-todo__picker--tags' });
    const search = createEl('input', {
      className: 'jects-todo__picker-search',
      attrs: { type: 'search', placeholder: this.t('tags'), 'aria-label': this.t('tags') },
    }) as HTMLInputElement;
    const listEl = createEl('div', { className: 'jects-todo__picker-list', attrs: { role: 'listbox', 'aria-multiselectable': 'true' } });
    wrap.append(search, listEl);
    const palette = ['var(--jects-cmyk-cyan)', 'var(--jects-cmyk-magenta)', 'var(--jects-cmyk-yellow)', 'var(--jects-cmyk-key)'];

    const render = (): void => {
      const q = search.value.trim().toLowerCase();
      listEl.replaceChildren();
      const matches = library.filter((t) => t.text.toLowerCase().includes(q));
      for (const tag of matches) {
        const on = selected.has(tag.text);
        const item = createEl('button', {
          className: ['jects-todo__picker-item', on ? 'jects-todo__picker-item--on' : ''].filter(Boolean).join(' '),
          attrs: { type: 'button', role: 'option', 'aria-selected': String(on) },
        });
        const sw = tag.color ? `<span class="jects-todo__group-swatch" style="background:oklch(${tag.color})"></span>` : '';
        item.innerHTML = `${sw}<span>${escapeHtml(tag.text)}</span>${on ? renderIcon('check', { size: 13 }) : ''}`;
        item.addEventListener('click', () => {
          if (selected.has(tag.text)) selected.delete(tag.text); else selected.set(tag.text, { ...tag });
          onCommit([...selected.values()]);
          render();
        });
        listEl.append(item);
      }
      if (q && !library.some((t) => t.text.toLowerCase() === q)) {
        const add = createEl('button', { className: 'jects-todo__picker-item jects-todo__picker-add', attrs: { type: 'button' } });
        add.textContent = `+ ${search.value.trim()}`;
        add.addEventListener('click', () => {
          const text = search.value.trim();
          const color = palette[library.length % palette.length]!;
          const tag: TodoTag = { text, color };
          library.push(tag); selected.set(text, tag);
          onCommit([...selected.values()]);
          search.value = '';
          render();
        });
        listEl.append(add);
      }
    };
    search.addEventListener('input', render);
    render();
    this.openPopover(anchor, wrap, this.t('tags'));
  }

  /** Distinct tags seen across the whole tree (the tag library). */
  private tagLibrary(): TodoTag[] {
    const map = new Map<string, TodoTag>();
    const walk = (tasks: TodoTask[]): void => {
      for (const t of tasks) {
        for (const tag of t.tags ?? []) if (!map.has(tag.text)) map.set(tag.text, { ...tag });
        walk(childrenOf(t));
      }
    };
    walk(this.model.roots);
    return [...map.values()];
  }

  // ── multi-sort / filter / columns popovers ──────────────────────────────────

  /** Multi-criteria sort builder: add/remove fields, per-field dir + reorder. */
  private openSortPopover(anchor: HTMLElement): void {
    const wrap = createEl('div', { className: 'jects-todo__builder' });
    const rows = createEl('div', { className: 'jects-todo__builder-rows' });
    wrap.append(rows);

    const draw = (): void => {
      const sort = this.getSort().filter((s) => s.field !== 'manual');
      rows.replaceChildren();
      sort.forEach((crit, i) => {
        const row = createEl('div', { className: 'jects-todo__builder-row' });
        const sel = createEl('select', { className: 'jects-todo__select', attrs: { 'aria-label': this.t('sortPrefix') } }) as HTMLSelectElement;
        for (const f of SORT_OPTIONS) {
          if (f === 'manual') continue;
          const opt = document.createElement('option');
          opt.value = f; opt.textContent = capitalize(f);
          sel.append(opt);
        }
        sel.value = crit.field;
        sel.addEventListener('change', () => { sort[i] = { field: sel.value as TodoSortField, dir: crit.dir ?? 'asc' }; this.setSort(sort); draw(); });
        const dir = createEl('button', { className: 'jects-todo__sortdir', attrs: { type: 'button', 'aria-label': this.t('toggleSortDir') } });
        dir.innerHTML = renderIcon(crit.dir === 'desc' ? 'arrow-up' : 'arrow-down', { size: 14 });
        dir.addEventListener('click', () => { sort[i] = { field: crit.field, dir: crit.dir === 'desc' ? 'asc' : 'desc' }; this.setSort(sort); draw(); });
        const up = createEl('button', { className: 'jects-todo__builder-move', attrs: { type: 'button', 'aria-label': this.t('prev'), disabled: i === 0 ? 'disabled' : '' } });
        up.innerHTML = renderIcon('chevron-up', { size: 14 });
        up.addEventListener('click', () => { if (i > 0) { [sort[i - 1], sort[i]] = [sort[i]!, sort[i - 1]!]; this.setSort(sort); draw(); } });
        const rm = createEl('button', { className: 'jects-todo__builder-rm', attrs: { type: 'button', 'aria-label': this.t('delete') } });
        rm.innerHTML = renderIcon('x', { size: 14 });
        rm.addEventListener('click', () => { sort.splice(i, 1); this.setSort(sort.length ? sort : [{ field: 'manual' }]); draw(); });
        row.append(sel, dir, up, rm);
        rows.append(row);
      });
    };

    const addBtn = createEl('button', { className: 'jects-todo__builder-add', attrs: { type: 'button' } });
    addBtn.innerHTML = `${renderIcon('plus', { size: 14 })}<span>${escapeHtml(this.t('addSort'))}</span>`;
    addBtn.addEventListener('click', () => {
      const sort = this.getSort().filter((s) => s.field !== 'manual');
      const used = new Set(sort.map((s) => s.field));
      const next = SORT_OPTIONS.find((f) => f !== 'manual' && !used.has(f)) ?? 'title';
      sort.push({ field: next, dir: 'asc' });
      this.setSort(sort);
      draw();
    });
    wrap.append(addBtn);
    draw();
    this.openPopover(anchor, wrap, this.t('addSort'));
  }

  /** Filter builder: status/priority/assignee/tag/due/milestone → setFilters. */
  private openFilterPopover(anchor: HTMLElement): void {
    const f = this.getFilters();
    const wrap = createEl('div', { className: 'jects-todo__builder jects-todo__builder--filter' });

    const section = (title: string, items: Array<{ value: string; label: string }>, current: string[], onToggle: (v: string, on: boolean) => void): void => {
      const sec = createEl('div', { className: 'jects-todo__builder-sec' });
      const h = createEl('div', { className: 'jects-todo__builder-sec-title' });
      h.textContent = title;
      sec.append(h);
      const cur = new Set(current);
      for (const it of items) {
        const lab = createEl('label', { className: 'jects-todo__builder-chk' });
        const cb = createEl('input', { attrs: { type: 'checkbox' } }) as HTMLInputElement;
        cb.checked = cur.has(it.value);
        cb.addEventListener('change', () => onToggle(it.value, cb.checked));
        const span = createEl('span'); span.textContent = it.label;
        lab.append(cb, span);
        sec.append(lab);
      }
      wrap.append(sec);
    };

    section(this.t('status'), this.statuses().map((s) => ({ value: s.id, label: s.label })), f.status ?? [], (v, on) => {
      const cur = new Set(this.getFilters().status ?? []);
      if (on) cur.add(v); else cur.delete(v);
      this.setFilters({ ...this.getFilters(), status: [...cur] });
    });
    section(this.t('priority'), PRIORITIES.map((p) => ({ value: p, label: priorityLabel(p) })), (f.priority ?? []) as string[], (v, on) => {
      const cur = new Set((this.getFilters().priority ?? []) as string[]);
      if (on) cur.add(v); else cur.delete(v);
      this.setFilters({ ...this.getFilters(), priority: [...cur] as TodoPriority[] });
    });
    const people = this.config.assignees ?? [];
    if (people.length) {
      section(this.t('assignees'), people.map((a) => ({ value: a, label: a })), f.assignees ?? [], (v, on) => {
        const cur = new Set(this.getFilters().assignees ?? []);
        if (on) cur.add(v); else cur.delete(v);
        this.setFilters({ ...this.getFilters(), assignees: [...cur] });
      });
    }
    const tags = this.tagLibrary();
    if (tags.length) {
      section(this.t('tags'), tags.map((t) => ({ value: t.text, label: t.text })), f.tags ?? [], (v, on) => {
        const cur = new Set(this.getFilters().tags ?? []);
        if (on) cur.add(v); else cur.delete(v);
        this.setFilters({ ...this.getFilters(), tags: [...cur] });
      });
    }
    // Due bucket (single-select) + milestone toggle.
    const dueSec = createEl('div', { className: 'jects-todo__builder-sec' });
    const dueSel = this.buildSelect('data-filter-due', this.t('dueDate'), [
      { value: 'any', label: this.t('filterAll') },
      { value: 'overdue', label: this.t('overdue') },
      { value: 'today', label: this.t('dueToday') },
      { value: 'soon', label: this.t('dueSoon') },
      { value: 'none', label: this.t('noDueDate') },
    ]);
    dueSel.value = f.due ?? 'any';
    dueSel.addEventListener('change', () => this.setFilters({ ...this.getFilters(), due: dueSel.value as TodoDueFilter }));
    dueSec.append(dueSel);
    const msLabel = createEl('label', { className: 'jects-todo__builder-chk' });
    const msCb = createEl('input', { attrs: { type: 'checkbox' } }) as HTMLInputElement;
    msCb.checked = f.milestone === true;
    msCb.addEventListener('change', () => {
      const next = { ...this.getFilters() };
      if (msCb.checked) next.milestone = true; else delete next.milestone;
      this.setFilters(next);
    });
    const msSpan = createEl('span'); msSpan.textContent = this.t('milestone');
    msLabel.append(msCb, msSpan);
    dueSec.append(msLabel);
    wrap.append(dueSec);

    const clear = createEl('button', { className: 'jects-todo__builder-add', attrs: { type: 'button' } });
    clear.textContent = this.t('clear');
    clear.addEventListener('click', () => { this.setFilters({}); this.closePopover(); });
    wrap.append(clear);

    this.openPopover(anchor, wrap, this.t('filterBuilder'));
  }

  /** Table column show/hide + reorder menu. */
  private openColumnsPopover(anchor: HTMLElement): void {
    const cols = this.getTableColumns();
    const wrap = createEl('div', { className: 'jects-todo__builder' });
    const rows = createEl('div', { className: 'jects-todo__builder-rows' });
    wrap.append(rows);
    const draw = (): void => {
      rows.replaceChildren();
      cols.forEach((c, i) => {
        const row = createEl('div', { className: 'jects-todo__builder-row' });
        const lab = createEl('label', { className: 'jects-todo__builder-chk' });
        const cb = createEl('input', { attrs: { type: 'checkbox' } }) as HTMLInputElement;
        cb.checked = !c.hidden;
        cb.addEventListener('change', () => { cols[i] = { ...c, hidden: !cb.checked }; this.setTableColumns(cols); draw(); });
        const span = createEl('span'); span.textContent = this.tableColLabel(c);
        lab.append(cb, span);
        const up = createEl('button', { className: 'jects-todo__builder-move', attrs: { type: 'button', 'aria-label': this.t('prev'), disabled: i === 0 ? 'disabled' : '' } });
        up.innerHTML = renderIcon('chevron-up', { size: 14 });
        up.addEventListener('click', () => { if (i > 0) { [cols[i - 1], cols[i]] = [cols[i]!, cols[i - 1]!]; this.setTableColumns(cols); draw(); } });
        row.append(lab, up);
        rows.append(row);
      });
    };
    draw();
    this.openPopover(anchor, wrap, this.t('columns'));
  }

  // ── progress badge + date formatting ────────────────────────────────────────

  /** A `done/total` count + mini progress bar for a parent task. */
  private buildProgressBadge(task: TodoTask): HTMLElement {
    const p = subtreeProgress(task);
    const badge = createEl('span', {
      className: 'jects-todo__pbadge',
      attrs: { 'aria-hidden': 'true', title: `${p.done} / ${p.total}` },
    });
    // jects-safe-html: static template; numeric values only
    badge.innerHTML = `<span class="jects-todo__pbadge-track"><span class="jects-todo__pbadge-fill" style="inline-size:${p.percent}%"></span></span><span class="jects-todo__pbadge-num">${p.done}/${p.total}</span>`;
    return badge;
  }

  /** Locale-aware short date for the configured locale. */
  private fmtDate(iso: string | null | undefined): string {
    return formatDateLocale(iso, this.locale());
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  /** Resolve a catalog message key. */
  private t(key: keyof TodoMessages): string {
    return this.messages[key];
  }

  /** Localized label for a view tab. */
  private viewLabel(v: TodoView): string {
    switch (v) {
      case 'list': return this.t('viewList');
      case 'board': return this.t('viewBoard');
      case 'calendar': return this.t('viewCalendar');
      case 'timeline': return this.t('viewTimeline');
      case 'table': return this.t('viewTable');
      default: return capitalize(v);
    }
  }

  /** The configured locale for `Intl` formatting (or runtime default). */
  private locale(): string | undefined {
    return this.config.locale;
  }

  /** The configured clock (injectable for tests), defaulting to `new Date()`. */
  private now(): Date {
    return this.config.now ? this.config.now() : new Date();
  }

  private nowIso(): string {
    return dateToIso(this.now()) ?? '';
  }

  private idOf(task: TodoTask): RecordId {
    return task[this.config.idField ?? 'id'] as RecordId;
  }

  /** Resolve a DOM `data-todo-id` string back to the real (possibly numeric) id. */
  private resolveId(raw: string): RecordId {
    return this.model.getTask(raw) ? raw : (this.model.getTask(Number(raw)) ? Number(raw) : raw);
  }

  private rowEl(id: RecordId): HTMLElement | null {
    if (!this.bodyEl) return null;
    const want = String(id);
    // Avoid CSS.escape (not present in every test env / older engines): scan
    // rows and compare the resolved id directly.
    for (const el of this.bodyEl.querySelectorAll<HTMLElement>('[data-todo-id]')) {
      if (el.dataset.todoId === want) return el;
    }
    return null;
  }

  private focusRow(id: RecordId): void {
    this.focusedId = id;
    this.syncRoving();
    this.rowEl(id)?.focus();
  }

  /** Keep exactly one row in the tab order (roving tabindex). */
  private syncRoving(): void {
    for (const el of this.bodyEl.querySelectorAll<HTMLElement>('[data-todo-id]')) {
      const on = this.resolveId(el.dataset.todoId!) === this.focusedId;
      el.tabIndex = on ? 0 : -1;
      el.setAttribute('aria-selected', String(on));
    }
  }

  override destroy(): void {
    if (this.isDestroyed) {
      super.destroy();
      return;
    }
    this.closeEditor(false);
    this.closeDetail();
    this.closePopover();
    this.cancelColumnResize();
    super.destroy();
  }
}

// ── module-scope pure helpers ───────────────────────────────────────────────

function normalizeForEvent(task: Partial<TodoTask>, idField: string): TodoTask {
  const out: TodoTask = {
    ...task,
    title: task.title ?? '',
    done: task.done ?? false,
    due: task.due ?? null,
    priority: task.priority ?? 'none',
    notes: task.notes ?? '',
  } as TodoTask;
  // Assign the id up front so `beforeAdd`, `add`, and the stored record all
  // share one id (the model will keep an explicit id rather than minting a new one).
  if ((out as Record<string, unknown>)[idField] == null) {
    (out as Record<string, unknown>)[idField] = nextTaskId();
  }
  return out;
}

// HTML / attribute escaping delegate to the shared `@jects/core` `escape`
// helper (the canonical implementation per docs/SECURITY.md §1) rather than a
// per-package re-implementation. Core `escape` also encodes `"` and `'`, so it
// is safe for both text-content interpolation and double-quoted attribute
// values — `escapeAttr` is retained as a named alias for call-site clarity.
const escapeHtml = escape;
const escapeAttr = escape;

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Up-to-two-letter initials for an assignee avatar. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

/** Deterministic avatar color (a CMYK hue token) from a name hash. */
const AVATAR_COLORS = [
  'var(--jects-cmyk-cyan)',
  'var(--jects-cmyk-magenta)',
  'var(--jects-cmyk-yellow)',
  'var(--jects-cmyk-key)',
];
function avatarColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length]!;
}

/** Parse a comma-separated id list, preserving numeric ids where applicable. */
function parseIdList(raw: string): RecordId[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => (/^-?\d+$/.test(s) ? Number(s) : s));
}

// Re-export the priority list as a value consumers may want (used by stories).
export { PRIORITIES };

register(
  'todolist',
  TodoList as unknown as new (host: HTMLElement | string, config?: Record<string, unknown>) => TodoList,
);
