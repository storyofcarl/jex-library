/**
 * `@jects/elements/pivot` — the `<jects-pivot>` custom element only.
 * Importing this entry pulls ONLY `@jects/pivot` plus the engine-free shared factory.
 */
import { PivotTable, type PivotTableConfig, type PivotTableEvents } from '@jects/pivot';
import { createComponent, defineElements, type JectsElementDefinition } from './shared.js';

export const JectsPivotElement = createComponent<PivotTable, PivotTableConfig, PivotTableEvents>(
  PivotTable,
);

/** The `<jects-pivot>` tag paired with its element class. */
export const pivotElementDefinition: JectsElementDefinition = {
  tag: 'jects-pivot',
  ctor: JectsPivotElement,
};

/** Define `<jects-pivot>` into a registry (defaults to the global `customElements`). Idempotent. */
export function registerPivot(target?: CustomElementRegistry): void {
  defineElements([pivotElementDefinition], target);
}

export {
  createComponent,
  type JectsElement,
  type JectsElementConstructor,
  type JectsElementDefinition,
} from './shared.js';
export type { PivotTableConfig, PivotTableEvents };
