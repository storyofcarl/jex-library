/** jsdom unit test for ProgressBar — render + interaction + emitted event. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ProgressBar } from './progress-bar.js';

let host: HTMLElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  host.remove();
});

describe('ProgressBar (jsdom)', () => {
  it('renders with progressbar role and aria values', () => {
    const p = new ProgressBar(host, { value: 40, max: 100 });
    const el = host.querySelector('.jects-progress')!;
    expect(el.getAttribute('role')).toBe('progressbar');
    expect(el.getAttribute('aria-valuenow')).toBe('40');
    expect(el.getAttribute('aria-valuemax')).toBe('100');
    const fill = host.querySelector('.jects-progress__fill') as HTMLElement;
    expect(fill.style.width).toBe('40%');
    p.destroy();
  });

  it('indeterminate omits aria-valuenow', () => {
    const p = new ProgressBar(host, { indeterminate: true });
    const el = host.querySelector('.jects-progress')!;
    expect(el.classList.contains('jects-progress--indeterminate')).toBe(true);
    expect(el.hasAttribute('aria-valuenow')).toBe(false);
    p.destroy();
  });

  it('setValue updates the bar and emits change', () => {
    const p = new ProgressBar(host, { value: 0 });
    const spy = vi.fn();
    p.on('change', spy);
    p.setValue(75);
    expect((host.querySelector('.jects-progress__fill') as HTMLElement).style.width).toBe('75%');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0].value).toBe(75);
    p.destroy();
  });

  it('emits complete when value reaches max', () => {
    const p = new ProgressBar(host, { value: 0, max: 100 });
    const spy = vi.fn();
    p.on('complete', spy);
    p.setValue(100);
    expect(spy).toHaveBeenCalledTimes(1);
    p.destroy();
  });

  it('clamps value within bounds', () => {
    const p = new ProgressBar(host, { value: 150, max: 100 });
    expect((host.querySelector('.jects-progress__fill') as HTMLElement).style.width).toBe('100%');
    p.destroy();
  });

  it('shows percentage label when requested', () => {
    const p = new ProgressBar(host, { value: 33, showLabel: true });
    expect(host.querySelector('.jects-progress__label')!.textContent).toBe('33%');
    p.destroy();
  });

  it('destroy removes the element', () => {
    const p = new ProgressBar(host, { value: 50 });
    p.destroy();
    expect(host.querySelector('.jects-progress')).toBeNull();
  });
});
