/**
 * `@jects/elements/spreadsheet` — the `<jects-spreadsheet>` custom element only.
 * Importing this entry pulls ONLY `@jects/spreadsheet` plus the engine-free shared factory.
 */
import { Spreadsheet, type SpreadsheetConfig, type SpreadsheetEvents } from '@jects/spreadsheet';
import { createComponent, defineElements, type JectsElementDefinition } from './shared.js';

export const JectsSpreadsheetElement = createComponent<
  Spreadsheet,
  SpreadsheetConfig,
  SpreadsheetEvents
>(Spreadsheet);

/** The `<jects-spreadsheet>` tag paired with its element class. */
export const spreadsheetElementDefinition: JectsElementDefinition = {
  tag: 'jects-spreadsheet',
  ctor: JectsSpreadsheetElement,
};

/** Define `<jects-spreadsheet>` into a registry (defaults to the global `customElements`). Idempotent. */
export function registerSpreadsheet(target?: CustomElementRegistry): void {
  defineElements([spreadsheetElementDefinition], target);
}

export {
  createComponent,
  type JectsElement,
  type JectsElementConstructor,
  type JectsElementDefinition,
} from './shared.js';
export type { SpreadsheetConfig, SpreadsheetEvents };
