/**
 * @jects/pivot table barrel — the rendering layer: the `PivotTable` widget plus
 * the projection helpers that map a computed `PivotResult` onto `@jects/grid`
 * columns/rows.
 *
 * This area depends on the framework-free `engine/` area (for `PivotResult` and
 * the conditional-format types) and on the `@jects/core` / `@jects/grid` peers,
 * but does NOT pull the package hub (`src/index.ts`).
 */

export {
  projectColumns,
  projectRows,
  leafHeader,
  PIVOT_META,
  type PivotGridRow,
  type PivotCellTemplate,
  type ProjectOptions,
} from './project.js';

export {
  PivotTable,
  type PivotTableConfig,
  type PivotTableEvents,
  type PivotAxis,
  type PivotFieldSpec,
} from './pivot-table.js';
