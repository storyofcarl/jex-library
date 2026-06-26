/** jsdom unit test for ContextMenu — render + interaction + events. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ContextMenu } from './context-menu.js';
import type { MenuItem } from './menu.js';

let host: HTMLElement;
let target: HTMLElement;

const items: MenuItem[] = [
  { id: 'cut', text: 'Cut' },
  { id: 'copy', text: 'Copy' },
  { id: 'paste', text: 'Paste' },
];

beforeEach(() => {
  host = document.createElement('div');
  target = document.createElement('div');
  document.body.append(host, target);
});
afterEach(() => {
  host.remove();
  target.remove();
});

describe('ContextMenu (jsdom)', () => {
  it('starts hidden', () => {
    const cm = new ContextMenu(host, { items });
    expect(cm.el.hidden).toBe(true);
    expect(cm.opened).toBe(false);
    cm.destroy();
  });

  it('opens at coordinates and renders the inner menu', () => {
    const cm = new ContextMenu(host, { items });
    const spy = vi.fn();
    cm.on('open', spy);
    cm.openAt(50, 60);
    expect(cm.opened).toBe(true);
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ x: 50, y: 60 }));
    expect(cm.el.querySelector('[data-id="copy"]')).toBeTruthy();
    expect(cm.el.style.left).toBe('50px');
    cm.destroy();
  });

  it('opens on the target contextmenu event', () => {
    const cm = new ContextMenu(host, { items, target });
    const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 20 });
    target.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(cm.opened).toBe(true);
    cm.destroy();
  });

  it('selecting an item emits select and closes by default', () => {
    const cm = new ContextMenu(host, { items });
    const sel = vi.fn();
    const close = vi.fn();
    cm.on('select', sel);
    cm.on('close', close);
    cm.openAt(0, 0);
    (cm.el.querySelector('[data-id="paste"]') as HTMLElement).click();
    expect(sel).toHaveBeenCalledWith(expect.objectContaining({ id: 'paste' }));
    expect(close).toHaveBeenCalledWith(expect.objectContaining({ reason: 'select' }));
    expect(cm.opened).toBe(false);
    cm.destroy();
  });

  it('Escape closes the menu', () => {
    const cm = new ContextMenu(host, { items });
    cm.openAt(0, 0);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(cm.opened).toBe(false);
    cm.destroy();
  });

  it('pointerdown outside closes the menu', () => {
    const cm = new ContextMenu(host, { items });
    cm.openAt(0, 0);
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(cm.opened).toBe(false);
    cm.destroy();
  });

  it('beforeOpen veto cancels opening', () => {
    const cm = new ContextMenu(host, { items });
    cm.on('beforeOpen', () => false);
    cm.openAt(0, 0);
    expect(cm.opened).toBe(false);
    cm.destroy();
  });

  it('destroy removes target listener and element', () => {
    const cm = new ContextMenu(host, { items, target });
    cm.destroy();
    const ev = new MouseEvent('contextmenu', { bubbles: true });
    target.dispatchEvent(ev);
    expect(host.querySelector('.jects-context-menu')).toBeNull();
  });

  it('destroy removes the target contextmenu listener (no leak after super())', () => {
    // Regression: target passed in the constructor must have its `contextmenu`
    // listener removed on destroy. Re-dispatch after destroy and assert the
    // event is NOT preventDefaulted (listener gone) — guards against the
    // field-initializer clobber wiping onTargetContext/boundTarget.
    const cm = new ContextMenu(host, { items, target });
    const removeSpy = vi.spyOn(target, 'removeEventListener');
    cm.destroy();
    expect(removeSpy).toHaveBeenCalledWith('contextmenu', expect.any(Function));
    const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    target.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    removeSpy.mockRestore();
  });

  it('update({ target }) unbinds the previous target listener (no stacking)', () => {
    const cm = new ContextMenu(host, { items, target });
    const target2 = document.createElement('div');
    document.body.append(target2);
    cm.update({ target: target2 });
    // Old target no longer opens the menu.
    const old = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    target.dispatchEvent(old);
    expect(old.defaultPrevented).toBe(false);
    expect(cm.opened).toBe(false);
    // New target does.
    const fresh = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    target2.dispatchEvent(fresh);
    expect(fresh.defaultPrevented).toBe(true);
    expect(cm.opened).toBe(true);
    cm.destroy();
    target2.remove();
  });

  it('restores focus to the invoking element on close', () => {
    const trigger = document.createElement('button');
    document.body.append(trigger);
    trigger.focus();
    const cm = new ContextMenu(host, { items });
    cm.openAt(0, 0);
    cm.close('api');
    expect(document.activeElement).toBe(trigger);
    cm.destroy();
    trigger.remove();
  });

  it('inner Menu emits dismiss on Escape when ContextMenu does not own Escape', () => {
    // With closeOnEsc disabled, the popup does not intercept Escape, so the
    // inner Menu surfaces its own `dismiss` signal at the outermost level.
    const cm = new ContextMenu(host, { items, closeOnEsc: false });
    cm.openAt(0, 0);
    const dismiss = vi.fn();
    cm.getMenu()!.on('dismiss', dismiss);
    cm.getMenu()!.el.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    expect(dismiss).toHaveBeenCalledTimes(1);
    cm.destroy();
  });
});
