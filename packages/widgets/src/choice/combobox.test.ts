/** jsdom unit test for ComboBox — render + interaction + emitted event. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ComboBox } from './combobox.js';

let host: HTMLElement;
const opts = [
  { value: 'apple', label: 'Apple' },
  { value: 'banana', label: 'Banana' },
  { value: 'cherry', label: 'Cherry' },
];

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  host.remove();
  document.querySelectorAll('.jects-combobox__listbox').forEach((n) => n.remove());
});

describe('ComboBox (jsdom)', () => {
  it('renders a combobox input', () => {
    const c = new ComboBox(host, { options: opts, placeholder: 'Fruit' });
    const input = host.querySelector('input[role="combobox"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.placeholder).toBe('Fruit');
    expect(input.getAttribute('aria-expanded')).toBe('false');
    c.destroy();
  });

  it('filters options as you type and emits input', () => {
    const c = new ComboBox(host, { options: opts });
    const inputSpy = vi.fn();
    c.on('input', inputSpy);
    const input = host.querySelector('input') as HTMLInputElement;
    input.value = 'ban';
    input.dispatchEvent(new Event('input'));
    expect(inputSpy).toHaveBeenCalledTimes(1);
    const rows = document.querySelectorAll('.jects-combobox__option');
    expect(rows.length).toBe(1);
    expect(rows[0]!.textContent).toContain('Banana');
    c.destroy();
  });

  it('single mode: choosing an option emits change and fills input', () => {
    const c = new ComboBox(host, { options: opts });
    const spy = vi.fn();
    c.on('change', spy);
    c.open();
    (document.querySelector('[data-value="cherry"]') as HTMLElement).click();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0].value).toBe('cherry');
    expect(c.value).toBe('cherry');
    expect((host.querySelector('input') as HTMLInputElement).value).toBe('Cherry');
    c.destroy();
  });

  it('multi mode: selections render as chips and accumulate', () => {
    const c = new ComboBox(host, { options: opts, multiple: true });
    const spy = vi.fn();
    c.on('change', spy);
    c.open();
    (document.querySelector('[data-value="apple"]') as HTMLElement).click();
    c.open();
    (document.querySelector('[data-value="banana"]') as HTMLElement).click();
    expect(c.values).toEqual(['apple', 'banana']);
    expect(host.querySelectorAll('.jects-combobox__chip').length).toBe(2);
    expect(spy).toHaveBeenCalledTimes(2);
    c.destroy();
  });

  it('multi mode: removing a chip deselects it', () => {
    const c = new ComboBox(host, { options: opts, multiple: true, values: ['apple', 'banana'] });
    const remove = host.querySelector('[data-remove="apple"]') as HTMLElement;
    remove.click();
    expect(c.values).toEqual(['banana']);
    c.destroy();
  });

  it('keyboard: ArrowDown + Enter selects active option', () => {
    const c = new ComboBox(host, { options: opts });
    const input = host.querySelector('input') as HTMLInputElement;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(c.isOpen).toBe(true);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(c.value).toBe('banana');
    c.destroy();
  });

  it('shows empty state when nothing matches', () => {
    const c = new ComboBox(host, { options: opts });
    const input = host.querySelector('input') as HTMLInputElement;
    input.value = 'zzz';
    input.dispatchEvent(new Event('input'));
    expect(document.querySelector('.jects-combobox__empty')).toBeTruthy();
    c.destroy();
  });

  it('beforeChange veto blocks selection', () => {
    const c = new ComboBox(host, { options: opts });
    c.on('beforeChange', () => false);
    c.open();
    (document.querySelector('[data-value="apple"]') as HTMLElement).click();
    expect(c.value).toBeUndefined();
    c.destroy();
  });

  it('destroy removes control and panel', () => {
    const c = new ComboBox(host, { options: opts });
    c.open();
    c.destroy();
    expect(host.querySelector('.jects-combobox')).toBeNull();
    expect(document.querySelector('.jects-combobox__listbox')).toBeNull();
  });
});
