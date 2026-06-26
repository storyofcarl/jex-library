/** jsdom unit test for Checkbox — render + interaction + emitted event. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Checkbox } from './checkbox.js';

let host: HTMLElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  host.remove();
});

describe('Checkbox (jsdom)', () => {
  it('renders an input with label', () => {
    const c = new Checkbox(host, { label: 'Accept' });
    const input = host.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(host.querySelector('.jects-checkbox__label')!.textContent).toBe('Accept');
    expect(input.checked).toBe(false);
    c.destroy();
  });

  it('reflects checked and indeterminate state', () => {
    const c = new Checkbox(host, { indeterminate: true });
    const input = host.querySelector('input') as HTMLInputElement;
    expect(input.indeterminate).toBe(true);
    expect(input.getAttribute('aria-checked')).toBe('mixed');
    c.update({ indeterminate: false, checked: true });
    expect(input.checked).toBe(true);
    expect(host.querySelector('.jects-checkbox')!.classList.contains('jects-checkbox--checked')).toBe(true);
    c.destroy();
  });

  it('emits change on toggle', () => {
    const c = new Checkbox(host);
    const spy = vi.fn();
    c.on('change', spy);
    const input = host.querySelector('input') as HTMLInputElement;
    input.checked = true;
    input.dispatchEvent(new Event('change'));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0].checked).toBe(true);
    expect(c.checked).toBe(true);
    c.destroy();
  });

  it('beforeChange veto reverts the toggle', () => {
    const c = new Checkbox(host);
    c.on('beforeChange', () => false);
    const input = host.querySelector('input') as HTMLInputElement;
    input.checked = true;
    input.dispatchEvent(new Event('change'));
    expect(input.checked).toBe(false);
    expect(c.checked).toBe(false);
    c.destroy();
  });

  it('disabled disables the input', () => {
    const c = new Checkbox(host, { disabled: true });
    expect((host.querySelector('input') as HTMLInputElement).disabled).toBe(true);
    c.destroy();
  });

  it('destroy removes the element', () => {
    const c = new Checkbox(host);
    c.destroy();
    expect(host.querySelector('.jects-checkbox')).toBeNull();
  });
});
