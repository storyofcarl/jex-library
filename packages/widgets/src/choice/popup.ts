/**
 * Local minimal anchored popup used by Select and ComboBox. Self-contained to
 * this cluster (the wave forbids cross-cluster imports). NOT a public widget —
 * just a tiny positioning + outside-click + escape helper.
 *
 * It appends the panel to document.body (escaping any clipping/overflow
 * ancestor of the field), positions it `fixed` under the anchor with collision
 * flip, and wires outside-click / Escape / scroll-reposition. Call open() to
 * mount, close() to unmount, destroy() to fully tear down.
 */

import { positionAnchoredPanel } from '../overlays/anchored-panel.js';

export interface PopupOptions {
  anchor: HTMLElement;
  panel: HTMLElement;
  /** Called when the popup requests close (outside click / Escape). */
  onRequestClose: () => void;
}

export class Popup {
  private readonly anchor: HTMLElement;
  readonly panel: HTMLElement;
  private readonly onRequestClose: () => void;
  private open_ = false;
  private destroyed_ = false;
  private readonly boundDocPointer: (e: MouseEvent) => void;
  private readonly boundKeydown: (e: KeyboardEvent) => void;
  private readonly boundReposition: () => void;

  constructor(opts: PopupOptions) {
    this.anchor = opts.anchor;
    this.panel = opts.panel;
    this.onRequestClose = opts.onRequestClose;
    this.panel.classList.add('jects-popup');
    this.panel.style.position = 'fixed';
    this.boundDocPointer = (e) => this.handleDocPointer(e);
    this.boundKeydown = (e) => this.handleKeydown(e);
    this.boundReposition = () => this.reposition();
  }

  get isOpen(): boolean {
    return this.open_;
  }

  open(): void {
    if (this.destroyed_ || this.open_) return;
    this.open_ = true;
    document.body.appendChild(this.panel);
    this.reposition();
    // Defer listener attach so the opening click doesn't immediately close it.
    setTimeout(() => {
      if (!this.open_) return;
      document.addEventListener('pointerdown', this.boundDocPointer, true);
    }, 0);
    document.addEventListener('keydown', this.boundKeydown, true);
    window.addEventListener('resize', this.boundReposition);
    window.addEventListener('scroll', this.boundReposition, true);
  }

  close(): void {
    if (!this.open_) return;
    this.open_ = false;
    document.removeEventListener('pointerdown', this.boundDocPointer, true);
    document.removeEventListener('keydown', this.boundKeydown, true);
    window.removeEventListener('resize', this.boundReposition);
    window.removeEventListener('scroll', this.boundReposition, true);
    this.panel.remove();
  }

  reposition(): void {
    if (this.destroyed_ || !this.open_) return;
    // Fixed positioning against the anchor with collision flip + viewport clamp,
    // matching the anchor width so the dropdown is at least as wide as the field.
    positionAnchoredPanel(this.panel, this.anchor, {
      placement: 'bottom',
      align: 'start',
      offset: 4,
      matchAnchorWidth: true,
    });
  }

  private handleDocPointer(e: MouseEvent): void {
    if (this.destroyed_ || !this.open_) return;
    const target = e.target as Node;
    if (this.anchor.contains(target) || this.panel.contains(target)) return;
    this.onRequestClose();
  }

  private handleKeydown(e: KeyboardEvent): void {
    if (this.destroyed_ || !this.open_) return;
    if (e.key === 'Escape' && this.open_) {
      e.stopPropagation();
      this.onRequestClose();
    }
  }

  destroy(): void {
    this.close();
    this.destroyed_ = true;
  }
}
