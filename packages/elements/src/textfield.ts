/**
 * `@jects/elements/textfield` — the `<jects-text-field>` custom element only.
 * Importing this entry pulls ONLY `@jects/widgets` plus the engine-free shared factory.
 */
import { TextField, type TextFieldConfig, type TextFieldEvents } from '@jects/widgets';
import { createComponent, defineElements, type JectsElementDefinition } from './shared.js';

export const JectsTextFieldElement = createComponent<TextField, TextFieldConfig, TextFieldEvents>(
  TextField,
);

/** The `<jects-text-field>` tag paired with its element class. */
export const textFieldElementDefinition: JectsElementDefinition = {
  tag: 'jects-text-field',
  ctor: JectsTextFieldElement,
};

/** Define `<jects-text-field>` into a registry (defaults to the global `customElements`). Idempotent. */
export function registerTextField(target?: CustomElementRegistry): void {
  defineElements([textFieldElementDefinition], target);
}

export {
  createComponent,
  type JectsElement,
  type JectsElementConstructor,
  type JectsElementDefinition,
} from './shared.js';
export type { TextFieldConfig, TextFieldEvents };
