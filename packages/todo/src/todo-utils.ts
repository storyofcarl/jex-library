/**
 * Pure helpers for @jects/todo — priority ordering, due-date formatting, and
 * tree progress math. Kept free of DOM so they are trivially unit-testable.
 */

import type {
  TodoTask,
  TodoPriority,
  TodoProgress,
  TodoFilter,
  TodoStatus,
  TodoDueStatus,
  TodoSort,
  TodoSortField,
  TodoGroupBy,
  TodoFilterCriteria,
  TodoDueFilter,
  TodoTag,
} from './contract.js';

export const PRIORITIES: readonly TodoPriority[] = ['none', 'low', 'medium', 'high'];

/* ── Statuses / workflow ───────────────────────────────────────────────────── */

/**
 * The default two-status workflow. Preserves the original binary behaviour: a
 * task is either `todo` (not done) or `done`. Richer sets are supplied via
 * `TodoListConfig.statuses` (e.g. todo / in-progress / blocked / done).
 */
export const DEFAULT_STATUSES: readonly TodoStatus[] = [
  { id: 'todo', label: 'To Do', color: 'var(--jects-muted-foreground)', isDone: false },
  { id: 'done', label: 'Done', color: 'var(--jects-success)', isDone: true },
];

/** Find a status by id within a status set. */
export function statusById(statuses: readonly TodoStatus[], id: string | undefined): TodoStatus | undefined {
  return id == null ? undefined : statuses.find((s) => s.id === id);
}

/** First status whose `isDone` matches — used to map the `done` flag to a status. */
export function statusForDone(statuses: readonly TodoStatus[], done: boolean): TodoStatus {
  return statuses.find((s) => s.isDone === done) ?? statuses[done ? statuses.length - 1 : 0]!;
}

/**
 * Resolve a task's effective status object. Falls back to mapping its `done`
 * flag onto the status set when no explicit `status` is stored (or it is stale).
 */
export function effectiveStatus(task: TodoTask, statuses: readonly TodoStatus[]): TodoStatus {
  return statusById(statuses, task.status) ?? statusForDone(statuses, task.done === true);
}

const PRIORITY_RANK: Record<TodoPriority, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
};

export function priorityRank(p: TodoPriority | undefined): number {
  return PRIORITY_RANK[p ?? 'none'] ?? 0;
}

export function priorityLabel(p: TodoPriority | undefined): string {
  switch (p ?? 'none') {
    case 'high':
      return 'High';
    case 'medium':
      return 'Medium';
    case 'low':
      return 'Low';
    default:
      return 'None';
  }
}

/** Direct children of a task (never undefined). */
export function childrenOf(task: TodoTask): TodoTask[] {
  return (task.children as TodoTask[] | undefined) ?? [];
}

export function isLeaf(task: TodoTask): boolean {
  return childrenOf(task).length === 0;
}

/**
 * Format an ISO `YYYY-MM-DD` due date for display. Returns '' for empty input.
 * Timezone-free: parses the calendar parts directly (no `new Date(iso)` UTC
 * shift) so the rendered day always matches the stored day.
 */
