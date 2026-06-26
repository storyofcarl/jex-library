/**
 * `@jects/react/richtext` — isolated React binding for the Jects RichText widget.
 *
 * Importing this entry pulls in ONLY the RichText symbol from `@jects/widgets`
 * (plus the shared factory and React), never any data/scheduling engine.
 */
import { RichText, type RichTextConfig, type RichTextEvents } from '@jects/widgets';
import { createComponent } from './factory.js';

export const JectsRichText = createComponent<RichText, RichTextConfig, RichTextEvents>(RichText);
export type { RichTextConfig, RichTextEvents };
