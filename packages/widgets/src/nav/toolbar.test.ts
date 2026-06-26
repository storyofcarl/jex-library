/** jsdom unit test for Toolbar — render + interaction + events. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Toolbar, type ToolbarItem } from './toolbar.js';

let host: HTMLElement;

const items: ToolbarItem[] = [
  { id: 'bold', icon: 'plus', label: 'Bold' },
  { id: 'italic', icon: 'minus', label: 'Italic' },
  { separator: true },
  { id: 'link', text: 'Link' },
];

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  host.remove();
});

describe('Toolbar (jsdom)', () => {
  it('renders toolbar role and buttons', () => {
    const t = new Toolbar(host, { items });
    expect(t.el.getAttribute('role')).toBe('toolbar');
    expect(t.el.getAttribute('aria-orientation')).toBe('horizontal');
    expect(t.getButton('bold')).toBeTruthy();
    expect(host.querySelector('.jects-toolbar__separator')!.getAttribute('role')).toBe('separator');
    t.destroy();
  });

  it('icon-only buttons get an aria-label', () => {
    const t = new Toolbar(host, { items });
    expect(t.getButton('bold')!.el.getAttribute('aria-label')).toBe('Bold');
    t.destroy();
  });

  it('emits action on button click', () => {
    const t = new Toolbar(host, { items });
    const spy = vi.fn();
    t.on('action', spy);
    (t.getButton('link')!.el as HTMLButtonElement).click();
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ id: 'link' }));
    t.destroy();
  });

  it('beforeAction veto cancels action', () => {
    const t = new Toolbar(host, { items });
    const spy = vi.fn();
    t.on('beforeAction', () => false);
    t.on('action', spy);
    (t.getButton('link')!.el as HTMLButtonElement).click();
    expect(spy).not.toHaveBeenCalled();
    t.destroy();
  });

  it('applies roving tabindex (only first focusable is tabbable)', () => {
    const t = new Toolbar(host, { items });
    const btns = Array.from(host.querySelectorAll('.jects-btn')) as HTMLElement[];
    expect(btns[0]!.tabIndex).toBe(0);
    expect(btns[1]!.tabIndex).toBe(-1);
    t.destroy();
  });

  it('ArrowRight moves roving focus to the next button', () => {
    const t = new Toolbar(host, { items });
    const btns = Array.from(host.querySelectorAll('.jects-btn')) as HTMLElement[];
    btns[0]!.focus();
    t.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(btns[1]!.tabIndex).toBe(0);
    expect(btns[0]!.tabIndex).toBe(-1);
    t.destroy();
  });

  it('overflowAfter collapses extra items into an overflow menu', () => {
    const many: ToolbarItem[] = [
      { id: 'a', text: 'A' },
      { id: 'b', text: 'B' },
      { id: 'c', text: 'C' },
      { id: 'd', text: 'D' },
    ];
    const t = new Toolbar(host, { items: many, overflowAfter: 2 });
    expect(t.getButton('a')).toBeTruthy();
    expect(t.getButton('c')).toBeUndefined();
    const trigger = t.getButton('__overflow')!;
    expect(trigger.el.getAttribute('aria-haspopup')).toBe('true');
    const spy = vi.fn();
    t.on('action', spy);
    (trigger.el as HTMLButtonElement).click();
    (host.querySelector('.jects-toolbar__overflow-menu [data-id="c"]') as HTMLElement).click();
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ id: 'c' }));
    t.destroy();
  });

  it('overflow trigger exposes aria-expanded=false before first interaction', () => {
    const many: ToolbarItem[] = [
      { id: 'a', text: 'A' },
      { id: 'b', text: 'B' },
      { id: 'c', text: 'C' },
    ];
    const t = new Toolbar(host, { items: many, overflowAfter: 2 });
    expect(t.getButton('__overflow')!.el.getAttribute('aria-expanded')).toBe('false');
    t.destroy();
  });

  it('Escape closes the overflow menu and returns focus to the trigger', () => {
    const many: ToolbarItem[] = [
      { id: 'a', text: 'A' },
      { id: 'b', text: 'B' },
      { id: 'c', text: 'C' },
    ];
    const t = new Toolbar(host, { items: many, overflowAfter: 2 });
    const trigger = t.getButton('__overflow')!;
    (trigger.el as HTMLButtonElement).click();
    const menuHost = host.querySelector('.jects-toolbar__overflow-menu') as HTMLElement;
    expect(menuHost.hidden).toBe(false);
    expect(trigger.el.getAttribute('aria-expanded')).toBe('true');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(menuHost.hidden).toBe(true);
    expect(trigger.el.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger.el);
    t.destroy();
  });

  it('outside pointerdown closes the overflow menu', () => {
    const many: ToolbarItem[] = [
      { id: 'a', text: 'A' },
      { id: 'b', text: 'B' },
      { id: 'c', text: 'C' },
    ];
    const t = new Toolbar(host, { items: many, overflowAfter: 2 });
    const trigger = t.getButton('__overflow')!;
    (trigger.el as HTMLButtonElement).click();
    const menuHost = host.querySelector('.jects-toolbar__overflow-menu') as HTMLElement;
    expect(menuHost.hidden).toBe(false);
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(menuHost.hidden).toBe(true);
    expect(trigger.el.getAttribute('aria-expanded')).toBe('false');
    t.destroy();
  });

  it('destroy cleans up child buttons', () => {
    const t = new Toolbar(host, { items });
    t.destroy();
    expect(host.querySelector('.jects-toolbar')).toBeNull();
  });
});
