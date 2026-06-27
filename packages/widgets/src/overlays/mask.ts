/**
 * Mask — a full-area overlay / backdrop that blocks interaction with the
 * element it covers, optionally showing a spinner and a message ("Loading…").
 *
 * The mask absolutely fills its host (the host should be positioned). Use it to
 * gate a panel during async work. Self-contained (depends only on `@jects/core`).
 *
 * NOTE: `super()` runs `buildEl()` before subclass field initializers, so DOM
 * listeners are wired with bound methods inside `buildEl()`.
 */

import {
  Widget,
  type WidgetConfig,
  type WidgetEvents,
  createEl,
  register,
  setHtml,
  trustedHtml,
} from '@jects/core';

export interface MaskConfig extends WidgetConfig {
  /** Message shown under the spinner. */
  message?: string;
  /** Show the spinner. Default `true`. */
  spinner?: boolean;
  /** Block pointer events on covered content. Default `true`. */
  blockInteraction?: boolean;
  /** Start visible. Default `true`. */
  visible?: boolean;
  /** Emit `dismiss` when the backdrop is clicked. Default `false`. */
  dismissible?: boolean;
}

export interface MaskEvents extends WidgetEvents {
  /** Emitted when a dismissible mask's backdrop is clicked. */
  dismiss: { mask: Mask };
}

export class Mask extends Widget<MaskConfig, MaskEvents> {
  protected override defaults(): Partial<MaskConfig> {
    return { spinner: true, blockInteraction: true, visible: true, dismissible: false };
  }

  protected buildEl(): HTMLElement {
    const el = createEl('div', {
      className: 'jects-mask',
      attrs: { role: 'alert', 'aria-busy': 'true' },
    });
    el.addEventListener('click', (e) => this.handleClick(e));
    return el;
  }

  private handleClick(event: MouseEvent): void {
    if (!this.config.dismissible) return;
    // Only the backdrop itself (not the inner box) dismisses.
    if (event.target === this.el) {
      this.emit('dismiss', { mask: this });
    }
  }

  protected override render(): void {
    const {
      message,
      spinner = true,
      blockInteraction = true,
      visible = true,
    } = this.config;

    const el = this.el;
    el.className = [
      'jects-mask',
      blockInteraction ? '' : 'jects-mask--pass-through',
      this.config.cls ?? '',
    ]
      .filter(Boolean)
      .join(' ');
    el.setAttribute('aria-busy', String(spinner));
    el.hidden = !visible;

    const parts: string[] = ['<div class="jects-mask__box">'];
    if (spinner) {
      parts.push(
        '<span class="jects-mask__spinner" aria-hidden="true"><span class="jects-mask__spinner-ring"></span></span>',
      );
    }
    if (message) {
      parts.push(`<span class="jects-mask__message">${escapeHtml(message)}</span>`);
    }
    parts.push('</div>');
    setHtml(el, trustedHtml(parts.join('')));
  }

  /** Show the mask. */
  override show(): this {
    this.config = { ...this.config, visible: true };
    this.el.hidden = false;
    return super.show();
  }

  /** Hide the mask. */
  override hide(): this {
    this.config = { ...this.config, visible: false };
    this.el.hidden = true;
    return super.hide();
  }

  /** Update the visible message (and re-render). */
  setMessage(message: string): this {
    return this.update({ message });
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

register(
  'mask',
  Mask as unknown as new (host: HTMLElement | string, config?: Record<string, unknown>) => Mask,
);
