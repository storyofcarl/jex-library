/**
 * Link — a themed anchor with href/target/variant. Emits a vetoable `beforeClick`
 * then `click` (mirroring Button's veto convention). When opened in a new tab
 * (`target="_blank"`), `rel="noopener noreferrer"` is applied automatically.
 */

import { Widget, type WidgetConfig, type WidgetEvents, register } from '@jects/core';

export type LinkVariant = 'default' | 'muted' | 'underline' | 'plain';

export interface LinkConfig extends WidgetConfig {
  /** Link text. */
  text?: string;
  /** Destination URL. */
  href?: string;
  /** Anchor target (e.g. `_blank`). */
  target?: '_self' | '_blank' | '_parent' | '_top';
  /** Visual variant. Default `default`. */
  variant?: LinkVariant;
  /** Explicit rel; auto-set to `noopener noreferrer` for `_blank` if omitted. */
  rel?: string;
  /** Disabled state (removes href, blocks navigation). */
  disabled?: boolean;
  /** Click handler convenience. */
  onClick?: (event: MouseEvent) => void;
}

export interface LinkEvents extends WidgetEvents {
  /** Vetoable: return `false` to cancel navigation. */
  beforeClick: { event: MouseEvent; link: Link };
  click: { event: MouseEvent; link: Link };
}

export class Link extends Widget<LinkConfig, LinkEvents> {
  protected override defaults(): Partial<LinkConfig> {
    return { variant: 'default', target: '_self' };
  }

  protected buildEl(): HTMLElement {
    const a = document.createElement('a');
    a.className = 'jects-link';
    a.addEventListener('click', (e) => this.handleClick(e as MouseEvent));
    return a;
  }

  private handleClick(event: MouseEvent): void {
    const { disabled, onClick } = this.config;
    if (disabled) {
      event.preventDefault();
      return;
    }
    if (this.emit('beforeClick', { event, link: this }) === false) {
      event.preventDefault();
      return;
    }
    onClick?.(event);
    this.emit('click', { event, link: this });
  }

  protected override render(): void {
    const { text = '', href, target = '_self', variant = 'default', rel, disabled = false } = this.config;
    const el = this.el as HTMLAnchorElement;

    el.className = ['jects-link', `jects-link--${variant}`, disabled ? 'jects-link--disabled' : '', this.config.cls ?? '']
      .filter(Boolean)
      .join(' ');

    el.textContent = text;

    if (disabled) {
      // Author-disabled: an unavailable link. Not focusable, marked aria-disabled.
      el.removeAttribute('href');
      el.setAttribute('role', 'link');
      el.setAttribute('aria-disabled', 'true');
      el.tabIndex = -1;
    } else if (!href) {
      // Enabled but hrefless: expose as a (focusable) link WITHOUT aria-disabled,
      // since the author did not disable it. Setting aria-disabled here would be a
      // contradictory/stale state that announces an unavailable link.
      el.removeAttribute('href');
      el.setAttribute('role', 'link');
      el.removeAttribute('aria-disabled');
      el.tabIndex = 0;
    } else {
      // Real anchor with a destination.
      el.href = href;
      el.removeAttribute('role');
      el.removeAttribute('aria-disabled');
      el.removeAttribute('tabindex');
    }

    if (target && target !== '_self') el.target = target;
    else el.removeAttribute('target');

    const computedRel = rel ?? (target === '_blank' ? 'noopener noreferrer' : undefined);
    if (computedRel) el.rel = computedRel;
    else el.removeAttribute('rel');
  }
}

register(
  'link',
  Link as unknown as new (host: HTMLElement | string, config?: Record<string, unknown>) => Link,
);
