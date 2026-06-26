# @jects/spreadsheet
> A formula-driven workbook/sheet UI with live recalc, real OOXML XLSX I/O, validation, conditional formatting, named ranges, sort/filter, comments, embedded charts and cell protection.

## Overview
`@jects/spreadsheet` is a framework-free spreadsheet component: a `Spreadsheet` Widget rendered into the light DOM, driving a headless `FormulaEngine` (dependency-graph recalc, cross-sheet refs, cycle detection, dynamic-array spill) through the `SpreadsheetApi` seam and reusing the `@jects/grid` Grid for tabular rendering. It targets the feature bar of Excel Online / Google Sheets / DHTMLX Spreadsheet — formulas, typed cells, data validation, conditional formats, named ranges, comments, protection and native `.xlsx` round-trip. Everything is driven by an imperative API and styled purely through `--jects-*` CSS variables (no hardcoded colors).

## Installation
```sh
pnpm add @jects/spreadsheet @jects/core @jects/grid @jects/widgets @jects/charts @jects/theme
```
All five `@jects/*` packages are peer dependencies. The package is ESM, tree-shakeable, and framework-free (`"type": "module"`, `sideEffects` limited to CSS). A UMD build (`spreadsheet.umd.cjs`) is also published for `require`.

## Integration

### CSS
Import the theme base once in your app, then the component's side-effect stylesheet:
```ts
import '@jects/theme/base.css';      // --jects-* token base (required)
import '@jects/spreadsheet/style.css';
```

### Vanilla TS
```ts
import { Spreadsheet } from '@jects/spreadsheet';

const ss = new Spreadsheet(host, {           // host: HTMLElement | string (selector)
  sheets: [{ name: 'Sheet1', cells: {} }],
});
```

### Frameworks (React / Angular / Vue)
Wrap with a thin adapter: construct on mount, `.destroy()` on unmount. The instance is the API — call its methods directly.

```tsx
import { useEffect, useRef } from 'react';
import { Spreadsheet } from '@jects/spreadsheet';
import '@jects/spreadsheet/style.css';

export function SheetView() {
  const hostRef = useRef<HTMLDivElement>(null);
  const ssRef = useRef<Spreadsheet>();

  useEffect(() => {
    const ss = new Spreadsheet(hostRef.current!, {
      sheets: [{ name: 'Sheet1', cells: {} }],
    });
    ssRef.current = ss;
    return () => ss.destroy();
  }, []);

  return <div ref={hostRef} style={{ height: 420 }} />;
}
```
Angular/Vue follow the same pattern (mount in `ngAfterViewInit` / `onMounted`, `destroy()` in the teardown hook).

### Theming
The grid, chrome, conditional-format colors and cell styles resolve `--jects-*` tokens. Override tokens on an ancestor (or `:root`) to retheme — e.g. data-bar / scale colors are supplied as token names like `--jects-cmyk-cyan`, `--jects-success`.

## Features

