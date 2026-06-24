/** jsdom unit test — runs in the default `pnpm test`. The real-browser suite is button.browser.test.ts. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Button } from './button.js';

let host: HTMLElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  host.remove();
});

describe('Button (jsdom)', () => {
  it('renders a button with text and default variant/size', () => {
    const b = new Button(host, { text: 'Save' });
    const el = host.querySelector('button')!;
    expect(el).toBeTruthy();
    expect(el.textContent).toContain('Save');
    expect(el.classList.contains('jects-btn')).toBe(true);
    expect(el.classList.contains('jects-btn--primary')).toBe(true);
    expect(el.classList.contains('jects-btn--md')).toBe(true);
    b.destroy();
  });

  it('applies variant and size modifiers', () => {
    const b = new Button(host, { text: 'X', variant: 'destructive', size: 'lg' });
    const el = host.querySelector('button')!;
    expect(el.classList.contains('jects-btn--destructive')).toBe(true);
    expect(el.classList.contains('jects-btn--lg')).toBe(true);
    b.destroy();
  });

  it('disabled blocks click and sets attributes', () => {
    const b = new Button(host, { text: 'X', disabled: true });
    const el = host.querySelector('button') as HTMLButtonElement;
    expect(el.disabled).toBe(true);
    const spy = vi.fn();
    b.on('click', spy);
    el.click();
    expect(spy).not.toHaveBeenCalled();
    b.destroy();
  });

  it('emits click with payload', () => {
    const b = new Button(host, { text: 'Go' });
    const spy = vi.fn();
    b.on('click', spy);
    (host.querySelector('button') as HTMLButtonElement).click();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0].button).toBe(b);
    b.destroy();
  });

  it('beforeClick veto cancels click', () => {
    const b = new Button(host, { text: 'Go' });
    const clickSpy = vi.fn();
    b.on('beforeClick', () => false);
    b.on('click', clickSpy);
    (host.querySelector('button') as HTMLButtonElement).click();
    expect(clickSpy).not.toHaveBeenCalled();
    b.destroy();
  });

  it('update re-renders config', () => {
    const b = new Button(host, { text: 'A', variant: 'primary' });
    b.update({ text: 'B', variant: 'ghost' });
    const el = host.querySelector('button')!;
    expect(el.textContent).toContain('B');
    expect(el.classList.contains('jects-btn--ghost')).toBe(true);
    b.destroy();
  });

  it('destroy removes the element', () => {
    const b = new Button(host, { text: 'Bye' });
    b.destroy();
    expect(host.querySelector('button')).toBeNull();
  });

  it('loading shows spinner and blocks click', () => {
    const b = new Button(host, { text: 'Wait', loading: true });
    const el = host.querySelector('button') as HTMLButtonElement;
    expect(el.classList.contains('jects-btn--loading')).toBe(true);
    expect(el.querySelector('.jects-btn__spinner')).toBeTruthy();
    expect(el.getAttribute('aria-busy')).toBe('true');
    b.destroy();
  });
});
