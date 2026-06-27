/**
 * Tooltip — a small text bubble shown on hover / focus of a target element.
 *
 * Shows after a configurable delay on pointer-enter or focus, hides on
 * pointer-leave / blur / Escape. Positioned on one of four sides of the target
 * with viewport clamping. Self-contained (depends only on `@jects/core`).
 *
 * NOTE: `super()` runs `buildEl()` before subclass field initializers, so the
 * target's DOM listeners are wired with bound methods inside `buildEl()`.
 */

import {
  Widget,
  type WidgetConfig,
  type WidgetEvents,
  createEl,
  register,
  setHtml,
  safeHtml,
  trustedHtml,
} from '@jects/core';

export type TooltipPlacement = 'top' | 'bottom' | 'left' | 'right';

export interface TooltipConfig extends WidgetConfig {
  /** Element the tooltip describes. Hover/focus on it shows the bubble. */
  target?: HTMLElement;
  /** Tooltip text. */
  text?: string;
  /**
   * HTML content (used when `text` is not given). Sanitized through the shared
   * `@jects/core` allow-list sanitizer before insertion. Set `trusted: true`
   * only when the markup is author-controlled and must bypass sanitization.
   */
  html?: string;
  /** Opt out of HTML sanitization for `html`. Default `false`. */
  trusted?: boolean;
  /** Side of the target. Default `top`. */
  placement?: TooltipPlacement;
  /** Delay (ms) before showing. Default `200`. */
  showDelay?: number;
  /** Delay (ms) before hiding. Default `0`. */
  hideDelay?: number;
  /** Gap (px) between target and bubble. Default `6`. */
  offset?: number;
}

export interface TooltipEvents extends WidgetEvents {
  /** Emitted when the bubble becomes visible. (`show`/`hide` are reserved by the base.) */
  shown: { tooltip: Tooltip };
  /** Emitted when the bubble is hidden. */
  hidden: { tooltip: Tooltip };
}

export class Tooltip extends Widget<TooltipConfig, TooltipEvents> {
  // NOTE: with `useDefineForClassFields`, subclass field initializers run AFTER
  // super() and would clobber any state established during the initial render.
  // So `visible` is DERIVED from the DOM (the `--visible` class), and the target
  // is wired in the constructor (after field init), never during render. The
  // fields below are only assigned by that post-construction wiring, so they survive.
  private timer: ReturnType<typeof setTimeout> | undefined;
  private boundShow?: () => void;
  private boundHide?: () => void;
  private boundEsc?: (e: KeyboardEvent) => void;
  private wiredTarget?: HTMLElement;

  constructor(host: HTMLElement | string, config?: TooltipConfig) {
    super(host, config);
    // Wire the target AFTER field initializers have run.
    this.wireTarget();
  }

  protected override defaults(): Partial<TooltipConfig> {
    return { placement: 'top', showDelay: 200, hideDelay: 0, offset: 6 };
  }

  private get visible(): boolean {
    return this.el.classList.contains('jects-tooltip--visible');
  }

  protected buildEl(): HTMLElement {
    return createEl('div', {
      className: 'jects-tooltip',
      attrs: { role: 'tooltip' },
    });
  }

  protected override render(): void {
    const { text, html, placement = 'top' } = this.config;
    const el = this.el;
    const wasVisible = this.visible;
    el.className = [
      'jects-tooltip',
      `jects-tooltip--${placement}`,
      wasVisible ? 'jects-tooltip--visible' : '',
      this.config.cls ?? '',
    ]
      .filter(Boolean)
      .join(' ');
    el.setAttribute('data-placement', placement);
    el.id ||= this.id;
    if (html !== undefined) setHtml(el, this.config.trusted ? trustedHtml(html) : safeHtml(html));
    else if (text !== undefined) el.textContent = text;

    if (!wasVisible) el.hidden = true;
    // Re-wire when target changes via update(); on first construct this is a no-op
    // because wiredTarget is still undefined and the constructor wires afterward.
    if (this.wiredTarget !== undefined) this.wireTarget();
  }

