/**
 * Avatar — displays a user image, falling back to initials, then a generic icon.
 *
 * Mirrors the Button reference pattern. Sizes sm/md/lg/xl; shape circle/square.
 * Listens for image load failure and degrades to the initials/fallback layer.
 */

import { Widget, type WidgetConfig, type WidgetEvents, createEl, register } from '@jects/core';

export type AvatarSize = 'sm' | 'md' | 'lg' | 'xl';
export type AvatarShape = 'circle' | 'square';

export interface AvatarConfig extends WidgetConfig {
  /** Image source URL. */
  src?: string;
  /** Alt text / accessible name. */
  alt?: string;
  /** Name used to derive initials when no image is available. */
  name?: string;
  /** Explicit initials override (1-2 chars). */
  initials?: string;
  /** Size. Default `md`. */
  size?: AvatarSize;
  /** Shape. Default `circle`. */
  shape?: AvatarShape;
}

export interface AvatarEvents extends WidgetEvents {
  /** Fired when the image loads successfully. */
  load: { avatar: Avatar };
  /** Fired when the image fails and the fallback is shown. */
  error: { avatar: Avatar };
}

export class Avatar extends Widget<AvatarConfig, AvatarEvents> {
  private imgFailed = false;

  // Element refs via getters (see Slider note): never cache as class fields.
  private get imgEl(): HTMLImageElement {
    return this.el.querySelector('.jects-avatar__img')!;
  }
  private get fallbackEl(): HTMLElement {
    return this.el.querySelector('.jects-avatar__fallback')!;
  }

  protected override defaults(): Partial<AvatarConfig> {
    return { size: 'md', shape: 'circle' };
  }

  protected buildEl(): HTMLElement {
    const root = createEl('span', { className: 'jects-avatar', attrs: { role: 'img' } });
    const img = createEl('img', { className: 'jects-avatar__img' });
    const fallback = createEl('span', {
      className: 'jects-avatar__fallback',
      attrs: { 'aria-hidden': 'true' },
    });
    root.append(img, fallback);

    img.addEventListener('error', () => this.handleError());
    img.addEventListener('load', () => this.handleLoad());
    return root;
  }

  private handleError(): void {
    this.imgFailed = true;
    this.imgEl.hidden = true;
    this.fallbackEl.hidden = false;
    this.emit('error', { avatar: this });
  }

  private handleLoad(): void {
    if (!this.imgEl.src) return;
    this.imgFailed = false;
    this.imgEl.hidden = false;
    this.fallbackEl.hidden = true;
    this.emit('load', { avatar: this });
  }

  /** Derive up to two uppercase initials from a display name. */
  private deriveInitials(): string {
    if (this.config.initials) return this.config.initials.slice(0, 2).toUpperCase();
    const name = (this.config.name ?? '').trim();
    if (!name) return '';
    const parts = name.split(/\s+/);
    const first = parts[0]?.[0] ?? '';
    const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
    return (first + last).toUpperCase();
  }

  protected override render(): void {
    const { src, alt, name, size = 'md', shape = 'circle' } = this.config;
    const initials = this.deriveInitials();

    this.el.className = [
      'jects-avatar',
      `jects-avatar--${size}`,
      `jects-avatar--${shape}`,
      this.config.cls ?? '',
    ]
      .filter(Boolean)
      .join(' ');

    this.el.setAttribute('aria-label', alt ?? name ?? 'Avatar');

    const hasImage = !!src && !this.imgFailed;
    if (src) {
      if (this.imgEl.getAttribute('src') !== src) {
        this.imgFailed = false;
        this.imgEl.src = src;
      }
      this.imgEl.alt = alt ?? name ?? '';
    } else {
      this.imgEl.removeAttribute('src');
    }

    this.imgEl.hidden = !hasImage;
    this.fallbackEl.hidden = hasImage;

    // Fallback layer: initials when available, otherwise a generic glyph.
    this.fallbackEl.textContent = initials || '?';
    this.fallbackEl.classList.toggle('jects-avatar__fallback--icon', !initials);
  }
}

register(
  'avatar',
  Avatar as unknown as new (host: HTMLElement | string, config?: Record<string, unknown>) => Avatar,
);
