/**
 * @jects/widgets/rich-text — the rich text editor widget.
 *
 * Additive subpath barrel. Importing this entry pulls in ONLY the rich-text
 * family code, never the whole widget kit. Side-effect CSS still lives in
 * `@jects/widgets/style.css`.
 */

export {
  RichText,
  type RichTextConfig,
  type RichTextEvents,
  type RichTextCommand,
  type RichTextToolbarItem,
  type RichTextStats,
  sanitizeHtml,
} from './richtext/rich-text.js';