export function formatDue(iso: string | null | undefined): string {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const monthName = MONTHS[month - 1] ?? '';
  return monthName ? `${monthName} ${day}, ${year}` : iso;
}

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/** Convert an ISO `YYYY-MM-DD` string to a local `Date` (or null). */
export function isoToDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** Convert a `Date` to an ISO `YYYY-MM-DD` string (or null). */
export function dateToIso(date: Date | null | undefined): string | null {
  if (!date || Number.isNaN(date.getTime())) return null;
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${mo}-${d}`;
}

/** True when an ISO due date is strictly before today (date-only). */
export function isOverdue(iso: string | null | undefined, now: Date = new Date()): boolean {
  const date = isoToDate(iso);
  if (!date) return false;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return date.getTime() < today.getTime();
}

/**
 * Whether a task counts as "done" for roll-up/progress purposes. A parent is
 * effectively done when every descendant leaf is done; leaves use their own
 * `done` flag. This is derived (not stored) so it always reflects the subtree.
 */
export function effectiveDone(task: TodoTask): boolean {
  const kids = childrenOf(task);
  if (kids.length === 0) return task.done === true;
  return kids.every((c) => effectiveDone(c));
}

/**
 * Progress over the whole tree: counts every LEAF task (so a parent never
 * double-counts its children). When there are no leaves at all, total is 0.
 */
export function computeProgress(tasks: TodoTask[]): TodoProgress {
  let total = 0;
  let done = 0;
  const walk = (list: TodoTask[]): void => {
    for (const t of list) {
      const kids = childrenOf(t);
      if (kids.length === 0) {
        total += 1;
        if (t.done === true) done += 1;
      } else {
        walk(kids);
      }
    }
  };
  walk(tasks);
  const ratio = total === 0 ? 0 : done / total;
  return { total, done, ratio, percent: Math.round(ratio * 100) };
}

/** A task passes the active filter (by its effective done state). */
export function passesFilter(task: TodoTask, filter: TodoFilter): boolean {
  if (filter === 'all') return true;
  const done = effectiveDone(task);
  return filter === 'done' ? done : !done;
}

/* ── Due-date status + reminders ───────────────────────────────────────────── */

/**
 * Bucket a due date relative to `now`: overdue (before today), today, soon
 * (within `soonDays`), upcoming (later), or none (no date). Date-only.
 */
export function dueStatus(
  iso: string | null | undefined,
  now: Date = new Date(),
  soonDays = 3,
): TodoDueStatus {
  const date = isoToDate(iso);
  if (!date) return 'none';
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = 86_400_000;
  const diff = Math.round((date.getTime() - today.getTime()) / day);
  if (diff < 0) return 'overdue';
  if (diff === 0) return 'today';
  if (diff <= soonDays) return 'soon';
  return 'upcoming';
}

/** Human label for a due-status (used in accessible row labels). */
export function dueStatusLabel(s: TodoDueStatus): string {
  switch (s) {
    case 'overdue': return 'Overdue';
    case 'today': return 'Due today';
    case 'soon': return 'Due soon';
    case 'upcoming': return 'Upcoming';
    default: return '';
  }
}

/* ── Search ────────────────────────────────────────────────────────────────── */

/** True when a task's title / notes / tags contain the (lower-cased) query. */
export function matchesSearch(task: TodoTask, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if ((task.title ?? '').toLowerCase().includes(q)) return true;
  if ((task.notes ?? '').toLowerCase().includes(q)) return true;
  if (task.tags?.some((t) => (t.text ?? '').toLowerCase().includes(q))) return true;
  if (task.assignees?.some((a) => a.toLowerCase().includes(q))) return true;
  return false;
}

/* ── Multi-criteria filtering ──────────────────────────────────────────────── */

/** Whether a task itself satisfies every active criterion (AND across axes). */
export function matchesCriteria(
  task: TodoTask,
  criteria: TodoFilterCriteria | undefined,
  statuses: readonly TodoStatus[],
  now: Date = new Date(),
  soonDays = 3,
): boolean {
  if (!criteria) return true;
  if (criteria.status?.length) {
    if (!criteria.status.includes(effectiveStatus(task, statuses).id)) return false;
  }
  if (criteria.priority?.length) {
    if (!criteria.priority.includes((task.priority ?? 'none') as TodoPriority)) return false;
  }
  if (criteria.assignees?.length) {
    const a = task.assignees ?? [];
    if (!criteria.assignees.some((x) => a.includes(x))) return false;
  }
  if (criteria.tags?.length) {
    const t = (task.tags ?? []).map((x) => x.text);
    if (!criteria.tags.some((x) => t.includes(x))) return false;
  }
  if (criteria.due && criteria.due !== 'any') {
    if (!matchesDueFilter(task.due, criteria.due, now, soonDays)) return false;
  }
  if (criteria.milestone !== undefined) {
    if ((task.milestone === true) !== criteria.milestone) return false;
  }
  return true;
}

function matchesDueFilter(
  iso: string | null | undefined,
  due: TodoDueFilter,
  now: Date,
  soonDays: number,
): boolean {
  const s = dueStatus(iso, now, soonDays);
  switch (due) {
    case 'none': return s === 'none';
    case 'overdue': return s === 'overdue';
    case 'today': return s === 'today';
    case 'soon': return s === 'soon' || s === 'today';
    default: return true;
  }
}

/* ── Sorting ───────────────────────────────────────────────────────────────── */

function compareField(
  a: TodoTask,
  b: TodoTask,
  field: TodoSortField,
  statuses: readonly TodoStatus[],
): number {
  switch (field) {
    case 'title':
      return (a.title ?? '').localeCompare(b.title ?? '');
    case 'priority':
      return priorityRank(a.priority) - priorityRank(b.priority);
    case 'status': {
      const ia = statuses.findIndex((s) => s.id === effectiveStatus(a, statuses).id);
      const ib = statuses.findIndex((s) => s.id === effectiveStatus(b, statuses).id);
      return ia - ib;
    }
    case 'created':
      return (a.createdAt ?? 0) - (b.createdAt ?? 0);
    case 'due':
    case 'startDate': {
      const av = (field === 'due' ? a.due : a.startDate) ?? '';
      const bv = (field === 'due' ? b.due : b.startDate) ?? '';
      // Empty dates sort last (treated as +∞).
      if (!av && !bv) return 0;
      if (!av) return 1;
      if (!bv) return -1;
      return av < bv ? -1 : av > bv ? 1 : 0;
    }
    default:
      return 0;
  }
}

/** Build a stable comparator from a sort list (manual sorts preserve order). */
export function taskComparator(
  sortBy: readonly TodoSort[],
  statuses: readonly TodoStatus[],
): (a: TodoTask, b: TodoTask) => number {
  const active = sortBy.filter((s) => s.field !== 'manual');
  return (a, b) => {
    for (const s of active) {
      const cmp = compareField(a, b, s.field, statuses);
      if (cmp !== 0) return s.dir === 'desc' ? -cmp : cmp;
    }
    return 0;
  };
}

/** Recursively sort a tree (siblings at every level) into a new array. */
export function sortTree(
  tasks: readonly TodoTask[],
  sortBy: readonly TodoSort[],
  statuses: readonly TodoStatus[],
): TodoTask[] {
  if (!sortBy.some((s) => s.field !== 'manual')) return tasks.slice();
  const cmp = taskComparator(sortBy, statuses);
  const sorted = tasks.slice().sort(cmp);
  return sorted.map((t) => {
    const kids = childrenOf(t);
    if (kids.length) return { ...t, children: sortTree(kids, sortBy, statuses) };
    return t;
  });
}

/* ── Grouping ──────────────────────────────────────────────────────────────── */

export interface TodoGroupKey {
  key: string;
  label: string;
  color?: string;
}

/**
 * The group key(s) a task belongs to for the given axis. Tag/assignee axes can
 * return MULTIPLE keys (a task with two tags appears under each); the others
 * return exactly one. An empty value maps to a stable "(none)" group.
 */
export function groupKeysOf(
  task: TodoTask,
  groupBy: TodoGroupBy,
  statuses: readonly TodoStatus[],
  now: Date = new Date(),
  soonDays = 3,
): TodoGroupKey[] {
  switch (groupBy) {
    case 'status': {
      const s = effectiveStatus(task, statuses);
      return [{ key: s.id, label: s.label, ...(s.color ? { color: s.color } : {}) }];
    }
    case 'priority': {
      const p = (task.priority ?? 'none') as TodoPriority;
      return [{ key: p, label: priorityLabel(p) }];
    }
    case 'assignee': {
      const a = task.assignees ?? [];
      if (!a.length) return [{ key: '__none', label: 'Unassigned' }];
      return a.map((x) => ({ key: x, label: x }));
    }
    case 'tag': {
      const t = task.tags ?? [];
      if (!t.length) return [{ key: '__none', label: 'No tag' }];
      return t.map((x: TodoTag) => ({ key: x.text, label: x.text, ...(x.color ? { color: x.color } : {}) }));
    }
    case 'due': {
      const s = dueStatus(task.due, now, soonDays);
      const label =
        s === 'none' ? 'No due date'
          : s === 'overdue' ? 'Overdue'
            : s === 'today' ? 'Today'
              : s === 'soon' ? 'Soon'
                : 'Upcoming';
      return [{ key: s, label }];
    }
    default:
      return [{ key: '__all', label: 'All' }];
  }
}

/** Stable display order of the known group keys for an axis. */
export function groupOrder(
  groupBy: TodoGroupBy,
  statuses: readonly TodoStatus[],
): string[] {
  switch (groupBy) {
    case 'status': return statuses.map((s) => s.id);
    case 'priority': return ['high', 'medium', 'low', 'none'];
    case 'due': return ['overdue', 'today', 'soon', 'upcoming', 'none'];
    default: return [];
  }
}

/* ── Flatten + export ──────────────────────────────────────────────────────── */

/** Depth-first flatten with a `depth` annotation (clones; strips `children`). */
export function flattenTasks(tasks: readonly TodoTask[]): Array<TodoTask & { depth: number }> {
  const out: Array<TodoTask & { depth: number }> = [];
  const walk = (list: readonly TodoTask[], depth: number): void => {
    for (const t of list) {
      const { children: _c, ...rest } = t;
      out.push({ ...(rest as TodoTask), depth });
      const kids = childrenOf(t);
      if (kids.length) walk(kids, depth + 1);
    }
  };
  walk(tasks, 0);
  return out;
}

const CSV_COLUMNS: Array<{ header: string; get: (t: TodoTask & { depth: number }, statuses: readonly TodoStatus[]) => string }> = [
  { header: 'id', get: (t) => String(t.id) },
  { header: 'title', get: (t) => t.title ?? '' },
  { header: 'status', get: (t, s) => effectiveStatus(t, s).label },
  { header: 'done', get: (t) => String(t.done === true) },
  { header: 'priority', get: (t) => (t.priority ?? 'none') },
  { header: 'due', get: (t) => t.due ?? '' },
  { header: 'startDate', get: (t) => t.startDate ?? '' },
  { header: 'assignees', get: (t) => (t.assignees ?? []).join('; ') },
  { header: 'tags', get: (t) => (t.tags ?? []).map((x) => x.text).join('; ') },
  { header: 'estimate', get: (t) => (t.estimate == null ? '' : String(t.estimate)) },
  { header: 'timeSpent', get: (t) => (t.timeSpent == null ? '' : String(t.timeSpent)) },
  { header: 'depth', get: (t) => String(t.depth) },
  { header: 'notes', get: (t) => t.notes ?? '' },
];

function csvCell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** Serialize tasks to a CSV string (flattened with a depth column). */
export function tasksToCsv(tasks: readonly TodoTask[], statuses: readonly TodoStatus[]): string {
  const rows = flattenTasks(tasks);
  const header = CSV_COLUMNS.map((c) => c.header).join(',');
  const body = rows.map((r) => CSV_COLUMNS.map((c) => csvCell(c.get(r, statuses))).join(',')).join('\n');
  return body ? `${header}\n${body}` : header;
}

/** Serialize tasks to a JSON string (nested by default, or flat). */
export function tasksToJson(tasks: readonly TodoTask[], flat = false): string {
  return JSON.stringify(flat ? flattenTasks(tasks) : tasks, null, 2);
}

/* ── Subtree progress (parent badges) ───────────────────────────────────────── */

/**
 * Progress over a single task's descendant LEAVES (for the parent `done/total`
 * badge + mini bar). A leaf reports `{total:1, done: t.done}`; a parent rolls up
 * its leaves. Never double-counts.
 */
export function subtreeProgress(task: TodoTask): TodoProgress {
  return computeProgress(childrenOf(task));
}

/* ── Dependency graph + cycle detection ─────────────────────────────────────── */

/**
 * Detect whether adding the edge "`taskId` is blocked by `blockerId`" would
 * create a cycle in the dependency graph (following `blockedBy` edges). A cycle
 * exists when `blockerId` is already (transitively) blocked by `taskId`, or when
 * the two ids are equal. Pure: scans the supplied task tree.
 */
export function wouldCreateCycle(
  tasks: readonly TodoTask[],
  taskId: RecordIdLike,
  blockerId: RecordIdLike,
): boolean {
  if (taskId === blockerId) return true;
  const byId = indexTasks(tasks);
  // Walk blockedBy edges starting from the proposed blocker; if we reach taskId,
  // adding taskId -> blockedBy(blockerId) closes a loop.
  const seen = new Set<RecordIdLike>();
  const stack: RecordIdLike[] = [blockerId];
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === taskId) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    const node = byId.get(cur);
    for (const b of node?.dependencies?.blockedBy ?? []) stack.push(b);
  }
  return false;
}

type RecordIdLike = string | number;

/** Flatten a task tree into an id→task map (first occurrence wins). */
export function indexTasks(tasks: readonly TodoTask[]): Map<RecordIdLike, TodoTask> {
  const map = new Map<RecordIdLike, TodoTask>();
  const walk = (list: readonly TodoTask[]): void => {
    for (const t of list) {
      const id = t.id as RecordIdLike;
      if (!map.has(id)) map.set(id, t);
      walk(childrenOf(t));
    }
  };
  walk(tasks);
  return map;
}

/** True when a task is started (not-done) while it still has open blockers. */
export function hasOpenBlockers(task: TodoTask, byId: Map<RecordIdLike, TodoTask>): boolean {
  const ids = task.dependencies?.blockedBy ?? [];
  for (const id of ids) {
    const blocker = byId.get(id as RecordIdLike);
    if (blocker && !effectiveDone(blocker)) return true;
  }
  return false;
}

/* ── Calendar grid math ─────────────────────────────────────────────────────── */

/** Add `days` to a `Date`, returning a new local `Date`. */
export function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

/** Start-of-week for `date` given a week-start weekday (0=Sun). */
export function startOfWeek(date: Date, weekStart = 0): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diff = (d.getDay() - weekStart + 7) % 7;
  return addDays(d, -diff);
}

/** The 7 days of the week containing `anchor`. */
export function weekDays(anchor: Date, weekStart = 0): Date[] {
  const s = startOfWeek(anchor, weekStart);
  return Array.from({ length: 7 }, (_v, i) => addDays(s, i));
}

/**
 * The 6×7 day grid covering the month of `anchor` (leading/trailing days from the
 * adjacent months pad to whole weeks).
 */
export function monthGridDays(anchor: Date, weekStart = 0): Date[] {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const gridStart = startOfWeek(first, weekStart);
  return Array.from({ length: 42 }, (_v, i) => addDays(gridStart, i));
}

/** Tasks whose `due` falls on the given local day. */
export function tasksOnDay(tasks: readonly TodoTask[], day: Date): TodoTask[] {
  const iso = dateToIso(day);
  return tasks.filter((t) => t.due === iso);
}

/* ── Timeline bounds ────────────────────────────────────────────────────────── */

/** The inclusive [min,max] date bounds spanning every task's start/due. */
export function timelineBounds(tasks: readonly TodoTask[], fallback: Date): { min: Date; max: Date } {
  let min: Date | null = null;
  let max: Date | null = null;
  const consider = (iso: string | null | undefined): void => {
    const d = isoToDate(iso);
    if (!d) return;
    if (!min || d < min) min = d;
    if (!max || d > max) max = d;
  };
  for (const t of tasks) {
    consider(t.startDate);
    consider(t.due);
  }
  if (!min || !max) {
    const m = new Date(fallback.getFullYear(), fallback.getMonth(), fallback.getDate());
    return { min: addDays(m, -3), max: addDays(m, 25) };
  }
  return { min, max };
}

/** Whole-day count between two dates (inclusive of the start, exclusive end). */
export function dayDiff(a: Date, b: Date): number {
  const da = new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime();
  const db = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime();
  return Math.round((db - da) / 86_400_000);
}

/* ── Import (CSV / JSON round-trip with export) ──────────────────────────────── */

/** Parse a JSON task export back into a task tree. Throws on invalid JSON. */
export function tasksFromJson(text: string): TodoTask[] {
  const data = JSON.parse(text) as unknown;
  if (!Array.isArray(data)) throw new Error('Expected a JSON array of tasks');
  // Flat exports carry a `depth`; rebuild the tree from it. Nested exports pass
  // straight through.
  const arr = data as Array<TodoTask & { depth?: number }>;
  if (arr.some((t) => typeof t.depth === 'number')) return rebuildFromFlat(arr);
  return arr.map((t) => ({ ...t }));
}

/** Rebuild a nested tree from a depth-annotated flat list. */
function rebuildFromFlat(rows: Array<TodoTask & { depth?: number }>): TodoTask[] {
  const roots: TodoTask[] = [];
  const stack: Array<{ depth: number; task: TodoTask }> = [];
  for (const row of rows) {
    const depth = row.depth ?? 0;
    const { depth: _d, children: _c, ...rest } = row;
    const task: TodoTask = { ...(rest as TodoTask) };
    while (stack.length && stack[stack.length - 1]!.depth >= depth) stack.pop();
    const top = stack[stack.length - 1];
    if (top) (top.task.children ??= []).push(task);
    else roots.push(task);
    stack.push({ depth, task });
  }
  return roots;
}

/** Split a CSV line honoring quoted cells (RFC-4180 subset). */
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = false;
      } else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

/**
 * Parse a CSV export (the columns {@link tasksToCsv} writes) back into a task
 * tree, using the `depth` column to restore the hierarchy.
 */
export function tasksFromCsv(text: string, statuses: readonly TodoStatus[]): TodoTask[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n').filter((l) => l.length > 0);
  if (!lines.length) return [];
  const header = parseCsvLine(lines[0]!);
  const col = (name: string): number => header.indexOf(name);
  const rows: Array<TodoTask & { depth?: number }> = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]!);
    const get = (name: string): string => {
      const idx = col(name);
      return idx >= 0 ? (cells[idx] ?? '') : '';
    };
    const statusLabel = get('status');
    const status = statuses.find((s) => s.label === statusLabel);
    const assignees = get('assignees').split(';').map((s) => s.trim()).filter(Boolean);
    const tags: TodoTag[] = get('tags').split(';').map((s) => s.trim()).filter(Boolean).map((t) => ({ text: t }));
    const est = get('estimate');
    const spent = get('timeSpent');
    const task: TodoTask & { depth?: number } = {
      id: get('id') || `imp-${i}`,
      title: get('title'),
      done: get('done') === 'true',
      priority: (get('priority') || 'none') as TodoPriority,
      due: get('due') || null,
      startDate: get('startDate') || null,
      notes: get('notes'),
      depth: Number(get('depth')) || 0,
    };
    if (status) task.status = status.id;
    if (assignees.length) task.assignees = assignees;
    if (tags.length) task.tags = tags;
    if (est) task.estimate = Number(est);
    if (spent) task.timeSpent = Number(spent);
    rows.push(task);
  }
  return rebuildFromFlat(rows);
}
