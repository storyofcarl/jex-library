/** jsdom unit test for TimePicker — render, stepping, AM/PM toggle, change event. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TimePicker } from './time-picker.js';

let host: HTMLElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  host.remove();
});

const fields = (): { h: HTMLInputElement; m: HTMLInputElement; period: HTMLButtonElement } => ({
  h: host.querySelectorAll('.jects-timepicker__field')[0] as HTMLInputElement,
  m: host.querySelectorAll('.jects-timepicker__field')[1] as HTMLInputElement,
  period: host.querySelector('.jects-timepicker__period') as HTMLButtonElement,
});

describe('TimePicker (jsdom)', () => {
  it('renders two spinbutton fields and a period toggle in 12h mode', () => {
    const t = new TimePicker(host, { value: { hours: 9, minutes: 5 } });
    const { h, m, period } = fields();
    expect(h.getAttribute('role')).toBe('spinbutton');
    expect(h.value).toBe('09');
    expect(m.value).toBe('05');
    expect(period.textContent).toBe('AM');
    expect(period.hidden).toBe(false);
    t.destroy();
  });

  it('shows 24-hour values and hides the period toggle in 24h mode', () => {
    const t = new TimePicker(host, { value: { hours: 18, minutes: 30 }, hour12: false });
    const { h, period } = fields();
    expect(h.value).toBe('18');
    expect(period.hidden).toBe(true);
    t.destroy();
  });

  it('ArrowUp on minutes steps by the configured step and emits change', () => {
    const t = new TimePicker(host, { value: { hours: 9, minutes: 0 }, step: 15 });
    const spy = vi.fn();
    t.on('change', spy);
    fields().m.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(t.getValue().minutes).toBe(15);
    t.destroy();
  });

  it('ArrowDown on hours wraps and decrements', () => {
    const t = new TimePicker(host, { value: { hours: 0, minutes: 0 }, hour12: false });
    fields().h.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(t.getValue().hours).toBe(23);
    t.destroy();
  });

  it('toggling AM/PM shifts hours by 12 and updates aria-pressed', () => {
    const t = new TimePicker(host, { value: { hours: 9, minutes: 0 } });
    const spy = vi.fn();
    t.on('change', spy);
    fields().period.click();
    expect(t.getValue().hours).toBe(21);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(fields().period.getAttribute('aria-pressed')).toBe('true');
    t.destroy();
  });

  it('beforeChange veto cancels the change', () => {
    const t = new TimePicker(host, { value: { hours: 9, minutes: 0 } });
    const changeSpy = vi.fn();
    t.on('beforeChange', () => false);
    t.on('change', changeSpy);
    fields().m.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    expect(changeSpy).not.toHaveBeenCalled();
    t.destroy();
  });

  it('typing a minute value snaps to the step on change', () => {
    const t = new TimePicker(host, { value: { hours: 9, minutes: 0 }, step: 15 });
    const m = fields().m;
    m.value = '20';
    m.dispatchEvent(new Event('change', { bubbles: true }));
    expect(t.getValue().minutes).toBe(15);
    t.destroy();
  });

  it('destroy removes the element', () => {
    const t = new TimePicker(host, {});
    t.destroy();
    expect(host.querySelector('.jects-timepicker')).toBeNull();
  });
});
