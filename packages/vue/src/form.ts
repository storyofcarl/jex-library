/**
 * `@jects/vue/form` — typed Vue 3 binding for the `@jects/widgets` {@link Form} only.
 *
 * Imports only the shared factory and the `@jects/widgets` engine.
 */
import { createComponent } from './factory.js';
import { Form, type FormConfig, type FormEvents } from '@jects/widgets';

export const JectsForm = createComponent<Form, FormConfig, FormEvents>(Form);

export type { FormConfig, FormEvents };
