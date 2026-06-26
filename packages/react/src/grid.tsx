/**
 * `@jects/react/grid` — isolated React binding for the Jects Grid engine.
 *
 * Importing this entry pulls in ONLY `@jects/grid` (plus the shared factory and
 * React), never any sibling engine. Use it to keep a grid-only install lean.
 */
import { Grid, type GridOptions, type GridEvents } from '@jects/grid';
import { createComponent } from './factory.js';

export const JectsGrid = createComponent<Grid, GridOptions, GridEvents>(Grid);
export type { GridOptions, GridEvents };
