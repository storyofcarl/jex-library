/**
 * @jects/widgets/pickers — color and file pickers.
 *
 * Additive subpath barrel. Importing this entry pulls in ONLY the `pickers`
 * family code (plus the shared anchored-panel positioning leaf the color picker
 * references), never the whole widget kit. Side-effect CSS still lives in
 * `@jects/widgets/style.css`.
 */

export {
  ColorPicker,
  type ColorPickerConfig,
  type ColorPickerEvents,
  parseHex,
} from './pickers/color-picker.js';

export {
  FilePicker,
  type FilePickerConfig,
  type FilePickerEvents,
  type VaultFile,
  formatBytes,
} from './pickers/file-picker.js';
