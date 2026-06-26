/** jsdom unit test for DisplayField — render + update + render event. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DisplayField } from './display-field.js';

let host: HTMLElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  host.remove();
});

describe('DisplayField (jsdom)', () => {
  it('renders label and value', () => {
    const f = new DisplayField(host, { label: 'Email', value: 'a@b.com' });
    expect(host.querySelector('.jects-display__label')!.textContent).toBe('Email');
    expect(host.querySelector('.jects-display__value')!.textContent).toBe('a@b.com');
    f.destroy();
  });

  it('shows the empty fallback when value is missing', () => {
    const f = new DisplayField(host, { label: 'Phone', empty: 'N/A' });
    const value = host.querySelector('.jects-display__value') as HTMLElement;
    expect(value.textContent).toBe('N/A');
    expect(value.classList.contains('jects-display__value--empty')).toBe(true);
    f.destroy();
  });

  it('updates value via update() and emits hide event', () => {
    const f = new DisplayField(host, { value: 'old' });
    f.update({ value: 'new' });
    expect(host.querySelector('.jects-display__value')!.textContent).toBe('new');
    const spy = vi.fn();
    f.on('hide', spy);
    f.hide();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(f.el.hidden).toBe(true);
    f.destroy();
  });

  it('applies layout modifier', () => {
    const f = new DisplayField(host, { layout: 'inline', label: 'L', value: 'V' });
    expect(host.querySelector('.jects-display--inline')).toBeTruthy();
    f.destroy();
  });

  it('destroy removes the element', () => {
    const f = new DisplayField(host, { value: 'x' });
    f.destroy();
    expect(host.querySelector('.jects-display')).toBeNull();
  });
});
