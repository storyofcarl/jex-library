/** jsdom unit test for Popup — render + interaction + emitted event. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Popup } from './popup.js';

let host: HTMLElement;
let anchor: HTMLElement;

beforeEach(() => {
  host = document.createElement('div');
  anchor = document.createElement('button');
  document.body.append(host, anchor);
});
afterEach(() => {
  host.remove();
  anchor.remove();
});

describe('Popup (jsdom)', () => {
  it('renders a dialog panel hidden by default', () => {
    const p = new Popup(host, { anchor, text: 'Hi' });
    const el = host.querySelector('.jects-popup') as HTMLElement;
    expect(el).toBeTruthy();
    expect(el.getAttribute('role')).toBe('dialog');
    expect(el.hidden).toBe(true);
    expect(el.textContent).toContain('Hi');
    p.destroy();
  });

  it('applies placement modifier class', () => {
    const p = new Popup(host, { anchor, placement: 'right', text: 'X' });
    const el = host.querySelector('.jects-popup') as HTMLElement;
    expect(el.classList.contains('jects-popup--right')).toBe(true);
    p.destroy();
  });

  it('open() shows the panel and emits open', () => {
    const p = new Popup(host, { anchor, text: 'X' });
    const spy = vi.fn();
    p.on('open', spy);
    p.open();
    const el = host.querySelector('.jects-popup') as HTMLElement;
    expect(el.hidden).toBe(false);
    expect(p.opened).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0].popup).toBe(p);
    p.destroy();
  });

  it('beforeOpen veto cancels opening', () => {
    const p = new Popup(host, { anchor, text: 'X' });
    p.on('beforeOpen', () => false);
    const openSpy = vi.fn();
    p.on('open', openSpy);
    p.open();
    expect(p.opened).toBe(false);
    expect(openSpy).not.toHaveBeenCalled();
    p.destroy();
  });

  it('Escape closes the popup with reason escape', () => {
    const p = new Popup(host, { anchor, text: 'X' });
    p.open();
    const spy = vi.fn();
    p.on('close', spy);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(p.opened).toBe(false);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0].reason).toBe('escape');
    p.destroy();
  });

  it('click outside closes the popup', () => {
    const p = new Popup(host, { anchor, text: 'X' });
    p.open();
    const spy = vi.fn();
    p.on('close', spy);
    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0].reason).toBe('click-outside');
    p.destroy();
  });

  it('click on anchor does NOT close', () => {
    const p = new Popup(host, { anchor, text: 'X' });
    p.open();
    const spy = vi.fn();
    p.on('close', spy);
    anchor.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    expect(spy).not.toHaveBeenCalled();
    p.destroy();
  });

  it('toggle flips state', () => {
    const p = new Popup(host, { anchor, text: 'X' });
    p.toggle();
    expect(p.opened).toBe(true);
    p.toggle();
    expect(p.opened).toBe(false);
    p.destroy();
  });

  it('starts open when configured', () => {
    const p = new Popup(host, { anchor, text: 'X', open: true });
    expect(p.opened).toBe(true);
    p.destroy();
  });

  it('destroy removes element and unbinds globals', () => {
    const p = new Popup(host, { anchor, text: 'X' });
    p.open();
    p.destroy();
    expect(host.querySelector('.jects-popup')).toBeNull();
    // No throw and no close after destroy.
    const spy = vi.fn();
    p.on('close', spy);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(spy).not.toHaveBeenCalled();
  });
});
