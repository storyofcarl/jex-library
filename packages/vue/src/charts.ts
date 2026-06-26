/**
 * `@jects/vue/charts` — typed Vue 3 binding for the `@jects/charts` {@link Chart} only.
 *
 * Imports only the shared factory and the `@jects/charts` engine.
 */
import { createComponent } from './factory.js';
import { Chart, type ChartConfig, type ChartEvents } from '@jects/charts';

export const JectsChart = createComponent<Chart, ChartConfig, ChartEvents>(Chart);

export type { ChartConfig, ChartEvents };
