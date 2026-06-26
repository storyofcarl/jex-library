# @jects/kanban — a framework-free task board (kanban) with swimlanes, WIP limits, rich cards and drag-and-drop.

## What it is

`@jects/kanban` provides a single imperative `TaskBoard` widget: a kanban board with columns, optional swimlanes, per-column WIP limits, rich cards (cover, tags, assignee, attachments, comments, votes, links), drag-and-drop, multi-select, undo/redo, sort, filter, remote data sync and export. It renders into a host element in the light DOM, is driven entirely by a JavaScript/TypeScript API, and is themed with CSS custom properties — no virtual DOM and no framework runtime.

Part of the Jects UI suite. Live demo: <https://jexlibrary.vercel.app> · Repo: <https://github.com/storyofcarl/jex-library>

## Install

```sh
pnpm add @jects/kanban @jects/core @jects/widgets @jects/theme
```

`@jects/core`, `@jects/widgets` and `@jects/theme` are peer dependencies. The package ships ESM (plus a UMD build) and is tree-shakeable.

## CSS

The package ships `dist/style.css` (exported as `./style.css`). Import it once, alongside the `@jects/theme` base tokens:

```ts
import '@jects/theme/style.css';   // base design tokens (--jects-*)
import '@jects/kanban/style.css';  // board + card styles
```

## Minimal example

```ts
import '@jects/theme/style.css';
import '@jects/kanban/style.css';
import { TaskBoard } from '@jects/kanban';

const board = new TaskBoard('#board', {
  columns: [
    { id: 'todo',  title: 'To Do' },
    { id: 'doing', title: 'In Progress', limit: 3 },
    { id: 'done',  title: 'Done' },
  ],
  cards: [
    { id: 1, column: 'todo',  order: 0, title: 'Write docs' },
    { id: 2, column: 'doing', order: 0, title: 'Build board' },
  ],
});

board.on('cardMove', ({ cards, to }) => {
  console.log(`${cards.length} card(s) → column ${to.column}`);
});

// later, on teardown:
board.destroy();
```

The first argument can be an `HTMLElement` or a CSS selector string.

## Subpath exports

- `@jects/kanban/style.css` — the board + card stylesheet (`dist/style.css`); import once per app.

The main entry (`@jects/kanban`) exports `TaskBoard`, `openCardEditor`, `renderCardBody`, `escapeHtml`, `cardAccessibleLabel`, `AjaxDataProvider`, and the types listed below. No further code subpaths exist.

## Common recipes

### Swimlanes and WIP limits

```ts
const board = new TaskBoard('#board', {
  columns: [
    { id: 'todo',   title: 'To Do',        color: 2 },
    { id: 'doing',  title: 'In Progress',  color: 3, limit: 3 },              // soft WIP badge
    { id: 'review', title: 'Review',       color: 4, limit: 2, strictLimit: true }, // hard veto
    { id: 'done',   title: 'Done',         color: 5 },
  ],
  lanes: [
    { id: 'fe', title: 'Frontend' },
    { id: 'be', title: 'Backend' },
  ],
  cards: [
    { id: 1, column: 'todo', lane: 'fe', order: 0, title: 'Design tokens audit' },
    { id: 2, column: 'doing', lane: 'be', order: 0, title: 'WIP enforcement', progress: 60 },
  ],
});

board.on('limitReject', ({ column, limit }) =>
  console.warn(`Column ${column} is at its WIP limit of ${limit}`));
```

### Vetoing a move

`before*` events are vetoable — return `false` from the handler to cancel the action.

```ts
board.on('beforeCardMove', ({ to }) => to.column !== 'done' || isWorkHours());
```

### Sort, filter and export

```ts
board.setSortField('due');   // order cards within columns by due date
board.setSortField('due');   // call again to flip ascending/descending
board.toggleFilter('mine');  // toggle a declared filter chip
const csv = board.export({ format: 'csv' });  // also 'json' (default) or 'png'
```

### Remote sync over REST + WebSocket

```ts
import { TaskBoard, AjaxDataProvider } from '@jects/kanban';

// Shorthand — the board builds an AjaxDataProvider internally:
const board = new TaskBoard('#board', {
  columns,
  syncUrl: 'https://api.example.com/cards', // GET loads, POST persists each op
  wsUrl: 'wss://api.example.com/cards',      // live remote changes
});

// …or pass a provider explicitly (e.g. to inject headers):
const authed = new TaskBoard('#board2', {
  columns,
  dataProvider: new AjaxDataProvider({
    url: 'https://api.example.com/cards',
    headers: { Authorization: `Bearer ${token}` },
  }),
});
```

## Events

Subscribe with `board.on(name, handler)` (also `once` / `off`, inherited from the base widget). `before*` events are vetoable — return `false` to cancel. Every payload includes `board`.

| Event | Payload | Fires when |
| --- | --- | --- |
| `selectionChange` | `{ board, ids }` | The selection set changed. |
| `beforeCardMove` | `{ board, cards, from, to }` | Before a move commits (return `false` to reject). |
| `cardMove` | `{ board, cards, from, to }` | A card / multi-selection was moved or reordered. |
| `beforeCardEdit` | `{ board, card }` | Before the editor opens (return `false` to cancel). |
| `cardEdit` | `{ board, card, changes }` | A card was edited and committed. |
| `cardActivate` | `{ board, card }` | A card was activated (double-click / Enter). |
| `columnToggle` | `{ board, column, collapsed }` | A column was collapsed/expanded. |
| `columnReorder` | `{ board, order }` | Columns were reordered (new id order). |
| `limitReject` | `{ board, column, limit }` | A move was rejected by a strict WIP limit. |
| `remoteChange` | `{ board, op }` | A remote op from the data provider was applied. |
| `historyChange` | `{ board, canUndo, canRedo }` | The undo/redo history changed. |

The event surface is typed via `TaskBoardEvents`.

## Theming

The board is themed entirely through Jects design tokens — set any `--jects-*` CSS custom property on the host (or an ancestor) to retheme. Include `@jects/theme` for the base token set; column/tag `color: 1..8` maps to the categorical ramp `--jects-data-1 … --jects-data-8`. See [docs/modules/theme.md](../../docs/modules/theme.md).

## Accessibility

Interactive and keyboard-driven: cards expose ARIA labels, keyboard navigation and keyboard moves are announced through a polite live region. The board region carries an accessible `label` (default `'Task board'`).

## Stability & support

**Beta.** The public API is stable and the package carries a browser test suite (including axe-core accessibility checks), but it is pre-1.0 and surfaces may still shift.

Part of the Jects UI suite. Commercial terms: see LICENSE.md.
