/**
 * @jects/todo — public contract (types only).
 *
 * The To-Do manager has grown from a checklist into an enterprise task manager
 * (Asana / ClickUp / Monday-class): a parent-child task hierarchy (built on
 * @jects/core `TreeStore`) with configurable statuses/workflow, a rich task
 * model (assignees, tags, custom fields, dependencies, effort, recurrence),
 * List + Board views, sort / group-by / multi-criteria filter / search, a detail
 * side-panel editor, due-date status + reminders, multi-select + bulk actions,
 * undo/redo, a pluggable data provider, and JSON/CSV export.
 *
 * This file is the typed API surface the implementation (`todo-list.ts`) codes
 * against; it carries no runtime values. Everything added beyond the original
 * checklist is OPTIONAL so the v1 contract keeps working unchanged.
 */

import type { WidgetConfig, WidgetEvents, RecordId, TreeNode } from '@jects/core';
import type { TodoMessages } from './todo-i18n.js';

/** Task priority. Ordered low → high for sorting/labels. */
export type TodoPriority = 'none' | 'low' | 'medium' | 'high';

/** Built-in visible-task filter (kept for back-compat; now one axis of many). */
export type TodoFilter = 'all' | 'active' | 'done';

/** Which surface the list renders as. */
export type TodoView = 'list' | 'board' | 'calendar' | 'timeline' | 'table';

/** Zoom granularity for the timeline / Gantt view. */
export type TodoTimelineZoom = 'day' | 'week' | 'month';

/** Calendar sub-view (month grid or single week). */
export type TodoCalendarMode = 'month' | 'week';

/* ── Workflow statuses ─────────────────────────────────────────────────────── */

/**
 * A configurable workflow status (replaces the binary done flag). Each status
 * has a stable `id`, a display `label`, an optional `color` (a `--jects-*`/oklch
 * token expression or hex), and `isDone` — whether tasks in this status count as
 * complete for roll-up / progress. The two-status default (`todo` / `done`)
 * preserves the original not-done/done behaviour.
 */
export interface TodoStatus {
  id: string;
  label: string;
  /** Color token expression for the status pill (e.g. `var(--jects-cmyk-cyan)`). */
  color?: string;
  /** Whether tasks in this status are considered complete. */
  isDone: boolean;
  /**
   * Work-in-progress limit. When set, the board column shows `count / limit` and
   * gets a warning style once exceeded (and can veto over-limit drops; see
   * `TodoListConfig.wipEnforce`).
   */
  wipLimit?: number;
}

/* ── Rich task sub-models ──────────────────────────────────────────────────── */

/** A colored tag/label on a task. */
export interface TodoTag {
  text: string;
  /** Color token expression (e.g. `var(--jects-cmyk-magenta)`); defaults to neutral. */
  color?: string;
}

/** Custom-field value kinds a task can carry. */
export type TodoCustomFieldType = 'text' | 'number' | 'date' | 'select' | 'checkbox';

/** Stored custom-field value (the union of all field-type value shapes). */
export type TodoCustomFieldValue = string | number | boolean | null;

/** Declares a custom field shown in the detail panel + (optionally) the row. */
export interface TodoCustomFieldDef {
  id: string;
  label: string;
  type: TodoCustomFieldType;
  /** Options for `select` fields. */
  options?: string[];
  /** Show a compact value chip on the row. Default `false`. */
  showOnRow?: boolean;
}

/** Task dependency edges (ids of other tasks). */
export interface TodoDependencies {
  /** Tasks this task blocks (must finish before they can). */
  blocks?: RecordId[];
  /** Tasks that block this task. */
  blockedBy?: RecordId[];
}

/* ── Collaboration sub-models ──────────────────────────────────────────────── */

/** A comment on a task. `mentions` carries the resolved @-names. */
export interface TodoComment {
  id: string;
  author: string;
  text: string;
  /** ms-epoch creation timestamp. */
  createdAt: number;
  /** Assignee names referenced via `@name` in the text. */
  mentions?: string[];
}

/** The kind of change captured in the activity log. */
export type TodoActivityAction = 'create' | 'update' | 'status' | 'comment' | 'attachment';

/** A single audit-trail entry, auto-appended when a tracked field changes. */
export interface TodoActivity {
  id: string;
  action: TodoActivityAction;
  /** Field that changed (for `update`/`status`). */
  field?: string;
  /** Who performed the change (the configured current user). */
  who?: string;
  /** ms-epoch timestamp. */
  when: number;
  /** Previous value (stringified). */
  from?: string;
  /** New value (stringified). */
  to?: string;
}

