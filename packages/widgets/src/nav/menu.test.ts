/** jsdom unit test for Menu — render + interaction + events. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Menu, type MenuItem } from './menu.js';

let host: HTMLElement;

const items: MenuItem[] = [
  { id: 'new', text: 'New', icon: 'plus' },
  { id: 'open', text: 'Open' },
  { separator: true },
  { id: 'wrap', text: 'Word Wrap', checkable: true, checked: true },
  {
    id: 'recent',
    text: 'Recent',
    children: [
      { id: 'r1', text: 'File 1' },
      { id: 'r2', text: 'File 2' },
    ],
  },
  { id: 'gone', text: 'Disabled', disabled: true },
];

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  host.remove();
});

describe('Menu (jsdom)', () => {
  it('renders menu role and items with roles', () => {
    const m = new Menu(host, { items });
    expect(m.el.getAttribute('role')).toBe('menu');
    expect(host.querySelector('[data-id="new"]')!.getAttribute('role')).toBe('menuitem');
    expect(host.querySelector('[data-id="wrap"]')!.getAttribute('role')).toBe('menuitemcheckbox');
    expect(host.querySelector('.jects-menu__separator')!.getAttribute('role')).toBe('separator');
    m.destroy();
  });

  it('marks the first focusable item active with tabindex 0', () => {
    const m = new Menu(host, { items });
    const active = host.querySelector('[data-id="new"]')!;
    expect(active.classList.contains('jects-menu__item--active')).toBe(true);
    expect(active.getAttribute('tabindex')).toBe('0');
    m.destroy();
  });

  it('emits select on click of a leaf item', () => {
    const m = new Menu(host, { items });
    const spy = vi.fn();
    m.on('select', spy);
    (host.querySelector('[data-id="open"]') as HTMLElement).click();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0].id).toBe('open');
    m.destroy();
  });

  it('beforeSelect veto cancels select', () => {
    const m = new Menu(host, { items });
    const sel = vi.fn();
    m.on('beforeSelect', () => false);
    m.on('select', sel);
    (host.querySelector('[data-id="open"]') as HTMLElement).click();
    expect(sel).not.toHaveBeenCalled();
    m.destroy();
  });

  it('toggles a checkable item and emits check', () => {
    const m = new Menu(host, { items });
    const spy = vi.fn();
    m.on('check', spy);
    expect(m.isItemChecked('wrap')).toBe(true);
    (host.querySelector('[data-id="wrap"]') as HTMLElement).click();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(m.isItemChecked('wrap')).toBe(false);
    expect(host.querySelector('[data-id="wrap"]')!.getAttribute('aria-checked')).toBe('false');
    m.destroy();
  });

  it('opens a submenu on click and emits submenu', () => {
    const m = new Menu(host, { items });
    const spy = vi.fn();
    m.on('submenu', spy);
    (host.querySelector('[data-id="recent"]') as HTMLElement).click();
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ id: 'recent', open: true }));
    expect(host.querySelector('[data-id="recent"]')!.getAttribute('aria-expanded')).toBe('true');
    expect(host.querySelector('[data-id="r1"]')).toBeTruthy();
    m.destroy();
  });

  it('ArrowDown moves active to next focusable item', () => {
    const m = new Menu(host, { items });
    m.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(host.querySelector('[data-id="open"]')!.classList.contains('jects-menu__item--active')).toBe(true);
    m.destroy();
  });

  it('Enter activates the active item', () => {
    const m = new Menu(host, { items });
    const spy = vi.fn();
    m.on('select', spy);
    m.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0].id).toBe('new');
    m.destroy();
  });

  it('menubar variant exposes horizontal orientation', () => {
    const m = new Menu(host, { items, variant: 'menubar' });
    expect(m.el.getAttribute('role')).toBe('menubar');
    expect(m.el.getAttribute('aria-orientation')).toBe('horizontal');
    m.destroy();
  });

  it('Escape at the outermost level emits dismiss (not a bogus submenu close)', () => {
    const m = new Menu(host, { items });
    const dismiss = vi.fn();
    const submenu = vi.fn();
    m.on('dismiss', dismiss);
    m.on('submenu', submenu);
    // Active item is 'new' (first), which has no submenu.
    m.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(dismiss).toHaveBeenCalledTimes(1);
    expect(submenu).not.toHaveBeenCalled();
    m.destroy();
  });

  it('Escape collapses an open submenu and returns focus to its parent', () => {
    const m = new Menu(host, { items });
    // Open the submenu and enter it.
    (host.querySelector('[data-id="recent"]') as HTMLElement).click();
    expect(host.querySelector('[data-id="recent"]')!.getAttribute('aria-expanded')).toBe('true');
    // Focus a child, then Escape.
    m.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    const submenu = vi.fn();
    m.on('submenu', submenu);
    m.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(host.querySelector('[data-id="recent"]')!.getAttribute('aria-expanded')).toBe('false');
    expect(host.querySelector('[data-id="recent"]')!.getAttribute('tabindex')).toBe('0');
    expect(submenu).toHaveBeenCalledWith(expect.objectContaining({ id: 'recent', open: false }));
    m.destroy();
  });

  it('keeps exactly one tabindex=0 even when the active item is inside a submenu', () => {
    const m = new Menu(host, { items });
    (host.querySelector('[data-id="recent"]') as HTMLElement).click();
    // Move focus into the submenu (ArrowRight opens/enters).
    m.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    const tabbable = host.querySelectorAll('.jects-menu__item[tabindex="0"]');
    expect(tabbable.length).toBe(1);
    // And it is the active (deep) item.
    expect(tabbable[0]!.classList.contains('jects-menu__item--active')).toBe(true);
    m.destroy();
  });

  it('destroy removes the element', () => {
    const m = new Menu(host, { items });
    m.destroy();
    expect(host.querySelector('.jects-menu')).toBeNull();
  });
});
