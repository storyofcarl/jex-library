# @jects/todo
> An enterprise task manager (Asana / ClickUp / Monday / Jira-class) with five views, configurable workflow, collaboration, dependencies, time tracking, undo/redo and import/export — framework-free.

## Overview
`@jects/todo` is a full enterprise task manager built on the `@jects/core` `TreeStore` and reusing `@jects/widgets` controls. It models a parent-child task hierarchy with a configurable status workflow, rich tasks (assignees, tags, custom fields, dependencies, effort, recurrence, comments, attachments), and renders that data across five interchangeable views (list, board, calendar, timeline, table). Like the rest of Jects UI it is framework-free and light-DOM, exposes a single imperative API surface (`new TodoList(host, config)` plus the `TodoListApi` methods + a rich event set), and is themed entirely through `--jects-*` CSS variables.

## Installation

```bash
pnpm add @jects/todo @jects/core @jects/theme @jects/icons @jects/widgets
```

All five peers are required:

| Peer | Why |
| --- | --- |
| `@jects/core` | `Widget` base, `TreeStore`, event bus, factory. |
| `@jects/theme` | The `--jects-*` token CSS. |
| `@jects/icons` | Toolbar / row / detail-panel icons. |
| `@jects/widgets` | The inline editors and pickers (selects, date pickers, etc.). |

The package is ESM, `type: module`, side-effect-free except CSS (`sideEffects: ["**/*.css"]`), so it tree-shakes.

## Integration

### CSS (required)
Import the base theme tokens, the widgets styles it builds on, and the todo styles:

```ts
import '@jects/theme/style.css';   // --jects-* tokens
import '@jects/widgets/style.css'; // controls reused by the detail editor
import '@jects/todo/style.css';    // task-manager styles
```

Add the `jects-scope` class to a wrapping element so tokens resolve:

```html
<body class="jects-scope"> ... </body>
```

### Vanilla TypeScript

```ts
import { TodoList } from '@jects/todo';

const todo = new TodoList('#host', {
  tasks: [{ id: 't1', title: 'Write the docs', priority: 'high' }],
});
todo.on('change', ({ tasks }) => persist(tasks));
```

`TodoList` is a `@jects/core` `Widget` subclass, so it also inherits `.on()/.off()/.emit()`, `.update()`, `.getConfig()`, `.show()/.hide()`, `.destroy()`, `.el` and `.id` alongside the `TodoListApi` methods below.

### Frameworks (React / Angular / Vue)
Use a thin wrapper: construct in a mount effect, drive it imperatively, and call `.destroy()` on cleanup.

```tsx
import { useEffect, useRef } from 'react';
import { TodoList, type TodoListConfig } from '@jects/todo';

export function Tasks(props: { config: TodoListConfig; onChange?: (tasks: unknown[]) => void }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const list = new TodoList(host.current!, props.config);
    const off = list.on('change', ({ tasks }) => props.onChange?.(tasks));
    return () => { off(); list.destroy(); };
  }, []);
  return <div ref={host} style={{ height: 600 }} />;
}
```

The same mount/destroy pattern applies to Angular (`ngAfterViewInit` / `ngOnDestroy`) and Vue (`onMounted` / `onUnmounted`).