/** A file/link attachment on a task (no upload backend — model + UI only). */
export interface TodoAttachment {
  id: string;
  name: string;
  url?: string;
  /** Size in bytes. */
  size?: number;
  /** MIME type or extension hint. */
  type?: string;
}

/**
 * A single task record. Stored in the `TreeStore`; `children` carries subtasks.
 * Dates are ISO `YYYY-MM-DD` strings (date-only, timezone-free) or `null`.
 * Everything past the original checklist fields is optional.
 */
export interface TodoTask extends TreeNode {
  /** Unique id. Auto-assigned when omitted on add. */
  id: RecordId;
  /** Task title (single line). */
  title: string;
  /** Completion state. Canonical; kept in sync with the active status' `isDone`. */
  done?: boolean;
  /** Workflow status id (see `TodoListConfig.statuses`). Defaults from `done`. */
  status?: string;
  /** Due date as ISO `YYYY-MM-DD`, or null. */
  due?: string | null;
  /** Start date as ISO `YYYY-MM-DD`, or null. */
  startDate?: string | null;
  /** Priority. Default `none`. */
  priority?: TodoPriority;
  /** Free-form notes. */
  notes?: string;
  /** Estimated effort in hours. */
  estimate?: number | null;
  /** Logged time in hours. */
  timeSpent?: number | null;
  /** Assignee names/ids (rendered as avatars). */
  assignees?: string[];
  /** Colored tags/labels. */
  tags?: TodoTag[];
  /** Custom-field values keyed by `TodoCustomFieldDef.id`. */
  customFields?: Record<string, TodoCustomFieldValue>;
  /** Dependency edges. */
  dependencies?: TodoDependencies;
  /** Reminder date/datetime ISO (`YYYY-MM-DD` or full ISO), or null. */
  reminder?: string | null;
  /** RRULE recurrence body (e.g. `FREQ=WEEKLY;BYDAY=MO`). Completing spawns next. */
  recurrence?: string | null;
  /** Series anchor: the first due date of a recurring series (set internally). */
  recurrenceAnchor?: string | null;
  /** Marks the task as a milestone (rendered distinctly; filterable). */
  milestone?: boolean;
  /** Discussion thread. */
  comments?: TodoComment[];
  /** Auto-maintained audit trail of field changes. */
  activity?: TodoActivity[];
  /** File / link attachments. */
  attachments?: TodoAttachment[];
  /** ms-epoch when a running timer started (null/absent = not running). */
  timerStartedAt?: number | null;
  /** Creation timestamp (ms epoch); auto-set on add. */
  createdAt?: number;
  /** Nested subtasks. */
  children?: TodoTask[];
}

/** Aggregate progress over the full tree. */
export interface TodoProgress {
  total: number;
  done: number;
  ratio: number;
  percent: number;
}

/** Due-date status bucket relative to "now". */
export type TodoDueStatus = 'none' | 'overdue' | 'today' | 'soon' | 'upcoming';

/* ── Sort / group / filter ─────────────────────────────────────────────────── */

/** A field tasks can be sorted by. `manual` = the stored tree order. */
export type TodoSortField =
  | 'manual'
  | 'title'
  | 'due'
  | 'startDate'
  | 'priority'
  | 'status'
  | 'created';

/** One sort criterion. */
export interface TodoSort {
  field: TodoSortField;
  dir?: 'asc' | 'desc';
}

/** Group-by axis for the list view + board columns. */
export type TodoGroupBy = 'none' | 'status' | 'assignee' | 'priority' | 'tag' | 'due';

/** Due bucket used in filter criteria. */
export type TodoDueFilter = 'any' | 'overdue' | 'today' | 'soon' | 'none';

/**
 * Multi-criteria filter (AND across axes; OR within an axis' array). Empty /
 * omitted axes match everything. Combined with the legacy `filter` (all/active/
 * done) and the free-text `search`.
 */
export interface TodoFilterCriteria {
  status?: string[];
  priority?: TodoPriority[];
  assignees?: string[];
  tags?: string[];
  due?: TodoDueFilter;
  /** When set, keep only milestones (`true`) or only non-milestones (`false`). */
  milestone?: boolean;
}

