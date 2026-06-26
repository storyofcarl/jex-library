/**
 * `@jects/elements/select` — the `<jects-select>` custom element only.
 * Importing this entry pulls ONLY `@jects/widgets` plus the engine-free shared factory.
 */
import { Select, type SelectConfig, type SelectEvents } from '@jects/widgets';
import { createComponent, defineElements, type JectsElementDefinition } from './shared.js';

export const JectsSelectElement = createComponent<Select, SelectConfig, SelectEvents>(Select);

/** The `<jects-select>` tag paired with its element class. */
export const selectElementDefinition: JectsElementDefinition = {
  tag: 'jects-select',
  ctor: JectsSelectElement,
};

/** Define `<jects-select>` into a registry (defaults to the global `customElements`). Idempotent. */
export function registerSelect(target?: CustomElementRegistry): void {
  defineElements([selectElementDefinition], target);
}

export {
  createComponent,
  type JectsElement,
  type JectsElementConstructor,
  type JectsElementDefinition,
} from './shared.js';
export type { SelectConfig, SelectEvents };