### Theming
Visuals come from `--jects-*` tokens. Status pill colors, tag colors and view accents reference tokens such as `--jects-data-1…n` and `--jects-cmyk-*` directly in your config. See [Theming](#theming).

### i18n
Pass a `locale` (BCP-47) for `Intl` date formatting and a partial `messages` object to override any of the ~120 user-facing strings (merged over English). The string keys live in `TodoMessages` (e.g. `addTask`, `viewBoard`, `overdue`, `selectedCount` which interpolates `{n}`, `changeStatus` which interpolates `{status}`).

## Features

- **Five views:** List (grouped, multi-sort), Board (Kanban with per-column WIP limits + drag), Calendar (month/week by due date), Timeline (start→due Gantt bars with dependency arrows), and a configurable Table/grid. Switch via the toolbar or `setView()`.
- **Configurable workflow:** custom `statuses` (id / label / color / `isDone` / `wipLimit`) replacing the binary done flag; optional WIP enforcement that vetoes over-limit board drops.
- **Board swimlanes:** a second grouping axis (`boardSwimlane`) splits columns into per-assignee / per-priority / per-tag lanes.
- **Rich task model:** assignees (avatars), colored tags, custom fields (text/number/date/select/checkbox), priority, start + due dates, estimate vs. time spent, reminders, milestones.
- **Inline editing + a detail side-panel** with pickers for every field.
- **Collaboration:** comments with `@mention` resolution, an auto-maintained activity log, and file/link attachments.
- **Time tracking:** start/stop timer per task; estimate vs. logged hours.
- **Dependencies:** blocks / blocked-by edges with cycle detection and a blocked warning.
- **Subtasks** (unlimited nesting), **milestones**, and **recurrence** (RRULE — completing spawns the next occurrence).
- **Sort / group / filter / search:** multi-criteria filter (AND across axes, OR within), free-text search, multi-column sort, group-by, saved filters + a filter builder.
- **Multi-select + bulk actions:** complete, delete, set status/priority, assign.
- **Undo/redo** history stack (Ctrl+Z / Ctrl+Y).
- **Pluggable data provider** (`load` / `sync`) plus a convenience `onChange` hook.
- **JSON / CSV import + export.**
- **Roll-up progress** through the hierarchy + a footer progress bar.
- **Full i18n** (locale-aware dates + an overridable message catalog).

## Quick start

```ts
import '@jects/theme/style.css';
import '@jects/widgets/style.css';
import '@jects/todo/style.css';
import { TodoList } from '@jects/todo';

const todo = new TodoList('#host', {
  statuses: [
    { id: 'todo',  label: 'To do',       color: 'var(--jects-data-1)', isDone: false },
    { id: 'doing', label: 'In progress', color: 'var(--jects-data-2)', isDone: false, wipLimit: 3 },
    { id: 'done',  label: 'Done',        color: 'var(--jects-data-4)', isDone: true },
  ],
  view: 'list',
  groupBy: 'status',
  tasks: [
    { id: 'a', title: 'Draft the proposal', status: 'doing', priority: 'high', due: '2026-07-01' },
    { id: 'b', title: 'Review with team',   status: 'todo',  priority: 'medium' },
    { id: 'c', title: 'Ship v1.0',          status: 'todo',  milestone: true, due: '2026-07-10' },
  ],
});

todo.on('change', ({ tasks }) => console.log('snapshot', tasks));
```

## Configuration

Main `TodoListConfig` options (all optional; defaults preserve the v1 checklist behaviour):

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `tasks` | `TodoTask[]` | — | Initial (nested) tasks. |
| `statuses` | `TodoStatus[]` | `todo` / `done` | Configurable workflow statuses (`id`, `label`, `color?`, `isDone`, `wipLimit?`). |
| `view` | `'list' \| 'board' \| 'calendar' \| 'timeline' \| 'table'` | `'list'` | Active view. |
| `boardSwimlane` | `TodoGroupBy` | `'none'` | Second board axis (rows) — `status`/`assignee`/`priority`/`tag`/`due`. |
| `wipEnforce` | `boolean` | `false` | Veto board drops that exceed a status `wipLimit`. |
| `tableColumns` | `TodoTableColumn[]` | standard set | Table columns (`field`, `label?`, `width?`, `hidden?`; `cf:<id>` targets a custom field). |
| `timelineZoom` | `'day' \| 'week' \| 'month'` | `'week'` | Timeline/Gantt granularity. |
| `calendarMode` | `'month' \| 'week'` | `'month'` | Calendar sub-view. |
| `sortBy` | `TodoSort \| TodoSort[]` | `manual` | Sort criteria (`{ field, dir? }`). |
| `groupBy` | `TodoGroupBy` | `'none'` | Group-by axis. |
| `filters` | `TodoFilterCriteria` | — | Multi-criteria filter (status/priority/assignees/tags/due/milestone). |
| `search` | `string` | — | Free-text search over title/notes/tags. |
| `savedFilters` | `TodoSavedFilter[]` | — | Named filters for the toolbar menu. |
| `filter` | `'all' \| 'active' \| 'done'` | `'all'` | Legacy quick filter. |
| `customFieldDefs` | `TodoCustomFieldDef[]` | — | Custom-field declarations shown in the detail panel. |
| `assignees` | `string[]` | — | Known assignees (for assign/filter menus + avatars). |
| `detailPanel` | `boolean` | `true` | Enable the detail side-panel editor. |
| `selectable` | `boolean` | `true` | Multi-select + bulk action bar. |
| `history` | `boolean` | `true` | Undo/redo stack (+ Ctrl+Z/Y). |
| `reorderable` | `boolean` | `true` | Drag-to-reorder + indent/outdent. |
| `rollUp` | `boolean` | `true` | Cascade/roll-up done state through the hierarchy. |
| `toolbar` | `boolean` | `true` | Show the top toolbar. |
| `progress` | `boolean` | `true` | Show the footer progress bar + counts. |
| `dataProvider` | `TodoDataProvider` | — | Pluggable `load` / `sync` persistence. |
| `onChange` | `(tasks, change) => void` | — | Convenience snapshot hook after each mutation. |
| `dueSoonDays` | `number` | `3` | Window (days) for the "due soon" bucket. |
| `now` | `() => Date` | — | Injectable clock for due-status / reminders / recurrence. |
| `locale` | `string` | runtime | BCP-47 locale for `Intl` date formatting. |
| `messages` | `Partial<TodoMessages>` | — | Override the user-facing string catalog (merged over English). |
| `currentUser` | `string` | — | Author recorded on comments + activity entries. |
| `idField` | `string` | `'id'` | Unique-id field on the underlying store. |
| `addPlaceholder` | `string` | — | Placeholder for the inline add-task input. |

### `TodoTask` (key fields)
`id`, `title`, `status` (or legacy `done`), `priority` (`none`/`low`/`medium`/`high`), `startDate` / `due` (ISO `YYYY-MM-DD` or `null`), `estimate` / `timeSpent` (hours), `assignees`, `tags` (`{ text, color? }`), `customFields`, `dependencies` (`{ blocks?, blockedBy? }`), `reminder`, `recurrence` (RRULE), `milestone`, `comments`, `activity`, `attachments`, `timerStartedAt`, `createdAt`, and `children` (subtasks).

## Methods

The imperative surface is `TodoListApi`, grouped:

**Tasks**
- `addTask(task, parentId?)`, `removeTask(id)`, `updateTask(id, changes)`, `toggleTask(id, done?)`
- `reorder(id, index)`, `indent(id)`, `outdent(id)`, `moveTask(id, parentId, index)`
- `expand(id)`, `collapse(id)`, `toggleExpand(id)`
- `getTasks()`, `getTask(id)`, `getProgress()`

**Workflow / statuses**
- `getStatuses()`, `setStatus(id, status)`

**Views / sort / group / filter / search**
- `setView(view)` / `getView()`, `setBoardSwimlane(axis)` / `getBoardSwimlane()`
- `setTableColumns(cols)` / `getTableColumns()`, `setTimelineZoom(zoom)`, `setCalendarDate(date)`
- `setSort(sortBy)` / `getSort()`, `setGroupBy(groupBy)` / `getGroupBy()`
- `setFilters(filters)` / `getFilters()`, `setSearch(query)` / `getSearch()`, `setFilter(filter)` / `getFilter()`
- `saveFilter(name)`, `applySavedFilter(id)`, `getSavedFilters()`

**Selection / bulk**
- `getSelected()`, `select(id, { additive?, range? })`, `selectAll()`, `clearSelection()`
- `bulkComplete(done?)`, `bulkRemove()`, `bulkUpdate(changes)`, `bulkSetStatus(status)`, `bulkSetPriority(priority)`, `bulkAssign(assignees)`

**Undo / redo**
- `undo()`, `redo()`, `canUndo()`, `canRedo()`

**Detail panel**
- `openDetail(id)`, `closeDetail()`

**Collaboration**
- `addComment(id, text, author?)`, `addAttachment(id, attachment)`, `removeAttachment(id, attachmentId)`

**Time tracking**
- `startTimer(id)`, `stopTimer(id)`, `isTimerRunning(id)`

**Dependencies**
- `addDependency(id, blockedById)`, `removeDependency(id, blockedById)` (cycle-checked)

**Persistence / export / import**
- `load(tasks)`, `reload()` (re-fetch via the data provider)
- `export({ format: 'json' | 'csv', flat? })`, `import(text, { format, mode? })`

## Events

| Event | Payload (beyond `{ list }`) | When |
| --- | --- | --- |
| `beforeAdd` / `add` | `{ task, parentId }` | A task is about to be / was added. |
| `beforeRemove` / `remove` | `{ task }` | A task is about to be / was removed. |
| `update` | `{ task, changes }` | A task was updated. |
| `toggle` | `{ task, done, affected }` | Completion toggled (with rolled-up tasks). |
| `move` | `{ task, parentId, index }` | A task was moved/reordered. |
| `status` | `{ task, status, affected }` | A task's workflow status changed. |
| `view` | `{ view }` | Active view changed. |
| `sort` / `group` / `filters` | `{ sortBy }` / `{ groupBy }` / `{ filters }` | Those axes changed. |
| `filter` | `{ filter }` | Legacy quick filter changed. |
| `search` | `{ query }` | Search query changed. |
| `select` | `{ ids }` | Selection changed. |
| `bulk` | `{ action, ids }` | A bulk action ran. |
| `history` | `{ canUndo, canRedo }` | Undo/redo availability changed. |
| `recur` | `{ task, next }` | A recurring task spawned its next occurrence. |
| `reminder` | `{ task, kind }` | A due/overdue/soon reminder fired. |
| `comment` | `{ task, comment }` | A comment was added. |
| `attachment` | `{ task, attachment, removed }` | An attachment was added/removed. |
| `timer` | `{ task, running }` | A task's timer started/stopped. |
| `progress` | `{ total, done, ratio, percent }` | Aggregate progress changed. |
| `load` | `{ tasks }` | Tasks were (re)loaded. |
| `change` | `{ tasks, change }` | The model changed in any way (full snapshot). |

`change.change` (and `dataProvider.sync` / `onChange`) carries a `TodoChange` of `{ action, ids }`, where `action` is one of `add`/`remove`/`update`/`toggle`/`move`/`status`/`bulk`/`load`/`recur`/`comment`/`attachment`/`timer`/`import`.

## Examples

### 1. A Kanban board with WIP limits and assignee swimlanes

```ts
import { TodoList } from '@jects/todo';

const board = new TodoList('#host', {
  view: 'board',
  statuses: [
    { id: 'todo',   label: 'To do',       color: 'var(--jects-data-1)', isDone: false },
    { id: 'doing',  label: 'In progress', color: 'var(--jects-data-2)', isDone: false, wipLimit: 2 },
    { id: 'review', label: 'In review',   color: 'var(--jects-data-3)', isDone: false, wipLimit: 3 },
    { id: 'done',   label: 'Done',        color: 'var(--jects-data-4)', isDone: true },
  ],
  wipEnforce: true,            // block drops that would exceed a column's WIP limit
  boardSwimlane: 'assignee',   // split each column into per-assignee lanes
  assignees: ['KM', 'Alex', 'Sam', 'Jo'],
  tasks: [
    { id: 'launch', title: 'Launch checklist', status: 'doing', priority: 'high', assignees: ['KM'],
      tags: [{ text: 'release', color: 'var(--jects-cmyk-magenta)' }] },
    { id: 'qa', title: 'QA the signup flow', status: 'review', assignees: ['Alex'],
      dependencies: { blockedBy: ['bugfix'] } },
    { id: 'bugfix', title: 'Fix popup z-order', status: 'review', priority: 'high', assignees: ['Alex'] },
  ],
});
```

### 2. Switching views, sorting and grouping at runtime

```ts
// Move to the timeline/Gantt and zoom to weeks.
board.setView('timeline').setTimelineZoom('week');

// Or the calendar, focused on a month.
board.setView('calendar').setCalendarDate(new Date(2026, 6, 1));

// Group the list by status and multi-sort (priority desc, then due asc).
board.setView('list')
  .setGroupBy('status')
  .setSort([{ field: 'priority', dir: 'desc' }, { field: 'due', dir: 'asc' }]);

// Filter to one assignee's high-priority tasks, then save it.
board.setFilters({ assignees: ['KM'], priority: ['high'] });
board.saveFilter('My high-priority');
```

### 3. Wiring a data provider and exporting

```ts
const todo = new TodoList('#host', {
  dataProvider: {
    load: async () => fetch('/api/tasks').then((r) => r.json()),
    sync: async (tasks, change) => {
      // optimistic: the model already changed; persist the snapshot.
      await fetch('/api/tasks', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tasks, change }),
      });
    },
  },
});

await todo.reload();                          // hydrate from load()
const json = todo.export({ format: 'json' }); // serialize the tree
const csv  = todo.export({ format: 'csv' });  // flat CSV
todo.import(csv, { format: 'csv', mode: 'append' });
```

## Theming

`@jects/todo` is styled through the same `--jects-*` token system as the rest of Jects UI (OKLCH, consumed as `oklch(var(--jects-*))`).

- **Status & tag colors** in your config reference tokens directly — e.g. `color: 'var(--jects-data-2)'` for a status pill or `{ text: 'release', color: 'var(--jects-cmyk-magenta)' }` for a tag. The categorical palettes are `--jects-data-1…n` (the data ramp, ideal for status columns) and `--jects-cmyk-cyan` / `-magenta` / `-yellow` / `-black` (Calm CMYK).
- **Surface / structure** uses the semantic tokens `--jects-background`, `--jects-foreground`, `--jects-muted`, `--jects-muted-foreground`, `--jects-border`, `--jects-ring`, and the radii `--jects-radius` / `-sm` / `-md` / `-lg`.
- **Dark / high-contrast** themes apply by toggling a class or attribute on a scope element: `<body class="jects-scope jects-dark">` or `[data-jects-theme="dark"]`; high contrast via `.jects-hc`.

Override any token under `:root` or your scope element to re-skin. The theme CSS lives inside an `@layer` cascade so plain consumer overrides win without specificity fights.