/** A persisted named filter (for the saved-filters menu). */
export interface TodoSavedFilter {
  id: string;
  name: string;
  filters?: TodoFilterCriteria;
  filter?: TodoFilter;
  search?: string;
  sortBy?: TodoSort | TodoSort[];
  groupBy?: TodoGroupBy;
}

/* ── Data provider ─────────────────────────────────────────────────────────── */

/**
 * Pluggable persistence. `load` hydrates the list (sync or async); `sync` is
 * called (optimistically, after the model already changed) with the full task
 * snapshot + the change descriptor so a backend can persist. Both are optional.
 */
export interface TodoDataProvider {
  load?: () => TodoTask[] | Promise<TodoTask[]>;
  sync?: (tasks: TodoTask[], change: TodoChange) => void | Promise<void>;
}

/** Describes a mutation for `sync` / `onChange` consumers. */
export interface TodoChange {
  action:
    | 'add' | 'remove' | 'update' | 'toggle' | 'move' | 'status' | 'bulk' | 'load' | 'recur'
    | 'comment' | 'attachment' | 'timer' | 'import';
  ids: RecordId[];
}

/* ── Export ────────────────────────────────────────────────────────────────── */

export type TodoExportFormat = 'json' | 'csv';

export interface TodoExportOptions {
  format: TodoExportFormat;
  /** Flatten the tree (default `true` for csv, configurable for json). */
  flat?: boolean;
}

/* ── Import ────────────────────────────────────────────────────────────────── */

export type TodoImportFormat = 'json' | 'csv';

export interface TodoImportOptions {
  format: TodoImportFormat;
  /** Replace the whole tree (default) or append to the existing tasks. */
  mode?: 'replace' | 'append';
}

/* ── Table / grid view ─────────────────────────────────────────────────────── */

/** A field a Table-view column can bind to. `cf:<id>` targets a custom field. */
export type TodoTableField =
  | 'title'
  | 'status'
  | 'priority'
  | 'assignees'
  | 'due'
  | 'startDate'
  | 'estimate'
  | 'timeSpent'
  | 'tags'
  | string;

/** One Table-view column. */
export interface TodoTableColumn {
  field: TodoTableField;
  /** Header label (defaults from the field name / custom-field label). */
  label?: string;
  /** Column width in px. */
  width?: number;
  /** Hide without removing (toggled from the column menu). */
  hidden?: boolean;
}

/* ── Config ────────────────────────────────────────────────────────────────── */

export interface TodoListConfig extends WidgetConfig {
  /** Initial tasks (nested). */
  tasks?: TodoTask[];
  /** Legacy quick filter. Default `all`. */
  filter?: TodoFilter;
  /** Show the top toolbar. Default `true`. */
  toolbar?: boolean;
  /** Show the footer progress bar + counts. Default `true`. */
  progress?: boolean;
  /** Allow drag-to-reorder + indent/outdent. Default `true`. */
  reorderable?: boolean;
  /** Cascade/roll-up done state through the hierarchy. Default `true`. */
  rollUp?: boolean;
  /** Field used as the unique id on the underlying store. Default `'id'`. */
  idField?: string;
  /** Placeholder for the inline "add task" input. */
  addPlaceholder?: string;

  /** Configurable workflow statuses. Default `todo` / `done`. */
  statuses?: TodoStatus[];
  /** Custom-field declarations shown in the detail panel. */
  customFieldDefs?: TodoCustomFieldDef[];
  /** Known assignees (for the bulk-assign / filter menus + avatars). */
  assignees?: string[];

  /** Active view. Default `'list'`. */
  view?: TodoView;
  /**
   * Second grouping axis for the Board view: columns stay status while rows
   * (swimlanes) group by this axis. `'none'`/undefined = a single lane.
   */
  boardSwimlane?: TodoGroupBy;
  /** Veto drops that would push a status over its `wipLimit`. Default `false`. */
  wipEnforce?: boolean;
  /** Table-view columns (show/hide/reorder). Defaults to a standard set. */
  tableColumns?: TodoTableColumn[];
  /**
   * Uniform row height (px) for the Table view. Default is content-height
   * (undefined). Set to enforce a fixed line height per row.
   */
  tableRowHeight?: number;
  /** Timeline/Gantt zoom granularity. Default `'week'`. */
  timelineZoom?: TodoTimelineZoom;
  /** Calendar sub-view. Default `'month'`. */
  calendarMode?: TodoCalendarMode;
  /** Sort criteria (single or list). Default `manual`. */
  sortBy?: TodoSort | TodoSort[];
  /** Group-by axis. Default `'none'`. */
  groupBy?: TodoGroupBy;
  /** Multi-criteria filter. */
  filters?: TodoFilterCriteria;
  /** Free-text search over title/notes/tags. */
  search?: string;
  /** Saved filters available in the toolbar menu. */
  savedFilters?: TodoSavedFilter[];

