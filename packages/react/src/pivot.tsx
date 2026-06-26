/**
 * `@jects/react/pivot` — isolated React binding for the Jects PivotTable engine.
 *
 * Importing this entry pulls in ONLY `@jects/pivot` (plus the shared factory and
 * React), never any sibling engine.
 */
import { PivotTable, type PivotTableConfig, type PivotTableEvents } from '@jects/pivot';
import { createComponent } from './factory.js';

export const JectsPivot = createComponent<PivotTable, PivotTableConfig, PivotTableEvents>(
  PivotTable,
);
export type { PivotTableConfig, PivotTableEvents };