  private wireTarget(): void {
    const target = this.config.target;
    if (target === this.wiredTarget) return;
    this.unwireTarget();
    if (!target) return;

    this.boundShow = (): void => this.scheduleShow();
    this.boundHide = (): void => this.scheduleHide();
    this.boundEsc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') this.hideNow();
    };
    target.addEventListener('pointerenter', this.boundShow);
    target.addEventListener('focusin', this.boundShow);
    target.addEventListener('pointerleave', this.boundHide);
    target.addEventListener('focusout', this.boundHide);
    target.addEventListener('keydown', this.boundEsc);
    target.setAttribute('aria-describedby', this.el.id);
    this.wiredTarget = target;
  }

  private unwireTarget(): void {
    const t = this.wiredTarget;
    if (!t) return;
    if (this.boundShow) {
      t.removeEventListener('pointerenter', this.boundShow);
      t.removeEventListener('focusin', this.boundShow);
    }
    if (this.boundHide) {
      t.removeEventListener('pointerleave', this.boundHide);
      t.removeEventListener('focusout', this.boundHide);
    }
    if (this.boundEsc) t.removeEventListener('keydown', this.boundEsc);
    t.removeAttribute('aria-describedby');
    delete this.wiredTarget;
  }

  /** Is the bubble currently visible? */
  get isVisible(): boolean {
    return this.visible;
  }

  private scheduleShow(): void {
    clearTimeout(this.timer);
    const delay = this.config.showDelay ?? 200;
    this.timer = setTimeout(() => this.showNow(), delay);
  }

  private scheduleHide(): void {
    clearTimeout(this.timer);
    const delay = this.config.hideDelay ?? 0;
    this.timer = setTimeout(() => this.hideNow(), delay);
  }

  /** Show the tooltip immediately (bypasses delay). */
  showNow(): this {
    clearTimeout(this.timer);
    if (this.visible || this.isDestroyed) return this;
    this.el.hidden = false;
    this.el.classList.add('jects-tooltip--visible');
    this.reposition();
    this.emit('shown', { tooltip: this });
    return this;
  }

  /** Hide the tooltip immediately (bypasses delay). */
  hideNow(): this {
    clearTimeout(this.timer);
    if (!this.visible) return this;
    this.el.classList.remove('jects-tooltip--visible');
    this.el.hidden = true;
    this.emit('hidden', { tooltip: this });
    return this;
  }

  /** Position the bubble against the target. */
  reposition(): this {
    const target = this.config.target;
    if (!target || !this.visible) return this;
    const { placement = 'top', offset = 6 } = this.config;
    const r = target.getBoundingClientRect();
    const w = this.el.offsetWidth;
    const h = this.el.offsetHeight;
    const vw = window.innerWidth || document.documentElement.clientWidth;
    const vh = window.innerHeight || document.documentElement.clientHeight;

    let top = 0;
    let left = 0;
    switch (placement) {
      case 'bottom':
        top = r.bottom + offset;
        left = r.left + (r.width - w) / 2;
        break;
      case 'left':
        left = r.left - offset - w;
        top = r.top + (r.height - h) / 2;
        break;
      case 'right':
        left = r.right + offset;
        top = r.top + (r.height - h) / 2;
        break;
      case 'top':
      default:
        top = r.top - offset - h;
        left = r.left + (r.width - w) / 2;
        break;
    }
    left = Math.max(0, Math.min(left, vw - w));
    top = Math.max(0, Math.min(top, vh - h));

    this.el.style.position = 'fixed';
    this.el.style.left = `${Math.round(left)}px`;
    this.el.style.top = `${Math.round(top)}px`;
    return this;
  }

  override destroy(): void {
    clearTimeout(this.timer);
    this.unwireTarget();
    super.destroy();
  }
}

register(
  'tooltip',
  Tooltip as unknown as new (
    host: HTMLElement | string,
    config?: Record<string, unknown>,
  ) => Tooltip,
);
