# @jects/todo — an enterprise task manager with List / Board / Calendar / Timeline / Table views.

## What it is

`@jects/todo` is a framework-free, light-DOM task manager built on the `@jects/core` `TreeStore` and the `@jects/widgets` control set. It models a nested parent/child task hierarchy with a configurable status workflow and rich tasks (assignees, tags, custom fields, dependencies, time tracking, recurrence, comments, attachments), and renders that data across five interchangeable views. The whole module is driven through a single imperative API (`new TodoList(host, config)`), emits a rich event set, and is themed entirely with `--jects-*` CSS variables.

## Install

```bash
pnpm add @jects/todo @jects/core @jects/icons @jects/theme @jects/widgets
```

All four peers are required: `@jects/core` (the `Widget` base, `TreeStore`, event bus), `@jects/icons` (toolbar / row / detail icons), `@jects/theme` (the `--jects-*` token CSS), and `@jects/widgets` (the inline editors and pickers).

## CSS

```ts
import '@jects/theme/style.css';   // --jects-* design tokens
import '@jects/widgets/style.css'; // controls reused by the detail editor
import '@jects/todo/style.css';    // task-manager styles
```

Wrap the host in a scope element so tokens resolve, e.g. `<body class="jects-scope">…</body>`.

## Minimal example

```ts
import '@jects/theme/style.css';
import '@jects/widgets/style.css';
import '@jects/todo/style.css';
import { TodoList } from '@jects/todo';

const todo = new TodoList('#host', {
  tasks: [
    { id: 'a', title: 'Draft the proposal', priority: 'high', due: '2026-07-01' },
    { id: 'b', title: 'Review with team',   priority: 'medium' },
  ],
});

todo.on('change', ({ tasks }) => persist(tasks));

// later…
todo.destroy();
```

`TodoList` is a `@jects/core` `Widget` subclass, so alongside the `TodoListApi` methods it inherits `.on()/.off()/.emit()`, `.update()`, `.getConfig()`, `.show()/.hide()`, `.destroy()`, `.el`, and `.id`.

## Subpath exports

- `@jects/todo/style.css` — compiled component stylesheet (the only export besides the package root `.`).

The package root (`.`) re-exports the runtime classes and helpers: `TodoList` and `PRIORITIES`; the `TodoModel` model plus `nextTaskId` / `nextSubId`; a large pure-function utility set from `todo-utils` (e.g. `computeProgress`, `passesFilter`, `tasksToCsv` / `tasksToJson` / `tasksFromJson` / `tasksFromCsv`, `wouldCreateCycle`, `monthGridDays`, `timelineBounds`); the i18n helpers (`DEFAULT_MESSAGES`, `mergeMessages`, `formatMessage`, …); and the recurrence helpers (`parseRecurrence`, `formatRecurrence`, `describeRecurrence`, `nextOccurrence`). All of these are reachable from the single `.` entry — there are no deep import paths.

## Common recipes

### Kanban board with WIP limits and assignee swimlanes

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
  wipEnforce: true,          // veto drops that exceed a column's WIP limit
  boardSwimlane: 'assignee', // split each column into per-assignee lanes
  assignees: ['KM', 'Alex', 'Sam'],
  tasks: [
    { id: 'qa', title: 'QA the signup flow', status: 'review', assignees: ['Alex'],
      dependencies: { blockedBy: ['bugfix'] } },
    { id: 'bugfix', title: 'Fix popup z-order', status: 'review', priority: 'high', assignees: ['Alex'] },
  ],
});
```

### Switching views, sorting, and grouping at runtime

```ts
board.setView('timeline').setTimelineZoom('week');
board.setView('calendar').setCalendarDate(new Date(2026, 6, 1));

board.setView('list')
  .setGroupBy('status')
  .setSort([{ field: 'priority', dir: 'desc' }, { field: 'due', dir: 'asc' }]);

board.setFilters({ assignees: ['KM'], priority: ['high'] });
board.saveFilter('My high-priority');
```

### Pluggable persistence, import, and export

```ts
const todo = new TodoList('#host', {
  dataProvider: {
    load: async () => fetch('/api/tasks').then((r) => r.json()),
    sync: async (tasks, change) => {
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

### Bulk actions and undo/redo

```ts
todo.selectAll();
todo.bulkSetStatus('done');
if (todo.canUndo()) todo.undo();
```

## Events

Subscribe with `todo.on(event, handler)`; each payload also carries `{ list }`. Key events:

- `add` / `remove` / `update` — task lifecycle (`beforeAdd` / `beforeRemove` fire first and are vetoable).
- `toggle` / `status` — completion or workflow-status change (with rolled-up `affected` tasks).
- `move` — a task was reordered, indented/outdented, or re-parented.
- `view` / `sort` / `group` / `filters` / `filter` / `search` — view-state changes.
- `select` / `bulk` — selection and bulk-action changes.
- `history` — undo/redo availability (`{ canUndo, canRedo }`).
- `recur` / `reminder` — a recurring task spawned its next occurrence / a due reminder fired.
- `comment` / `attachment` / `timer` — collaboration and time-tracking changes.
- `progress` — aggregate roll-up progress (`{ total, done, ratio, percent }`).
- `load` — tasks were (re)loaded.
- `change` — the model changed in any way; payload is `{ tasks, change }` where `change` is a `TodoChange` of `{ action, ids }`.

## Theming

Styled entirely through the `--jects-*` token system (OKLCH values consumed as `oklch(var(--jects-*))`): status and tag colors reference categorical tokens such as `--jects-data-1…n` and `--jects-cmyk-cyan/-magenta/-yellow/-black`, while surfaces use semantic tokens (`--jects-background`, `--jects-foreground`, `--jects-border`, `--jects-ring`, the `--jects-radius*` radii). Include `@jects/theme` for the base tokens; toggle dark / high-contrast via `jects-dark` / `jects-hc` classes (or `[data-jects-theme="dark"]`) on a scope element. See [docs/modules/theme.md](../../docs/modules/theme.md).

## Accessibility

Interactive throughout: rows, the toolbar, board columns, and the detail panel are keyboard-operable (including `Ctrl+Z` / `Ctrl+Y` for undo/redo), and the package is tested against `axe-core` in the browser test suite. A locale-aware, fully overridable message catalog (`TodoMessages`, via the `messages` config) backs every user-facing string.

## Stability & support

**Beta.** The module ships a broad API surface with unit and browser (incl. `axe-core` accessibility) test coverage, but the package is pre-1.0 (`0.0.0`) and some surfaces may still shift before v1.

Part of the Jects UI suite. Live demo: <https://jexlibrary.vercel.app> · Source: <https://github.com/storyofcarl/jex-library>. Commercial terms: see LICENSE.md.
