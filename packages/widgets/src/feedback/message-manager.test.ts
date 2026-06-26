/** jsdom unit tests for the Feedback cluster (MessageManager + dialog helpers). */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MessageManager, alert, confirm, prompt } from './message-manager.js';

let host: HTMLElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  host.remove();
  // Clean any stray dialog overlays.
  document.querySelectorAll('.jects-dialog-overlay').forEach((n) => n.remove());
});

describe('MessageManager (jsdom)', () => {
  it('renders an accessible toaster region with position class', () => {
    const m = new MessageManager(host, { position: 'bottom-left' });
    const region = host.querySelector('.jects-toaster')!;
    expect(region).toBeTruthy();
    expect(region.getAttribute('role')).toBe('region');
    expect(region.getAttribute('aria-label')).toBe('Notifications');
    // A11y: the container must NOT be a live region — each toast is its own
    // live region (role=status/alert). Nested live regions are undefined SR
    // behavior, so aria-live/aria-relevant are absent on the container.
    expect(region.getAttribute('aria-live')).toBeNull();
    expect(region.getAttribute('aria-relevant')).toBeNull();
    expect(region.classList.contains('jects-toaster--bottom-left')).toBe(true);
    m.destroy();
  });

  it('toasts carry their own role and are focusable; no aria-live to nest', () => {
    const m = new MessageManager(host);
    m.push({ message: 'info one', variant: 'info' });
    m.push({ message: 'boom', variant: 'error' });
    const info = host.querySelector('.jects-toast--info')!;
    const err = host.querySelector('.jects-toast--error')!;
    expect(info.getAttribute('role')).toBe('status');
    expect(err.getAttribute('role')).toBe('alert');
    // tabindex=-1 lets focus move between toasts when one is dismissed.
    expect(info.getAttribute('tabindex')).toBe('-1');
    // No per-toast aria-live (role conveys politeness; avoids nested live regions).
    expect(info.getAttribute('aria-live')).toBeNull();
    expect(err.getAttribute('aria-live')).toBeNull();
    m.destroy();
  });

  it('does not hang when a beforeDismiss veto is active during max overflow', () => {
    const m = new MessageManager(host, { max: 1 });
    // Veto every manual dismiss. Cap enforcement must use forceDismiss and not
    // spin forever on the un-dismissable oldest toast.
    m.on('beforeDismiss', () => false);
    m.push({ message: 'a', timeout: 0 });
    m.push({ message: 'b', timeout: 0 }); // overflow → forces 'a' out
    expect(m.count).toBe(1);
    expect(host.querySelector('.jects-toast__message')!.textContent).toBe('b');
    m.destroy();
  });

  it('emits toastShow before any overflow dismissal (consistent map)', () => {
    const m = new MessageManager(host, { max: 1 });
    const order: string[] = [];
    m.on('toastShow', (e) => order.push(`show:${e.id}`));
    m.on('toastDismiss', (e) => order.push(`dismiss:${e.id}`));
    m.push({ message: 'a', timeout: 0 });
    order.length = 0;
    m.push({ message: 'b', timeout: 0 });
    // The new toast's show must be observed before the overflow dismiss.
    expect(order[0]!.startsWith('show:')).toBe(true);
    expect(order.some((o) => o.startsWith('dismiss:'))).toBe(true);
    expect(order.indexOf(order.find((o) => o.startsWith('show:'))!)).toBeLessThan(
      order.findIndex((o) => o.startsWith('dismiss:')),
    );
    m.destroy();
  });

  it('show() renders a toast with title, message and variant', () => {
    const m = new MessageManager(host);
    const handle = m.push({ title: 'Saved', message: 'All good', variant: 'success' })!;
    expect(handle).toBeTruthy();
    const toast = host.querySelector('.jects-toast--success')!;
    expect(toast.textContent).toContain('Saved');
    expect(toast.textContent).toContain('All good');
    expect(toast.getAttribute('role')).toBe('status');
    expect(m.count).toBe(1);
    m.destroy();
  });

  it('error/warning toasts use role=alert', () => {
    const m = new MessageManager(host);
    m.push({ message: 'Boom', variant: 'error' });
    expect(host.querySelector('.jects-toast--error')!.getAttribute('role')).toBe('alert');
    m.destroy();
  });

  it('clicking the close button dismisses and emits dismiss', () => {
    const m = new MessageManager(host);
    const dismissSpy = vi.fn();
    m.on('toastDismiss', dismissSpy);
    m.push({ message: 'Hi' });
    const closeBtn = host.querySelector<HTMLButtonElement>('.jects-toast__close')!;
    expect(closeBtn).toBeTruthy();
    closeBtn.click();
    expect(host.querySelector('.jects-toast')).toBeNull();
    expect(dismissSpy).toHaveBeenCalledTimes(1);
    expect(m.count).toBe(0);
    m.destroy();
  });

  it('emits show with payload', () => {
    const m = new MessageManager(host);
    const spy = vi.fn();
    m.on('toastShow', spy);
    m.push({ message: 'Hello' });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0].manager).toBe(m);
    m.destroy();
  });

  it('beforeShow veto suppresses the toast', () => {
    const m = new MessageManager(host);
    m.on('beforeShow', () => false);
    const handle = m.push({ message: 'nope' });
    expect(handle).toBeNull();
    expect(host.querySelector('.jects-toast')).toBeNull();
    m.destroy();
  });

  it('auto-dismisses after the timeout', () => {
    vi.useFakeTimers();
    const m = new MessageManager(host);
    m.push({ message: 'temp', timeout: 1000 });
    expect(m.count).toBe(1);
    vi.advanceTimersByTime(1000);
    expect(m.count).toBe(0);
    m.destroy();
    vi.useRealTimers();
  });

  it('respects max by dropping the oldest toast', () => {
    const m = new MessageManager(host, { max: 2 });
    m.push({ message: 'a', timeout: 0 });
    m.push({ message: 'b', timeout: 0 });
    m.push({ message: 'c', timeout: 0 });
    expect(m.count).toBe(2);
    const texts = [...host.querySelectorAll('.jects-toast__message')].map((n) => n.textContent);
    expect(texts).toEqual(['b', 'c']);
    m.destroy();
  });

  it('update changes the position class', () => {
    const m = new MessageManager(host, { position: 'top-right' });
    m.update({ position: 'top-center' });
    expect(host.querySelector('.jects-toaster--top-center')).toBeTruthy();
    m.destroy();
  });

  it('destroy clears timers and removes the region', () => {
    vi.useFakeTimers();
    const m = new MessageManager(host);
    m.push({ message: 'x', timeout: 5000 });
    m.destroy();
    expect(host.querySelector('.jects-toaster')).toBeNull();
    // Advancing timers after destroy must not throw.
    vi.advanceTimersByTime(5000);
    vi.useRealTimers();
  });
});

