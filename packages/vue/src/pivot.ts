/**
 * `@jects/vue/pivot` — typed Vue 3 binding for the `@jects/pivot` {@link PivotTable} only.
 *
 * Imports only the shared factory and the `@jects/pivot` engine.
 */
import { createComponent } from './factory.js';
import { PivotTable, type PivotTableConfig, type PivotTableEvents } from '@jects/pivot';

export const JectsPivot = createComponent<PivotTable, PivotTableConfig, PivotTableEvents>(
  PivotTable,
);

export type { PivotTableConfig, PivotTableEvents };
