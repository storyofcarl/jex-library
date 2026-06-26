/** jsdom unit test for Switch — render + interaction + emitted event. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Switch } from './switch.js';

let host: HTMLElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  host.remove();
});

describe('Switch (jsdom)', () => {
  it('renders a role=switch input with track and thumb', () => {
    const s = new Switch(host, { label: 'Wi-Fi' });
    const input = host.querySelector('input[role="switch"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(host.querySelector('.jects-switch__thumb')).toBeTruthy();
    expect(host.querySelector('.jects-switch__label')!.textContent).toBe('Wi-Fi');
    s.destroy();
  });

  it('emits change with new state on toggle', () => {
    const s = new Switch(host);
    const spy = vi.fn();
    s.on('change', spy);
    const input = host.querySelector('input') as HTMLInputElement;
    input.checked = true;
    input.dispatchEvent(new Event('change'));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0].checked).toBe(true);
    expect(host.querySelector('.jects-switch')!.classList.contains('jects-switch--checked')).toBe(true);
    s.destroy();
  });

  it('toggle() flips state programmatically', () => {
    const s = new Switch(host);
    const spy = vi.fn();
    s.on('change', spy);
    s.toggle();
    expect(s.checked).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    s.destroy();
  });

  it('beforeChange veto reverts', () => {
    const s = new Switch(host, { checked: true });
    s.on('beforeChange', () => false);
    const input = host.querySelector('input') as HTMLInputElement;
    input.checked = false;
    input.dispatchEvent(new Event('change'));
    expect(input.checked).toBe(true);
    s.destroy();
  });

  it('disabled disables the input', () => {
    const s = new Switch(host, { disabled: true });
    expect((host.querySelector('input') as HTMLInputElement).disabled).toBe(true);
    s.destroy();
  });
});
