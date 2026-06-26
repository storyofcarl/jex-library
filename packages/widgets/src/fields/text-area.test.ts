/** jsdom unit test for TextArea — render + interaction + emitted event. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TextArea } from './text-area.js';

let host: HTMLElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  host.remove();
});

describe('TextArea (jsdom)', () => {
  it('renders a textarea with label, rows and value', () => {
    const f = new TextArea(host, { label: 'Bio', rows: 5, value: 'hello' });
    const ta = host.querySelector('textarea') as HTMLTextAreaElement;
    expect(ta).toBeTruthy();
    expect(ta.value).toBe('hello');
    expect(ta.rows).toBe(5);
    expect(host.querySelector('.jects-textarea__label')!.textContent).toContain('Bio');
    f.destroy();
  });

  it('emits input when typing', () => {
    const f = new TextArea(host);
    const spy = vi.fn();
    f.on('input', spy);
    const ta = host.querySelector('textarea') as HTMLTextAreaElement;
    ta.value = 'typed';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0].value).toBe('typed');
    f.destroy();
  });

  it('renders and updates the maxLength counter', () => {
    const f = new TextArea(host, { maxLength: 100, value: 'abc' });
    const counter = host.querySelector('.jects-textarea__counter') as HTMLElement;
    expect(counter.textContent).toBe('3 / 100');
    const ta = host.querySelector('textarea') as HTMLTextAreaElement;
    expect(ta.maxLength).toBe(100);
    ta.value = 'abcde';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    expect(counter.textContent).toBe('5 / 100');
    f.destroy();
  });

  it('autoGrow applies the modifier class', () => {
    const f = new TextArea(host, { autoGrow: true });
    expect(host.querySelector('.jects-textarea--autogrow')).toBeTruthy();
    f.destroy();
  });

  it('autoGrow height includes the border so the last line is not clipped', () => {
    const f = new TextArea(host, { autoGrow: true });
    const ta = host.querySelector('textarea') as HTMLTextAreaElement;
    // jsdom does not lay out; simulate a 2px top/bottom border + content scrollHeight.
    ta.style.borderTopWidth = '1px';
    ta.style.borderBottomWidth = '1px';
    Object.defineProperty(ta, 'scrollHeight', { configurable: true, value: 40 });
    ta.value = 'multi\nline\ntext';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    // Because the textarea is border-box, the grown height must add both borders
    // (40 + 1 + 1 = 42px) — otherwise descenders on the last line are clipped.
    expect(ta.style.height).toBe('42px');
    f.destroy();
  });

  it('error sets aria-invalid and renders message', () => {
    const f = new TextArea(host, { error: 'Too short' });
    const ta = host.querySelector('textarea') as HTMLTextAreaElement;
    expect(ta.getAttribute('aria-invalid')).toBe('true');
    expect(host.querySelector('.jects-textarea__error')!.textContent).toBe('Too short');
    f.destroy();
  });

  it('disabled reflects on the textarea', () => {
    const f = new TextArea(host, { disabled: true });
    expect((host.querySelector('textarea') as HTMLTextAreaElement).disabled).toBe(true);
    f.destroy();
  });

  it('destroy removes the element', () => {
    const f = new TextArea(host);
    f.destroy();
    expect(host.querySelector('.jects-textarea')).toBeNull();
  });
});
