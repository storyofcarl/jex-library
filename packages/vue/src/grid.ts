/**
 * `@jects/vue/grid` — typed Vue 3 binding for {@link Grid} only.
 *
 * This entry imports the shared factory and the `@jects/grid` engine and nothing
 * else, so a consumer of `@jects/vue/grid` never pulls in sibling engines
 * (`@jects/gantt`, `@jects/scheduler`, …) through the bundler.
 */
import { createComponent } from './factory.js';
import { Grid, type GridOptions, type GridEvents } from '@jects/grid';

export const JectsGrid = createComponent<Grid, GridOptions, GridEvents>(Grid);

export type { GridOptions, GridEvents };
