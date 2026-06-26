# @jects/kanban
> A draggable, framework-free kanban board (`TaskBoard`) — columns, swimlanes, WIP limits and rich cards, built on `@jects/core`.

## Overview
`@jects/kanban` provides a single `TaskBoard` widget: a Trello/Bryntum-TaskBoard-class kanban board with columns, optional swimlanes, WIP limits, rich cards (cover, tags, assignee, attachments, comments, votes, links), drag-and-drop, multi-select, undo/redo, sort, filter, remote data sync and export. It matches the feature surface of category leaders like Bryntum TaskBoard and Trello.

Like the rest of Jects UI it is framework-free: it renders into a host element in the light DOM, is driven entirely by an imperative API (`new TaskBoard(host, config)` plus methods/events), and is themed through CSS custom properties (`--jects-*`) — no virtual DOM, no framework runtime.

## Installation
```sh
pnpm add @jects/kanban @jects/core @jects/widgets @jects/theme
```
`@jects/core`, `@jects/widgets` and `@jects/theme` are peer dependencies. The package ships ESM, is tree-shakeable, and has no framework dependency.

## Integration
Import the side-effect stylesheet once, alongside the `@jects/theme` base tokens:

```ts
import '@jects/theme/style.css';   // base design tokens (--jects-*)
import '@jects/kanban/style.css';  // board + card styles
import { TaskBoard } from '@jects/kanban';
```

**Vanilla TS** — construct against a host element (or a CSS selector string):

```ts
const board = new TaskBoard('#board', { columns, cards });
```

**Framework wrappers (React / Angular / Vue)** — the pattern is identical everywhere: create the instance in a mount effect, keep the instance in a ref, and call `.destroy()` on unmount. React example:

```tsx
import { useEffect, useRef } from 'react';
import { TaskBoard, type TaskBoardConfig } from '@jects/kanban';
import '@jects/theme/style.css';
import '@jects/kanban/style.css';

export function Board(props: { config: TaskBoardConfig }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const board = new TaskBoard(host.current!, props.config);
    return () => board.destroy();
  }, []);
  return <div ref={host} style={{ height: 600 }} />;
}
```

