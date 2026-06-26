/**
 * @jects/todo — Jects UI enterprise task manager built on @jects/core.
 *
 * Far past a checklist: a parent-child task hierarchy (subtasks via @jects/core
 * `TreeStore`) with configurable workflow statuses, a rich task model
 * (assignees, tags, custom fields, dependencies, effort, recurrence), List +
 * Board views, sort / group-by / multi-criteria filter / search, a detail
 * side-panel editor, due-date status + reminders, multi-select + bulk actions,
 * undo/redo, a pluggable data provider, and JSON/CSV export. Reuses
 * @jects/widgets `Checkbox` / `TextField` / `DatePicker`.
 *
 * Importing this module registers the widget with the factory under the type
 * `todolist` (`create({ type: 'todolist', ... })`).
 *
 * Side-effect CSS: `import '@jects/todo/style.css'`.
 */

import './styles.css';

/* ── Public contract (types only) ─────────────────────────────────────────── */
export type {
  TodoTask,
  TodoPriority,
  TodoFilter,
  TodoProgress,
  TodoListConfig,
  TodoListEvents,
  TodoListApi,
  TodoListCtor,
  // enterprise additions
  TodoStatus,
  TodoTag,
  TodoCustomFieldType,
  TodoCustomFieldValue,
  TodoCustomFieldDef,
  TodoDependencies,
  TodoView,
  TodoDueStatus,
  TodoSortField,
  TodoSort,
  TodoGroupBy,
  TodoDueFilter,
  TodoFilterCriteria,
  TodoSavedFilter,
  TodoDataProvider,
  TodoChange,
  TodoExportFormat,
  TodoExportOptions,
  // parity additions
  TodoComment,
  TodoActivity,
  TodoActivityAction,
  TodoAttachment,
  TodoTimelineZoom,
  TodoCalendarMode,
  TodoImportFormat,
  TodoImportOptions,
  TodoTableField,
  TodoTableColumn,
} from './contract.js';

/* ── Widget (value): importing runs `register('todolist', TodoList)`. ────── */
export { TodoList, PRIORITIES } from './todo-list.js';

/* ── Headless model + pure helpers (useful for advanced consumers/tests). ── */
export { TodoModel, nextTaskId, nextSubId } from './todo-model.js';
export {
  computeProgress,
  effectiveDone,
  passesFilter,
  priorityLabel,
  priorityRank,
  formatDue,
  isOverdue,
  isoToDate,
  dateToIso,
  childrenOf,
  isLeaf,
  // workflow statuses
  DEFAULT_STATUSES,
  statusById,
  statusForDone,
  effectiveStatus,
  // due-date status
  dueStatus,
  dueStatusLabel,
  // sort / group / filter / search
  matchesSearch,
  matchesCriteria,
  taskComparator,
  sortTree,
  groupKeysOf,
  groupOrder,
  // export / import
  flattenTasks,
  tasksToCsv,
  tasksToJson,
  tasksFromJson,
  tasksFromCsv,
  // parity helpers
  subtreeProgress,
  wouldCreateCycle,
  indexTasks,
  hasOpenBlockers,
  monthGridDays,
  weekDays,
  startOfWeek,
  timelineBounds,
  dayDiff,
  addDays,
  tasksOnDay,
} from './todo-utils.js';
export type { TodoGroupKey } from './todo-utils.js';

/* ── i18n (message catalog + locale date formatting). ─────────────────────── */
export {
  DEFAULT_MESSAGES,
  mergeMessages,
  formatMessage,
  formatDateLocale,
  formatMonthTitle,
  weekdayNames,
} from './todo-i18n.js';
export type { TodoMessages } from './todo-i18n.js';

/* ── Recurrence (RRULE subset, date-only). ─────────────────────────────────── */
export {
  parseRecurrence,
  formatRecurrence,
  describeRecurrence,
  nextOccurrence,
} from './todo-recurrence.js';
export type { TodoRecurFreq, TodoRecurRule } from './todo-recurrence.js';
