/**
 * `@jects/react/form` — isolated React binding for the Jects Form widget.
 *
 * Importing this entry pulls in ONLY the Form symbol from `@jects/widgets`
 * (plus the shared factory and React), never any data/scheduling engine.
 */
import { Form, type FormConfig, type FormEvents } from '@jects/widgets';
import { createComponent } from './factory.js';

export const JectsForm = createComponent<Form, FormConfig, FormEvents>(Form);
export type { FormConfig, FormEvents };
