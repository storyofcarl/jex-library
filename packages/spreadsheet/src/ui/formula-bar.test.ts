/** jsdom unit test for the FormulaBar. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FormulaBar } from './formula-bar.js';

let host: HTMLElement;
let bar: FormulaBar;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  bar = new FormulaBar(host, { name: 'A1', value: '=1+1' });
});
afterEach(() => {
  bar.destroy();
  host.remove();
});

describe('FormulaBar (jsdom)', () => {
  it('renders name box + formula input with a group role', () => {
    expect(host.querySelector('[role="group"]')).toBeTruthy();
    const name = host.querySelector('.jects-fbar__name') as HTMLInputElement;
    const input = host.querySelector('.jects-fbar__input') as HTMLInputElement;
    expect(name.value).toBe('A1');
    expect(input.value).toBe('=1+1');
  });

  it('emits commit on Enter in the formula input', () => {
    const spy = vi.fn();
    bar.on('commit', spy);
    const input = host.querySelector('.jects-fbar__input') as HTMLInputElement;
    input.value = '=2+2';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ value: '=2+2' }));
  });

  it('emits navigate on Enter in the name box', () => {
    const spy = vi.fn();
    bar.on('navigate', spy);
    const name = host.querySelector('.jects-fbar__name') as HTMLInputElement;
    name.value = 'B5';
    name.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(spy).toHaveBeenCalledWith({ name: 'B5' });
  });

  it('emits cancel on Escape', () => {
    const spy = vi.fn();
    bar.on('cancel', spy);
    const input = host.querySelector('.jects-fbar__input') as HTMLInputElement;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(spy).toHaveBeenCalled();
  });

  it('setActive updates the visible fields', () => {
    bar.setActive('C3', '=SUM(A1:A2)');
    const name = host.querySelector('.jects-fbar__name') as HTMLInputElement;
    expect(name.value).toBe('C3');
    expect(bar.getValue()).toBe('=SUM(A1:A2)');
  });
});
