/**
 * `@jects/angular/grid` — typed Angular standalone binding for the {@link Grid} engine.
 *
 * Import this subpath when you only use the grid: it pulls in `@jects/grid` and the
 * shared factory **only**, never any sibling engine (gantt, scheduler, …). Use the
 * root `@jects/angular` entry instead if you want the whole suite in one import.
 */
import { createComponent } from './factory.js';
import { Grid, type GridOptions, type GridEvents } from '@jects/grid';

export const JectsGrid = createComponent<Grid, GridOptions, GridEvents>(Grid, {
  selector: 'jects-grid',
});

export type { GridOptions, GridEvents };