describe('Dialog helpers (jsdom)', () => {
  const flush = () => Promise.resolve();

  it('alert() mounts a modal dialog and resolves on OK', async () => {
    const p = alert({ title: 'Heads up', message: 'Done' });
    const overlay = document.querySelector('.jects-dialog-overlay')!;
    const panel = overlay.querySelector('.jects-dialog')!;
    expect(panel.getAttribute('role')).toBe('dialog');
    expect(panel.getAttribute('aria-modal')).toBe('true');
    expect(panel.textContent).toContain('Heads up');
    overlay.querySelector<HTMLButtonElement>('[data-jects-dialog-ok]')!.click();
    await expect(p).resolves.toBeUndefined();
    expect(document.querySelector('.jects-dialog-overlay')).toBeNull();
  });

  it('confirm() resolves true on OK and false on Cancel', async () => {
    const p1 = confirm({ message: 'Sure?' });
    document
      .querySelector<HTMLButtonElement>('[data-jects-dialog-ok]')!
      .click();
    await expect(p1).resolves.toBe(true);

    const p2 = confirm({ message: 'Sure?' });
    document
      .querySelector<HTMLButtonElement>('[data-jects-dialog-cancel]')!
      .click();
    await expect(p2).resolves.toBe(false);
  });

  it('confirm() uses alertdialog role and Esc cancels', async () => {
    const p = confirm({ message: 'X' });
    const overlay = document.querySelector('.jects-dialog-overlay')!;
    expect(overlay.querySelector('.jects-dialog')!.getAttribute('role')).toBe('alertdialog');
    overlay.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    await expect(p).resolves.toBe(false);
  });

  it('prompt() resolves the input value on OK', async () => {
    const p = prompt({ message: 'Name?', defaultValue: 'Ada' });
    const input = document.querySelector<HTMLInputElement>('[data-jects-dialog-input]')!;
    expect(input.value).toBe('Ada');
    input.value = 'Grace';
    document.querySelector<HTMLButtonElement>('[data-jects-dialog-ok]')!.click();
    await expect(p).resolves.toBe('Grace');
  });

  it('prompt() resolves null on Cancel', async () => {
    const p = prompt({ message: 'Name?' });
    document.querySelector<HTMLButtonElement>('[data-jects-dialog-cancel]')!.click();
    await expect(p).resolves.toBeNull();
    await flush();
  });

  it('Enter key confirms the dialog', async () => {
    const p = confirm({ message: 'Go?' });
    const overlay = document.querySelector('.jects-dialog-overlay')!;
    overlay.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await expect(p).resolves.toBe(true);
  });

  it('accepts a string shorthand', async () => {
    const p = alert('Just a message');
    expect(document.querySelector('.jects-dialog')!.textContent).toContain('Just a message');
    document.querySelector<HTMLButtonElement>('[data-jects-dialog-ok]')!.click();
    await p;
  });

  it('prompt() input has an accessible name via aria-labelledby/describedby', () => {
    const p = prompt({ title: 'Rename', message: 'New name?', defaultValue: 'x' });
    const panel = document.querySelector('.jects-dialog')!;
    const input = panel.querySelector<HTMLInputElement>('[data-jects-dialog-input]')!;
    const titleId = panel.querySelector('.jects-dialog__title')!.id;
    expect(input.getAttribute('aria-labelledby')).toBe(titleId);
    expect(input.getAttribute('aria-describedby')).toBe(
      panel.querySelector('.jects-dialog__message')!.id,
    );
    p.cancel();
  });

  it('prompt() input falls back to aria-label when no title/message', () => {
    const p = prompt({ placeholder: 'Your email' });
    const input = document.querySelector<HTMLInputElement>('[data-jects-dialog-input]')!;
    expect(input.getAttribute('aria-label')).toBe('Your email');
    p.cancel();
  });

  it('exposes a programmatic cancel() that tears down the overlay', async () => {
    const p = confirm({ message: 'Stuck?' });
    expect(document.querySelector('.jects-dialog-overlay')).toBeTruthy();
    p.cancel();
    await expect(p).resolves.toBe(false);
    expect(document.querySelector('.jects-dialog-overlay')).toBeNull();
  });

  it('cancel() after a normal settle is a no-op (idempotent cleanup)', async () => {
    const p = confirm({ message: 'OK?' });
    document.querySelector<HTMLButtonElement>('[data-jects-dialog-ok]')!.click();
    await expect(p).resolves.toBe(true);
    // Double teardown must not throw or re-resolve to a different value.
    expect(() => p.cancel()).not.toThrow();
    expect(document.querySelector('.jects-dialog-overlay')).toBeNull();
  });
});

describe('MessageManager auto-dismiss focus/pause behavior (jsdom)', () => {
  it('pauses the auto-dismiss timer while focus is inside the toast', () => {
    vi.useFakeTimers();
    const m = new MessageManager(host);
    m.push({ message: 'hover me', timeout: 1000 });
    const toast = host.querySelector<HTMLElement>('.jects-toast')!;
    toast.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    vi.advanceTimersByTime(2000);
    // Still present: timer paused while focused.
    expect(m.count).toBe(1);
    toast.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    vi.advanceTimersByTime(1000);
    expect(m.count).toBe(0);
    m.destroy();
    vi.useRealTimers();
  });

  it('removes the root click listener on destroy (disposer contract)', () => {
    const m = new MessageManager(host);
    const region = host.querySelector<HTMLElement>('.jects-toaster')!;
    m.push({ message: 'x', timeout: 0 });
    m.destroy();
    // After destroy the region is detached; clicking a (now-orphaned) close
    // delegate must not throw / re-invoke handler logic on the destroyed map.
    expect(() => region.dispatchEvent(new MouseEvent('click', { bubbles: true }))).not.toThrow();
    expect(m.count).toBe(0);
  });
});