- **Formula engine** — `=`-prefixed formulas with a dependency graph and incremental, topological recalc; cross-sheet references (`Sheet2!A1:B3`); cycle detection (`#CYCLE!`); dynamic-array spill (anchor `spill` extent + `spillParent` members, `#SPILL!` on block); Excel-compatible error sentinels (`#DIV/0!`, `#VALUE!`, `#REF!`, `#NAME?`, `#N/A`, …); built-in function library plus user functions (`engine.defineFunction` / `registerFunctions`).
- **Cell typing & formatting** — per-cell `CellFormat` (`number`, `currency`, `percent`, `date`, `time`, `text`, `boolean`) with number-format patterns (`"#,##0.00"`, `"0%"`, `"yyyy-mm-dd"`) and locale; `NUMBER_FORMAT_PRESETS` helper.
- **Cell styling** — bold/italic/underline/strikethrough, horizontal & vertical alignment, wrap, per-edge borders, token-based fg/bg colors.
- **Data validation** — list (enforced dropdown), number (min/max), and text (maxLength) rules per cell/range; invalid input is vetoed and surfaced via `editRejected`.
- **Conditional formatting** — `cellValue` (operators incl. `between`/`notBetween`), `colorScale` (2/3-color), `dataBar`, and `expression` (formula-driven) rules, evaluated live against computed values.
- **Named ranges** — workbook-level `name → ref`, case-insensitive, usable in formulas (`=SUM(Revenue)`).
- **Sort & filter** — sort a range by an absolute key column (stable, whole-record reorder); predicate filter that hides rows; column-header sort/filter affordance (`headerMenu`).
- **Comments / notes** — per-cell text comment with triangle indicator + popover, round-tripped through JSON/XLSX.
- **Cell & sheet protection** — per-cell `locked` flag (Excel semantics: locked by default) enforced once the sheet is protected.
- **Structure ops** — insert/delete rows & columns (ref-rewriting), merge/unmerge, frozen panes, row/column resize & hide.
- **Fill handle** — linear / date / list series fill in any direction (`fillTo`, `fillDown`, `fillRight`).
- **Clipboard** — internal + OS clipboard copy/paste, TSV parsing, block paste.
- **Embedded charts** — floating `@jects/charts` chart built from a data range (category column + numeric series).
- **Sheets** — multi-sheet workbook with tab strip, add/remove/rename/reorder, active-sheet switching.
- **Undo/redo** — command history across edits, styling, structure and data ops.
- **I/O** — CSV / JSON string export-import (`exportTo` / `importFrom`), legacy SpreadsheetML-2003 (`xlsx` string flavor), and **real OOXML `.xlsx`** bytes/Blob round-trip (`exportXlsx`, `exportXlsxBlob`, `importXlsx`) with typed cells, formulas, number formats, merges, frozen panes and named ranges. Bundled `zipSync`/`unzipSync` (no external zip dep).

## Quick start
```ts
import { Spreadsheet } from '@jects/spreadsheet';
import '@jects/theme/base.css';
import '@jects/spreadsheet/style.css';

const host = document.getElementById('spreadsheet')!;

const ss = new Spreadsheet(host, {
  maxRows: 16,
  sheets: [
    {
      id: 'sales',
      name: 'Sales',
      rowCount: 50,
      colCount: 8,
      cells: {
        '0,0': { value: 'Region', style: { bold: true } },
        '0,3': { value: 'Units',  style: { bold: true } },
        '0,4': { value: 'Revenue', style: { bold: true } },
        '1,0': { value: 'North' }, '1,3': { value: 120 },
        '1,4': { value: 5400, format: { type: 'currency', numberFormat: '#,##0' } },
        '2,0': { value: 'South' }, '2,3': { value: 64 },
        '2,4': { value: 2100, format: { type: 'currency', numberFormat: '#,##0' } },
        // Column totals via formulas (recalc live)
        '6,0': { value: 'Total', style: { bold: true } },
        '6,3': { formula: 'SUM(D2:D6)', style: { bold: true } },
        '6,4': { formula: 'SUM(E2:E6)', format: { type: 'currency', numberFormat: '#,##0' }, style: { bold: true } },
      },
    },
  ],
});

// A sheet-local rectangle {top,left,bottom,right} for range-taking methods.
const rng = (top: number, left: number, bottom: number, right: number) => ({ top, left, bottom, right });

ss.defineName('Revenue', 'Sales!E2:E6');                                   // named range
ss.setValidation({ kind: 'list', values: ['Won', 'Open', 'Lost'] }, rng(1, 2, 5, 2)); // dropdown
ss.addConditionalFormat({ kind: 'dataBar', colorToken: '--jects-cmyk-cyan' }, rng(1, 4, 5, 4));
ss.setFrozen({ rows: 1, cols: 0 });                                        // freeze header

ss.on('editRejected', (ev) => console.warn('rejected:', ev.reason, ev.message));
```

## Configuration
Extends `WidgetConfig`. Main fields:

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `api` | `SpreadsheetApi` | — | Production engine seam. When omitted, a built-in in-UI engine is created from `workbook`/`sheets`. |
| `workbook` | `WorkbookModel` | — | Initial workbook (used only when `api` is omitted). |
| `sheets` | `Array<Partial<SheetModel>>` | — | Convenience initializer (used when both `api` and `workbook` are omitted). Missing `id`/`name`/`cells`/`rowCount`/`colCount` are filled in; first sheet becomes active. |
| `toolbar` | `boolean` | `true` | Show the toolbar. |
| `formulaBar` | `boolean` | `true` | Show the formula bar. |
| `sheetTabs` | `boolean` | `true` | Show the sheet-tab strip. |
| `maxCols` | `number` | `26` | Max rendered columns. |
| `maxRows` | `number` | `100` | Max rendered rows. |
| `headerMenu` | `boolean` | `true` | Column-header sort/filter affordance (click cycles sort; alt/shift-click quick-filters). |

