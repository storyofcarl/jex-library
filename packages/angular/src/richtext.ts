/**
 * `@jects/angular/richtext` — typed Angular standalone binding for the {@link RichText} widget.
 *
 * Importing this subpath pulls in `@jects/widgets` and the shared factory only, never a
 * data/scheduling engine (grid, gantt, …). Use the root `@jects/angular` entry for the
 * whole suite.
 */
import { createComponent } from './factory.js';
import { RichText, type RichTextConfig, type RichTextEvents } from '@jects/widgets';

export const JectsRichText = createComponent<RichText, RichTextConfig, RichTextEvents>(RichText, {
  selector: 'jects-rich-text',
});

export type { RichTextConfig, RichTextEvents };
