/**
 * `@jects/elements/form` — the `<jects-form>` custom element only.
 * Importing this entry pulls ONLY `@jects/widgets` plus the engine-free shared factory.
 */
import { Form, type FormConfig, type FormEvents } from '@jects/widgets';
import { createComponent, defineElements, type JectsElementDefinition } from './shared.js';

export const JectsFormElement = createComponent<Form, FormConfig, FormEvents>(Form);

/** The `<jects-form>` tag paired with its element class. */
export const formElementDefinition: JectsElementDefinition = {
  tag: 'jects-form',
  ctor: JectsFormElement,
};

/** Define `<jects-form>` into a registry (defaults to the global `customElements`). Idempotent. */
export function registerForm(target?: CustomElementRegistry): void {
  defineElements([formElementDefinition], target);
}

export {
  createComponent,
  type JectsElement,
  type JectsElementConstructor,
  type JectsElementDefinition,
} from './shared.js';
export type { FormConfig, FormEvents };