**Theming** is done entirely via `--jects-*` custom properties on the host (or any ancestor); see [Theming](#theming).

## Features
- **Columns** — declarative `columns` (id/title/color/width), drag-to-reorder headers (`columnReorder`), collapse/expand, and lockable columns (reject drops/drags/reorder).
- **Swimlanes** — optional horizontal `lanes` banding across every column; collapsible.
- **WIP limits** — per-column `limit` shows a `count/limit` badge and a warning state; `strictLimit` hard-vetoes any drop/move that would exceed it (emits `limitReject`).
- **Rich cards** — cover banner, title, description, tag chips, avatar (image or initials), progress bar, assignee, due date, file attachments, comment thread, vote tally, related-card links, and arbitrary custom body items. A full `cardRenderer` override is supported.
- **Drag-and-drop** — pointer + touch (long-press) drag, multi-select group drag (ctrl/meta/shift), edge auto-scroll, and keyboard moves with a screen-reader live region.
- **Editing** — modal card editor on double-click / `editCard()`, inline quick-edit of titles, and `applyCardEdit()`.
- **Undo / redo** — opt-in history stack with `Ctrl+Z` / `Ctrl+Y` and `undo()`/`redo()`/`canUndo()`/`canRedo()`.
- **Sort** — toolbar sort control + `setSortField()` over `order` / `priority` / `title` / `votes` / `due` (re-select toggles direction).
- **Filter / search** — built-in search box, declarative `filters` (rendered as toolbar chips, AND-combined) and an ad-hoc `filterFn`.
- **Remote data** — pluggable `TaskBoardDataProvider`, or the bundled `AjaxDataProvider` (REST `GET`/`POST` + optional WebSocket subscription) via `dataProvider`, or the `syncUrl` / `wsUrl` shorthand. Optimistic local mutations are pushed to the provider; remote ops are applied back (emits `remoteChange`).
- **Export** — `export({ format })` to `json`, `csv`, or `png`.
- **Accessibility** — keyboard navigation/moves, ARIA labels per card, and a polite live region.

## Quick start
Adapted from the live gallery demo:

```ts
import '@jects/theme/style.css';
import '@jects/kanban/style.css';
import { TaskBoard } from '@jects/kanban';

const board = new TaskBoard('#board', {
  toolbar: true,
  searchPlaceholder: 'Search cards…',
  undoRedo: true,
  sortable: true,
  sortField: 'order',
  filters: [
    { id: 'mine',  label: 'Assignee: KM', test: (c) => c.assignee === 'KM' },
    { id: 'voted', label: 'Voted',        test: (c) => !!(c.votes && c.votes.voted) },
  ],
  columns: [
    { id: 'backlog', title: 'Backlog', color: 1 },
    { id: 'todo',    title: 'To Do',   color: 2 },
    { id: 'doing',   title: 'In Progress', color: 3, limit: 3 },              // soft WIP
    { id: 'review',  title: 'Review',  color: 4, limit: 2, strictLimit: true }, // hard WIP
    { id: 'done',    title: 'Done',    color: 5 },
  ],
  lanes: [
    { id: 'fe', title: 'Frontend' },
    { id: 'be', title: 'Backend' },
  ],
  cards: [
    {
      id: 1, column: 'backlog', lane: 'fe', order: 0,
      title: 'Design tokens audit', description: 'Verify OKLCH ramps render token-pure.',
      tags: [{ text: 'design', color: 1 }, { text: 'p2', color: 4 }],
      avatar: 'KM', assignee: 'KM', progress: 10, due: '2026-07-10',
      attachments: [{ name: 'spec.pdf', size: 184320 }],
      comments: [{ author: 'AB', text: 'Ramp 5 looks off in dark mode.', time: '2026-06-20' }],
      votes: { count: 3, voted: false }, links: [6],
    },
    { id: 2, column: 'todo',  lane: 'fe', order: 0, title: 'Drag-and-drop polish', votes: { count: 5, voted: true } },
    { id: 3, column: 'doing', lane: 'be', order: 0, title: 'WIP limit enforcement', progress: 60 },
  ],
});

board.on('cardMove', ({ cards, to }) => {
  console.log(`${cards.length} card(s) → column ${to.column}`);
});
```

## Configuration
`TaskBoardConfig` (extends the base `WidgetConfig`, so `cls` / `style` / `hidden` / `disabled` are also available).

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `columns` | `KanbanColumnDef[]` | `[]` | Columns, left-to-right. |
| `lanes` | `KanbanLaneDef[]` | — | Swimlanes, top-to-bottom. Omit/empty to disable swimlanes. |
| `cards` | `KanbanCard[]` | `[]` | Initial cards (builds the internal `Store` when `store` is omitted). |
| `store` | `Store<KanbanCard>` | — | Use an existing core `Store` instead of `cards`. |
| `columnWidth` | `number` | `280` | Default column width (px). |
| `draggable` | `boolean` | `true` | Enable card drag-and-drop. |
| `multiSelect` | `boolean` | `true` | Allow multi-select (ctrl/meta/shift) for group drag. |
| `autoScroll` | `boolean` | `true` | Auto-scroll horizontally when dragging near an edge. |
| `columnReorder` | `boolean` | `true` | Allow reordering columns by dragging headers. |
| `toolbar` | `boolean` | `true` | Show the built-in toolbar (search, and sort/filter controls when enabled). |
| `searchPlaceholder` | `string` | — | Placeholder for the search box. |
| `editable` | `boolean` | `true` | Open the modal card editor on double-click / `editCard()`. |
| `cardRenderer` | `CardRenderer` | — | Full card-body renderer override `(card) => string`. |
| `label` | `string` | `'Task board'` | Accessible label for the board region. |
| `dataProvider` | `TaskBoardDataProvider` | — | Remote source: load cards + push optimistic mutations. |
| `syncUrl` | `string` | — | REST endpoint shorthand; builds an `AjaxDataProvider` when `dataProvider` is unset. |
| `wsUrl` | `string` | — | WebSocket URL for live remote changes (used with `syncUrl`). |
| `undoRedo` | `boolean` | `false` | Enable the undo/redo stack + `Ctrl+Z` / `Ctrl+Y`. |
| `sortable` | `boolean` | `false` | Show a toolbar sort control. |
| `sortField` | `SortField` | `'order'` | Initial sort field (`order` \| `priority` \| `title` \| `votes` \| `due`). |
| `filters` | `BoardFilterDef[]` | — | Toolbar filter predicates (rendered as chips, AND-combined). |
| `filterFn` | `(card) => boolean` | — | Ad-hoc predicate applied alongside search + active filters (return `true` to keep). |

Key card/column shapes (selected fields):

- **`KanbanCard`** — `id` (required), `column` (required), `lane?`, `order?`, `title?`, `description?`, `tags?: CardTag[]`, `avatar?`, `progress?` (0–100), `cover?`, `assignee?`, `due?`, `attachments?: CardAttachment[]`, `comments?: CardComment[]`, `votes?: CardVotes`, `links?: RecordId[]`, `bodyItems?: CardBodyItem[]` (extends core `Model`, so extra fields are preserved).
- **`KanbanColumnDef`** — `id` (required), `title?`, `color?` (1–8 → `--jects-data-N`), `limit?`, `strictLimit?`, `collapsed?`, `locked?`, `width?`.
- **`KanbanLaneDef`** — `id` (required), `title?`, `collapsed?`.

## Methods
Inherited from `Widget`: `update(patch)`, `getConfig()`, `show()`, `hide()`, `on(event, fn)`, `once()`, `off()`, `destroy()`, `isDestroyed`.

| Method | Description |
| --- | --- |
| `toggleColumn(id)` | Collapse/expand a column. |
| `setColumnLocked(id, locked)` | Lock/unlock a column (locked rejects drops/drags/reorder). |
| `moveColumn(id, toIndex)` | Reorder a column to a new index. |
| `editCard(id)` | Open the modal card editor (vetoable via `beforeCardEdit`). |
| `applyCardEdit(id, changes)` | Apply changed fields to a card and emit `cardEdit`. |
| `quickEditCard(id)` | Start inline title quick-edit in place. |
| `toggleVote(id)` | Toggle a card's vote (count ±1 + `voted`); recorded for undo + synced. |
| `getSelection()` / `setSelection(ids)` | Read / replace the selected card ids. |
| `moveCard(id, to)` | Programmatically move a card to `{ column, lane?, index }` (`CardDropTarget`). |
| `addCard(card)` | Append a card to a column; returns the stored card. |
| `setQuery(q)` | Set/clear the search query. |
| `setSortField(field)` / `getSortField()` | Set / read the active sort field (re-setting same field toggles direction). |
| `toggleFilter(id)` / `setFilters(ids)` / `getActiveFilters()` | Manage active toolbar filters. |
| `canUndo()` / `canRedo()` / `undo()` / `redo()` | Undo/redo (requires `undoRedo: true`). |
| `export(options?)` | Serialize cards to a string — `{ format: 'json' \| 'csv' \| 'png' }` (default `json`). |
| `destroy()` | Tear down the board, listeners and (if owned) store. |

All mutators return `this` for chaining (except `addCard`, which returns the stored card, and `export`, which returns a string).

## Events
Subscribe with `board.on(name, handler)`. `before*` events are **vetoable**: return `false` from the handler to cancel the action. Every payload includes `board`.

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

## Examples

### Columns, cards and a drag veto
```ts
const board = new TaskBoard('#board', {
  columns: [
    { id: 'todo',  title: 'To Do' },
    { id: 'doing', title: 'In Progress', limit: 2, strictLimit: true },
    { id: 'done',  title: 'Done' },
  ],
  cards: [
    { id: 1, column: 'todo',  order: 0, title: 'Write docs' },
    { id: 2, column: 'doing', order: 0, title: 'Build board' },
  ],
});

// Reject moves into a locked-down column outside work hours.
board.on('beforeCardMove', ({ to }) => to.column !== 'done' || isWorkHours());
board.on('limitReject', ({ column, limit }) =>
  console.warn(`Column ${column} is at its WIP limit of ${limit}`));
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
const board2 = new TaskBoard('#board2', {
  columns,
  dataProvider: new AjaxDataProvider({
    url: 'https://api.example.com/cards',
    headers: { Authorization: `Bearer ${token}` },
  }),
});
```

### Sort, filter and export
```ts
board.setSortField('due');             // order cards within columns by due date
board.setSortField('due');             // call again to flip ascending/descending
board.toggleFilter('mine');            // toggle a declared filter chip
const csv = board.export({ format: 'csv' });
download('board.csv', csv);
```

## Theming
The board consumes the standard Jects design tokens — set any `--jects-*` custom property on the host or an ancestor to retheme. Commonly used tokens:

- **Surfaces / text** — `--jects-background`, `--jects-foreground`, `--jects-card`, `--jects-card-foreground`, `--jects-muted`, `--jects-muted-foreground`, `--jects-border`, `--jects-input`.
- **Accent / focus** — `--jects-primary`, `--jects-primary-foreground`, `--jects-accent`, `--jects-accent-foreground`, `--jects-ring`.
- **WIP warning state** — `--jects-warning`, `--jects-warning-foreground`.
- **Categorical color** — column/tag `color: 1..8` maps to the data ramp `--jects-data-1 … --jects-data-8`.
- **Shape / motion / type** — `--jects-radius-{sm,md,lg,xl}`, `--jects-shadow-{sm,md,lg}`, `--jects-space-{1..4}`, `--jects-duration-{fast,normal}`, `--jects-font-family`, `--jects-font-size-{xs,sm}`, `--jects-font-weight-{medium,semibold}`.

```css
#board {
  --jects-primary: oklch(0.62 0.19 255);
  --jects-radius-lg: 12px;
}
```

Dark / high-contrast themes work automatically when you toggle the `@jects/theme` theme (e.g. via its `setTheme()` helper), which sets the token values on `<html>`.
