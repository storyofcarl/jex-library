/**
 * `@jects/angular/spreadsheet` — typed Angular standalone binding for the {@link Spreadsheet} engine.
 *
 * Importing this subpath pulls in `@jects/spreadsheet` and the shared factory only, never a
 * sibling engine. Use the root `@jects/angular` entry for the whole suite.
 */
import { createComponent } from './factory.js';
import { Spreadsheet, type SpreadsheetConfig, type SpreadsheetEvents } from '@jects/spreadsheet';

export const JectsSpreadsheet = createComponent<Spreadsheet, SpreadsheetConfig, SpreadsheetEvents>(
  Spreadsheet,
  { selector: 'jects-spreadsheet' },
);

export type { SpreadsheetConfig, SpreadsheetEvents };
