/** jsdom unit test for Tree — render + interaction + emitted event. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TreeStore } from '@jects/core';
import { Tree } from './tree.js';

let host: HTMLElement;

const sampleData = () => [
  {
    id: 1,
    text: 'Root A',
    children: [
      { id: 2, text: 'Child A1' },
      { id: 3, text: 'Child A2' },
    ],
  },
  { id: 4, text: 'Root B' },
];

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  host.remove();
});

describe('Tree (jsdom)', () => {
  it('renders a tree with role and root nodes', () => {
    const t = new Tree(host, { data: sampleData() });
    const root = host.querySelector('.jects-tree')!;
    expect(root.getAttribute('role')).toBe('tree');
    const nodes = host.querySelectorAll('.jects-tree__node');
    // collapsed by default → only the two roots are visible
    expect(nodes.length).toBe(2);
    expect(root.textContent).toContain('Root A');
    t.destroy();
  });

  it('expands a node on twisty click revealing children + emits toggle', () => {
    const t = new Tree(host, { data: sampleData() });
    const spy = vi.fn();
    t.on('toggle', spy);
    const twisty = host.querySelector<HTMLElement>('[data-twisty="1"]')!;
    twisty.click();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0].expanded).toBe(true);
    expect(host.textContent).toContain('Child A1');
    t.destroy();
  });

  it('selects a node on click and emits select', () => {
    const t = new Tree(host, { data: sampleData() });
    const spy = vi.fn();
    t.on('select', spy);
    const node = host.querySelector<HTMLElement>('.jects-tree__node[data-id="4"]')!;
    node.click();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(t.getSelected()).toEqual([4]);
    expect(host.querySelector('.jects-tree__node[data-id="4"]')!.getAttribute('aria-selected')).toBe('true');
    t.destroy();
  });

  it('beforeSelect veto cancels selection', () => {
    const t = new Tree(host, { data: sampleData() });
    t.on('beforeSelect', () => false);
    host.querySelector<HTMLElement>('.jects-tree__node[data-id="4"]')!.click();
    expect(t.getSelected()).toEqual([]);
    t.destroy();
  });

  it('renders checkboxes and emits check', () => {
    const t = new Tree(host, { data: sampleData(), checkboxes: true });
    const spy = vi.fn();
    t.on('check', spy);
    host.querySelector<HTMLElement>('[data-check="4"]')!.click();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(t.getChecked()).toEqual([4]);
    t.destroy();
  });

  it('binds an external TreeStore', () => {
    const store = new TreeStore({ data: sampleData() });
    const t = new Tree(host, { store });
    expect(t.getStore()).toBe(store);
    t.destroy();
  });

  it('a focusable treeitem (tabindex=0) exists from the first render', () => {
    // Regression: the activeId field-initializer ordering bug previously left
    // every treeitem at tabindex=-1 on first paint.
    const t = new Tree(host, { data: sampleData() });
    expect(host.querySelectorAll('.jects-tree__node[tabindex="0"]').length).toBe(1);
    t.destroy();
  });

  it('lazy-load rejection is handled: emits error and reverts the half-expansion', async () => {
    const err = new Error('boom');
    const t = new Tree(host, {
      data: [{ id: 1, text: 'Lazy' }],
      loadChildren: () => Promise.reject(err),
    });
    const errors: unknown[] = [];
    t.on('error', (p) => {
      errors.push(p.err);
    });
    const toggleSpy = vi.fn();
    t.on('toggle', toggleSpy);

    const twisty = host.querySelector<HTMLElement>('[data-twisty="1"]')!;
    twisty.click();
    // Let the rejected loader settle without an unhandled rejection crashing.
    await new Promise((r) => setTimeout(r, 0));

    expect(errors).toEqual([err]);
    expect(toggleSpy).not.toHaveBeenCalled();
    // The node must NOT remain in a half-expanded state.
    expect(t.getStore().isExpanded(1)).toBe(false);
    t.destroy();
  });

  it('toggleNode after destroy does not emit or throw (use-after-destroy guard)', async () => {
    let resolve!: (children: { id: number; text: string }[]) => void;
    const t = new Tree(host, {
      data: [{ id: 1, text: 'Lazy' }],
      loadChildren: () =>
        new Promise<{ id: number; text: string }[]>((r) => {
          resolve = r;
        }),
    });
    const toggleSpy = vi.fn();
    t.on('toggle', toggleSpy);
    host.querySelector<HTMLElement>('[data-twisty="1"]')!.click();
    // Destroy while the loader is still in flight.
    t.destroy();
    resolve([{ id: 2, text: 'Child' }]);
    await new Promise((r) => setTimeout(r, 0));
    // No emit on a torn-down emitter, no render into a removed element.
    expect(toggleSpy).not.toHaveBeenCalled();
  });

  it('destroy removes the element', () => {
    const t = new Tree(host, { data: sampleData() });
    t.destroy();
    expect(host.querySelector('.jects-tree')).toBeNull();
  });
});
