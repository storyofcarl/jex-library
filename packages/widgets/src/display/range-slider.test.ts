/** jsdom unit test for RangeSlider — render + interaction + emitted event. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RangeSlider } from './range-slider.js';

let host: HTMLElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  host.remove();
});

describe('RangeSlider (jsdom)', () => {
  it('renders two thumbs with slider roles', () => {
    const r = new RangeSlider(host, { min: 0, max: 100, low: 20, high: 80 });
    const thumbs = host.querySelectorAll('.jects-range__thumb');
    expect(thumbs.length).toBe(2);
    expect(thumbs[0]!.getAttribute('role')).toBe('slider');
    expect(host.querySelector('.jects-range__thumb--low')!.getAttribute('aria-valuenow')).toBe('20');
    expect(host.querySelector('.jects-range__thumb--high')!.getAttribute('aria-valuenow')).toBe('80');
    r.destroy();
  });

  it('thumbs cannot cross each other', () => {
    const r = new RangeSlider(host, { min: 0, max: 100, low: 20, high: 80 });
    r.setThumb('low', 95);
    expect(r.getConfig().low).toBe(80); // clamped to high
    r.setThumb('high', 10);
    expect(r.getConfig().high).toBe(80); // clamped to low
    r.destroy();
  });

  it('keyboard moves a thumb and emits change', () => {
    const r = new RangeSlider(host, { min: 0, max: 100, step: 5, low: 20, high: 80 });
    const spy = vi.fn();
    r.on('change', spy);
    const low = host.querySelector('.jects-range__thumb--low') as HTMLElement;
    low.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    expect(r.getConfig().low).toBe(25);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0].low).toBe(25);
    r.destroy();
  });

  it('beforeChange veto cancels', () => {
    const r = new RangeSlider(host, { low: 20, high: 80 });
    r.on('beforeChange', () => false);
    r.setThumb('low', 40);
    expect(r.getConfig().low).toBe(20);
    r.destroy();
  });

  it('destroy removes the element', () => {
    const r = new RangeSlider(host, { low: 10, high: 90 });
    r.destroy();
    expect(host.querySelector('.jects-range')).toBeNull();
  });
});
