/**
 * `@jects/react/spreadsheet` — isolated React binding for the Jects Spreadsheet engine.
 *
 * Importing this entry pulls in ONLY `@jects/spreadsheet` (plus the shared factory and
 * React), never any sibling engine.
 */
import { Spreadsheet, type SpreadsheetConfig, type SpreadsheetEvents } from '@jects/spreadsheet';
import { createComponent } from './factory.js';

export const JectsSpreadsheet = createComponent<Spreadsheet, SpreadsheetConfig, SpreadsheetEvents>(
  Spreadsheet,
);
export type { SpreadsheetConfig, SpreadsheetEvents };
