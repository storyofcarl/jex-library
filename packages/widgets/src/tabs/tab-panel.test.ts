/** jsdom unit test for TabPanel — render + interaction + emitted event + lazy. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TabPanel } from './tab-panel.js';

let host: HTMLElement;
const items = [
  { id: 'one', label: 'One', content: '<p data-test="p1">First</p>' },
  { id: 'two', label: 'Two', content: '<p data-test="p2">Second</p>' },
  { id: 'three', label: 'Three', content: '<p data-test="p3">Third</p>' },
];

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  host.remove();
});

describe('TabPanel (jsdom)', () => {
  it('renders a tablist strip and a panel region', () => {
    const tp = new TabPanel(host, { items });
    expect(host.querySelector('[role="tablist"]')).toBeTruthy();
    expect(host.querySelector('.jects-tabpanel__panels')).toBeTruthy();
    tp.destroy();
  });

  it('shows only the active panel with role=tabpanel + aria-labelledby', () => {
    const tp = new TabPanel(host, { items, active: 'one' });
    const panel = host.querySelector('[role="tabpanel"]') as HTMLElement;
    expect(panel).toBeTruthy();
    expect(panel.dataset.id).toBe('one');
    expect(panel.hidden).toBe(false);
    expect(panel.getAttribute('aria-labelledby')).toContain('-tab-one');
    expect(panel.querySelector('[data-test="p1"]')).toBeTruthy();
    tp.destroy();
  });

  it('lazy: panel shells exist for every tab; content is materialised on activation', () => {
    const tp = new TabPanel(host, { items, active: 'one', lazy: true });
    // Empty shells exist for all tabs up front (so aria-controls stays valid),
    // but only the active panel has its content filled in.
    expect(host.querySelectorAll('[role="tabpanel"]').length).toBe(3);
    expect(host.querySelector('[data-id="one"] [data-test="p1"]')).toBeTruthy();
    expect(host.querySelector('[data-id="two"] [data-test="p2"]')).toBeNull();
    tp.activate('two');
    const two = host.querySelector('[data-id="two"][role="tabpanel"]') as HTMLElement;
    expect(two.hidden).toBe(false);
    expect(two.querySelector('[data-test="p2"]')).toBeTruthy();
    tp.destroy();
  });

  it('every tab points aria-controls at an existing panel shell (lazy default)', () => {
    const tp = new TabPanel(host, { items, active: 'one' });
    host.querySelectorAll<HTMLElement>('[role="tab"]').forEach((tab) => {
      const target = tab.getAttribute('aria-controls')!;
      expect(host.querySelector(`[id="${target}"]`)).toBeTruthy();
    });
    tp.destroy();
  });

  it('non-lazy renders all panels upfront', () => {
    const tp = new TabPanel(host, { items, lazy: false });
    expect(host.querySelectorAll('[role="tabpanel"]').length).toBe(3);
    tp.destroy();
  });

  it('activating a tab via click switches the visible panel and emits change', () => {
    const tp = new TabPanel(host, { items, active: 'one' });
    const spy = vi.fn();
    tp.on('change', spy);
    (host.querySelector('[data-id="two"][role="tab"]') as HTMLButtonElement).click();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0]).toMatchObject({ id: 'two', previous: 'one' });
    const two = host.querySelector('[data-id="two"][role="tabpanel"]') as HTMLElement;
    const one = host.querySelector('[data-id="one"][role="tabpanel"]') as HTMLElement;
    expect(two.hidden).toBe(false);
    expect(one.hidden).toBe(true);
    tp.destroy();
  });

  it('keepAlive false tears down inactive lazy panel content (shell stays)', () => {
    const tp = new TabPanel(host, { items, active: 'one', lazy: true, keepAlive: false });
    tp.activate('two');
    // 'one' keeps its shell (so aria-controls stays valid) but its content is
    // released once we leave it.
    const one = host.querySelector('[data-id="one"][role="tabpanel"]') as HTMLElement;
    expect(one).toBeTruthy();
    expect(one.querySelector('[data-test="p1"]')).toBeNull();
    const two = host.querySelector('[data-id="two"][role="tabpanel"]') as HTMLElement;
    expect(two).toBeTruthy();
    expect(two.querySelector('[data-test="p2"]')).toBeTruthy();
    tp.destroy();
  });

  it('content factory receives the panel host', () => {
    const tp = new TabPanel(host, {
      items: [{ id: 'f', label: 'Factory', content: (el) => (el.textContent = 'made') }],
    });
    const panel = host.querySelector('[role="tabpanel"]') as HTMLElement;
    expect(panel.textContent).toBe('made');
    tp.destroy();
  });

  it('closable: closing a tab removes its panel and emits close', () => {
    const tp = new TabPanel(host, { items, active: 'two', closable: true });
    const spy = vi.fn();
    tp.on('close', spy);
    const closeBtn = host.querySelector('.jects-tabbar__close[data-id="two"]') as HTMLElement;
    closeBtn.click();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(host.querySelector('[data-id="two"][role="tabpanel"]')).toBeNull();
    expect(host.querySelectorAll('[role="tab"]').length).toBe(2);
    tp.destroy();
  });

  it('destroy removes everything including the inner tabbar', () => {
    const tp = new TabPanel(host, { items });
    tp.destroy();
    expect(host.querySelector('.jects-tabpanel')).toBeNull();
    expect(host.querySelector('[role="tablist"]')).toBeNull();
  });
});
