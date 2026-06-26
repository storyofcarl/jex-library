/**
 * `@jects/vue/textfield` — typed Vue 3 binding for the `@jects/widgets` {@link TextField} only.
 *
 * Imports only the shared factory and the `@jects/widgets` engine.
 */
import { createComponent } from './factory.js';
import { TextField, type TextFieldConfig, type TextFieldEvents } from '@jects/widgets';

export const JectsTextField = createComponent<TextField, TextFieldConfig, TextFieldEvents>(
  TextField,
);

export type { TextFieldConfig, TextFieldEvents };
