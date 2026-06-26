/** jsdom unit test for Link — render + interaction + emitted event. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Link } from './link.js';

let host: HTMLElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  host.remove();
});

describe('Link (jsdom)', () => {
  it('renders an anchor with href, text and default variant', () => {
    const l = new Link(host, { text: 'Docs', href: 'https://x.test' });
    const a = host.querySelector('a') as HTMLAnchorElement;
    expect(a).toBeTruthy();
    expect(a.textContent).toBe('Docs');
    expect(a.getAttribute('href')).toBe('https://x.test');
    expect(a.classList.contains('jects-link--default')).toBe(true);
    l.destroy();
  });

  it('adds rel=noopener for target _blank', () => {
    const l = new Link(host, { text: 'X', href: 'https://x.test', target: '_blank' });
    const a = host.querySelector('a') as HTMLAnchorElement;
    expect(a.target).toBe('_blank');
    expect(a.rel).toBe('noopener noreferrer');
    l.destroy();
  });

  it('emits click on activation', () => {
    const l = new Link(host, { text: 'X', href: '#' });
    const spy = vi.fn();
    l.on('click', spy);
    (host.querySelector('a') as HTMLAnchorElement).click();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0].link).toBe(l);
    l.destroy();
  });

  it('beforeClick veto cancels click', () => {
    const l = new Link(host, { text: 'X', href: '#' });
    const clickSpy = vi.fn();
    l.on('beforeClick', () => false);
    l.on('click', clickSpy);
    (host.querySelector('a') as HTMLAnchorElement).click();
    expect(clickSpy).not.toHaveBeenCalled();
    l.destroy();
  });

  it('disabled removes href and blocks click', () => {
    const l = new Link(host, { text: 'X', href: 'https://x.test', disabled: true });
    const a = host.querySelector('a') as HTMLAnchorElement;
    expect(a.hasAttribute('href')).toBe(false);
    expect(a.getAttribute('aria-disabled')).toBe('true');
    const spy = vi.fn();
    l.on('click', spy);
    a.click();
    expect(spy).not.toHaveBeenCalled();
    l.destroy();
  });

  it('destroy removes the element', () => {
    const l = new Link(host, { text: 'X', href: '#' });
    l.destroy();
    expect(host.querySelector('a')).toBeNull();
  });
});
