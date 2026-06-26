/** jsdom unit test for Ribbon — render + interaction + events. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Ribbon, type RibbonTab } from './ribbon.js';

let host: HTMLElement;

const tabs: RibbonTab[] = [
  {
    id: 'home',
    text: 'Home',
    groups: [
      {
        title: 'Clipboard',
        commands: [
          { id: 'paste', text: 'Paste' },
          { id: 'cut', icon: 'minus', label: 'Cut' },
        ],
      },
      {
        title: 'Font',
        commands: [{ id: 'bold', text: 'Bold' }],
      },
    ],
  },
  {
    id: 'insert',
    text: 'Insert',
    groups: [{ title: 'Tables', commands: [{ id: 'table', text: 'Table' }] }],
  },
];

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  host.remove();
});

describe('Ribbon (jsdom)', () => {
  it('renders a tablist with tabs and the first panel', () => {
    const r = new Ribbon(host, { tabs });
    expect(host.querySelector('[role="tablist"]')).toBeTruthy();
    const tabEls = host.querySelectorAll('[role="tab"]');
    expect(tabEls.length).toBe(2);
    expect(tabEls[0]!.getAttribute('aria-selected')).toBe('true');
    expect(host.querySelector('[role="tabpanel"]')).toBeTruthy();
    expect(host.querySelector('[role="group"][aria-label="Clipboard"]')).toBeTruthy();
    expect(r.getActive()).toBe('home');
    r.destroy();
  });

  it('panel is labelled by its tab and tab controls its panel', () => {
    const r = new Ribbon(host, { tabs });
    const tab = host.querySelector('[role="tab"]')!;
    const panel = host.querySelector('[role="tabpanel"]')!;
    expect(panel.getAttribute('aria-labelledby')).toBe(tab.id);
    expect(tab.getAttribute('aria-controls')).toBe(panel.id);
    r.destroy();
  });

  it('clicking a tab switches the panel and emits change', () => {
    const r = new Ribbon(host, { tabs });
    const spy = vi.fn();
    r.on('change', spy);
    (host.querySelectorAll('[role="tab"]')[1] as HTMLElement).click();
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ id: 'insert' }));
    expect(r.getActive()).toBe('insert');
    expect(host.querySelector('[role="group"][aria-label="Tables"]')).toBeTruthy();
    r.destroy();
  });

  it('beforeChange veto cancels switching', () => {
    const r = new Ribbon(host, { tabs });
    r.on('beforeChange', () => false);
    (host.querySelectorAll('[role="tab"]')[1] as HTMLElement).click();
    expect(r.getActive()).toBe('home');
    r.destroy();
  });

  it('command button click emits command', () => {
    const r = new Ribbon(host, { tabs });
    const spy = vi.fn();
    r.on('command', spy);
    const btn = host.querySelector('.jects-ribbon__command .jects-btn') as HTMLButtonElement;
    btn.click();
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ id: 'paste', tabId: 'home' }));
    r.destroy();
  });

  it('ArrowRight on a tab activates the next tab', () => {
    const r = new Ribbon(host, { tabs });
    const tab = host.querySelector('[role="tab"]') as HTMLElement;
    tab.focus();
    tab.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(r.getActive()).toBe('insert');
    r.destroy();
  });

  it('icon-only command gets an aria-label', () => {
    const r = new Ribbon(host, { tabs });
    const cutBtn = Array.from(host.querySelectorAll('.jects-btn')).find(
      (b) => b.getAttribute('aria-label') === 'Cut',
    );
    expect(cutBtn).toBeTruthy();
    r.destroy();
  });

  it('destroy removes the element and cleans up buttons', () => {
    const r = new Ribbon(host, { tabs });
    r.destroy();
    expect(host.querySelector('.jects-ribbon')).toBeNull();
  });
});
