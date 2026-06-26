# @jects/spreadsheet — a formula-driven workbook UI for the web

## What it is

`@jects/spreadsheet` is a framework-free spreadsheet component: a `Spreadsheet` widget rendered into the light DOM, driving a headless formula engine (dependency-graph recalc, cross-sheet refs, cycle detection, dynamic-array spill) and reusing the Jects Grid for tabular rendering. It ships formulas, typed cells, data validation, conditional formatting, named ranges, comments, embedded charts, cell/sheet protection, fill-handle, sort/filter, undo/redo, and real OOXML `.xlsx` round-trip. Everything is driven by an imperative API and styled purely through `--jects-*` CSS variables.

- Repo: https://github.com/storyofcarl/jex-library
- Live demo: https://jexlibrary.vercel.app

## Install

```sh
pnpm add @jects/spreadsheet @jects/core @jects/grid @jects/widgets @jects/charts @jects/theme
```

All five `@jects/*` packages are peer dependencies. The package is ESM and tree-shakeable (`"type": "module"`, side effects limited to CSS); a UMD build (`spreadsheet.umd.cjs`) is also published for `require`.

## CSS

```ts
import '@jects/theme/base.css';        // --jects-* token base (required)
import '@jects/spreadsheet/style.css'; // component stylesheet
```

## Minimal example

```ts
import { Spreadsheet } from '@jects/spreadsheet';
import '@jects/theme/base.css';
import '@jects/spreadsheet/style.css';

const host = document.getElementById('spreadsheet')!;

const ss = new Spreadsheet(host, {
  sheets: [
    {
      id: 'sales',
      name: 'Sales',
      rowCount: 50,
      colCount: 8,
      cells: {
        '0,4': { value: 'Revenue', style: { bold: true } },
        '1,4': { value: 5400, format: { type: 'currency', numberFormat: '#,##0' } },
        '2,4': { value: 2100, format: { type: 'currency', numberFormat: '#,##0' } },
        '6,4': { formula: 'SUM(E2:E6)', format: { type: 'currency', numberFormat: '#,##0' }, style: { bold: true } },
      },
    },
  ],
});

// later, on teardown:
ss.destroy();
```

The `host` is an `HTMLElement` (or a selector string). `SheetModel` cells are a sparse map keyed `"row,col"` (zero-based); each `CellModel` carries `value` / `formula` (without `=`) / `format` / `style` / `comment` / `locked`.

## Subpath exports

- `@jects/spreadsheet/engine` — the headless formula engine surface (`createFormulaEngine`, `FormulaEngineImpl`, `builtinFunctions`) for use without the UI widget.
- `@jects/spreadsheet/io` — the standalone I/O helpers (CSV / JSON / SpreadsheetML and real OOXML `.xlsx` conversion, plus the bundled `zipSync`/`unzipSync`) for importing/exporting workbook models headlessly.

## Common recipes

**Real `.xlsx` export (opens natively in Excel / Sheets / LibreOffice)**

```ts
const blob = ss.exportXlsxBlob();
const url = URL.createObjectURL(blob);
const a = Object.assign(document.createElement('a'), { href: url, download: 'sales.xlsx' });
a.click();
URL.revokeObjectURL(url);
```

**Validation dropdown + conditional formatting**

```ts
const rng = (top: number, left: number, bottom: number, right: number) => ({ top, left, bottom, right });

// Enforced dropdown on the Status column (C2:C6).
ss.setValidation({ kind: 'list', values: ['Won', 'Open', 'Lost'] }, rng(1, 2, 5, 2));

// Data-bars + a high-value highlight on Revenue (E2:E6).
ss.addConditionalFormat({ kind: 'dataBar', colorToken: '--jects-cmyk-cyan' }, rng(1, 4, 5, 4));
ss.addConditionalFormat(
  { kind: 'cellValue', op: '>=', value: 6000, style: { backgroundToken: '--jects-cmyk-yellow-soft', bold: true } },
  rng(1, 4, 5, 4),
);
```

**Named range + sort/filter + embedded chart**

```ts
const rng = (t: number, l: number, b: number, r: number) => ({ top: t, left: l, bottom: b, right: r });

ss.defineName('Revenue', 'Sales!E2:E6');                 // usable as =SUM(Revenue)
ss.sortRange({ column: 4, dir: 'desc' }, rng(1, 0, 5, 4)); // sort whole records by Revenue
ss.applyFilter(2, (v) => v === 'Won', rng(1, 0, 5, 4));    // keep only Status = "Won"
ss.clearFilter();

ss.insertChart(rng(0, 0, 5, 4), { type: 'bar' });        // Region categories, Revenue series
```

**Protection, freeze, fill, undo**

```ts
ss.setFrozen({ rows: 1, cols: 0 });   // freeze header row
ss.fillDown();                        // fill the leading row across the selection
ss.setSheetProtected(true);           // enforce per-cell `locked` flags
ss.undo();
```

## Events

Subscribe with `ss.on(event, handler)` (returns an unsubscribe function). Widget-level events include:

| Event | Payload | Fires when |
| --- | --- | --- |
| `selectionChange` | `{ ref; range }` | The active cell / selection range changes. |
| `cellCommit` | `{ ref; input }` | A cell input is committed through the UI. |
| `sheetChange` | `{ sheetId }` | The active sheet changes. |
| `import` | `{ format }` | A workbook is imported. |
| `editRejected` | `{ address; reason: 'validation' \| 'protected'; message? }` | An edit is rejected by validation or protection. |

Lower-level engine events are available on `ss.getApi().events` (e.g. `beforeCellChange` (vetoable), `cellChange`, `recalc`, `spill`, `cellError`, `structureChange`, `workbookLoad`).

## Theming

All visuals resolve `--jects-*` CSS custom properties from `@jects/theme/base.css` — no raw colors are baked in. Conditional-format colors and cell `colorToken`/`backgroundToken` are passed as token names; override tokens on `:root` or a scoping ancestor to retheme. See [docs/modules/theme.md](../../docs/modules/theme.md).

## Accessibility

The grid is keyboard-driven (arrow-key navigation, Enter/Tab to commit, range selection) and renders into the light DOM so application ARIA and focus styling cascade in normally. Accessibility coverage is exercised with `axe-core` in the browser test suite.

## Stability & support

**Beta.** The public API is exercised by unit and browser (Playwright + axe) test suites across the formula engine, validation, conditional formatting, I/O, and UI surface, and is stabilizing toward v1; expect minor API refinement before the 1.0 release.

Part of the Jects UI suite. Commercial terms: see LICENSE.md.
