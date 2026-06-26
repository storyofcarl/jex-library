# @jects/grid

> Virtualized, framework-free data grid with a stable imperative API and a pluggable feature/renderer architecture.

## Overview

`@jects/grid` is a high-performance data grid built on `@jects/core`. It virtualizes
tens of thousands of rows (only visible rows live in the DOM), supports typed columns,
inline editing, multi-sort/filter, grouping with aggregates, selection, master-detail,
tree mode, and CSV/Excel/PDF export. It targets the enterprise feature bar of products
like **AG Grid** and **Bryntum Grid**.

The core paradigm is a **framework-free, light-DOM Widget class** (`Grid`) with a stable
imperative service surface (`GridApi`). Behavior is added through composable feature
plugins (`grid.use(...)`), and the rendering backend is swappable behind a `Renderer`
interface (default is a DOM row/cell recycler). Theming is entirely via CSS custom
properties — no Shadow DOM, no runtime style injection beyond the side-effect stylesheet.

## Installation

```bash
pnpm add @jects/grid @jects/core @jects/theme @jects/widgets
```

`@jects/core`, `@jects/theme`, and `@jects/widgets` are peer dependencies (the grid reuses
`@jects/widgets` controls as cell editors). The package ships **ESM** (`./dist/grid.js`,
with a UMD/CJS fallback), is **tree-shakeable** (only the features you import/`use` are
bundled), and is **framework-free** — usable from vanilla TS or wrapped in any framework.

## Integration

### Side-effect CSS + theme base

Import the grid's stylesheet once (it is a side-effect import, marked `sideEffects` in
`package.json`) and pull in the `@jects/theme` token base so the `--jects-*` variables
resolve:

```ts
import '@jects/theme/style.css';   // 3-tier OKLCH token base (semantic + palette)
import '@jects/grid/style.css';    // grid structural styles
```

### Vanilla TS usage

```ts
import { Grid } from '@jects/grid';

const host = document.getElementById('grid')!;
const grid = new Grid(host, {
  data: rows,
  columns: [
    { field: 'name', header: 'Name', flex: 1, sortable: true },
    { field: 'salary', header: 'Salary', type: 'number', width: 110, align: 'end' },
  ],
});
```

`new Grid(host, options)` accepts an `HTMLElement` or a selector string as the host. The
instance **is** a `GridApi` (it exposes the same surface to consumers) plus the standard
Widget lifecycle (`update` / `getConfig` / `show` / `hide` / `destroy`).

### Framework usage (React / Angular / Vue)

The grid is an imperative class, so frameworks wrap it with a thin adapter: instantiate
it in a mount effect against a ref'd element, drive data/columns through `update(...)` or
store mutations, and call `.destroy()` on unmount. Do **not** re-create the grid on every
render — create once, then push changes imperatively.

```tsx
import { useEffect, useRef } from 'react';
import { Grid } from '@jects/grid';
import type { GridOptions } from '@jects/grid';
import '@jects/theme/style.css';
import '@jects/grid/style.css';

export function DataGrid({ options }: { options: GridOptions }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<Grid | null>(null);

  useEffect(() => {
    const grid = new Grid(hostRef.current!, options);
    gridRef.current = grid;
    return () => grid.destroy();         // tear down on unmount
  }, []);

  useEffect(() => {
    gridRef.current?.update(options);    // push prop changes imperatively
  }, [options]);

  return <div ref={hostRef} style={{ height: 480 }} />;
}
```

Angular/Vue follow the same pattern: instantiate in `ngAfterViewInit` / `onMounted`,
`destroy()` in `ngOnDestroy` / `onUnmounted`.

### Theming

The grid renders into light DOM and reads `@jects/theme` tokens (3-tier OKLCH design
tokens with a single `--jects-radius`). Customize by overriding `--jects-*` custom
properties on any ancestor (or `:root`). Dark mode is supported through the theme base
(`@jects/theme` ships a dark token set; toggle it via the theme's documented `data-theme`
/ class hook). See **Theming** below for the specific variables the grid consumes.

