/**
 * Real-Chromium browser-mode test (Vitest browser mode + Playwright).
 * Run with `pnpm --filter @jects/widgets test:browser`.
 * Verifies render, variants, disabled, and click event against a real layout engine.
 */
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

describe('Button (real Chromium)', () => {
  it('renders into the DOM with the expected classes', () => {
    const b = new Button(host, { text: 'Click me', variant: 'primary', size: 'md' });
    const el = host.querySelector('button.jects-btn')!;
    expect(el).toBeTruthy();
    expect(el.classList.contains('jects-btn--primary')).toBe(true);
    expect(el.textContent).toContain('Click me');
    b.destroy();
  });

  it('applies each variant class', () => {
    for (const variant of ['primary', 'secondary', 'destructive', 'outline', 'ghost', 'link'] as const) {
      const b = new Button(host, { text: variant, variant });
      const el = host.querySelector('button.jects-btn')!;
      expect(el.classList.contains(`jects-btn--${variant}`)).toBe(true);
      b.destroy();
    }
  });

  it('disabled button does not fire click', () => {
    const b = new Button(host, { text: 'No', disabled: true });
    const spy = vi.fn();
    b.on('click', spy);
    (host.querySelector('button') as HTMLButtonElement).click();
    expect(spy).not.toHaveBeenCalled();
    b.destroy();
  });

  it('fires click event on a real user-style click', () => {
    const b = new Button(host, { text: 'Yes' });
    const spy = vi.fn();
    b.on('click', spy);
    const el = host.querySelector('button') as HTMLButtonElement;
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(spy).toHaveBeenCalledTimes(1);
    b.destroy();
  });
});
