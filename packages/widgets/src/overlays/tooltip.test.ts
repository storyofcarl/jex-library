/** jsdom unit test for Tooltip — render + interaction + emitted event. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Tooltip } from './tooltip.js';

let host: HTMLElement;
let target: HTMLElement;

beforeEach(() => {
  vi.useFakeTimers();
  host = document.createElement('div');
  target = document.createElement('button');
  document.body.append(host, target);
});
afterEach(() => {
  vi.useRealTimers();
  host.remove();
  target.remove();
});

describe('Tooltip (jsdom)', () => {
  it('renders a tooltip role element hidden by default', () => {
    const t = new Tooltip(host, { target, text: 'Hint' });
    const el = host.querySelector('.jects-tooltip') as HTMLElement;
    expect(el).toBeTruthy();
    expect(el.getAttribute('role')).toBe('tooltip');
    expect(el.hidden).toBe(true);
    expect(el.textContent).toBe('Hint');
    t.destroy();
  });

  it('wires aria-describedby onto the target', () => {
    const t = new Tooltip(host, { target, text: 'Hint' });
    const el = host.querySelector('.jects-tooltip') as HTMLElement;
    expect(target.getAttribute('aria-describedby')).toBe(el.id);
    t.destroy();
  });

  it('shows after the configured delay on pointerenter and emits shown', () => {
    const t = new Tooltip(host, { target, text: 'Hint', showDelay: 200 });
    const spy = vi.fn();
    t.on('shown', spy);
    target.dispatchEvent(new Event('pointerenter'));
    expect(t.isVisible).toBe(false);
    vi.advanceTimersByTime(200);
    expect(t.isVisible).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0].tooltip).toBe(t);
    t.destroy();
  });

  it('hides on pointerleave and emits hidden', () => {
    const t = new Tooltip(host, { target, text: 'Hint', showDelay: 0, hideDelay: 0 });
    t.showNow();
    const spy = vi.fn();
    t.on('hidden', spy);
    target.dispatchEvent(new Event('pointerleave'));
    vi.advanceTimersByTime(0);
    expect(t.isVisible).toBe(false);
    expect(spy).toHaveBeenCalledTimes(1);
    t.destroy();
  });

  it('Escape on the target hides immediately', () => {
    const t = new Tooltip(host, { target, text: 'Hint' });
    t.showNow();
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(t.isVisible).toBe(false);
    t.destroy();
  });

  it('focus shows the tooltip', () => {
    const t = new Tooltip(host, { target, text: 'Hint', showDelay: 50 });
    target.dispatchEvent(new Event('focusin'));
    vi.advanceTimersByTime(50);
    expect(t.isVisible).toBe(true);
    t.destroy();
  });

  it('destroy removes element and unwires the target', () => {
    const t = new Tooltip(host, { target, text: 'Hint' });
    t.destroy();
    expect(host.querySelector('.jects-tooltip')).toBeNull();
    expect(target.hasAttribute('aria-describedby')).toBe(false);
  });
});
