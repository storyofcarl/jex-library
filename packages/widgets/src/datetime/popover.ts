/**
 * Anchored popover used by the Date & time cluster (DatePicker calendar).
 *
 * It portals its panel to `document.body` while open so the panel ESCAPES any
 * `overflow:hidden`/`clip` ancestor of the field (previously it rendered inline
 * under the anchor and was clipped — Gallery feedback #3 / #5). While open it is
 * positioned `fixed` against the anchor with collision flip, repositions on
 * scroll/resize, and closes on outside-click and Escape. While closed the panel
 * returns to its original parent so the owning widget keeps DOM ownership for
 * setup and teardown.
 *
 * Not a Widget — a tiny controller around a single panel element.
 */

import { createEl, type Unbind } from '@jects/core';
import { positionAnchoredPanel } from '../overlays/anchored-panel.js';

export interface PopoverOptions {
  /** The element the popover is anchored beneath. */
  anchor: HTMLElement;
  /** Called when the popover requests close (outside click / Escape). */
  onClose: () => void;
}

export class Popover {
  /** The panel element; populate its contents after construction. */
  readonly panel: HTMLElement;
  private readonly anchor: HTMLElement;
  private readonly onClose: () => void;
  private disposers: Unbind[] = [];
  private open = false;
  /** Original parent (and next sibling) so the panel can be returned on hide. */
  private homeParent: Node | null = null;
  private homeNext: Node | null = null;

  constructor(options: PopoverOptions) {
    this.anchor = options.anchor;
    this.onClose = options.onClose;
    this.panel = createEl('div', {
      className: 'jects-dt-popover',
      attrs: { role: 'dialog', 'aria-modal': 'false', hidden: true },
    });
  }

  /** Show the panel anchored to the trigger and wire dismiss listeners. */
  show(): void {
    if (this.open) return;
    this.open = true;

    // Remember where the panel lives so we can restore it on hide, then portal it
    // to the body layer so it escapes any clipping/overflow ancestor.
    this.homeParent = this.panel.parentNode;
    this.homeNext = this.panel.nextSibling;
    document.body.appendChild(this.panel);

    this.panel.hidden = false;
    this.position();

    const onDocPointer = (e: Event): void => {
      const t = e.target as Node;
      if (!this.panel.contains(t) && !this.anchor.contains(t)) this.onClose();
    };
    const onKeydown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        this.onClose();
      }
    };
    const onReposition = (): void => this.position();
    // Defer the document listener so the opening click doesn't immediately close it.
    const id = setTimeout(() => {
      document.addEventListener('pointerdown', onDocPointer, true);
    }, 0);
    this.panel.addEventListener('keydown', onKeydown);
    window.addEventListener('resize', onReposition);
    window.addEventListener('scroll', onReposition, true);
    this.disposers.push(
      () => {
        clearTimeout(id);
        document.removeEventListener('pointerdown', onDocPointer, true);
      },
      () => this.panel.removeEventListener('keydown', onKeydown),
      () => window.removeEventListener('resize', onReposition),
      () => window.removeEventListener('scroll', onReposition, true),
    );
  }

  /** Hide the panel, detach dismiss listeners, and return it to its home parent. */
  hide(): void {
    if (!this.open) return;
    this.open = false;
    this.panel.hidden = true;
    for (const d of this.disposers.splice(0)) d();
    // Return the panel to where it lived so the owner retains DOM ownership.
    if (this.homeParent) {
      this.homeParent.insertBefore(this.panel, this.homeNext);
    } else {
      this.panel.remove();
    }
    this.homeParent = null;
    this.homeNext = null;
  }

  get isOpen(): boolean {
    return this.open;
  }

  /** Position the portaled panel against the anchor (fixed, with flip + clamp). */
  private position(): void {
    if (!this.open) return;
    positionAnchoredPanel(this.panel, this.anchor, { placement: 'bottom', align: 'start', offset: 4 });
  }

  /** Tear down the popover entirely. */
  destroy(): void {
    this.hide();
    this.panel.remove();
  }
}