## Features

- **Virtualization** — row virtualization by default; optional variable row heights
  (`OffsetIndex`-backed) and horizontal/column virtualization for very wide grids;
  tunable `overscan`. Handles 50k+ rows with only visible rows in the DOM.
- **Typed columns** — `text`, `number`, `date`, `check`, `action`, `tree`, `template`
  (custom renderer), plus parity types `rating` (editable stars), `widget` (mount any
  `@jects/widgets` control per cell), `rownumber` (auto 1-based index), and `select`
  (row-selector checkbox).
- **Custom renderers & editors** — per-column `renderer` (`CellRenderer`) and `editor`
  (`CellEditor`); a `CellRendererRegistry` with built-ins (`textRenderer`,
  `numberRenderer`, `dateRenderer`, `checkRenderer`, `actionRenderer`, `ratingRenderer`,
  `widgetCellRenderer`, …) and `formatNumber` / `formatDate` helpers.
- **Sorting** — single or multi-column sort (`SortFeature`); declarative `features.sort`
  with initial state.
- **Filtering** — column filters (`FilterFeature`), a filter bar (`FilterBarFeature`),
  per-column operator menu (`FilterMenuFeature`), faceted/value filtering
  (`FilterFacetFeature`), and a quick global search (`QuickSearchFeature`) with match
  highlighting.
- **Grouping & aggregates** — row grouping (`GroupFeature`) with per-group and
  grand-total aggregations (`sum`, `avg`, `count`, custom), summary/footer rows
  (`SummaryFeature`), and a tree (hierarchical) mode (`TreeFeature`) backed by `TreeStore`.
- **Selection** — `none` / `single` / `multi` / `cell` / `range` modes; a built-in
  selection checkbox column (`SelectionColumnFeature`) with header "select all".
- **Editing** — inline cell editing and full-row editing (`EditingFeature`); `click` /
  `dblclick` / `manual` triggers, commit-on-blur, keyboard Enter/Tab navigation, and
  validation hooks; editors reuse `@jects/widgets` controls.
- **Clipboard & fill** — TSV copy/paste over ranges (`matrixToTSV` / `parseTSV` /
  `applyPaste`) and an Excel-style fill handle with series detection (`FillFeature`).
- **Master-detail** — expandable full-width detail rows per row (`RowExpanderFeature`)
  with a custom detail renderer.
- **Column management** — resize, reorder, auto-size (`ColumnAutoSizeFeature`), a column
  picker (`ColumnPickerFeature`), multi-level stacked headers (`HeaderGroupsFeature`),
  and persisted column/sort/filter/group state (`ColumnStateFeature`).
- **Rows** — drag reorder within and across grids (`RowReorderFeature`), row resize
  (`RowResizeFeature`).
- **Responsive** — viewport-width column auto-hide via `responsivePriority` /
  `minGridWidth`, or explicit breakpoints (`ResponsiveFeature`).
- **Tooltips** — cell tooltips, including show-on-overflow (`TooltipFeature`).
- **Undo/redo** — command-stack undo/redo of edits (`UndoRedoFeature`).
- **Export** — CSV and Excel (`ExportFeature`) and PDF (`PdfExportFeature`).
- **Infinite / range loading** — server-side range/page loading with placeholders
  (`InfiniteLoadFeature`).
- **Spans & RTL** — cell row/col spanning (`SpanDomRenderer`) and right-to-left layout.

## Quick start

```html
<div id="grid" style="height: 420px"></div>
```

