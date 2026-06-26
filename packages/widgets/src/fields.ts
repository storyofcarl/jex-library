/**
 * @jects/widgets/fields — text-ish input/display fields.
 *
 * Additive subpath barrel. Importing this entry pulls in ONLY the `fields`
 * family code, never the whole widget kit. Side-effect CSS still lives in
 * `@jects/widgets/style.css`.
 */

export {
  TextField,
  type TextFieldConfig,
  type TextFieldEvents,
  type FieldSize,
} from './fields/text-field.js';

export {
  NumberField,
  type NumberFieldConfig,
  type NumberFieldEvents,
} from './fields/number-field.js';

export {
  TextArea,
  type TextAreaConfig,
  type TextAreaEvents,
} from './fields/text-area.js';

export {
  DisplayField,
  type DisplayFieldConfig,
  type DisplayFieldEvents,
} from './fields/display-field.js';

export { Label, type LabelConfig, type LabelEvents } from './fields/label.js';

export {
  Link,
  type LinkConfig,
  type LinkEvents,
  type LinkVariant,
} from './fields/link.js';
