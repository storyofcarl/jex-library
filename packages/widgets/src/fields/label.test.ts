/** jsdom unit test for Label — render + htmlFor + required marker + render event. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Label } from './label.js';

let host: HTMLElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  host.remove();
});

describe('Label (jsdom)', () => {
  it('renders a <label> with text and for attribute', () => {
    const l = new Label(host, { text: 'Username', htmlFor: 'user' });
    const el = host.querySelector('label') as HTMLLabelElement;
    expect(el).toBeTruthy();
    expect(el.textContent).toContain('Username');
    expect(el.htmlFor).toBe('user');
    expect(el.classList.contains('jects-label')).toBe(true);
    l.destroy();
  });

  it('shows a required marker', () => {
    const l = new Label(host, { text: 'Email', required: true });
    expect(host.querySelector('.jects-label__required')).toBeTruthy();
    l.destroy();
  });

  it('updates text via update() and emits destroy event', () => {
    const l = new Label(host, { text: 'A' });
    l.update({ text: 'B' });
    expect(host.querySelector('label')!.textContent).toContain('B');
    const spy = vi.fn();
    l.on('destroy', spy);
    l.destroy();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('destroy removes the element', () => {
    const l = new Label(host, { text: 'X' });
    l.destroy();
    expect(host.querySelector('label')).toBeNull();
  });
});
