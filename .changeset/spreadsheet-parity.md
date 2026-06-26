---
'@jects/spreadsheet': minor
---

Close audited enterprise-parity gaps in `@jects/spreadsheet` (Excel/Sheets-class):

- **Data validation** is now enforced on the edit path — invalid input is vetoed (emitting
  `editRejected`) and `list` rules render a native `<select>` dropdown editor.
- **Conditional formatting**: `SheetModel.conditionalFormats` (`cellValue` / `colorScale` /
  `dataBar` / `expression`) evaluated live in the grid, with `addConditionalFormat` /
  `clearConditionalFormats`.
- **Real `.xlsx` (OOXML)** read + write — a genuine zipped package (worksheets, sharedStrings,
  styles) capturing values, formulas, number formats, merges, frozen panes, and named ranges —
  via `exportXlsx()` / `importXlsx()` (legacy SpreadsheetML still at `exportTo('xlsx')`).
- **Named ranges**: `defineName` / `deleteName` / `listNames`, usable in formulas + recalculated.
- **Sort / filter**: `sortRange` (stable) + `applyFilter` / `clearFilter`, plus a column-header
  sort/filter affordance.
- **Comments / notes**: `CellModel.comment` + `setComment` / `getComment`, indicator + serialization.
- **Embedded charts**: `insertChart(range, { type })` mounts a `@jects/charts` `Chart` from range
  data as a floating object.
- **Drag fill-handle**: implemented over `fillSeries` / `fillBlock` (`fillTo`), no longer a no-op.
- **Cell protection**: `SheetModel.protected` + `CellModel.locked`, `setSheetProtected` /
  `setCellsLocked`, with edit veto + UI.
