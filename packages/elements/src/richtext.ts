/**
 * `@jects/elements/richtext` — the `<jects-rich-text>` custom element only.
 * Importing this entry pulls ONLY `@jects/widgets` plus the engine-free shared factory.
 */
import { RichText, type RichTextConfig, type RichTextEvents } from '@jects/widgets';
import { createComponent, defineElements, type JectsElementDefinition } from './shared.js';

export const JectsRichTextElement = createComponent<RichText, RichTextConfig, RichTextEvents>(
  RichText,
);

/** The `<jects-rich-text>` tag paired with its element class. */
export const richTextElementDefinition: JectsElementDefinition = {
  tag: 'jects-rich-text',
  ctor: JectsRichTextElement,
};

/** Define `<jects-rich-text>` into a registry (defaults to the global `customElements`). Idempotent. */
export function registerRichText(target?: CustomElementRegistry): void {
  defineElements([richTextElementDefinition], target);
}

export {
  createComponent,
  type JectsElement,
  type JectsElementConstructor,
  type JectsElementDefinition,
} from './shared.js';
export type { RichTextConfig, RichTextEvents };
