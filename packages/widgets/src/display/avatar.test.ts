/** jsdom unit test for Avatar — render + interaction + emitted event. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Avatar } from './avatar.js';

let host: HTMLElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  host.remove();
});

describe('Avatar (jsdom)', () => {
  it('renders initials from a name when no image', () => {
    const a = new Avatar(host, { name: 'Ada Lovelace' });
    const fb = host.querySelector('.jects-avatar__fallback')!;
    expect(fb.textContent).toBe('AL');
    expect((host.querySelector('.jects-avatar__img') as HTMLImageElement).hidden).toBe(true);
    a.destroy();
  });

  it('honors explicit initials override', () => {
    const a = new Avatar(host, { initials: 'jx' });
    expect(host.querySelector('.jects-avatar__fallback')!.textContent).toBe('JX');
    a.destroy();
  });

  it('shows a generic glyph fallback with no name', () => {
    const a = new Avatar(host);
    const fb = host.querySelector('.jects-avatar__fallback')!;
    expect(fb.textContent).toBe('?');
    expect(fb.classList.contains('jects-avatar__fallback--icon')).toBe(true);
    a.destroy();
  });

  it('renders an image when src is provided', () => {
    const a = new Avatar(host, { src: 'https://example.com/a.png', alt: 'Ada' });
    const img = host.querySelector('.jects-avatar__img') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe('https://example.com/a.png');
    expect(img.hidden).toBe(false);
    a.destroy();
  });

  it('falls back and emits error when the image fails', () => {
    const a = new Avatar(host, { src: 'bad', name: 'Grace Hopper' });
    const spy = vi.fn();
    a.on('error', spy);
    const img = host.querySelector('.jects-avatar__img') as HTMLImageElement;
    img.dispatchEvent(new Event('error'));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(img.hidden).toBe(true);
    expect(host.querySelector('.jects-avatar__fallback')!.textContent).toBe('GH');
    a.destroy();
  });

  it('applies size and shape modifiers', () => {
    const a = new Avatar(host, { name: 'X', size: 'lg', shape: 'square' });
    const el = host.querySelector('.jects-avatar')!;
    expect(el.classList.contains('jects-avatar--lg')).toBe(true);
    expect(el.classList.contains('jects-avatar--square')).toBe(true);
    a.destroy();
  });

  it('destroy removes the element', () => {
    const a = new Avatar(host, { name: 'Bye' });
    a.destroy();
    expect(host.querySelector('.jects-avatar')).toBeNull();
  });
});
