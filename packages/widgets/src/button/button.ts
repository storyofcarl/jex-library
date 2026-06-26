/**
 * Button — the reference Jects component. Every Wave-1 component copies this pattern:
 *
 * - extends `Widget<Config, Events>`
 * - `defaults()` supplies component defaults
 * - `buildEl()` creates the single root element once
 * - `render()` syncs all DOM to current config (idempotent)
 * - emits a vetoable `beforeClick` then `click`
 * - CSS lives in `button.css`, references only `--jects-*` tokens, in `@layer jects.components`
 */

import { Widget, type WidgetConfig, type WidgetEvents, createEl, register } from '@jects/core';
import { renderIcon, type IconName } from '@jects/icons';

export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'destructive'
  | 'outline'
  | 'ghost'
  | 'link';
export type ButtonSize = 'sm' | 'md' | 'lg';
export type IconAlign = 'start' | 'end';

export interface ButtonConfig extends WidgetConfig {
  /** Visible label. */
  text?: string;
  /** Icon name from @jects/icons. */
  icon?: IconName;
  /** Icon placement relative to text. Default `start`. */
  iconAlign?: IconAlign;
  /** Visual variant. Default `primary`. */
  variant?: ButtonVariant;
  /** Size. Default `md`. */
  size?: ButtonSize;
  /** Disabled state. */
  disabled?: boolean;
  /** Loading state (shows spinner, blocks clicks). */
  loading?: boolean;
  /** Native button type. Default `button`. */
  type?: 'button' | 'submit' | 'reset';
  /** Click handler convenience (also available via `.on('click', ...)`). */
  onClick?: (event: MouseEvent) => void;
}

export interface ButtonEvents extends WidgetEvents {
  /** Vetoable: return `false` from a handler to cancel the click. */
  beforeClick: { event: MouseEvent; button: Button };
  click: { event: MouseEvent; button: Button };
}

export class Button extends Widget<ButtonConfig, ButtonEvents> {
  protected override defaults(): Partial<ButtonConfig> {
    return { variant: 'primary', size: 'md', iconAlign: 'start', type: 'button' };
  }

  protected buildEl(): HTMLElement {
    const btn = createEl('button', { className: 'jects-btn' });
    // NOTE: `super()` runs buildEl() before subclass field initializers, so we
    // must NOT reference a class-field arrow handler here. Bind a method instead.
    btn.addEventListener('click', (e) => this.handleClick(e as MouseEvent));
    return btn;
  }

  private handleClick(event: MouseEvent): void {
    const { disabled, loading, onClick } = this.config;
    if (disabled || loading) {
      event.preventDefault();
      return;
    }
    if (this.emit('beforeClick', { event, button: this }) === false) {
      event.preventDefault();
      return;
    }
    onClick?.(event);
    this.emit('click', { event, button: this });
  }

  protected override render(): void {
    const {
      text,
      icon,
      iconAlign = 'start',
      variant = 'primary',
      size = 'md',
      disabled = false,
      loading = false,
      type = 'button',
    } = this.config;

    const el = this.el as HTMLButtonElement;
    el.className = [
      'jects-btn',
      `jects-btn--${variant}`,
      `jects-btn--${size}`,
      loading ? 'jects-btn--loading' : '',
      icon && !text ? 'jects-btn--icon-only' : '',
      this.config.cls ?? '',
    ]
      .filter(Boolean)
      .join(' ');

    el.type = type;
    el.disabled = disabled || loading;
    if (disabled) el.setAttribute('aria-disabled', 'true');
    else el.removeAttribute('aria-disabled');
    el.setAttribute('aria-busy', String(loading));

    const parts: string[] = [];
    if (loading) {
      parts.push(
        `<span class="jects-btn__spinner" aria-hidden="true">${renderIcon('loader', { size: 16, className: 'jects-btn__spinner-icon' })}</span>`,
      );
    } else if (icon && iconAlign === 'start') {
      parts.push(`<span class="jects-btn__icon">${renderIcon(icon, { size: 16 })}</span>`);
    }
    if (text) parts.push(`<span class="jects-btn__label">${escapeHtml(text)}</span>`);
    if (!loading && icon && iconAlign === 'end') {
      parts.push(`<span class="jects-btn__icon">${renderIcon(icon, { size: 16 })}</span>`);
    }
    // jects-safe-html: parts are renderIcon SVG + static class spans; label text escaped via escapeHtml above
    el.innerHTML = parts.join('');
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Register for declarative composition: create({ type: 'button', text: 'Go' }).
register('button', Button as unknown as new (host: HTMLElement | string, config?: Record<string, unknown>) => Button);