`SheetModel` cells are a sparse map keyed `"row,col"` (zero-based), each a `CellModel` (`value` / `formula` (without `=`) / `format` / `style` / `comment` / `locked`).

## Methods
Selected public methods (all range args are sheet-local `{top,left,bottom,right}`; omit to use the current selection):

| Method | Description |
| --- | --- |
| `getApi(): SpreadsheetApi` | The driving engine API (cells, sheets, recalc, `events`). |
| `getGrid(): CellGrid` | The underlying cell-grid surface. |
| `toggleStyle(key)` | Toggle `bold`/`italic`/`underline`/`strikethrough` over the selection. |
| `applyStyle(patch: Partial<CellStyle>)` | Apply a style patch to the selection (undoable). |
| `applyFormat(format: CellFormat)` | Apply a number format to the selection. |
| `merge()` / `split()` | Merge the selection into one cell / unmerge at the active cell. |
| `setFrozen(frozen: FrozenPanes)` | Set frozen row/column counts. |
| `resizeColumn(col, size)` / `resizeRow(row, size)` | Resize to `size` px. |
| `hideColumn(col)` / `hideRow(row)` | Hide a column / row. |
| `fillTo(source: CellRange, target: CellAddress)` | Fill-handle drag: extrapolate a series from `source` past its edge. |
| `fillDown()` / `fillRight()` | Fill the leading row/column across the selection. |
| `copy(): string` | Copy the selection to internal + OS clipboard (returns TSV). |
| `paste(tsv?): Promise<void>` / `pasteBlock(block: CellValue[][])` | Paste clipboard/TSV / synchronously paste a block. |
| `setValidation(rule, range?)` / `getValidation(addr)` | Attach / read a validation rule. |
| `addConditionalFormat(rule: CfRuleInput, range?): CfRule` | Add a CF rule (range derived from selection/arg). |
| `clearConditionalFormats()` / `getConditionalFormats(): CfRule[]` | Clear / list CF rules on the active sheet. |
| `setComment(addr, text)` / `getComment(addr)` | Set (or clear) / read a cell comment. |
| `setSheetProtected(on)` / `isSheetProtected()` | Toggle / query sheet protection. |
| `setCellsLocked(locked, range?)` | Set the `locked` flag over a range. |
| `defineName(name, ref)` / `deleteName(name)` / `listNames()` | Manage workbook named ranges. |
| `sortRange({ column, dir? }, range?)` | Stable sort rows by an absolute key column. |
| `applyFilter(column, predicate, range?)` / `clearFilter()` | Hide non-matching rows / reveal all. |
| `insertChart(range?, options?): Chart` | Insert a floating embedded chart. |
| `getCharts(): Chart[]` / `removeChart(chart)` | List / remove embedded charts. |
| `exportTo(format: IoFormat): string` / `importFrom(text, format)` | CSV / JSON / SpreadsheetML string I/O. |
| `exportXlsx(): Uint8Array` / `exportXlsxBlob(): Blob` / `importXlsx(bytes)` | Real OOXML `.xlsx` round-trip. |
| `setActiveSheet(id)` / `addSheet(name?): string` | Switch / add (and activate) a sheet. |
| `undo()` / `redo()` / `canUndo()` / `canRedo()` | Command history. |
| `destroy()` | Tear down the widget and subscriptions. |

The engine API (`ss.getApi()`) adds lower-level cell/sheet operations: `setCellInput`, `setValue`, `setFormula`, `clearCell`, `setFormat`, `setStyle`, `insertRows`/`deleteRows`/`insertColumns`/`deleteColumns`, `mergeCells`/`unmergeCells`, `recalculate`, `setCalcMode`, `serialize`, plus `engine` (the `FormulaEngine`) and `events`.

## Events
Subscribe with `ss.on(event, handler)` (returns an unsubscribe function). Widget-level events:

