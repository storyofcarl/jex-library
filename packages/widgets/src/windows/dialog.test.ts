/** jsdom unit test for Dialog — render + interaction + emitted event + promise. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Dialog } from './dialog.js';

let host: HTMLElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  host.remove();
});

describe('Dialog (jsdom)', () => {
  it('renders a modal window with dialog class, header, body, footer', () => {
    const d = new Dialog(host, {
      title: 'Confirm',
      text: 'Are you sure?',
      actions: [{ key: 'ok', text: 'OK', variant: 'primary' }],
    });
    const el = host.querySelector('.jects-window') as HTMLElement;
    expect(el.classList.contains('jects-dialog')).toBe(true);
    expect(el.getAttribute('aria-modal')).toBe('true');
    expect(el.querySelector('.jects-window__title')?.textContent).toBe('Confirm');
    expect(el.querySelector('.jects-window__body')?.textContent).toContain('Are you sure?');
    expect(el.querySelector('.jects-dialog__footer')).toBeTruthy();
    // The Mask backdrop (Wave-1 reuse).
    expect(host.querySelector('.jects-mask')).toBeTruthy();
    d.destroy();
  });

  it('renders one Wave-1 Button per action', () => {
    const d = new Dialog(host, {
      actions: [
        { key: 'cancel', text: 'Cancel' },
        { key: 'ok', text: 'OK', variant: 'primary' },
      ],
    });
    const btns = host.querySelectorAll('.jects-dialog__footer .jects-btn');
    expect(btns.length).toBe(2);
    expect(btns[0]!.textContent).toContain('Cancel');
    expect(btns[1]!.textContent).toContain('OK');
    d.destroy();
  });

  it('hides the footer when there are no actions', () => {
    const d = new Dialog(host, { title: 'X', actions: [] });
    const footer = host.querySelector('.jects-dialog__footer') as HTMLElement;
    expect(footer.hidden).toBe(true);
    d.destroy();
  });

  it('clicking an action emits action and resolves the promise with its key', async () => {
    const d = new Dialog(host, {
      actions: [{ key: 'ok', text: 'OK', variant: 'primary' }],
    });
    const spy = vi.fn();
    d.on('action', spy);
    const promise = d.open();
    const btn = host.querySelector('.jects-dialog__footer .jects-btn') as HTMLButtonElement;
    btn.click();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0].key).toBe('ok');
    await expect(promise).resolves.toBe('ok');
    // Action with default closeOnAction closes the dialog.
    expect(host.querySelector('.jects-window')).toBeNull();
  });

  it('Escape dismiss resolves the promise with null', async () => {
    const d = new Dialog(host, {
      title: 'X',
      actions: [{ key: 'ok', text: 'OK' }],
    });
    const promise = d.open();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await expect(promise).resolves.toBeNull();
    expect(host.querySelector('.jects-window')).toBeNull();
  });

  it('closeOnAction:false keeps the dialog open and does not settle', () => {
    const d = new Dialog(host, {
      actions: [{ key: 'apply', text: 'Apply', closeOnAction: false }],
    });
    const spy = vi.fn();
    d.on('action', spy);
    d.open();
    const btn = host.querySelector('.jects-dialog__footer .jects-btn') as HTMLButtonElement;
    btn.click();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(host.querySelector('.jects-window')).toBeTruthy();
    d.destroy();
  });

  it('destroying an open dialog resolves the promise with null', async () => {
    const d = new Dialog(host, { actions: [{ key: 'ok', text: 'OK' }] });
    const promise = d.open();
    d.destroy();
    await expect(promise).resolves.toBeNull();
  });

  it('destructive tone adds the modifier class', () => {
    const d = new Dialog(host, { title: 'Delete', tone: 'destructive' });
    const el = host.querySelector('.jects-window') as HTMLElement;
    expect(el.classList.contains('jects-dialog--destructive')).toBe(true);
    d.destroy();
  });

  it('rebuilding actions via update does not leak buttons', () => {
    const d = new Dialog(host, { actions: [{ key: 'a', text: 'A' }] });
    expect(host.querySelectorAll('.jects-dialog__footer .jects-btn').length).toBe(1);
    d.update({ actions: [{ key: 'b', text: 'B' }, { key: 'c', text: 'C' }] });
    expect(host.querySelectorAll('.jects-dialog__footer .jects-btn').length).toBe(2);
    d.destroy();
  });
});
