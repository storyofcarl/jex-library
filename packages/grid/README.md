# @jects/grid — virtualized, enterprise-grade data grid

## What it is

`@jects/grid` is a framework-free, light-DOM data grid that virtualizes tens of thousands of rows (only visible rows live in the DOM) behind a stable imperative API. It ships typed columns, multi-sort/filter, grouping with aggregates, selection, inline editing, master-detail, tree mode, clipboard/fill, and CSV/Excel/PDF export. Behavior is added through composable feature plugins and the rendering backend is swappable behind a `Renderer` interface.

Part of the [Jects UI suite](https://github.com/storyofcarl/jex-library). Live demo: <https://jexlibrary.vercel.app>.

## Install

```bash
pnpm add @jects/grid @jects/core @jects/theme @jects/widgets
```

`@jects/core`, `@jects/theme`, and `@jects/widgets` are peer dependencies — the grid reuses `@jects/widgets` controls as cell editors and reads `@jects/theme` tokens. The package ships ESM with a UMD/CJS fallback and is tree-shakeable (only the features you import and `use(...)` are bundled).

## CSS

The package ships a side-effect stylesheet. Import it once, alongside the theme token base so the `--jects-*` variables resolve:

```ts
import '@jects/theme/style.css';   // OKLCH token base (semantic + palette)
import '@jects/grid/style.css';    // grid structural styles
```

## Minimal example

```ts
import { Grid } from '@jects/grid';

const host = document.getElementById('grid')!;
const grid = new Grid(host, {
  data: [
    { id: 1, name: 'Ada Lovelace', dept: 'Engineering', salary: 124000 },
    { id: 2, name: 'Grace Hopper', dept: 'Research', salary: 138000 },
  ],
  columns: [
    { field: 'name', header: 'Name', flex: 1, sortable: true },
    { field: 'dept', header: 'Department', flex: 1, sortable: true },
    { field: 'salary', header: 'Salary', type: 'number', width: 110, align: 'end' },
  ],
});

// later, on teardown:
grid.destroy();
```

`new Grid(host, options)` accepts an `HTMLElement` or a selector string as the host. The instance **is** a `GridApi` plus the standard Widget lifecycle (`update` / `getConfig` / `show` / `hide` / `destroy`).

## Subpath exports

In addition to the root entry (`@jects/grid`) and the stylesheet (`@jects/grid/style.css`), the package exposes focused subpaths for direct, tree-shakeable access to internals:

- `@jects/grid/engine` — rendering and layout core: `GridEngine`, `DomRenderer` / `createDomRenderer`, `RowModel`, `DefaultViewport`, `DefaultSelectionModel`, `DefaultEditSession`, column geometry helpers (`resolveColumns`, `computeColumnWindow`, `columnId`), group-row painting, cell spanning (`SpanDomRenderer`), and RTL helpers.
- `@jects/grid/columns` — column models, renderers, editors, selection, clipboard, and spans: the `CellRendererRegistry` and built-in renderers (`textRenderer`, `numberRenderer`, `dateRenderer`, `checkRenderer`, `actionRenderer`, `ratingRenderer`, `widgetCellRenderer`, `selectRenderer`, …), `EditController` / `EditingFeature`, `GridSelectionModel` / `SelectionFeature`, and TSV clipboard helpers (`matrixToTSV`, `parseTSV`, `applyPaste`).
- `@jects/grid/features` — the optional feature plugins and their factories: sort, filter (bar/menu/facet), quick search, grouping, summary, tree, cell/header menus, export, PDF export, column state/picker/auto-size, fill, row reorder/resize/expander, selection column, responsive, tooltip, infinite/range load, and undo/redo.
- `@jects/grid/header-groups` — multi-level stacked column headers: `HeaderGroupsFeature` / `headerGroupsFeature` plus the header-tree resolver (`resolveHeaderTree`, `hasHeaderGroups`) and related types.

## Common recipes

### Sorting, multi-selection, and a selector column

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
    { field: 'rating', header: 'Rating', type: 'rating', width: 120, meta: { rating: { max: 5 } } },
    { field: 'active', header: 'Active', type: 'check',  width: 80, align: 'center' },
  ],
});

grid.on('selectionChange', () => console.log(grid.selection.getSelectedRows()));
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
exporter.downloadCsv();
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

// beforeCellEdit is vetoable — return false to reject the edit
grid.on('beforeCellEdit', ({ column, value }) =>
  column.field === 'salary' && Number(value) < 0 ? false : undefined);

undo.undo();
undo.redo();
```

## Events

Subscribe with `grid.on(event, payload => …)` (also `once` / `off` / `emit`). `beforeX` events are vetoable — return `false` to cancel. Key events from `GridEvents` include:

- `cellClick` / `cellDblClick` — `{ row, column, address, event }`
- `beforeCellEdit` (vetoable) — an inline edit is about to begin
- `cellEdit` — an inline edit committed (`{ row, column, address, oldValue, value }`)
- `selectionChange` — `{ selectedIds, cells }`
- `sortChange` / `filterChange` / `groupChange` — view directives changed
- `rowExpand` — a tree row expanded/collapsed
- `scroll` / `viewportChange` — the viewport scrolled or the rendered row window moved
- `columnResize` / `columnReorder` — column geometry changed
- `beforeRowReorder` (vetoable) / `rowReorder` — a row drag-reorder

## Theming

The grid renders into light DOM under `.jects-grid` and styles itself entirely from `--jects-*` CSS custom properties — override them on `:root` or any ancestor to retheme. Include `@jects/theme` (via `@jects/theme/style.css`) for the token base; dark mode is inherited automatically through the theme. See [docs/modules/theme.md](../../docs/modules/theme.md).

## Accessibility

The grid is interactive: keyboard navigation across cells, Enter/Tab editing flow, and ARIA roles/attributes on the grid, rows, and cells. The package is tested against `axe-core` in its browser test suite.

## Stability & support

**Beta.** The public API is broad and exercised by unit and browser (axe) tests; surface details may still shift. Part of the Jects UI suite. Commercial terms: see LICENSE.md.
