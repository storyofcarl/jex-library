/** jsdom unit test for Radio — render + interaction + emitted event. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Radio } from './radio.js';

let host: HTMLElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  host.remove();
});

describe('Radio (jsdom)', () => {
  it('renders a radio input with label and value', () => {
    const r = new Radio(host, { label: 'Cards', value: 'card', name: 'pay' });
    const input = host.querySelector('input[type="radio"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.value).toBe('card');
    expect(input.name).toBe('pay');
    expect(host.querySelector('.jects-radio__label')!.textContent).toBe('Cards');
    r.destroy();
  });

  it('emits change with value when selected', () => {
    const r = new Radio(host, { value: 'a' });
    const spy = vi.fn();
    r.on('change', spy);
    const input = host.querySelector('input') as HTMLInputElement;
    input.checked = true;
    input.dispatchEvent(new Event('change'));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0].value).toBe('a');
    expect(host.querySelector('.jects-radio')!.classList.contains('jects-radio--checked')).toBe(true);
    r.destroy();
  });

  it('beforeChange veto reverts selection', () => {
    const r = new Radio(host, { value: 'a' });
    r.on('beforeChange', () => false);
    const input = host.querySelector('input') as HTMLInputElement;
    input.checked = true;
    input.dispatchEvent(new Event('change'));
    expect(input.checked).toBe(false);
    r.destroy();
  });

  it('setChecked updates without firing change', () => {
    const r = new Radio(host, { value: 'a' });
    const spy = vi.fn();
    r.on('change', spy);
    r.setChecked(true);
    expect(r.checked).toBe(true);
    expect(spy).not.toHaveBeenCalled();
    r.destroy();
  });
});
