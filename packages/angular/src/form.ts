/**
 * `@jects/angular/form` — typed Angular standalone binding for the {@link Form} widget.
 *
 * Importing this subpath pulls in `@jects/widgets` and the shared factory only, never a
 * data/scheduling engine (grid, gantt, …). Use the root `@jects/angular` entry for the
 * whole suite.
 */
import { createComponent } from './factory.js';
import { Form, type FormConfig, type FormEvents } from '@jects/widgets';

export const JectsForm = createComponent<Form, FormConfig, FormEvents>(Form, {
  selector: 'jects-form',
});

export type { FormConfig, FormEvents };