  /** Enable the detail side-panel editor (opens for the selected task). Default `true`. */
  detailPanel?: boolean;
  /** Enable multi-select (checkbox/ctrl/shift) + the bulk action bar. Default `true`. */
  selectable?: boolean;
  /** Enable the undo/redo history stack (+ Ctrl+Z/Y). Default `true`. */
  history?: boolean;

  /** Pluggable persistence. */
  dataProvider?: TodoDataProvider;
  /** Convenience change hook (full snapshot after each mutation). */
  onChange?: (tasks: TodoTask[], change: TodoChange) => void;

  /** Injectable clock for due-status / reminders / recurrence (testability). */
  now?: () => Date;
  /** Window (in days) for the "due soon" bucket. Default `3`. */
  dueSoonDays?: number;

  /** BCP-47 locale for `Intl` date formatting. Default the runtime default. */
  locale?: string;
  /** Partial override of the user-facing string catalog (merged over English). */
  messages?: Partial<TodoMessages>;
  /** Current user — recorded as the author of comments + activity entries. */
  currentUser?: string;
}

/** Payload base carrying the emitting list. */
interface TodoEventBase {
  list: TodoListApi;
}

export interface TodoListEvents extends WidgetEvents {
  beforeAdd: TodoEventBase & { task: TodoTask; parentId: RecordId | null };
  add: TodoEventBase & { task: TodoTask; parentId: RecordId | null };
  beforeRemove: TodoEventBase & { task: TodoTask };
  remove: TodoEventBase & { task: TodoTask };
  update: TodoEventBase & { task: TodoTask; changes: Partial<TodoTask> };
  toggle: TodoEventBase & { task: TodoTask; done: boolean; affected: TodoTask[] };
  move: TodoEventBase & { task: TodoTask; parentId: RecordId | null; index: number };
  filter: TodoEventBase & { filter: TodoFilter };
  progress: TodoEventBase & TodoProgress;

  /** A task's workflow status changed. */
  status: TodoEventBase & { task: TodoTask; status: string; affected: TodoTask[] };
  /** The active view changed. */
  view: TodoEventBase & { view: TodoView };
  /** The sort criteria changed. */
  sort: TodoEventBase & { sortBy: TodoSort[] };
  /** The group-by axis changed. */
  group: TodoEventBase & { groupBy: TodoGroupBy };
  /** The multi-criteria filter changed. */
  filters: TodoEventBase & { filters: TodoFilterCriteria };
  /** The search query changed. */
  search: TodoEventBase & { query: string };
  /** The selection changed. */
  select: TodoEventBase & { ids: RecordId[] };
  /** A bulk action ran. */
  bulk: TodoEventBase & { action: string; ids: RecordId[] };
  /** A Table-view column was resized (drag or keyboard). */
  columnresize: TodoEventBase & { field: string; width: number };
  /** Undo/redo availability changed. */
  history: TodoEventBase & { canUndo: boolean; canRedo: boolean };
  /** A recurring task spawned its next occurrence. */
  recur: TodoEventBase & { task: TodoTask; next: TodoTask };
  /** A due/overdue/soon reminder fired. */
  reminder: TodoEventBase & { task: TodoTask; kind: TodoDueStatus };
  /** Tasks were (re)loaded (initial data or via the data provider). */
  load: TodoEventBase & { tasks: TodoTask[] };
  /** A comment was added to a task. */
  comment: TodoEventBase & { task: TodoTask; comment: TodoComment };
  /** An attachment was added or removed. */
  attachment: TodoEventBase & { task: TodoTask; attachment: TodoAttachment; removed: boolean };
  /** A task's running timer started or stopped (`running` reflects the new state). */
  timer: TodoEventBase & { task: TodoTask; running: boolean };
  /** The model changed in any way (full snapshot). */
  change: TodoEventBase & { tasks: TodoTask[]; change: TodoChange };
}

