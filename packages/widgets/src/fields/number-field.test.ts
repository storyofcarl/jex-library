/** jsdom unit test for NumberField — render + interaction + emitted event. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NumberField } from './number-field.js';

let host: HTMLElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  host.remove();
});

describe('NumberField (jsdom)', () => {
  it('renders an input with spinbutton role and spinner buttons', () => {
    const f = new NumberField(host, { value: '5' });
    const input = host.querySelector('input') as HTMLInputElement;
    expect(input.getAttribute('role')).toBe('spinbutton');
    expect(host.querySelector('.jects-field__step--up')).toBeTruthy();
    expect(host.querySelector('.jects-field__step--down')).toBeTruthy();
    f.destroy();
  });

  it('clicking the up spinner increments by step and emits change', () => {
    const f = new NumberField(host, { value: '1', step: 2 });
    const spy = vi.fn();
    f.on('change', spy);
    (host.querySelector('.jects-field__step--up') as HTMLButtonElement).click();
    expect((host.querySelector('input') as HTMLInputElement).value).toBe('3');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0].numericValue).toBe(3);
    f.destroy();
  });

  it('ArrowUp/ArrowDown step the value', () => {
    const f = new NumberField(host, { value: '10' });
    const input = host.querySelector('input') as HTMLInputElement;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    expect(input.value).toBe('11');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(input.value).toBe('10');
    f.destroy();
  });

  it('clamps to min/max when stepping', () => {
    const f = new NumberField(host, { value: '9', min: 0, max: 10, step: 5 });
    f.step(1);
    expect((host.querySelector('input') as HTMLInputElement).value).toBe('10');
    f.update({ value: '1' });
    f.step(-1);
    expect((host.querySelector('input') as HTMLInputElement).value).toBe('0');
    f.destroy();
  });

  it('formats to precision on commit (change)', () => {
    const f = new NumberField(host, { precision: 2 });
    const input = host.querySelector('input') as HTMLInputElement;
    input.value = '3.5';
    input.dispatchEvent(new Event('change', { bubbles: true }));
    expect(input.value).toBe('3.50');
    f.destroy();
  });

  it('emits input with numericValue while typing', () => {
    const f = new NumberField(host);
    const spy = vi.fn();
    f.on('input', spy);
    const input = host.querySelector('input') as HTMLInputElement;
    input.value = '42';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(spy.mock.calls[0]![0].numericValue).toBe(42);
    f.destroy();
  });

  it('hides spinners when disabled', () => {
    const f = new NumberField(host, { value: '1', disabled: true });
    expect(host.querySelector('.jects-field__step--up')).toBeNull();
    f.destroy();
  });
});
