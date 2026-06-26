/**
 * Badge — a small status/label pill, optionally dismissable.
 *
 * Mirrors the Button reference pattern. Variants include the standard
 * semantic set plus the calm CMYK accents (cyan/magenta/yellow/key).
 */

import { Widget, type WidgetConfig, type WidgetEvents, createEl, register } from '@jects/core';

export type BadgeVariant =
  | 'primary'
  | 'secondary'
  | 'outline'
  | 'success'
  | 'warning'
  | 'destructive'
  | 'cyan'
  | 'magenta'
  | 'yellow'
  | 'key';

export interface BadgeConfig extends WidgetConfig {
  /** Visible text. */
  text?: string;
  /** Visual variant. Default `primary`. */
  variant?: BadgeVariant;
  /** Show a leading status dot. Default `false`. */
  dot?: boolean;
  /** Show a dismiss (×) button. Default `false`. */
  dismissable?: boolean;
}

export interface BadgeEvents extends WidgetEvents {
  /** Vetoable: return `false` to keep the badge. */
  beforeDismiss: { badge: Badge };
  /** Fired after a dismiss is committed (badge is destroyed). */
  dismiss: { badge: Badge };
}

export class Badge extends Widget<BadgeConfig, BadgeEvents> {
  protected override defaults(): Partial<BadgeConfig> {
    return { variant: 'primary' };
  }

  protected buildEl(): HTMLElement {
    const root = createEl('span', { className: 'jects-badge' });
    root.addEventListener('click', (e) => this.handleClick(e));
    return root;
  }

  private handleClick(e: MouseEvent): void {
    const target = (e.target as Element).closest('.jects-badge__dismiss');
    if (!target) return;
    e.stopPropagation();
    this.dismiss();
  }

  /** Dismiss the badge: vetoable via `beforeDismiss`, then emits `dismiss` and destroys. */
  dismiss(): void {
    if (this.emit('beforeDismiss', { badge: this }) === false) return;
    this.emit('dismiss', { badge: this });
    this.destroy();
  }

  protected override render(): void {
    const { text, variant = 'primary', dot = false, dismissable = false } = this.config;

    this.el.className = ['jects-badge', `jects-badge--${variant}`, this.config.cls ?? '']
      .filter(Boolean)
      .join(' ');

    const parts: string[] = [];
    if (dot) parts.push('<span class="jects-badge__dot" aria-hidden="true"></span>');
    if (text) parts.push(`<span class="jects-badge__label">${escapeHtml(text)}</span>`);
    if (dismissable) {
      parts.push(
        '<button type="button" class="jects-badge__dismiss" aria-label="Dismiss">&times;</button>',
      );
    }
    // jects-safe-html: label text escaped via escapeHtml above; dot/dismiss markup static
    this.el.innerHTML = parts.join('');
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

register(
  'badge',
  Badge as unknown as new (host: HTMLElement | string, config?: Record<string, unknown>) => Badge,
);