```ts
import { Grid } from '@jects/grid';
import '@jects/theme/style.css';
import '@jects/grid/style.css';

const rows = [
  { id: 1, name: 'Ada Lovelace',  dept: 'Engineering', salary: 124000, active: true },
  { id: 2, name: 'Grace Hopper',  dept: 'Research',    salary: 138000, active: true },
  { id: 3, name: 'Linus Torvalds', dept: 'Engineering', salary: 142000, active: false },
];

const grid = new Grid(document.getElementById('grid')!, {
  data: rows,
  selection: 'multi',
  editing: { enabled: true, trigger: 'dblclick' },
  features: {
    sort: { multi: true },
    filter: true,
    columnResize: true,
    selectionColumn: { headerCheckbox: true },
  },
  columns: [
    { field: 'id',     header: 'ID',         type: 'number', width: 64, sortable: true, frozen: 'left' },
    { field: 'name',   header: 'Name',       flex: 1, minWidth: 130, sortable: true, filterable: true },
    { field: 'dept',   header: 'Department', flex: 1, sortable: true, filterable: true },
    { field: 'salary', header: 'Salary',     type: 'number', width: 110, align: 'end', sortable: true,
      meta: { format: { grouping: true } } },
    { field: 'active', header: 'Active',     type: 'check', width: 80, align: 'center' },
  ],
});

grid.on('selectionChange', ({ selectedIds }) => console.log('selected', selectedIds));
```

## Configuration

`GridOptions` (extends `WidgetConfig`, so `cls` / `style` / `hidden` / `disabled` are
also accepted).

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `data` | `Store<Row>` \| `TreeStore<Row>` \| `Row[]` | — (required) | Data source: a core store, a tree store (for tree mode), or a raw row array the grid wraps. |
| `columns` | `ColumnDef<Row>[]` | — (required) | Column definitions in display order. |
| `rowHeight` | `number` | `DEFAULT_ROW_HEIGHT` | Default row height in px. |
| `headerHeight` | `number` | `DEFAULT_HEADER_HEIGHT` | Header row height in px. |
| `virtualization` | `VirtualizationOptions` | `{ enabled: true }` | `enabled`, `overscan`, `variableRowHeight`, `horizontal`. |
| `selection` | `'none'` \| `'single'` \| `'multi'` \| `'cell'` \| `'range'` | `'none'` | Selection granularity. |
| `editing` | `boolean` \| `EditingOptions` | `false` | Inline editing; object form: `enabled`, `trigger` (`'click'`/`'dblclick'`/`'manual'`, default `'dblclick'`), `commitOnBlur` (default `true`), `keyboardNav` (default `true`). |
| `treeMode` | `boolean` \| `TreeModeOptions` | `false` | Hierarchical rows (requires a `TreeStore`); object form: `treeColumn`, `indent`, `expanded`, `lazy`. |
| `features` | `FeaturesConfig` | `{}` | Declarative enable/config of built-in features (see below). |
| `renderer` | `RendererFactory<Row>` | DOM recycler | Override the rendering backend. |
| `plugins` | `GridFeature<Row>[]` | `[]` | Features installed at construction. |
| `idField` | `string` | store default | Unique row id field forwarded to the store. |
| `emptyText` | `string` | — | Empty-state text when there are no rows. |

`ColumnDef` key fields: `field`, `header`, `width`, `minWidth`, `maxWidth`, `flex`,
`type` (`ColumnType`, default `'text'`), `renderer`, `editor`, `sortable`, `filterable`,
`resizable`, `reorderable`, `frozen` (`'left'`/`'right'`), `align`
(`'start'`/`'center'`/`'end'`), `hidden`, `id`, `responsivePriority`, `minGridWidth`,
`meta`.

`features` (`FeaturesConfig`) accepts: `sort` (`boolean | { multi?, initial? }`),
`filter` (`boolean | { initial? }`), `group` (`boolean | { initial?, aggregations?,
footerAggregations? }`), `columnResize`, `columnReorder`, `clipboard`, `export`,
`selectionColumn` (`boolean | { columnId?, columnWidth?, headerCheckbox? }`), and
`responsive` (`boolean | { breakpoints?: { maxWidth, hide }[] }`).

