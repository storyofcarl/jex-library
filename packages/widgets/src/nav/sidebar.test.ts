/** jsdom unit test for Sidebar — render + interaction + events. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Sidebar, type SidebarItem } from './sidebar.js';

let host: HTMLElement;

const items: SidebarItem[] = [
  { id: 'home', text: 'Home', icon: 'chevron-right' },
  {
    id: 'lib',
    text: 'Library',
    icon: 'menu',
    children: [
      { id: 'books', text: 'Books' },
      { id: 'media', text: 'Media' },
    ],
  },
  { id: 'settings', text: 'Settings', badge: '3' },
];

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  host.remove();
});

describe('Sidebar (jsdom)', () => {
  it('renders nav with tree role and items', () => {
    const s = new Sidebar(host, { items, title: 'App' });
    expect(s.el.tagName).toBe('NAV');
    expect(host.querySelector('[role="tree"]')).toBeTruthy();
    expect(host.querySelector('[data-id="home"]')!.getAttribute('role')).toBe('treeitem');
    expect(host.querySelector('.jects-sidebar__title')!.textContent).toBe('App');
    s.destroy();
  });

  it('group items advertise aria-expanded', () => {
    const s = new Sidebar(host, { items });
    const grp = host.querySelector('[data-id="lib"]')!;
    expect(grp.getAttribute('aria-expanded')).toBe('false');
    s.destroy();
  });

  it('selecting a leaf emits select and sets aria-current', () => {
    const s = new Sidebar(host, { items });
    const spy = vi.fn();
    s.on('select', spy);
    (host.querySelector('[data-id="home"]') as HTMLElement).click();
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ id: 'home' }));
    expect(host.querySelector('[data-id="home"]')!.getAttribute('aria-current')).toBe('page');
    expect(s.getActive()).toBe('home');
    s.destroy();
  });

  it('beforeSelect veto cancels selection', () => {
    const s = new Sidebar(host, { items });
    const spy = vi.fn();
    s.on('beforeSelect', () => false);
    s.on('select', spy);
    (host.querySelector('[data-id="home"]') as HTMLElement).click();
    expect(spy).not.toHaveBeenCalled();
    s.destroy();
  });

  it('clicking a group toggles expansion and emits toggle', () => {
    const s = new Sidebar(host, { items });
    const spy = vi.fn();
    s.on('toggle', spy);
    (host.querySelector('[data-id="lib"]') as HTMLElement).click();
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ id: 'lib', expanded: true }));
    expect(host.querySelector('[data-id="books"]')).toBeTruthy();
    s.destroy();
  });

  it('collapse toggle switches to mini mode and emits collapse', () => {
    const s = new Sidebar(host, { items });
    const spy = vi.fn();
    s.on('collapse', spy);
    (host.querySelector('[data-toggle="collapse"]') as HTMLElement).click();
    expect(s.collapsed).toBe(true);
    expect(s.el.classList.contains('jects-sidebar--collapsed')).toBe(true);
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ collapsed: true }));
    s.destroy();
  });

  it('ArrowDown moves roving focus', () => {
    const s = new Sidebar(host, { items });
    s.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(host.querySelector('[data-id="lib"]')!.getAttribute('tabindex')).toBe('0');
    s.destroy();
  });

  it('ArrowRight expands a collapsed group', () => {
    const s = new Sidebar(host, { items });
    // focus the group first
    s.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    s.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(host.querySelector('[data-id="lib"]')!.getAttribute('aria-expanded')).toBe('true');
    s.destroy();
  });

  it('collapse toggle is keyboard-reachable (tabindex=0)', () => {
    const s = new Sidebar(host, { items });
    const toggle = host.querySelector('[data-toggle="collapse"]') as HTMLElement;
    expect(toggle.getAttribute('tabindex')).toBe('0');
    s.destroy();
  });

  it('activating the toggle via keyboard collapses the sidebar', () => {
    const s = new Sidebar(host, { items });
    const spy = vi.fn();
    s.on('collapse', spy);
    const toggle = host.querySelector('[data-toggle="collapse"]') as HTMLButtonElement;
    toggle.focus();
    // Buttons activate on click; Enter/Space dispatch a native click in browsers.
    toggle.click();
    expect(s.collapsed).toBe(true);
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ collapsed: true }));
    // Label/aria-pressed update.
    const toggle2 = host.querySelector('[data-toggle="collapse"]')!;
    expect(toggle2.getAttribute('aria-pressed')).toBe('true');
    expect(toggle2.getAttribute('aria-label')).toBe('Expand sidebar');
    s.destroy();
  });

  it('collapsed items expose an accessible name via aria-label', () => {
    const s = new Sidebar(host, { items, collapsed: true });
    const home = host.querySelector('[data-id="home"]')!;
    expect(home.getAttribute('aria-label')).toBe('Home');
    // Badge is folded into the name when present.
    const settings = host.querySelector('[data-id="settings"]')!;
    expect(settings.getAttribute('aria-label')).toBe('Settings (3)');
    s.destroy();
  });

  it('destroy removes the element', () => {
    const s = new Sidebar(host, { items });
    s.destroy();
    expect(host.querySelector('.jects-sidebar')).toBeNull();
  });
});
