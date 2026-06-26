/** jsdom unit test for Slider — render + interaction + emitted event. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Slider } from './slider.js';

let host: HTMLElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  host.remove();
});

describe('Slider (jsdom)', () => {
  it('renders a slider thumb with aria attributes', () => {
    const s = new Slider(host, { min: 0, max: 10, value: 5 });
    const thumb = host.querySelector('.jects-slider__thumb')!;
    expect(thumb.getAttribute('role')).toBe('slider');
    expect(thumb.getAttribute('aria-valuemin')).toBe('0');
    expect(thumb.getAttribute('aria-valuemax')).toBe('10');
    expect(thumb.getAttribute('aria-valuenow')).toBe('5');
    s.destroy();
  });

  it('clamps and steps the value', () => {
    const s = new Slider(host, { min: 0, max: 10, step: 2, value: 5 });
    s.setValue(7);
    expect(s.getConfig().value).toBe(8); // 7 snaps to nearest step of 2 -> 8
    s.setValue(3);
    expect(s.getConfig().value).toBe(4); // 3 snaps up to 4
    s.setValue(100);
    expect(s.getConfig().value).toBe(10);
    s.destroy();
  });

  it('keyboard ArrowRight increments and emits change', () => {
    const s = new Slider(host, { min: 0, max: 10, step: 1, value: 5 });
    const spy = vi.fn();
    s.on('change', spy);
    const thumb = host.querySelector('.jects-slider__thumb') as HTMLElement;
    thumb.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(s.getConfig().value).toBe(6);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0].value).toBe(6);
    s.destroy();
  });

  it('Home/End jump to bounds', () => {
    const s = new Slider(host, { min: 2, max: 8, value: 5 });
    const thumb = host.querySelector('.jects-slider__thumb') as HTMLElement;
    thumb.dispatchEvent(new KeyboardEvent('keydown', { key: 'End' }));
    expect(s.getConfig().value).toBe(8);
    thumb.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home' }));
    expect(s.getConfig().value).toBe(2);
    s.destroy();
  });

  it('beforeChange veto cancels the change', () => {
    const s = new Slider(host, { value: 5 });
    s.on('beforeChange', () => false);
    s.setValue(9);
    expect(s.getConfig().value).toBe(5);
    s.destroy();
  });

  it('disabled blocks keyboard changes', () => {
    const s = new Slider(host, { value: 5, disabled: true });
    const thumb = host.querySelector('.jects-slider__thumb') as HTMLElement;
    thumb.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    expect(s.getConfig().value).toBe(5);
    s.destroy();
  });

  it('destroy removes the element', () => {
    const s = new Slider(host, { value: 3 });
    s.destroy();
    expect(host.querySelector('.jects-slider')).toBeNull();
  });
});
