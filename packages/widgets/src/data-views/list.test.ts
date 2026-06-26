/** jsdom unit test for List — render (virtualized) + interaction + emitted event. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Store } from '@jects/core';
import { List } from './list.js';

let host: HTMLElement;

const makeData = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: i + 1, text: `Item ${i + 1}` }));

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  host.remove();
});

describe('List (jsdom)', () => {
  it('renders a listbox and virtualizes a large data set', () => {
    const l = new List(host, { data: makeData(10000), itemSize: 36, height: 360 });
    const root = host.querySelector('.jects-list')!;
    expect(root.getAttribute('role')).toBe('listbox');
    const items = host.querySelectorAll('.jects-list__item');
    // Only a window of rows is rendered, not all 10000.
    expect(items.length).toBeGreaterThan(0);
    expect(items.length).toBeLessThan(100);
    // Spacer reflects the full virtual height.
    const spacer = host.querySelector<HTMLElement>('.jects-list__spacer')!;
    expect(spacer.style.height).toBe(`${10000 * 36}px`);
    l.destroy();
  });

  it('shows the empty state', () => {
    const l = new List(host, { data: [], emptyText: 'Nothing here' });
    expect(host.querySelector('.jects-list__empty')!.textContent).toBe('Nothing here');
    l.destroy();
  });

  it('selects a row on click and emits select', () => {
    const l = new List(host, { data: makeData(20) });
    const spy = vi.fn();
    l.on('select', spy);
    host.querySelector<HTMLElement>('.jects-list__item[data-index="2"]')!.click();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(l.getSelected()).toEqual([3]);
    expect(
      host.querySelector('.jects-list__item[data-index="2"]')!.getAttribute('aria-selected'),
    ).toBe('true');
    l.destroy();
  });

  it('beforeSelect veto cancels selection', () => {
    const l = new List(host, { data: makeData(20) });
    l.on('beforeSelect', () => false);
    host.querySelector<HTMLElement>('.jects-list__item[data-index="0"]')!.click();
    expect(l.getSelected()).toEqual([]);
    l.destroy();
  });

  it('uses a custom item template', () => {
    const l = new List(host, {
      data: makeData(5),
      itemTemplate: (r) => `<b class="custom">${(r as { text: string }).text}</b>`,
    });
    expect(host.querySelector('.custom')!.textContent).toBe('Item 1');
    l.destroy();
  });

  it('emits activate on double-click', () => {
    const l = new List(host, { data: makeData(5) });
    const spy = vi.fn();
    l.on('activate', spy);
    const item = host.querySelector<HTMLElement>('.jects-list__item[data-index="1"]')!;
    item.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0].id).toBe(2);
    l.destroy();
  });

  it('re-renders when the bound store changes', () => {
    const store = new Store({ data: makeData(3) });
    const l = new List(host, { store });
    expect(host.querySelectorAll('.jects-list__item').length).toBe(3);
    store.add({ id: 99, text: 'New' });
    expect(host.querySelectorAll('.jects-list__item').length).toBe(4);
    l.destroy();
  });

  it('tracks the active option via aria-activedescendant and keeps focus on the root', () => {
    const l = new List(host, { data: makeData(500), height: 200, itemSize: 36 });
    const root = host.querySelector<HTMLElement>('.jects-list')!;
    root.focus();
    // Keyboard nav updates aria-activedescendant on the always-present root and
    // never moves DOM focus onto a (virtualizable) option.
    root.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe(root);
    const activeId = root.getAttribute('aria-activedescendant');
    expect(activeId).toBeTruthy();
    expect(host.querySelector(`#${activeId}`)).toBeTruthy();
    l.destroy();
  });

  it('a window re-render on scroll does not drop focus off the root', () => {
    const l = new List(host, { data: makeData(500), height: 200, itemSize: 36 });
    const root = host.querySelector<HTMLElement>('.jects-list')!;
    root.focus();
    const vp = host.querySelector<HTMLElement>('.jects-list__viewport')!;
    vp.scrollTop = 4000;
    vp.dispatchEvent(new Event('scroll'));
    // Plain user scroll re-renders the window but must not move focus to <body>.
    expect(document.activeElement).toBe(root);
    l.destroy();
  });

  it('force-renders the active row even when scrolled out of the window', () => {
    const l = new List(host, { data: makeData(500), height: 200, itemSize: 36 });
    const root = host.querySelector<HTMLElement>('.jects-list')!;
    root.focus();
    for (let i = 0; i < 30; i++) {
      root.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    }
    // Now scroll back to the top: the active row (index 30) is out of the visual
    // window but its element must still exist for aria-activedescendant.
    const vp = host.querySelector<HTMLElement>('.jects-list__viewport')!;
    vp.scrollTop = 0;
    vp.dispatchEvent(new Event('scroll'));
    const activeId = root.getAttribute('aria-activedescendant');
    expect(host.querySelector(`#${activeId}`)).toBeTruthy();
    l.destroy();
  });

  it('destroy removes the element', () => {
    const l = new List(host, { data: makeData(3) });
    l.destroy();
    expect(host.querySelector('.jects-list')).toBeNull();
  });
});