## Methods

The `Grid` instance exposes the full `GridApi`:

| Method | Description |
| --- | --- |
| `getRow(rowIndex): Row \| undefined` | Row model at an absolute (sorted/filtered) view index. |
| `getRowById(id): Row \| undefined` | Row model by id. |
| `getRowIndex(id): number` | View index of a row id, or `-1`. |
| `getRowCount(): number` | Number of rows in the current (filtered) view. |
| `getColumn(id): ColumnDef \| undefined` | Look up a column by id/field. |
| `setColumns(columns): void` | Replace column definitions and re-resolve geometry. |
| `updateColumn(id, patch): void` | Update one column in place (width, hidden, frozen, …). |
| `refresh(): void` | Recompute the window and repaint the viewport. |
| `refreshRow(id): void` | Repaint a single row. |
| `refreshCell(rowIndex, colIndex): void` | Repaint a single cell. |
| `invalidateLayout(): void` | Recompute resolved column widths/positions. |
| `use(feature): GridFeature` | Install a feature/plugin (calls `feature.init(this)`); returns it. |
| `removeFeature(name): void` | Remove a feature by name (calls its `destroy`). |
| `on(event, fn) / once / off / emit` | Typed event subscription / emission. |
| `track(disposer): void` | Register a disposer run on `destroy()`. |
| `update(patch): this` | Merge options and re-render (Widget lifecycle). |
| `getConfig(): Readonly<GridOptions>` | Current resolved options. |
| `show() / hide(): this` | Toggle the grid root. |
| `destroy(): void` | Vetoable teardown — disposes renderer, features, store wiring. |

Read-only accessors: `store`, `columns`, `viewport` (with `scrollToRow` /
`scrollToColumn` / `scrollTo`), `selection` (`SelectionModel`: `select`, `add`,
`deselect`, `selectRange`, `clear`, `getSelectedIds`, `getSelectedRows`, …), `editing`
(`EditSession`: `start`, `commit`, `cancel`, `isEditing`), `renderer`, `el`, `features`,
`id`, `isDestroyed`.

## Events

Subscribe with `grid.on(event, payload => …)`. `beforeX` events are **vetoable** — return
`false` to cancel.

| Event | Payload | Fires when |
| --- | --- | --- |
| `cellClick` | `{ row, column, address, event }` | A cell is clicked. |
| `cellDblClick` | `{ row, column, address, event }` | A cell is double-clicked. |
| `beforeCellEdit` | `{ row, column, address, value }` | An inline edit is about to begin (vetoable). |
| `cellEdit` | `{ row, column, address, oldValue, value }` | An inline edit committed. |
| `selectionChange` | `{ selectedIds, cells }` | The selection changed. |
| `sortChange` | `{ sort: SortState[] }` | Sort directives changed. |
| `filterChange` | `{ filter: FilterState[] }` | Filter directives changed. |
| `groupChange` | `{ group: GroupState }` | Grouping changed. |
| `rowExpand` | `{ row, id, expanded }` | A tree row expanded/collapsed. |
| `scroll` | `{ scrollTop, scrollLeft }` | The viewport scrolled. |
| `columnResize` | `{ columnId, width }` | A column finished resizing. |
| `columnReorder` | `{ columnId, fromIndex, toIndex }` | Columns were reordered. |
| `viewportChange` | `{ window: ViewportWindow }` | The rendered row window moved. |
| `beforeRowReorder` | `RowReorderPayload` | A row drag-reorder is about to commit (vetoable). |
| `rowReorder` | `RowReorderPayload` | A row drag-reorder committed. |

(Plus the inherited Widget events such as `beforeDestroy`.)

## Examples

### Typed columns with sorting, multi-selection, and a selector column

