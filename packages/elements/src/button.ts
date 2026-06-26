/**
 * `@jects/elements/button` — the `<jects-button>` custom element only.
 * Importing this entry pulls ONLY `@jects/widgets` plus the engine-free shared factory.
 */
import { Button, type ButtonConfig, type ButtonEvents } from '@jects/widgets';
import { createComponent, defineElements, type JectsElementDefinition } from './shared.js';

export const JectsButtonElement = createComponent<Button, ButtonConfig, ButtonEvents>(Button);

/** The `<jects-button>` tag paired with its element class. */
export const buttonElementDefinition: JectsElementDefinition = {
  tag: 'jects-button',
  ctor: JectsButtonElement,
};

/** Define `<jects-button>` into a registry (defaults to the global `customElements`). Idempotent. */
export function registerButton(target?: CustomElementRegistry): void {
  defineElements([buttonElementDefinition], target);
}

export {
  createComponent,
  type JectsElement,
  type JectsElementConstructor,
  type JectsElementDefinition,
} from './shared.js';
export type { ButtonConfig, ButtonEvents };
