/**
 * `@jects/react/textfield` — isolated React binding for the Jects TextField widget.
 *
 * Importing this entry pulls in ONLY the TextField symbol from `@jects/widgets`
 * (plus the shared factory and React), never any data/scheduling engine.
 */
import { TextField, type TextFieldConfig, type TextFieldEvents } from '@jects/widgets';
import { createComponent } from './factory.js';

export const JectsTextField = createComponent<TextField, TextFieldConfig, TextFieldEvents>(
  TextField,
);
export type { TextFieldConfig, TextFieldEvents };
