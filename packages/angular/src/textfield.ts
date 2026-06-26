/**
 * `@jects/angular/textfield` — typed Angular standalone binding for the {@link TextField} widget.
 *
 * Importing this subpath pulls in `@jects/widgets` and the shared factory only, never a
 * data/scheduling engine (grid, gantt, …). Use the root `@jects/angular` entry for the
 * whole suite.
 */
import { createComponent } from './factory.js';
import { TextField, type TextFieldConfig, type TextFieldEvents } from '@jects/widgets';

export const JectsTextField = createComponent<TextField, TextFieldConfig, TextFieldEvents>(
  TextField,
  { selector: 'jects-text-field' },
);

export type { TextFieldConfig, TextFieldEvents };