/** The imperative public surface (implemented by the `TodoList` Widget class). */
export interface TodoListApi {
  readonly el: HTMLElement;

  addTask(task: Partial<TodoTask>, parentId?: RecordId | null): TodoTask | undefined;
  removeTask(id: RecordId): TodoTask | undefined;
  updateTask(id: RecordId, changes: Partial<TodoTask>): TodoTask | undefined;
  toggleTask(id: RecordId, done?: boolean): TodoTask[];

  reorder(id: RecordId, index: number): boolean;
  indent(id: RecordId): boolean;
  outdent(id: RecordId): boolean;
  moveTask(id: RecordId, parentId: RecordId | null, index: number): boolean;

  expand(id: RecordId): void;
  collapse(id: RecordId): void;
  toggleExpand(id: RecordId): void;

  setFilter(filter: TodoFilter): this;
  getFilter(): TodoFilter;

  getProgress(): TodoProgress;
  getTasks(): TodoTask[];
  getTask(id: RecordId): TodoTask | undefined;

  /* ── statuses / workflow ── */
  getStatuses(): TodoStatus[];
  setStatus(id: RecordId, status: string): TodoTask | undefined;

  /* ── view / sort / group / filter / search ── */
  setView(view: TodoView): this;
  getView(): TodoView;
  setBoardSwimlane(axis: TodoGroupBy): this;
  getBoardSwimlane(): TodoGroupBy;
  setTableColumns(columns: TodoTableColumn[]): this;
  getTableColumns(): TodoTableColumn[];
  /** Set the persisted width (px) of one Table-view column by field. */
  setColumnWidth(field: TodoTableField, width: number): this;
  /** Set a uniform Table-view row height (px); pass null to clear. */
  setTableRowHeight(height: number | null): this;
  getTableRowHeight(): number | null;
  setTimelineZoom(zoom: TodoTimelineZoom): this;
  setCalendarDate(date: Date): this;
  setSort(sortBy: TodoSort | TodoSort[]): this;
  getSort(): TodoSort[];
  setGroupBy(groupBy: TodoGroupBy): this;
  getGroupBy(): TodoGroupBy;
  setFilters(filters: TodoFilterCriteria): this;
  getFilters(): TodoFilterCriteria;
  setSearch(query: string): this;
  getSearch(): string;
  saveFilter(name: string): TodoSavedFilter;
  applySavedFilter(id: string): boolean;
  getSavedFilters(): TodoSavedFilter[];

  /* ── selection / bulk ── */
  getSelected(): RecordId[];
  select(id: RecordId, opts?: { additive?: boolean; range?: boolean }): void;
  selectAll(): void;
  clearSelection(): void;
  bulkComplete(done?: boolean): RecordId[];
  bulkRemove(): RecordId[];
  bulkUpdate(changes: Partial<TodoTask>): RecordId[];
  bulkSetStatus(status: string): RecordId[];
  bulkSetPriority(priority: TodoPriority): RecordId[];
  bulkAssign(assignees: string[]): RecordId[];

  /* ── undo / redo ── */
  undo(): boolean;
  redo(): boolean;
  canUndo(): boolean;
  canRedo(): boolean;

  /* ── detail panel ── */
  openDetail(id: RecordId): void;
  closeDetail(): void;

  /* ── collaboration ── */
  addComment(id: RecordId, text: string, author?: string): TodoComment | undefined;
  addAttachment(id: RecordId, attachment: Partial<TodoAttachment>): TodoAttachment | undefined;
  removeAttachment(id: RecordId, attachmentId: string): boolean;

  /* ── time tracking ── */
  startTimer(id: RecordId): boolean;
  stopTimer(id: RecordId): number;
  isTimerRunning(id: RecordId): boolean;

  /* ── dependencies ── */
  addDependency(id: RecordId, blockedById: RecordId): boolean;
  removeDependency(id: RecordId, blockedById: RecordId): boolean;

  /* ── persistence / export / import ── */
  load(tasks: TodoTask[]): this;
  reload(): Promise<void>;
  export(opts: TodoExportOptions): string;
  import(text: string, opts: TodoImportOptions): TodoTask[];
}

/** Constructor shape (Widget subclass). */
export interface TodoListCtor {
  new (host: HTMLElement | string, config?: TodoListConfig): TodoListApi;
}
