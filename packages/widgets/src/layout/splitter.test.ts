/** jsdom unit test — runs in the default `pnpm test`. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Splitter } from './splitter.js';

let host: HTMLElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  host.remove();
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
});

describe('Splitter (jsdom)', () => {
  it('renders two panes and a separator handle with aria', () => {
    const s = new Splitter(host, { first: 'A', second: 'B' });
    const el = host.querySelector('.jects-splitter')!;
    expect(el.querySelector('.jects-splitter__pane--first')!.textContent).toBe('A');
    expect(el.querySelector('.jects-splitter__pane--second')!.textContent).toBe('B');
    const handle = el.querySelector('.jects-splitter__handle') as HTMLElement;
    expect(handle.getAttribute('role')).toBe('separator');
    expect(handle.getAttribute('aria-orientation')).toBe('vertical'); // horizontal split => vertical bar
    expect(handle.getAttribute('aria-valuenow')).toBe('50');
    s.destroy();
  });

  it('applies the ratio as a CSS custom property', () => {
    const s = new Splitter(host, { ratio: 0.3 });
    const el = host.querySelector('.jects-splitter') as HTMLElement;
    expect(el.style.getPropertyValue('--_splitter-ratio')).toBe('30');
    s.destroy();
  });

  it('clamps ratio to [min, max]', () => {
    const s = new Splitter(host, { ratio: 0.99, min: 0.2, max: 0.8 });
    expect(s.ratio).toBe(0.8);
    s.setRatio(0.01);
    expect(s.ratio).toBe(0.2);
    s.destroy();
  });

  it('setRatio emits resize and calls onResize', () => {
    const onResize = vi.fn();
    const s = new Splitter(host, { ratio: 0.5, onResize });
    const spy = vi.fn();
    s.on('resize', spy);
    s.setRatio(0.6);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0].ratio).toBeCloseTo(0.6);
    expect(onResize).toHaveBeenCalledWith(expect.closeTo(0.6));
    s.destroy();
  });

  it('beforeResize veto cancels the change', () => {
    const s = new Splitter(host, { ratio: 0.5 });
    s.on('beforeResize', () => false);
    s.setRatio(0.7);
    expect(s.ratio).toBe(0.5);
    s.destroy();
  });

  it('keyboard ArrowRight/ArrowLeft adjusts ratio by step (horizontal)', () => {
    const s = new Splitter(host, { ratio: 0.5, step: 0.1 });
    const handle = host.querySelector('.jects-splitter__handle') as HTMLElement;
    handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(s.ratio).toBeCloseTo(0.6);
    handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(s.ratio).toBeCloseTo(0.5);
    s.destroy();
  });

  it('Home/End jump to min/max', () => {
    const s = new Splitter(host, { ratio: 0.5, min: 0.15, max: 0.85 });
    const handle = host.querySelector('.jects-splitter__handle') as HTMLElement;
    handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    expect(s.ratio).toBe(0.85);
    handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    expect(s.ratio).toBe(0.15);
    s.destroy();
  });

  it('vertical orientation reports horizontal separator and uses Arrow Up/Down', () => {
    const s = new Splitter(host, { orientation: 'vertical', ratio: 0.5, step: 0.1 });
    const handle = host.querySelector('.jects-splitter__handle') as HTMLElement;
    expect(handle.getAttribute('aria-orientation')).toBe('horizontal');
    handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(s.ratio).toBeCloseTo(0.6);
    s.destroy();
  });

  it('disabled blocks keyboard and setRatio', () => {
    const s = new Splitter(host, { ratio: 0.5, disabled: true });
    const handle = host.querySelector('.jects-splitter__handle') as HTMLElement;
    handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    s.setRatio(0.8);
    expect(s.ratio).toBe(0.5);
    expect(handle.tabIndex).toBe(-1);
    s.destroy();
  });

  it('persists the ratio to localStorage and restores on a new instance', () => {
    const s = new Splitter(host, { ratio: 0.5, persist: 'jects-test-split' });
    s.setRatio(0.4);
    expect(localStorage.getItem('jects-test-split')).toBe('0.4');
    s.destroy();
    const host2 = document.createElement('div');
    document.body.appendChild(host2);
    const s2 = new Splitter(host2, { ratio: 0.5, persist: 'jects-test-split' });
    expect(s2.ratio).toBeCloseTo(0.4);
    s2.destroy();
    host2.remove();
  });

  it('destroy() removes the element', () => {
    const s = new Splitter(host, { first: 'A', second: 'B' });
    s.destroy();
    expect(host.querySelector('.jects-splitter')).toBeNull();
  });
});
