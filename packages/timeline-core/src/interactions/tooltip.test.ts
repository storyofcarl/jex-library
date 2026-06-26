/** jsdom unit tests for the TimelineTooltip controller. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TimelineTooltip } from './tooltip.js';

let host: HTMLElement;
beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  host.remove();
  vi.useRealTimers();
});

describe('TimelineTooltip', () => {
  it('appends a hidden role=tooltip element to the host', () => {
    const tip = new TimelineTooltip({ host });
    const el = tip.element;
    expect(host.contains(el)).toBe(true);
    expect(el.getAttribute('role')).toBe('tooltip');
    expect(el.hidden).toBe(true);
    expect(tip.isVisible).toBe(false);
    tip.destroy();
  });

  it('showAt renders text + position and reveals immediately (no delay)', () => {
    const tip = new TimelineTooltip({ host, placement: 'top', offset: 8 });
    tip.showAt({ text: 'Task A', x: 40, y: 20 });
    const el = tip.element;
    expect(el.hidden).toBe(false);
    expect(tip.isVisible).toBe(true);
    expect(el.textContent).toBe('Task A');
    expect(el.style.getPropertyValue('--_tt-x')).toBe('40px');
    // top placement subtracts the offset.
    expect(el.style.getPropertyValue('--_tt-y')).toBe('12px');
    tip.destroy();
  });

  it('renders trusted html when provided', () => {
    const tip = new TimelineTooltip({ host });
    tip.showAt({ html: '<b>bold</b>', x: 0, y: 0 });
    expect(tip.element.innerHTML).toBe('<b>bold</b>');
    tip.destroy();
  });

  it('bottom placement adds the offset', () => {
    const tip = new TimelineTooltip({ host, placement: 'bottom', offset: 6 });
    tip.showAt({ text: 'x', x: 10, y: 30 });
    expect(tip.element.style.getPropertyValue('--_tt-y')).toBe('36px');
    tip.destroy();
  });

  it('respects showDelay before revealing', () => {
    vi.useFakeTimers();
    const tip = new TimelineTooltip({ host, showDelay: 100 });
    tip.showAt({ text: 'late', x: 0, y: 0 });
    expect(tip.isVisible).toBe(false);
    vi.advanceTimersByTime(100);
    expect(tip.isVisible).toBe(true);
    tip.destroy();
  });

  it('hide cancels a pending delayed show', () => {
    vi.useFakeTimers();
    const tip = new TimelineTooltip({ host, showDelay: 100 });
    tip.showAt({ text: 'x', x: 0, y: 0 });
    tip.hide();
    vi.advanceTimersByTime(200);
    expect(tip.isVisible).toBe(false);
    tip.destroy();
  });

  it('moveTo updates position without re-rendering content', () => {
    const tip = new TimelineTooltip({ host, placement: 'follow' });
    tip.showAt({ text: 'drag', x: 0, y: 0 });
    tip.moveTo(50, 50);
    expect(tip.element.style.getPropertyValue('--_tt-x')).toBe('50px');
    expect(tip.element.textContent).toBe('drag');
    tip.destroy();
  });

  it('destroy removes the element and is idempotent', () => {
    const tip = new TimelineTooltip({ host });
    const el = tip.element;
    tip.destroy();
    tip.destroy();
    expect(host.contains(el)).toBe(false);
  });

  it('ignores showAt after destroy', () => {
    const tip = new TimelineTooltip({ host });
    tip.destroy();
    tip.showAt({ text: 'x', x: 0, y: 0 });
    expect(tip.isVisible).toBe(false);
  });
});
