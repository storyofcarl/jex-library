/**
 * `@jects/vue/richtext` — typed Vue 3 binding for the `@jects/widgets` {@link RichText} only.
 *
 * Imports only the shared factory and the `@jects/widgets` engine.
 */
import { createComponent } from './factory.js';
import { RichText, type RichTextConfig, type RichTextEvents } from '@jects/widgets';

export const JectsRichText = createComponent<RichText, RichTextConfig, RichTextEvents>(RichText);

export type { RichTextConfig, RichTextEvents };
