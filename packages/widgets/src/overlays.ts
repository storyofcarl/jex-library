/**
 * @jects/widgets/overlays — floating surfaces: window/dialog/mask/popup/tooltip.
 *
 * Additive subpath barrel. Importing this entry pulls in ONLY the overlay/window
 * surfaces (plus any shared leaf they reference), never the whole widget kit.
 * Side-effect CSS still lives in `@jects/widgets/style.css`.
 */

export {
  Tooltip,
  type TooltipConfig,
  type TooltipEvents,
  type TooltipPlacement,
} from './overlays/tooltip.js';

export {
  Popup,
  type PopupConfig,
  type PopupEvents,
  type PopupPlacement,
  type PopupAlign,
  type PopupCloseReason,
} from './overlays/popup.js';

export { Mask, type MaskConfig, type MaskEvents } from './overlays/mask.js';

export {
  Window,
  type WindowConfig,
  type WindowEvents,
  type WindowCloseReason,
  type ResizeEdge,
} from './windows/window.js';

export {
  Dialog,
  type DialogConfig,
  type DialogEvents,
  type DialogAction,
} from './windows/dialog.js';
