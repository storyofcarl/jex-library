/** jsdom unit test for TextField — render + interaction + emitted event. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TextField } from './text-field.js';

let host: HTMLElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  host.remove();
});

describe('TextField (jsdom)', () => {
  it('renders an input with label, placeholder and default size', () => {
    const f = new TextField(host, { label: 'Name', placeholder: 'Jane', value: 'hi' });
    const input = host.querySelector('input') as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.value).toBe('hi');
    expect(input.placeholder).toBe('Jane');
    expect(host.querySelector('.jects-field__label')!.textContent).toContain('Name');
    expect(host.querySelector('.jects-field--md')).toBeTruthy();
    f.destroy();
  });

  it('emits input when the user types', () => {
    const f = new TextField(host);
    const spy = vi.fn();
    f.on('input', spy);
    const input = host.querySelector('input') as HTMLInputElement;
    input.value = 'abc';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0].value).toBe('abc');
    f.destroy();
  });

  it('emits change on commit', () => {
    const f = new TextField(host);
    const spy = vi.fn();
    f.on('change', spy);
    const input = host.querySelector('input') as HTMLInputElement;
    input.value = 'committed';
    input.dispatchEvent(new Event('change', { bubbles: true }));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0].value).toBe('committed');
    f.destroy();
  });

  it('clearable shows a clear button that clears and emits clear', () => {
    const f = new TextField(host, { clearable: true, value: 'wipe' });
    const clearBtn = host.querySelector('.jects-field__clear') as HTMLButtonElement;
    expect(clearBtn).toBeTruthy();
    expect(clearBtn.hidden).toBe(false);
    const clearSpy = vi.fn();
    f.on('clear', clearSpy);
    clearBtn.click();
    expect(clearSpy).toHaveBeenCalledTimes(1);
    expect((host.querySelector('input') as HTMLInputElement).value).toBe('');
    f.destroy();
  });

  it('renders prefix and suffix affixes', () => {
    const f = new TextField(host, { prefix: '$', suffix: '.00' });
    expect(host.querySelector('.jects-field__prefix')!.textContent).toBe('$');
    expect(host.querySelector('.jects-field__suffix')!.textContent).toBe('.00');
    f.destroy();
  });

  it('invalid/error sets aria-invalid and renders error text', () => {
    const f = new TextField(host, { error: 'Required' });
    const input = host.querySelector('input') as HTMLInputElement;
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(host.querySelector('.jects-field--invalid')).toBeTruthy();
    expect(host.querySelector('.jects-field__error')!.textContent).toBe('Required');
    f.destroy();
  });

  it('disabled and readOnly reflect on the input', () => {
    const f = new TextField(host, { disabled: true });
    expect((host.querySelector('input') as HTMLInputElement).disabled).toBe(true);
    f.update({ disabled: false, readOnly: true });
    expect((host.querySelector('input') as HTMLInputElement).readOnly).toBe(true);
    f.destroy();
  });

  it('applies size modifier', () => {
    const f = new TextField(host, { size: 'lg' });
    expect(host.querySelector('.jects-field--lg')).toBeTruthy();
    f.destroy();
  });

  it('destroy removes the element', () => {
    const f = new TextField(host, { value: 'x' });
    f.destroy();
    expect(host.querySelector('.jects-field')).toBeNull();
  });
});
