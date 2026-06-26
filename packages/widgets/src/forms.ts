/**
 * @jects/widgets/forms — form orchestration widgets.
 *
 * Additive subpath barrel. Importing this entry pulls in ONLY the `forms`
 * family code (plus any shared leaf the family itself references), never the
 * whole widget kit. Side-effect CSS still lives in `@jects/widgets/style.css`.
 */

export {
  Form,
  type FormConfig,
  type FormEvents,
  type FieldControl,
  type FieldValue,
  type FormValues,
  type RuleResult,
  type FieldRules,
  type FieldSchema,
  type FieldCondition,
  type FormFieldset,
  type FormLayout,
  type ValidationResult,
} from './forms/form.js';

export {
  TagsField,
  type TagsFieldConfig,
  type TagsFieldEvents,
} from './forms/tags-field.js';
