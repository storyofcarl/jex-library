/**
 * `@jects/elements/charts` — the `<jects-chart>` custom element only.
 * Importing this entry pulls ONLY `@jects/charts` plus the engine-free shared factory.
 */
import { Chart, type ChartConfig, type ChartEvents } from '@jects/charts';
import { createComponent, defineElements, type JectsElementDefinition } from './shared.js';

export const JectsChartElement = createComponent<Chart, ChartConfig, ChartEvents>(Chart);

/** The `<jects-chart>` tag paired with its element class. */
export const chartElementDefinition: JectsElementDefinition = {
  tag: 'jects-chart',
  ctor: JectsChartElement,
};

/** Define `<jects-chart>` into a registry (defaults to the global `customElements`). Idempotent. */
export function registerChart(target?: CustomElementRegistry): void {
  defineElements([chartElementDefinition], target);
}

export {
  createComponent,
  type JectsElement,
  type JectsElementConstructor,
  type JectsElementDefinition,
} from './shared.js';
export type { ChartConfig, ChartEvents };
