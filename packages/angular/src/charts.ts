/**
 * `@jects/angular/charts` — typed Angular standalone binding for the {@link Chart} engine.
 *
 * Importing this subpath pulls in `@jects/charts` and the shared factory only, never a
 * sibling engine. Use the root `@jects/angular` entry for the whole suite.
 */
import { createComponent } from './factory.js';
import { Chart, type ChartConfig, type ChartEvents } from '@jects/charts';

export const JectsChart = createComponent<Chart, ChartConfig, ChartEvents>(Chart, {
  selector: 'jects-chart',
});

export type { ChartConfig, ChartEvents };
