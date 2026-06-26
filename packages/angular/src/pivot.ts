/**
 * `@jects/angular/pivot` — typed Angular standalone binding for the {@link PivotTable} engine.
 *
 * Importing this subpath pulls in `@jects/pivot` and the shared factory only, never a
 * sibling engine. Use the root `@jects/angular` entry for the whole suite.
 */
import { createComponent } from './factory.js';
import { PivotTable, type PivotTableConfig, type PivotTableEvents } from '@jects/pivot';

export const JectsPivot = createComponent<PivotTable, PivotTableConfig, PivotTableEvents>(
  PivotTable,
  { selector: 'jects-pivot' },
);

export type { PivotTableConfig, PivotTableEvents };
