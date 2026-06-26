/** jsdom unit test — runs in the default `pnpm test`. Covers render + interaction + event. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ColorPicker, parseHex } from './color-picker.js';

let host: HTMLElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  host.remove();
});

describe('ColorPicker (jsdom)', () => {
  it('renders a trigger and popover with controls', () => {
    const p = new ColorPicker(host, { value: '#ff0000' });
    expect(host.querySelector('.jects-colorpicker')).toBeTruthy();
    const trigger = host.querySelector('.jects-colorpicker__trigger') as HTMLButtonElement;
    expect(trigger).toBeTruthy();
    expect(trigger.getAttribute('aria-haspopup')).toBe('dialog');
    expect(host.querySelector('.jects-colorpicker__sv')).toBeTruthy();
    expect(host.querySelector('.jects-colorpicker__hue')).toBeTruthy();
    expect(host.querySelector('.jects-colorpicker__hex')).toBeTruthy();
    p.destroy();
  });

  it('initializes inputs from the value', () => {
    const p = new ColorPicker(host, { value: '#ff0000' });
    expect((host.querySelector('.jects-colorpicker__hex') as HTMLInputElement).value).toBe('#ff0000');
    expect(p.getValue()).toBe('#ff0000');
    p.destroy();
  });

  it('renders the default CMYK swatch palette', () => {
    const p = new ColorPicker(host);
    const swatches = host.querySelectorAll('.jects-colorpicker__swatch');
    expect(swatches.length).toBe(10);
    p.destroy();
  });

  it('toggles the popover open/closed and emits open/close', () => {
    const p = new ColorPicker(host);
    const openSpy = vi.fn();
    const closeSpy = vi.fn();
    p.on('open', openSpy);
    p.on('close', closeSpy);
    const trigger = host.querySelector('.jects-colorpicker__trigger') as HTMLButtonElement;
    const popover = host.querySelector('.jects-colorpicker__popover') as HTMLElement;
    expect(popover.hidden).toBe(true);
    trigger.click();
    expect(popover.hidden).toBe(false);
    expect(openSpy).toHaveBeenCalledTimes(1);
    trigger.click();
    expect(popover.hidden).toBe(true);
    expect(closeSpy).toHaveBeenCalledTimes(1);
    p.destroy();
  });

  it('emits change when the hex input changes', () => {
    const p = new ColorPicker(host, { value: '#000000' });
    const spy = vi.fn();
    p.on('change', spy);
    const hex = host.querySelector('.jects-colorpicker__hex') as HTMLInputElement;
    hex.value = '#00ff00';
    hex.dispatchEvent(new Event('change'));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0].value).toBe('#00ff00');
    expect(p.getValue()).toBe('#00ff00');
    p.destroy();
  });

  it('clicking a swatch updates the value and emits change', () => {
    const p = new ColorPicker(host, { value: '#000000', swatches: ['#ffffff', '#123456'] });
    const spy = vi.fn();
    p.on('change', spy);
    const swatch = host.querySelectorAll('.jects-colorpicker__swatch')[1] as HTMLButtonElement;
    swatch.click();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(p.getValue()).toBe('#123456');
    p.destroy();
  });

  it('RGB inputs drive the value', () => {
    const p = new ColorPicker(host, { value: '#000000' });
    const inputs = host.querySelectorAll('.jects-colorpicker__num');
    const r = inputs[0] as HTMLInputElement;
    r.value = '255';
    r.dispatchEvent(new Event('change'));
    expect(p.getValue()).toBe('#ff0000');
    p.destroy();
  });

  it('beforeChange veto rejects the new value', () => {
    const p = new ColorPicker(host, { value: '#000000' });
    const changeSpy = vi.fn();
    p.on('beforeChange', () => false);
    p.on('change', changeSpy);
    const hex = host.querySelector('.jects-colorpicker__hex') as HTMLInputElement;
    hex.value = '#abcdef';
    hex.dispatchEvent(new Event('change'));
    expect(changeSpy).not.toHaveBeenCalled();
    expect(p.getValue()).toBe('#000000');
    p.destroy();
  });

  it('setValue produces alpha-aware hex when alpha < 1', () => {
    const p = new ColorPicker(host, { value: '#000000', alpha: true });
    p.setValue('#ff000080');
    expect(p.getValue()).toBe('#ff000080');
    p.destroy();
  });

  it('keyboard adjusts saturation/value on the SV area', () => {
    const p = new ColorPicker(host, { value: '#808080' });
    const spy = vi.fn();
    p.on('change', spy);
    const sv = host.querySelector('.jects-colorpicker__sv') as HTMLElement;
    sv.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(spy).toHaveBeenCalled();
    p.destroy();
  });

  it('disabled blocks opening', () => {
    const p = new ColorPicker(host, { disabled: true });
    const trigger = host.querySelector('.jects-colorpicker__trigger') as HTMLButtonElement;
    expect(trigger.disabled).toBe(true);
    trigger.click();
    expect((host.querySelector('.jects-colorpicker__popover') as HTMLElement).hidden).toBe(true);
    p.destroy();
  });

  it('destroy removes the element', () => {
    const p = new ColorPicker(host);
    p.destroy();
    expect(host.querySelector('.jects-colorpicker')).toBeNull();
  });
});

describe('parseHex', () => {
  it('parses #rgb / #rrggbb / #rrggbbaa', () => {
    expect(parseHex('#f00')).toEqual({ r: 255, g: 0, b: 0, a: 1 });
    expect(parseHex('00ff00')).toEqual({ r: 0, g: 255, b: 0, a: 1 });
    expect(parseHex('#ff000080')).toEqual({ r: 255, g: 0, b: 0, a: 128 / 255 });
  });
  it('rejects invalid input', () => {
    expect(parseHex('nope')).toBeNull();
    expect(parseHex('#12345')).toBeNull();
  });
});
