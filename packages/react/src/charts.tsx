/**
 * `@jects/react/charts` — isolated React binding for the Jects Chart engine.
 *
 * Importing this entry pulls in ONLY `@jects/charts` (plus the shared factory and
 * React), never any sibling engine.
 */
import { Chart, type ChartConfig, type ChartEvents } from '@jects/charts';
import { createComponent } from './factory.js';

export const JectsChart = createComponent<Chart, ChartConfig, ChartEvents>(Chart);
export type { ChartConfig, ChartEvents };
