/**
 * `@jects/elements/grid` — the `<jects-grid>` custom element only.
 *
 * Importing this entry pulls ONLY `@jects/grid` (plus the engine-free shared factory),
 * never a sibling engine. Use it for an isolated install:
 *
 * ```ts
 * import { registerGrid } from '@jects/elements/grid';
 * registerGrid();
 * ```
 */
import { Grid, type GridOptions, type GridEvents } from '@jects/grid';
import { createComponent, defineElements, type JectsElementDefinition } from './shared.js';

export const JectsGridElement = createComponent<Grid, GridOptions, GridEvents>(Grid);

/** The `<jects-grid>` tag paired with its element class. */
export const gridElementDefinition: JectsElementDefinition = {
  tag: 'jects-grid',
  ctor: JectsGridElement,
};

/** Define `<jects-grid>` into a registry (defaults to the global `customElements`). Idempotent. */
export function registerGrid(target?: CustomElementRegistry): void {
  defineElements([gridElementDefinition], target);
}

export {
  createComponent,
  type JectsElement,
  type JectsElementConstructor,
  type JectsElementDefinition,
} from './shared.js';
export type { GridOptions, GridEvents };
