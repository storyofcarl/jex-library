/**
 * `@jects/vue/spreadsheet` — typed Vue 3 binding for {@link Spreadsheet} only.
 *
 * Imports only the shared factory and the `@jects/spreadsheet` engine.
 */
import { createComponent } from './factory.js';
import { Spreadsheet, type SpreadsheetConfig, type SpreadsheetEvents } from '@jects/spreadsheet';

export const JectsSpreadsheet = createComponent<Spreadsheet, SpreadsheetConfig, SpreadsheetEvents>(
  Spreadsheet,
);

export type { SpreadsheetConfig, SpreadsheetEvents };
