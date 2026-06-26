/** jsdom unit test for CheckboxGroup — render + interaction + emitted event. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CheckboxGroup } from './checkbox-group.js';

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

describe('CheckboxGroup (jsdom)', () => {
  it('renders a group of checkboxes', () => {
    const g = new CheckboxGroup(host, { options: opts, value: ['a'], ariaLabel: 'Letters' });
    expect(host.querySelector('[role="group"]')).toBeTruthy();
    const inputs = host.querySelectorAll('input[type="checkbox"]');
    expect(inputs.length).toBe(3);
    expect((inputs[0] as HTMLInputElement).checked).toBe(true);
    g.destroy();
  });

  it('emits change with updated value array on toggle', () => {
    const g = new CheckboxGroup(host, { options: opts, value: ['a'] });
    const spy = vi.fn();
    g.on('change', spy);
    const inputB = host.querySelector('input[value="b"]') as HTMLInputElement;
    inputB.checked = true;
    inputB.dispatchEvent(new Event('change', { bubbles: true }));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0].value).toEqual(['a', 'b']);
    expect(g.value).toEqual(['a', 'b']);
    g.destroy();
  });

  it('unchecking removes the value', () => {
    const g = new CheckboxGroup(host, { options: opts, value: ['a', 'b'] });
    const inputA = host.querySelector('input[value="a"]') as HTMLInputElement;
    inputA.checked = false;
    inputA.dispatchEvent(new Event('change', { bubbles: true }));
    expect(g.value).toEqual(['b']);
    g.destroy();
  });

  it('beforeChange veto reverts the input', () => {
    const g = new CheckboxGroup(host, { options: opts, value: [] });
    g.on('beforeChange', () => false);
    const inputA = host.querySelector('input[value="a"]') as HTMLInputElement;
    inputA.checked = true;
    inputA.dispatchEvent(new Event('change', { bubbles: true }));
    expect(inputA.checked).toBe(false);
    expect(g.value).toEqual([]);
    g.destroy();
  });

  it('disabled option is rendered disabled', () => {
    const g = new CheckboxGroup(host, { options: opts });
    expect((host.querySelector('input[value="c"]') as HTMLInputElement).disabled).toBe(true);
    g.destroy();
  });
});
