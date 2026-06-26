/** jsdom unit test for DatePicker — render, typing, popover open, change event. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DatePicker } from './date-picker.js';

let host: HTMLElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  host.remove();
});

const getInput = (): HTMLInputElement => host.querySelector('.jects-datepicker__input') as HTMLInputElement;

describe('DatePicker (jsdom)', () => {
  it('renders a combobox input with placeholder', () => {
    const p = new DatePicker(host, { placeholder: 'pick a date' });
    const input = getInput();
    expect(input).toBeTruthy();
    expect(input.getAttribute('role')).toBe('combobox');
    expect(input.getAttribute('aria-haspopup')).toBe('dialog');
    expect(input.placeholder).toBe('pick a date');
    p.destroy();
  });

  it('shows the formatted value in the input', () => {
    const p = new DatePicker(host, { value: new Date(2026, 5, 10) });
    expect(getInput().value).toBe('2026-06-10');
    p.destroy();
  });

  it('emits input on each keystroke', () => {
    const p = new DatePicker(host);
    const spy = vi.fn();
    p.on('input', spy);
    const input = getInput();
    input.value = '2026-06';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0].text).toBe('2026-06');
    p.destroy();
  });

  it('commits a typed valid date on Enter and emits change', () => {
    const p = new DatePicker(host);
    const spy = vi.fn();
    p.on('change', spy);
    const input = getInput();
    input.value = '2026-06-12';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(p.getValue()!.getDate()).toBe(12);
    p.destroy();
  });

  it('opens the popover (calendar) on ArrowDown and sets aria-expanded', () => {
    const p = new DatePicker(host);
    const input = getInput();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(input.getAttribute('aria-expanded')).toBe('true');
    // The calendar popover is portaled to document.body while open (escapes
    // overflow), so it is no longer inside `host`.
    expect(document.querySelector('.jects-minical')).toBeTruthy();
    p.destroy();
  });

  it('selecting a calendar day commits the value and closes the popover', () => {
    const p = new DatePicker(host, { value: new Date(2026, 5, 1) });
    p.open();
    const spy = vi.fn();
    p.on('change', spy);
    // Calendar is portaled to body while open.
    (document.querySelector('[data-date="2026-06-15"]') as HTMLButtonElement).click();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(p.getValue()!.getDate()).toBe(15);
    expect(getInput().getAttribute('aria-expanded')).toBe('false');
    p.destroy();
  });

  it('rejects an out-of-range typed date', () => {
    const p = new DatePicker(host, { min: new Date(2026, 5, 10), max: new Date(2026, 5, 20) });
    const spy = vi.fn();
    p.on('change', spy);
    const input = getInput();
    input.value = '2026-06-01';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(spy).not.toHaveBeenCalled();
    expect(p.getValue()).toBeNull();
    p.destroy();
  });

  it('destroy removes the element', () => {
    const p = new DatePicker(host);
    p.destroy();
    expect(host.querySelector('.jects-datepicker')).toBeNull();
  });
});
