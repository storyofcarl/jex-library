/**
 * @jects/todo — i18n message catalog + locale-aware date formatting.
 *
 * Every user-facing string the widget renders is keyed here so a consumer can
 * supply a `messages` override (merged over English) and a `locale` for `Intl`
 * date formatting. Mirrors the `locale`-driven `Intl` approach used by
 * `@jects/calendar`, extended with a full string catalog.
 */

/** The full set of user-facing strings (English is the default). */
export interface TodoMessages {
  // toolbar
  addTask: string;
  addPlaceholder: string;
  search: string;
  filterAll: string;
  filterActive: string;
  filterDone: string;
  noGrouping: string;
  groupPrefix: string;
  manualOrder: string;
  sortPrefix: string;
  toggleSortDir: string;
  addSort: string;
  savedFilters: string;
  saveFilter: string;
  filterBuilder: string;
  undo: string;
  redo: string;
  // views
  viewList: string;
  viewBoard: string;
  viewCalendar: string;
  viewTimeline: string;
  viewTable: string;
  // calendar / timeline nav
  today: string;
  prev: string;
  next: string;
  zoomDay: string;
  zoomWeek: string;
  zoomMonth: string;
  swimlanePrefix: string;
  noSwimlane: string;
  columns: string;
  // groups / buckets
  unassigned: string;
  noTag: string;
  noDueDate: string;
  overdue: string;
  dueToday: string;
  dueSoon: string;
  upcoming: string;
  untitled: string;
  // detail panel
  details: string;
  close: string;
  status: string;
  priority: string;
  startDate: string;
  dueDate: string;
  reminder: string;
  estimateH: string;
  timeSpentH: string;
  assignees: string;
  tags: string;
  recurrence: string;
  blockedBy: string;
  blocks: string;
  notes: string;
  milestone: string;
  comments: string;
  addComment: string;
  activity: string;
  attachments: string;
  addAttachment: string;
  startTimer: string;
  stopTimer: string;
  timerRunning: string;
  progress: string;
  // bulk
  selectedCount: string; // uses {n}
  complete: string;
  reopen: string;
  setStatus: string;
  setPriority: string;
  setAssignees: string;
  delete: string;
  clear: string;
  // row controls
  selectTask: string;
  markComplete: string;
  changeStatus: string; // uses {status}
  addSubtask: string;
  selectAll: string;
  resizeColumn: string;
  rowHeight: string;
  // list-view column headers
  colTask: string;
  colDone: string;
  colStatus: string;
  colPeople: string;
  colDue: string;
  colPriority: string;
  // misc
  cycleError: string;
  blockedWarning: string;
  done: string;
  total: string;
  emptyState: string;
}

/** The English default catalog. */
export const DEFAULT_MESSAGES: TodoMessages = {
  addTask: 'Add task',
  addPlaceholder: 'Add a task…',
  search: 'Search…',
  filterAll: 'All',
  filterActive: 'Active',
  filterDone: 'Done',
  noGrouping: 'No grouping',
  groupPrefix: 'Group',
  manualOrder: 'Manual order',
  sortPrefix: 'Sort',
  toggleSortDir: 'Toggle sort direction',
  addSort: 'Add sort',
  savedFilters: 'Saved filters…',
  saveFilter: 'Save current filter',
  filterBuilder: 'Filter',
  undo: 'Undo',
  redo: 'Redo',
  viewList: 'List',
  viewBoard: 'Board',
  viewCalendar: 'Calendar',
  viewTimeline: 'Timeline',
  viewTable: 'Table',
  today: 'Today',
  prev: 'Previous',
  next: 'Next',
  zoomDay: 'Day',
  zoomWeek: 'Week',
  zoomMonth: 'Month',
  swimlanePrefix: 'Lanes',
  noSwimlane: 'No lanes',
  columns: 'Columns',
  unassigned: 'Unassigned',
  noTag: 'No tag',
  noDueDate: 'No due date',
  overdue: 'Overdue',
  dueToday: 'Today',
  dueSoon: 'Soon',
  upcoming: 'Upcoming',
  untitled: '(untitled)',
  details: 'Task details',
  close: 'Close details',
  status: 'Status',
  priority: 'Priority',
  startDate: 'Start date',
  dueDate: 'Due date',
  reminder: 'Reminder',
  estimateH: 'Estimate (h)',
  timeSpentH: 'Time spent (h)',
  assignees: 'Assignees',
  tags: 'Tags',
  recurrence: 'Recurrence (RRULE)',
  blockedBy: 'Blocked by',
  blocks: 'Blocks',
  notes: 'Notes',
  milestone: 'Milestone',
  comments: 'Comments',
  addComment: 'Add a comment… use @name to mention',
  activity: 'Activity',
  attachments: 'Attachments',
  addAttachment: 'Add attachment (name or URL)',
  startTimer: 'Start timer',
  stopTimer: 'Stop timer',
  timerRunning: 'Timer running',
  progress: 'Progress',
  selectedCount: '{n} selected',
  complete: 'Complete',
  reopen: 'Reopen',
  setStatus: 'Set status…',
  setPriority: 'Set priority…',
  setAssignees: 'Assign…',
  delete: 'Delete',
  clear: 'Clear',
  selectTask: 'Select task',
  markComplete: 'Mark complete',
  changeStatus: 'Change status (now: {status})',
  addSubtask: 'Add subtask',
  selectAll: 'Select all tasks',
  resizeColumn: 'Resize column',
  rowHeight: 'Row height',
  colTask: 'Task',
  colDone: 'Done',
  colStatus: 'Status',
  colPeople: 'Assignees',
  colDue: 'Due',
  colPriority: 'Priority',
  cycleError: 'That dependency would create a cycle.',
  blockedWarning: 'This task still has open blockers.',
  done: 'done',
  total: 'total',
  emptyState: 'No tasks yet. Add one above.',
};

/** Merge a partial override over the English defaults. */
export function mergeMessages(override?: Partial<TodoMessages>): TodoMessages {
  return override ? { ...DEFAULT_MESSAGES, ...override } : DEFAULT_MESSAGES;
}

/** Interpolate `{key}` placeholders in a message. */
export function formatMessage(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_m, k: string) => (k in vars ? String(vars[k]) : `{${k}}`));
}

/**
 * Format an ISO `YYYY-MM-DD` (date-only, timezone-free) for display using the
 * given locale. Falls back to the raw string when unparseable.
 */
export function formatDateLocale(
  iso: string | null | undefined,
  locale: string | undefined,
  opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' },
): string {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  // Construct a local date (no UTC shift) so the rendered day matches storage.
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  try {
    return new Intl.DateTimeFormat(locale, opts).format(d);
  } catch {
    return iso;
  }
}

/** Locale-aware month + year title (e.g. "June 2026"). */
export function formatMonthTitle(date: Date, locale: string | undefined): string {
  try {
    return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(date);
  } catch {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  }
}

/** Localized short weekday names (Sun..Sat), respecting the locale's script. */
export function weekdayNames(locale: string | undefined, weekStart = 0): string[] {
  const fmt = (() => {
    try {
      return new Intl.DateTimeFormat(locale, { weekday: 'short' });
    } catch {
      return null;
    }
  })();
  const base = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const out: string[] = [];
  for (let i = 0; i < 7; i++) {
    const day = (i + weekStart) % 7;
    if (fmt) {
      // 2023-01-01 is a Sunday — index by weekday.
      out.push(fmt.format(new Date(2023, 0, 1 + day)));
    } else {
      out.push(base[day]!);
    }
  }
  return out;
}
