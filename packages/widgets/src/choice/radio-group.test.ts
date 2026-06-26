/** jsdom unit test for RadioGroup — render + interaction + emitted event. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RadioGroup } from './radio-group.js';

let host: HTMLElement;
const opts = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Bravo' },
  { value: 'c', label: 'Charlie', disabled: true },
];

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  host.remove();
});

describe('RadioGroup (jsdom)', () => {
  it('renders a radiogroup with role=radio options', () => {
    const g = new RadioGroup(host, { options: opts, ariaLabel: 'Letters' });
    expect(host.querySelector('[role="radiogroup"]')).toBeTruthy();
    const radios = host.querySelectorAll('[role="radio"]');
    expect(radios.length).toBe(3);
    expect(host.querySelector('.jects-radio-group')!.getAttribute('aria-label')).toBe('Letters');
    g.destroy();
  });

  it('selects on click and emits change', () => {
    const g = new RadioGroup(host, { options: opts });
    const spy = vi.fn();
    g.on('change', spy);
    (host.querySelector('[data-value="b"]') as HTMLElement).click();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0].value).toBe('b');
    expect(g.value).toBe('b');
    expect(host.querySelector('[data-value="b"]')!.getAttribute('aria-checked')).toBe('true');
    g.destroy();
  });

  it('arrow key moves and selects next enabled option', () => {
    const g = new RadioGroup(host, { options: opts, value: 'a' });
    const root = host.querySelector('.jects-radio-group') as HTMLElement;
    root.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(g.value).toBe('b');
    // 'c' is disabled, so ArrowDown from 'b' wraps to enabled 'a'
    root.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(g.value).toBe('a');
    g.destroy();
  });

  it('does not select a disabled option', () => {
    const g = new RadioGroup(host, { options: opts });
    (host.querySelector('[data-value="c"]') as HTMLElement).click();
    expect(g.value).toBeUndefined();
    g.destroy();
  });

  it('roving tabindex: only the selected option is tabbable', () => {
    const g = new RadioGroup(host, { options: opts, value: 'b' });
    expect(host.querySelector('[data-value="b"]')!.getAttribute('tabindex')).toBe('0');
    expect(host.querySelector('[data-value="a"]')!.getAttribute('tabindex')).toBe('-1');
    g.destroy();
  });

  it('beforeChange veto blocks selection', () => {
    const g = new RadioGroup(host, { options: opts });
    g.on('beforeChange', () => false);
    (host.querySelector('[data-value="a"]') as HTMLElement).click();
    expect(g.value).toBeUndefined();
    g.destroy();
  });
});