| Event | Payload | Fires when |
| --- | --- | --- |
| `selectionChange` | `{ ref: CellRef; range: CellRange }` | The active cell / selection range changes. |
| `cellCommit` | `{ ref: CellRef; input: string }` | A cell input is committed through the UI. |
| `sheetChange` | `{ sheetId: string }` | The active sheet changes. |
| `import` | `{ format: IoFormat }` | A workbook is imported. |
| `editRejected` | `{ address: CellAddress; reason: 'validation' \| 'protected'; message? }` | An edit is rejected by validation or protection. |

Engine-level events are available on `ss.getApi().events` (e.g. `beforeCellChange` (vetoable), `cellChange`, `recalc` `{ changed: CellRef[] }`, `spill`, `cellError`, `structureChange`, `workbookLoad`, `editRejected`).

## Examples

**Data + a formula + real XLSX export**
```ts
const ss = new Spreadsheet(host, {
  sheets: [{
    id: 'sales', name: 'Sales', rowCount: 50, colCount: 8,
    cells: {
      '0,4': { value: 'Revenue', style: { bold: true } },
      '1,4': { value: 5400, format: { type: 'currency', numberFormat: '#,##0' } },
      '2,4': { value: 2100, format: { type: 'currency', numberFormat: '#,##0' } },
      '6,4': { formula: 'SUM(E2:E6)', format: { type: 'currency', numberFormat: '#,##0' } },
    },
  }],
});

// Download a real .xlsx that Excel/Sheets/LibreOffice open natively.
const blob = ss.exportXlsxBlob();
const url = URL.createObjectURL(blob);
const a = Object.assign(document.createElement('a'), { href: url, download: 'sales.xlsx' });
a.click();
URL.revokeObjectURL(url);
```

**Validation dropdown + conditional formatting**
```ts
const rng = (t: number, l: number, b: number, r: number) => ({ top: t, left: l, bottom: b, right: r });

// Enforced dropdown on the Status column (C2:C6).
ss.setValidation({ kind: 'list', values: ['Won', 'Open', 'Lost'] }, rng(1, 2, 5, 2));

// Data-bars + a high-value highlight on Revenue (E2:E6).
ss.addConditionalFormat({ kind: 'dataBar', colorToken: '--jects-cmyk-cyan' }, rng(1, 4, 5, 4));
ss.addConditionalFormat(
  { kind: 'cellValue', op: '>=', value: 6000, style: { backgroundToken: '--jects-cmyk-yellow-soft', bold: true } },
  rng(1, 4, 5, 4),
);

// Red -> amber -> green scale on Units (D2:D6).
ss.addConditionalFormat(
  { kind: 'colorScale', minToken: '--jects-destructive', midToken: '--jects-warning', maxToken: '--jects-success' },
  rng(1, 3, 5, 3),
);
```

**Named range + sort/filter + embedded chart**
```ts
const rng = (t: number, l: number, b: number, r: number) => ({ top: t, left: l, bottom: b, right: r });

ss.defineName('Revenue', 'Sales!E2:E6');         // =SUM(Revenue) anywhere in the workbook
ss.sortRange({ column: 4, dir: 'desc' }, rng(1, 0, 5, 4));   // sort whole records by Revenue
ss.applyFilter(2, (v) => v === 'Won', rng(1, 0, 5, 4));      // keep only Status = "Won"
ss.clearFilter();

// Region (col 0) -> categories, Revenue (col 4) -> bar series.
ss.insertChart(rng(0, 0, 5, 4), { type: 'bar' });
```

## Theming
All visuals resolve `--jects-*` tokens from `@jects/theme/base.css` — no raw colors are baked in. Conditional-format colors, cell `colorToken`/`backgroundToken` and tab colors are passed as token names. Useful tokens:

- Surface / text: `--jects-background`, `--jects-foreground`, `--jects-card`, `--jects-border`, `--jects-muted`, `--jects-primary`.
- Status / scale: `--jects-success`, `--jects-warning`, `--jects-destructive`.
- Accent palette (used in the gallery demo): `--jects-cmyk-cyan`, `--jects-cmyk-magenta`, `--jects-cmyk-yellow-soft`.

Switch themes by swapping/adding a theme stylesheet (e.g. `@jects/theme/dark.css`) or by redefining tokens on a scoping element. The widget renders into the light DOM, so app-level CSS and tokens cascade in normally.
