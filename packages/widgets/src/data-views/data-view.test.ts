/** jsdom unit test for DataView — render + interaction + emitted event. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Store } from '@jects/core';
import { DataView } from './data-view.js';

let host: HTMLElement;

const makeData = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: i + 1, text: `Card ${i + 1}` }));

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  host.remove();
});

describe('DataView (jsdom)', () => {
  it('renders a responsive grid of cards', () => {
    const v = new DataView(host, { data: makeData(6) });
    const root = host.querySelector('.jects-dataview')!;
    expect(root.getAttribute('role')).toBe('listbox');
    const grid = host.querySelector<HTMLElement>('.jects-dataview__grid')!;
    expect(grid.style.gridTemplateColumns).toContain('auto-fill');
    expect(host.querySelectorAll('.jects-dataview__card').length).toBe(6);
    v.destroy();
  });

  it('shows the empty state', () => {
    const v = new DataView(host, { data: [], emptyText: 'Nothing' });
    expect(host.querySelector('.jects-dataview__empty')!.textContent).toBe('Nothing');
    v.destroy();
  });

  it('selects a card on click and emits select', () => {
    const v = new DataView(host, { data: makeData(4) });
    const spy = vi.fn();
    v.on('select', spy);
    host.querySelector<HTMLElement>('.jects-dataview__card[data-index="2"]')!.click();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(v.getSelected()).toEqual([3]);
    expect(
      host.querySelector('.jects-dataview__card[data-index="2"]')!.getAttribute('aria-selected'),
    ).toBe('true');
    v.destroy();
  });

  it('multi-selection toggles ids', () => {
    const v = new DataView(host, { data: makeData(4), selectionMode: 'multi' });
    host.querySelector<HTMLElement>('.jects-dataview__card[data-index="0"]')!.click();
    host.querySelector<HTMLElement>('.jects-dataview__card[data-index="1"]')!.click();
    expect(v.getSelected().sort()).toEqual([1, 2]);
    host.querySelector<HTMLElement>('.jects-dataview__card[data-index="0"]')!.click();
    expect(v.getSelected()).toEqual([2]);
    v.destroy();
  });

  it('beforeSelect veto cancels selection', () => {
    const v = new DataView(host, { data: makeData(4) });
    v.on('beforeSelect', () => false);
    host.querySelector<HTMLElement>('.jects-dataview__card[data-index="0"]')!.click();
    expect(v.getSelected()).toEqual([]);
    v.destroy();
  });

  it('uses a custom card template', () => {
    const v = new DataView(host, {
      data: makeData(2),
      cardTemplate: (r) => `<h4 class="ct">${(r as { text: string }).text}</h4>`,
    });
    expect(host.querySelector('.ct')!.textContent).toBe('Card 1');
    v.destroy();
  });

  it('emits activate on double-click', () => {
    const v = new DataView(host, { data: makeData(3) });
    const spy = vi.fn();
    v.on('activate', spy);
    host
      .querySelector<HTMLElement>('.jects-dataview__card[data-index="1"]')!
      .dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0].id).toBe(2);
    v.destroy();
  });

  it('re-renders when the bound store changes', () => {
    const store = new Store({ data: makeData(2) });
    const v = new DataView(host, { store });
    expect(host.querySelectorAll('.jects-dataview__card').length).toBe(2);
    store.add({ id: 9, text: 'New' });
    expect(host.querySelectorAll('.jects-dataview__card').length).toBe(3);
    v.destroy();
  });

  it('destroy removes the element', () => {
    const v = new DataView(host, { data: makeData(2) });
    v.destroy();
    expect(host.querySelector('.jects-dataview')).toBeNull();
  });
});