```ts
import { Grid } from '@jects/grid';

const grid = new Grid('#grid', {
  data: employees,
  selection: 'multi',
  features: {
    sort: { multi: true },
    columnResize: true,
    selectionColumn: { headerCheckbox: true },
  },
  columns: [
    { field: 'id',     header: 'ID',     type: 'number', width: 64, frozen: 'left', sortable: true },
    { field: 'name',   header: 'Name',   flex: 1, sortable: true },
    { field: 'hired',  header: 'Hired',  type: 'date',   width: 120, sortable: true },
    { field: 'rating', header: 'Rating', type: 'rating', width: 120, meta: { rating: { max: 5 } } },
    { field: 'active', header: 'Active', type: 'check',  width: 80, align: 'center' },
  ],
});

grid.on('selectionChange', e => console.log(grid.selection.getSelectedRows()));
```

### Grouping with aggregates and CSV export

```ts
import { Grid, exportFeature } from '@jects/grid';

const grid = new Grid('#grid', {
  data: rows,
  features: {
    sort: true,
    group: {
      initial: { columnIds: ['dept'] },
      aggregations: { salary: 'sum', id: 'count' },
      footerAggregations: { salary: 'sum', id: 'count' },
    },
  },
  columns: [
    { field: 'name',   header: 'Name', flex: 1 },
    { field: 'dept',   header: 'Department', flex: 1 },
    { field: 'salary', header: 'Salary', type: 'number', align: 'end', width: 120 },
  ],
});

const exporter = grid.use(exportFeature({ fileName: 'employees' }));
document.querySelector('#csv')!.addEventListener('click', () => exporter.downloadCsv());
```

### Inline editing with validation and an undo stack

```ts
import { Grid, undoRedoFeature } from '@jects/grid';

const grid = new Grid('#grid', {
  data: rows,
  editing: { enabled: true, trigger: 'dblclick', commitOnBlur: true },
  columns: [
    { field: 'name',   header: 'Name', flex: 1 },
    { field: 'salary', header: 'Salary', type: 'number', align: 'end', width: 120 },
  ],
});

const undo = grid.use(undoRedoFeature());

grid.on('beforeCellEdit', ({ column, value }) =>
  column.field === 'salary' && Number(value) < 0 ? false : undefined);

document.querySelector('#undo')!.addEventListener('click', () => undo.undo());
document.querySelector('#redo')!.addEventListener('click', () => undo.redo());
```

## Theming

The grid renders into light DOM under the `.jects-grid` root and styles itself from the
shared `@jects/theme` tokens — override these `--jects-*` custom properties on `:root` (or
any ancestor) to retheme:

- **Surfaces & text:** `--jects-background`, `--jects-foreground`, `--jects-card`,
  `--jects-card-foreground`, `--jects-muted`, `--jects-muted-foreground`,
  `--jects-popover`, `--jects-popover-foreground`.
- **Lines & focus:** `--jects-border`, `--jects-input`, `--jects-ring`.
- **Accent / selection:** `--jects-primary`, `--jects-primary-foreground`,
  `--jects-accent`, `--jects-accent-foreground`, `--jects-secondary`,
  `--jects-destructive`, `--jects-success`.
- **Typography & rhythm:** `--jects-font-family`, `--jects-font-size-*`,
  `--jects-font-weight-*`, `--jects-space-*`, `--jects-radius`.
- **Grid-specific:** `--jects-grid-detail-width` (master-detail panel width).

Component class hooks you can target/extend include `.jects-grid`, `.jects-grid--rtl`,
`.jects-grid--has-tooltips`, `.jects-grid-cell--selected`, `.jects-grid-cell--focused`,
`.jects-grid-cell--number` / `--rating` / `--action` / `--check` / `--select`, and the
frozen-column markers `.jects-grid-col--frozen-left` / `--frozen-right`. Dark mode is
provided by the `@jects/theme` base via its documented theme toggle (the grid inherits it
automatically — no grid-specific config).
