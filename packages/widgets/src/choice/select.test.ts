/** jsdom unit test for Select — render + interaction + emitted event. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Select } from './select.js';

let host: HTMLElement;
const opts = [
  { value: 'r', label: 'Red' },
  { value: 'g', label: 'Green' },
  { value: 'b', label: 'Blue', disabled: true },
];

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  host.remove();
  document.querySelectorAll('.jects-select__listbox').forEach((n) => n.remove());
});

describe('Select (jsdom)', () => {
  it('renders a combobox trigger with placeholder', () => {
    const s = new Select(host, { options: opts, placeholder: 'Pick a color' });
    const trigger = host.querySelector('[role="combobox"]') as HTMLButtonElement;
    expect(trigger).toBeTruthy();
    expect(trigger.textContent).toContain('Pick a color');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    s.destroy();
  });

  it('opens the listbox on click', () => {
    const s = new Select(host, { options: opts });
    (host.querySelector('[role="combobox"]') as HTMLButtonElement).click();
    expect(s.isOpen).toBe(true);
    expect(document.querySelector('[role="listbox"]')).toBeTruthy();
    expect(document.querySelectorAll('[role="option"]').length).toBe(3);
    s.destroy();
  });

  it('selects an option and emits change', () => {
    const s = new Select(host, { options: opts });
    const spy = vi.fn();
    s.on('change', spy);
    s.open();
    (document.querySelector('[data-value="g"]') as HTMLElement).click();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0].value).toBe('g');
    expect(s.value).toBe('g');
    expect(s.isOpen).toBe(false);
    expect((host.querySelector('[role="combobox"]') as HTMLElement).textContent).toContain('Green');
    s.destroy();
  });

  it('does not select a disabled option', () => {
    const s = new Select(host, { options: opts });
    s.open();
    (document.querySelector('[data-value="b"]') as HTMLElement).click();
    expect(s.value).toBeUndefined();
    s.destroy();
  });

  it('keyboard: ArrowDown opens then Enter selects', () => {
    const s = new Select(host, { options: opts });
    const trigger = host.querySelector('[role="combobox"]') as HTMLElement;
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(s.isOpen).toBe(true);
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(s.value).toBe('r');
    s.destroy();
  });

  it('clearable: clear() resets the value and emits change', () => {
    const s = new Select(host, { options: opts, value: 'r', clearable: true });
    const spy = vi.fn();
    s.on('change', spy);
    s.clear();
    expect(s.value).toBeUndefined();
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ value: undefined }));
    s.destroy();
  });

  it('beforeChange veto blocks selection', () => {
    const s = new Select(host, { options: opts });
    s.on('beforeChange', () => false);
    s.open();
    (document.querySelector('[data-value="g"]') as HTMLElement).click();
    expect(s.value).toBeUndefined();
    s.destroy();
  });

  it('disabled does not open', () => {
    const s = new Select(host, { options: opts, disabled: true });
    s.open();
    expect(s.isOpen).toBe(false);
    s.destroy();
  });

  it('destroy removes trigger and any open panel', () => {
    const s = new Select(host, { options: opts });
    s.open();
    s.destroy();
    expect(host.querySelector('.jects-select')).toBeNull();
    expect(document.querySelector('.jects-select__listbox')).toBeNull();
  });
});
