/** jsdom unit test for Mask — render + interaction + emitted event. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Mask } from './mask.js';

let host: HTMLElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  host.remove();
});

describe('Mask (jsdom)', () => {
  it('renders an overlay with spinner by default', () => {
    const m = new Mask(host);
    const el = host.querySelector('.jects-mask') as HTMLElement;
    expect(el).toBeTruthy();
    expect(el.getAttribute('role')).toBe('alert');
    expect(el.getAttribute('aria-busy')).toBe('true');
    expect(el.querySelector('.jects-mask__spinner')).toBeTruthy();
    expect(el.hidden).toBe(false);
    m.destroy();
  });

  it('renders a message when provided', () => {
    const m = new Mask(host, { message: 'Loading…' });
    const el = host.querySelector('.jects-mask') as HTMLElement;
    expect(el.querySelector('.jects-mask__message')?.textContent).toBe('Loading…');
    m.destroy();
  });

  it('omits spinner and sets aria-busy false when spinner: false', () => {
    const m = new Mask(host, { spinner: false, message: 'Done' });
    const el = host.querySelector('.jects-mask') as HTMLElement;
    expect(el.querySelector('.jects-mask__spinner')).toBeNull();
    expect(el.getAttribute('aria-busy')).toBe('false');
    m.destroy();
  });

  it('pass-through modifier applied when blockInteraction: false', () => {
    const m = new Mask(host, { blockInteraction: false });
    const el = host.querySelector('.jects-mask') as HTMLElement;
    expect(el.classList.contains('jects-mask--pass-through')).toBe(true);
    m.destroy();
  });

  it('hide()/show() toggle visibility', () => {
    const m = new Mask(host);
    const el = host.querySelector('.jects-mask') as HTMLElement;
    m.hide();
    expect(el.hidden).toBe(true);
    m.show();
    expect(el.hidden).toBe(false);
    m.destroy();
  });

  it('dismissible backdrop click emits dismiss', () => {
    const m = new Mask(host, { dismissible: true });
    const el = host.querySelector('.jects-mask') as HTMLElement;
    const spy = vi.fn();
    m.on('dismiss', spy);
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0].mask).toBe(m);
    m.destroy();
  });

  it('non-dismissible mask does not emit dismiss on click', () => {
    const m = new Mask(host);
    const el = host.querySelector('.jects-mask') as HTMLElement;
    const spy = vi.fn();
    m.on('dismiss', spy);
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(spy).not.toHaveBeenCalled();
    m.destroy();
  });

  it('setMessage updates the rendered message', () => {
    const m = new Mask(host, { message: 'A' });
    m.setMessage('B');
    const el = host.querySelector('.jects-mask') as HTMLElement;
    expect(el.querySelector('.jects-mask__message')?.textContent).toBe('B');
    m.destroy();
  });

  it('destroy removes the element', () => {
    const m = new Mask(host);
    m.destroy();
    expect(host.querySelector('.jects-mask')).toBeNull();
  });
});
