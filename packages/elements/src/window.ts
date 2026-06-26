/**
 * `@jects/elements/window` — the `<jects-window>` custom element only.
 * Importing this entry pulls ONLY `@jects/widgets` plus the engine-free shared factory.
 */
import { Window, type WindowConfig, type WindowEvents } from '@jects/widgets';
import { createComponent, defineElements, type JectsElementDefinition } from './shared.js';

export const JectsWindowElement = createComponent<Window, WindowConfig, WindowEvents>(Window);

/** The `<jects-window>` tag paired with its element class. */
export const windowElementDefinition: JectsElementDefinition = {
  tag: 'jects-window',
  ctor: JectsWindowElement,
};

/** Define `<jects-window>` into a registry (defaults to the global `customElements`). Idempotent. */
export function registerWindow(target?: CustomElementRegistry): void {
  defineElements([windowElementDefinition], target);
}

export {
  createComponent,
  type JectsElement,
  type JectsElementConstructor,
  type JectsElementDefinition,
} from './shared.js';
export type { WindowConfig, WindowEvents };
