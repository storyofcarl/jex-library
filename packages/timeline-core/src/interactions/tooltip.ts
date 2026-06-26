/**
 * Tooltip hook for timeline bars and dependency lines.
 *
 * A framework-free controller that shows a hover/drag tooltip anchored to the
 * pointer. It owns a single floating element (token-pure CSS, see tooltip.css)
 * appended to a host, positioned via CSS custom properties, and shown/hidden on
 * demand. The content is produced by a caller-supplied resolver so Scheduler /
 * Gantt decide what a bar's tooltip says — this core only handles geometry,
 * show/hide debouncing, and teardown.
 *
 * No store/engine access: the controller is driven imperatively (`showAt` /
 * `hide`) by whatever owns the pointer gesture (the renderer or a drag
 * primitive). It registers no global listeners beyond what its host passes in,
 * so it can never leak.
 */

import { Disposers } from './shared.js';

/** Where a tooltip sits relative to its anchor point. */
export type TooltipPlacement = 'top' | 'bottom' | 'follow';

export interface TooltipOptions {
  /** Element the tooltip is appended to (positioned within its content box). */
  host: HTMLElement;
  /** Placement strategy. `follow` tracks the pointer; others anchor a box. */
  placement?: TooltipPlacement;
  /** Px gap between the anchor and the tooltip. Default 8. */
  offset?: number;
  /** Show delay (ms) to avoid flicker on quick passes. Default 0. */
  showDelay?: number;
  /** Extra class on the tooltip element. */
  cls?: string;
}

/** A single tooltip render request. */
export interface TooltipContent {
  /** Plain text (escaped). Use `html` for trusted rich content instead. */
  text?: string;
  /** Trusted, library-controlled HTML. */
  html?: string;
  /** Anchor point in `host`-relative coordinates. */
  x: number;
  y: number;
}

/**
 * Imperative tooltip controller. One instance owns one floating element; call
 * `showAt` to render+position, `hide` to dismiss, `destroy` to release.
 */
export class TimelineTooltip {
  private readonly el: HTMLElement;
  private readonly disposers = new Disposers();
  private readonly placement: TooltipPlacement;
  private readonly offset: number;
  private readonly showDelay: number;
  private showTimer: ReturnType<typeof setTimeout> | null = null;
  private visible = false;
  private destroyed = false;

  constructor(private readonly options: TooltipOptions) {
    this.placement = options.placement ?? 'top';
    this.offset = options.offset ?? 8;
    this.showDelay = options.showDelay ?? 0;

    const el = document.createElement('div');
    el.className = ['jects-timeline-tooltip', options.cls ?? ''].filter(Boolean).join(' ');
    // Role + hidden default; the tooltip is decorative-on-top of focusable bars.
    el.setAttribute('role', 'tooltip');
    el.dataset.placement = this.placement;
    el.hidden = true;
    this.el = el;
    this.options.host.appendChild(el);
    this.disposers.add(() => el.remove());
  }

  /** The tooltip element (for tests / styling hooks). */
  get element(): HTMLElement {
    return this.el;
  }

  get isVisible(): boolean {
    return this.visible;
  }

  /** Render content at an anchor and show (respecting `showDelay`). */
  showAt(content: TooltipContent): void {
    if (this.destroyed) return;
    this.render(content);
    if (this.showDelay > 0 && !this.visible) {
      this.clearTimer();
      this.showTimer = setTimeout(() => this.reveal(), this.showDelay);
    } else {
      this.reveal();
    }
  }

  /** Update only the anchor position (e.g. on pointermove during a drag). */
  moveTo(x: number, y: number): void {
    if (this.destroyed) return;
    this.position(x, y);
  }

  /** Hide and cancel any pending show. */
  hide(): void {
    this.clearTimer();
    if (this.destroyed) return;
    this.el.hidden = true;
    this.visible = false;
  }

  private reveal(): void {
    this.el.hidden = false;
    this.visible = true;
  }

  private clearTimer(): void {
    if (this.showTimer !== null) {
      clearTimeout(this.showTimer);
      this.showTimer = null;
    }
  }

  private render(content: TooltipContent): void {
    if (content.html !== undefined) this.el.innerHTML = content.html;
    else this.el.textContent = content.text ?? '';
    this.position(content.x, content.y);
  }

  /**
   * Position the tooltip via CSS custom properties so the stylesheet owns the
   * actual transform (keeps layout token-pure and avoids inline magic numbers
   * leaking past `--_*` private props).
   */
  private position(x: number, y: number): void {
    const style = this.el.style;
    style.setProperty('--_tt-x', `${x}px`);
    let anchorY = y;
    if (this.placement === 'top') anchorY = y - this.offset;
    else if (this.placement === 'bottom') anchorY = y + this.offset;
    style.setProperty('--_tt-y', `${anchorY}px`);
  }

  /** Release the tooltip element + timers (idempotent). */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.clearTimer();
    this.visible = false;
    this.disposers.dispose();
  }
}
