/** jsdom unit test for Spacer — render + config interaction + emitted event. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Spacer } from './spacer.js';

let host: HTMLElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  host.remove();
});

describe('Spacer (jsdom)', () => {
  it('renders a vertical spacer with token height by default', () => {
    const s = new Spacer(host);
    const el = host.querySelector('.jects-spacer') as HTMLElement;
    expect(el.classList.contains('jects-spacer--vertical')).toBe(true);
    expect(el.style.height).toBe('var(--jects-space-4)');
    expect(el.getAttribute('aria-hidden')).toBe('true');
    s.destroy();
  });

  it('uses width on the horizontal axis', () => {
    const s = new Spacer(host, { axis: 'horizontal', size: 6 });
    const el = host.querySelector('.jects-spacer') as HTMLElement;
    expect(el.classList.contains('jects-spacer--horizontal')).toBe(true);
    expect(el.style.width).toBe('var(--jects-space-6)');
    s.destroy();
  });

  it('accepts an explicit CSS length', () => {
    const s = new Spacer(host, { axis: 'vertical', size: '3rem' });
    expect((host.querySelector('.jects-spacer') as HTMLElement).style.height).toBe('3rem');
    s.destroy();
  });

  it('grow mode flex-grows instead of fixed size', () => {
    const s = new Spacer(host, { grow: true });
    const el = host.querySelector('.jects-spacer') as HTMLElement;
    expect(el.classList.contains('jects-spacer--grow')).toBe(true);
    expect(el.style.flex).toContain('1');
    s.destroy();
  });

  it('update re-renders to a new size; destroy emits a destroy event', () => {
    const spy = vi.fn();
    const s = new Spacer(host, { size: 2 });
    s.on('destroy', spy);
    s.update({ size: 8 });
    expect((host.querySelector('.jects-spacer') as HTMLElement).style.height).toBe(
      'var(--jects-space-8)',
    );
    s.destroy();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('destroy removes the element', () => {
    const s = new Spacer(host);
    s.destroy();
    expect(host.querySelector('.jects-spacer')).toBeNull();
  });
});
