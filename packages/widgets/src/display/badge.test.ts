/** jsdom unit test for Badge — render + interaction + emitted event. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Badge } from './badge.js';

let host: HTMLElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  host.remove();
});

describe('Badge (jsdom)', () => {
  it('renders text and default variant', () => {
    const b = new Badge(host, { text: 'New' });
    const el = host.querySelector('.jects-badge')!;
    expect(el.textContent).toContain('New');
    expect(el.classList.contains('jects-badge--primary')).toBe(true);
    b.destroy();
  });

  it('applies CMYK accent variants', () => {
    const b = new Badge(host, { text: 'Tag', variant: 'cyan' });
    expect(host.querySelector('.jects-badge')!.classList.contains('jects-badge--cyan')).toBe(true);
    b.destroy();
  });

  it('renders a dot when requested', () => {
    const b = new Badge(host, { text: 'Live', dot: true });
    expect(host.querySelector('.jects-badge__dot')).toBeTruthy();
    b.destroy();
  });

  it('dismiss button emits dismiss and removes the badge', () => {
    const b = new Badge(host, { text: 'X', dismissable: true });
    const spy = vi.fn();
    b.on('dismiss', spy);
    (host.querySelector('.jects-badge__dismiss') as HTMLButtonElement).click();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(host.querySelector('.jects-badge')).toBeNull();
    b.destroy();
  });

  it('beforeDismiss veto keeps the badge', () => {
    const b = new Badge(host, { text: 'Keep', dismissable: true });
    b.on('beforeDismiss', () => false);
    (host.querySelector('.jects-badge__dismiss') as HTMLButtonElement).click();
    expect(host.querySelector('.jects-badge')).toBeTruthy();
    b.destroy();
  });

  it('update re-renders variant', () => {
    const b = new Badge(host, { text: 'A', variant: 'primary' });
    b.update({ variant: 'success' });
    expect(host.querySelector('.jects-badge')!.classList.contains('jects-badge--success')).toBe(true);
    b.destroy();
  });

  it('destroy removes the element', () => {
    const b = new Badge(host, { text: 'Bye' });
    b.destroy();
    expect(host.querySelector('.jects-badge')).toBeNull();
  });
});
