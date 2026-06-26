/**
 * positionAnchoredPanel — shared fixed-position anchoring for portaled panels.
 *
 * Picker dropdowns (calendar, color popover, listbox) are portaled to
 * `document.body` so they ESCAPE any `overflow:hidden`/`clip` ancestor of the
 * field. Once at body level they must be positioned manually against their
 * anchor. This helper computes a `position:fixed` placement on one side of the
 * anchor, flips to the opposite side on viewport collision, and clamps the panel
 * into the viewport — the same strategy the `Popup` overlay uses, factored out so
 * every picker shares one implementation.
 *
 * Self-contained: depends only on the DOM.
 */

export type AnchoredSide = 'top' | 'bottom' | 'left' | 'right';
export type AnchoredAlign = 'start' | 'center' | 'end';

export interface AnchoredPanelOptions {
  /** Side of the anchor to place the panel on. Default `bottom`. */
  placement?: AnchoredSide;
  /** Cross-axis alignment along the chosen side. Default `start`. */
  align?: AnchoredAlign;
  /** Gap (px) between anchor and panel. Default `4`. */
  offset?: number;
  /** Flip to the opposite side on viewport collision. Default `true`. */
  flip?: boolean;
  /** Match the panel's min-width to the anchor width. Default `false`. */
  matchAnchorWidth?: boolean;
}

/**
 * Position `panel` (already mounted, typically on `document.body`) against
 * `anchor` using `position:fixed`. Returns the resolved side actually used (may
 * differ from the requested placement after a flip) so callers can reflect it.
 */
export function positionAnchoredPanel(
  panel: HTMLElement,
  anchor: HTMLElement,
  options: AnchoredPanelOptions = {},
): AnchoredSide {
  const {
    placement = 'bottom',
    align = 'start',
    offset = 4,
    flip = true,
    matchAnchorWidth = false,
  } = options;

  panel.style.position = 'fixed';
  if (matchAnchorWidth) {
    panel.style.minWidth = `${Math.round(anchor.getBoundingClientRect().width)}px`;
  }

  const a = anchor.getBoundingClientRect();
  const pw = panel.offsetWidth;
  const ph = panel.offsetHeight;
  const vw = window.innerWidth || document.documentElement.clientWidth;
  const vh = window.innerHeight || document.documentElement.clientHeight;

  let side: AnchoredSide = placement;
  if (flip) {
    if (placement === 'bottom' && a.bottom + offset + ph > vh && a.top - offset - ph >= 0)
      side = 'top';
    else if (placement === 'top' && a.top - offset - ph < 0 && a.bottom + offset + ph <= vh)
      side = 'bottom';
    else if (placement === 'right' && a.right + offset + pw > vw && a.left - offset - pw >= 0)
      side = 'left';
    else if (placement === 'left' && a.left - offset - pw < 0 && a.right + offset + pw <= vw)
      side = 'right';
  }

  let top = 0;
  let left = 0;
  if (side === 'top' || side === 'bottom') {
    top = side === 'bottom' ? a.bottom + offset : a.top - offset - ph;
    if (align === 'end') left = a.right - pw;
    else if (align === 'center') left = a.left + (a.width - pw) / 2;
    else left = a.left;
  } else {
    left = side === 'right' ? a.right + offset : a.left - offset - pw;
    if (align === 'end') top = a.bottom - ph;
    else if (align === 'center') top = a.top + (a.height - ph) / 2;
    else top = a.top;
  }

  // Clamp into the viewport so the panel never sits off-screen.
  left = Math.max(0, Math.min(left, Math.max(0, vw - pw)));
  top = Math.max(0, Math.min(top, Math.max(0, vh - ph)));

  panel.style.left = `${Math.round(left)}px`;
  panel.style.top = `${Math.round(top)}px`;
  panel.setAttribute('data-placement', side);
  return side;
}
