/** jsdom unit test — runs in the default `pnpm test`. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Panel } from './panel.js';
import { Button } from '../button/button.js';

let host: HTMLElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  host.remove();
});

describe('Panel (jsdom)', () => {
  it('renders title, body html and footer', () => {
    const p = new Panel(host, { title: 'Files', body: '<p>content</p>', footer: 'Footer' });
    const el = host.querySelector('.jects-panel')!;
    expect(el.querySelector('.jects-panel__title')!.textContent).toBe('Files');
    expect(el.querySelector('.jects-panel__body')!.innerHTML).toContain('content');
    const footer = el.querySelector('.jects-panel__footer') as HTMLElement;
    expect(footer.hidden).toBe(false);
    expect(footer.textContent).toBe('Footer');
    p.destroy();
  });

  it('hides header when no title/tools/collapsible', () => {
    const p = new Panel(host, { body: 'x' });
    const header = host.querySelector('.jects-panel__header') as HTMLElement;
    expect(header.hidden).toBe(true);
    p.destroy();
  });

  it('mounts a widget body and owns it (destroyed with panel)', () => {
    const detached = document.createElement('div');
    const btn = new Button(detached, { text: 'Go' });
    const p = new Panel(host, { title: 'P', body: btn });
    expect(host.querySelector('.jects-panel__body button.jects-btn')).toBeTruthy();
    p.destroy();
    expect(btn.isDestroyed).toBe(true);
  });

  it('collapsible renders an accessible toggle with aria-expanded/controls', () => {
    const p = new Panel(host, { title: 'P', collapsible: true });
    const toggle = host.querySelector('.jects-panel__toggle') as HTMLButtonElement;
    expect(toggle).toBeTruthy();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const bodyId = (host.querySelector('.jects-panel__body') as HTMLElement).id;
    expect(toggle.getAttribute('aria-controls')).toBe(bodyId);
    p.destroy();
  });

  it('clicking the toggle collapses and emits collapse', () => {
    const p = new Panel(host, { title: 'P', collapsible: true });
    const spy = vi.fn();
    p.on('collapse', spy);
    (host.querySelector('.jects-panel__toggle') as HTMLButtonElement).click();
    const body = host.querySelector('.jects-panel__body') as HTMLElement;
    expect(body.hidden).toBe(true);
    expect(host.querySelector('.jects-panel')!.classList.contains('jects-panel--collapsed')).toBe(true);
    expect((host.querySelector('.jects-panel__toggle') as HTMLButtonElement).getAttribute('aria-expanded')).toBe('false');
    expect(spy).toHaveBeenCalledTimes(1);
    p.destroy();
  });

  it('beforeCollapse veto cancels collapse', () => {
    const p = new Panel(host, { title: 'P', collapsible: true });
    p.on('beforeCollapse', () => false);
    p.collapse();
    expect(p.getConfig().collapsed).toBeFalsy();
    p.destroy();
  });

  it('expand() re-opens and emits expand', () => {
    const p = new Panel(host, { title: 'P', collapsible: true, collapsed: true });
    const spy = vi.fn();
    p.on('expand', spy);
    p.expand();
    expect((host.querySelector('.jects-panel__body') as HTMLElement).hidden).toBe(false);
    expect(spy).toHaveBeenCalledTimes(1);
    p.destroy();
  });

  it('destroy() removes element', () => {
    const p = new Panel(host, { title: 'X' });
    p.destroy();
    expect(host.querySelector('.jects-panel')).toBeNull();
  });
});
