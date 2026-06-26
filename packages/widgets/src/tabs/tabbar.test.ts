/** jsdom unit test for Tabbar — render + interaction + emitted event. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Tabbar } from './tabbar.js';

let host: HTMLElement;
const items = [
  { id: 'a', label: 'Alpha' },
  { id: 'b', label: 'Bravo' },
  { id: 'c', label: 'Charlie', disabled: true },
  { id: 'd', label: 'Delta' },
];

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  host.remove();
});

describe('Tabbar (jsdom)', () => {
  it('renders a tablist with role=tab buttons', () => {
    const t = new Tabbar(host, { items, ariaLabel: 'Sections' });
    const list = host.querySelector('[role="tablist"]')!;
    expect(list).toBeTruthy();
    expect(list.getAttribute('aria-label')).toBe('Sections');
    expect(host.querySelectorAll('[role="tab"]').length).toBe(4);
    t.destroy();
  });

  it('defaults active to first enabled tab and sets aria-selected + roving tabindex', () => {
    const t = new Tabbar(host, { items });
    expect(t.active).toBe('a');
    const tabA = host.querySelector('[data-id="a"]')!;
    expect(tabA.getAttribute('aria-selected')).toBe('true');
    expect(tabA.getAttribute('tabindex')).toBe('0');
    expect(host.querySelector('[data-id="b"]')!.getAttribute('tabindex')).toBe('-1');
    t.destroy();
  });

  it('disabled tab has aria-disabled and is not selectable', () => {
    const t = new Tabbar(host, { items });
    const tabC = host.querySelector('[data-id="c"]') as HTMLButtonElement;
    expect(tabC.getAttribute('aria-disabled')).toBe('true');
    tabC.click();
    expect(t.active).toBe('a');
    t.destroy();
  });

  it('clicking a tab activates it and emits change', () => {
    const t = new Tabbar(host, { items });
    const spy = vi.fn();
    t.on('change', spy);
    (host.querySelector('[data-id="b"]') as HTMLButtonElement).click();
    expect(t.active).toBe('b');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0]).toMatchObject({ id: 'b', previous: 'a' });
    t.destroy();
  });

  it('beforeChange veto cancels activation', () => {
    const t = new Tabbar(host, { items });
    t.on('beforeChange', () => false);
    (host.querySelector('[data-id="b"]') as HTMLButtonElement).click();
    expect(t.active).toBe('a');
    t.destroy();
  });

  it('ArrowRight skips disabled tabs and wraps', () => {
    const t = new Tabbar(host, { items, active: 'b' });
    const list = host.querySelector('[role="tablist"]') as HTMLElement;
    list.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    // b -> (skip disabled c) -> d
    expect(t.active).toBe('d');
    list.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    // d -> wrap to a
    expect(t.active).toBe('a');
    t.destroy();
  });

  it('Home/End jump to first/last enabled tab', () => {
    const t = new Tabbar(host, { items, active: 'b' });
    const list = host.querySelector('[role="tablist"]') as HTMLElement;
    list.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    expect(t.active).toBe('d');
    list.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    expect(t.active).toBe('a');
    t.destroy();
  });

  it('closable: renders close affordance and emits close, moving activation', () => {
    const t = new Tabbar(host, {
      items: [
        { id: 'x', label: 'X' },
        { id: 'y', label: 'Y' },
        { id: 'z', label: 'Z' },
      ],
      active: 'y',
      closable: true,
    });
    const closeSpy = vi.fn();
    t.on('close', closeSpy);
    const closeBtn = host.querySelector('.jects-tabbar__close[data-id="y"]') as HTMLElement;
    expect(closeBtn).toBeTruthy();
    // The close affordance is a decorative aria-hidden span (NOT an interactive
    // control nested in the tab button); closing is keyboard-exposed via Delete.
    expect(closeBtn.getAttribute('aria-hidden')).toBe('true');
    expect(closeBtn.getAttribute('role')).toBeNull();
    const tab = host.querySelector('.jects-tabbar__tab[data-id="y"]') as HTMLElement;
    expect(tab.getAttribute('aria-keyshortcuts')).toBe('Delete');
    closeBtn.click();
    expect(closeSpy).toHaveBeenCalledTimes(1);
    expect(host.querySelectorAll('[role="tab"]').length).toBe(2);
    // active moved to the next neighbour (z)
    expect(t.active).toBe('z');
    t.destroy();
  });

  it('beforeClose veto keeps the tab', () => {
    const t = new Tabbar(host, { items, closable: true });
    t.on('beforeClose', () => false);
    t.close('a');
    expect(host.querySelectorAll('[role="tab"]').length).toBe(4);
    t.destroy();
  });

  it('tabs reference their panel via aria-controls only when controlsPanels is set', () => {
    // Standalone (no panels): no aria-controls, so the IDREF cannot dangle.
    const standalone = new Tabbar(host, { items });
    expect(standalone.el.querySelector('[data-id="a"]')!.hasAttribute('aria-controls')).toBe(false);
    standalone.destroy();

    const t = new Tabbar(host, { items, controlsPanels: true });
    const tabA = host.querySelector('[data-id="a"]')!;
    expect(tabA.getAttribute('aria-controls')).toContain('-panel-a');
    t.destroy();
  });

  it('renders a decorative (aria-hidden) close affordance + Delete keyshortcut', () => {
    const t = new Tabbar(host, { items, closable: true });
    const tab = host.querySelector('.jects-tabbar__tab[data-id="a"]') as HTMLElement;
    expect(tab.getAttribute('role')).toBe('tab');
    expect(tab.getAttribute('aria-keyshortcuts')).toBe('Delete');
    const close = tab.querySelector('.jects-tabbar__close[data-id="a"]') as HTMLElement;
    expect(close).toBeTruthy();
    // Decorative: excluded from the tab's accessible name, not interactive.
    expect(close.getAttribute('aria-hidden')).toBe('true');
    expect(close.getAttribute('role')).toBeNull();

    // Delete on the active tab still closes it (keyboard-operable close).
    const closeSpy = vi.fn();
    t.on('close', closeSpy);
    const list = host.querySelector('[role="tablist"]') as HTMLElement;
    list.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    expect(closeSpy).toHaveBeenCalledTimes(1);
    t.destroy();
  });

  it('update re-renders items', () => {
    const t = new Tabbar(host, { items });
    t.update({ items: [{ id: 'solo', label: 'Solo' }] });
    expect(host.querySelectorAll('[role="tab"]').length).toBe(1);
    expect(t.active).toBe('solo');
    t.destroy();
  });

  it('destroy removes the element', () => {
    const t = new Tabbar(host, { items });
    t.destroy();
    expect(host.querySelector('[role="tablist"]')).toBeNull();
  });
});
