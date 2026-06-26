/** jsdom unit test for DateTimeField — render, combined value, change event. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DateTimeField } from './date-time-field.js';

let host: HTMLElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  host.remove();
});

describe('DateTimeField (jsdom)', () => {
  it('renders a date part and a time part', () => {
    const f = new DateTimeField(host, { value: new Date(2026, 5, 10, 9, 30) });
    expect(host.querySelector('.jects-datepicker')).toBeTruthy();
    expect(host.querySelector('.jects-timepicker')).toBeTruthy();
    f.destroy();
  });

  it('seeds both children from the combined value', () => {
    const f = new DateTimeField(host, { value: new Date(2026, 5, 10, 9, 30) });
    const input = host.querySelector('.jects-datepicker__input') as HTMLInputElement;
    const hourField = host.querySelectorAll('.jects-timepicker__field')[0] as HTMLInputElement;
    expect(input.value).toBe('2026-06-10');
    expect(hourField.value).toBe('09');
    f.destroy();
  });

  it('combines a date selection with the current time and emits change', () => {
    const f = new DateTimeField(host, { value: new Date(2026, 5, 1, 8, 0) });
    const spy = vi.fn();
    f.on('change', spy);
    // open the calendar and pick a day
    const input = host.querySelector('.jects-datepicker__input') as HTMLInputElement;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    // The calendar is portaled to document.body while open (escapes overflow).
    (document.querySelector('[data-date="2026-06-15"]') as HTMLButtonElement).click();
    expect(spy).toHaveBeenCalled();
    const v = f.getValue()!;
    expect(v.getDate()).toBe(15);
    expect(v.getHours()).toBe(8);
    f.destroy();
  });

  it('changing the time updates the combined value', () => {
    const f = new DateTimeField(host, { value: new Date(2026, 5, 10, 9, 0), step: 15 });
    const spy = vi.fn();
    f.on('change', spy);
    const minuteField = host.querySelectorAll('.jects-timepicker__field')[1] as HTMLInputElement;
    minuteField.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    expect(spy).toHaveBeenCalled();
    expect(f.getValue()!.getMinutes()).toBe(15);
    f.destroy();
  });

  it('beforeChange veto cancels the combined change', () => {
    const f = new DateTimeField(host, { value: new Date(2026, 5, 10, 9, 0) });
    const changeSpy = vi.fn();
    f.on('beforeChange', () => false);
    f.on('change', changeSpy);
    const minuteField = host.querySelectorAll('.jects-timepicker__field')[1] as HTMLInputElement;
    minuteField.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    expect(changeSpy).not.toHaveBeenCalled();
    f.destroy();
  });

  it('reverts child + internal state when a combined change is vetoed', () => {
    const f = new DateTimeField(host, { value: new Date(2026, 5, 10, 9, 0), step: 15 });
    f.on('beforeChange', () => false);
    const minuteField = host.querySelectorAll('.jects-timepicker__field')[1] as HTMLInputElement;
    // Veto a +15 minute edit: the time child commits 09:15 then we veto.
    minuteField.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    // config.value is unchanged AND the child was rolled back to it.
    expect(f.getValue()!.getMinutes()).toBe(0);
    expect(minuteField.value).toBe('00');
    f.destroy();
  });

  it('re-emits change after a vetoed edit is retried with veto removed', () => {
    const f = new DateTimeField(host, { value: new Date(2026, 5, 10, 9, 0), step: 15 });
    const veto = vi.fn(() => false as const);
    const off = f.on('beforeChange', veto);
    const changeSpy = vi.fn();
    f.on('change', changeSpy);
    const minuteField = host.querySelectorAll('.jects-timepicker__field')[1] as HTMLInputElement;
    // First edit vetoed -> reverted; no change.
    minuteField.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    expect(changeSpy).not.toHaveBeenCalled();
    // Remove veto and make the SAME edit again; it must now emit because internal
    // state was reverted to config.value (not left at the rejected 09:15).
    off();
    minuteField.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    expect(changeSpy).toHaveBeenCalledTimes(1);
    expect(f.getValue()!.getMinutes()).toBe(15);
    f.destroy();
  });

  it('update({ value }) propagates to both children', () => {
    const f = new DateTimeField(host, { value: new Date(2026, 5, 10, 9, 0) });
    f.update({ value: new Date(2027, 0, 2, 14, 45) });
    const input = host.querySelector('.jects-datepicker__input') as HTMLInputElement;
    const hourField = host.querySelectorAll('.jects-timepicker__field')[0] as HTMLInputElement;
    expect(input.value).toBe('2027-01-02');
    // 14h -> 02 PM in 12h mode
    expect(hourField.value).toBe('02');
    f.destroy();
  });

  it('destroy removes the element and children', () => {
    const f = new DateTimeField(host, {});
    f.destroy();
    expect(host.querySelector('.jects-datetimefield')).toBeNull();
    expect(host.querySelector('.jects-datepicker')).toBeNull();
  });
});
