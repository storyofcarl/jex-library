/** jsdom unit test — runs in the default `pnpm test`. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Layout } from './layout.js';
import { Button } from '../button/button.js';

let host: HTMLElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  host.remove();
});

describe('Layout (jsdom)', () => {
  it('renders a center-only layout as a group with a center region', () => {
    const l = new Layout(host, { center: { content: '<p>main</p>' } });
    const el = host.querySelector('.jects-layout') as HTMLElement;
    expect(el.getAttribute('role')).toBe('group');
    const center = el.querySelector('.jects-layout__cell--center')!;
    expect(center.getAttribute('role')).toBe('region');
    expect(center.textContent).toContain('main');
    l.destroy();
  });

  it('builds nested splitters for present edge regions', () => {
    const l = new Layout(host, {
      north: { content: 'N' },
      west: { content: 'W' },
      center: { content: 'C' },
    });
    const el = host.querySelector('.jects-layout')!;
    expect(el.querySelectorAll('.jects-splitter').length).toBe(2); // north + west
    expect(el.querySelector('.jects-layout__cell--north')!.textContent).toBe('N');
    expect(el.querySelector('.jects-layout__cell--west')!.textContent).toBe('W');
    expect(el.querySelector('.jects-layout__cell--center')!.textContent).toBe('C');
    l.destroy();
  });

  it('mounts widget content into a cell and owns it', () => {
    const detached = document.createElement('div');
    const btn = new Button(detached, { text: 'In Cell' });
    const l = new Layout(host, { center: { content: btn } });
    expect(host.querySelector('.jects-layout__cell--center button.jects-btn')).toBeTruthy();
    l.destroy();
    expect(btn.isDestroyed).toBe(true);
  });

  it('collapse() hides the edge region and emits collapse', () => {
    const l = new Layout(host, { west: { content: 'W' }, center: { content: 'C' } });
    const spy = vi.fn();
    l.on('collapse', spy);
    l.collapse('west');
    expect(l.isCollapsed('west')).toBe(true);
    expect(host.querySelector('.jects-layout__cell--west')).toBeNull();
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ region: 'west' }));
    l.destroy();
  });

  it('beforeCollapse veto cancels collapsing', () => {
    const l = new Layout(host, { west: { content: 'W' }, center: { content: 'C' } });
    l.on('beforeCollapse', () => false);
    l.collapse('west');
    expect(l.isCollapsed('west')).toBe(false);
    expect(host.querySelector('.jects-layout__cell--west')).toBeTruthy();
    l.destroy();
  });

  it('expand() restores a collapsed region and emits expand', () => {
    const l = new Layout(host, {
      east: { content: 'E', collapsed: true },
      center: { content: 'C' },
    });
    expect(host.querySelector('.jects-layout__cell--east')).toBeNull();
    const spy = vi.fn();
    l.on('expand', spy);
    l.expand('east');
    expect(host.querySelector('.jects-layout__cell--east')).toBeTruthy();
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ region: 'east' }));
    l.destroy();
  });

  it('toggle() flips collapsed state', () => {
    const l = new Layout(host, { south: { content: 'S' }, center: { content: 'C' } });
    l.toggle('south');
    expect(l.isCollapsed('south')).toBe(true);
    l.toggle('south');
    expect(l.isCollapsed('south')).toBe(false);
    l.destroy();
  });

  it('re-emits a region resize when its splitter resizes', () => {
    const l = new Layout(host, { west: { content: 'W' }, center: { content: 'C' } });
    const spy = vi.fn();
    l.on('resize', spy);
    // The west splitter is the outermost; grab its widget via its handle and drive setRatio through keyboard.
    const handle = host.querySelector('.jects-splitter__handle') as HTMLElement;
    handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ region: 'west' }));
    l.destroy();
  });

  it('keeps a live content widget functional across re-renders (collapse/expand/update)', () => {
    const detached = document.createElement('div');
    const btn = new Button(detached, { text: 'Live' });
    const l = new Layout(host, {
      west: { content: 'W' },
      center: { content: btn },
    });
    expect(host.querySelector('.jects-layout__cell--center button.jects-btn')).toBeTruthy();

    // Each of these triggers a render(); none must destroy the center widget.
    l.collapse('west');
    expect(btn.isDestroyed).toBe(false);
    l.expand('west');
    expect(btn.isDestroyed).toBe(false);
    l.toggle('west');
    l.toggle('west');
    expect(btn.isDestroyed).toBe(false);
    l.update({});
    expect(btn.isDestroyed).toBe(false);

    // Still mounted, still the same element, still interactive.
    const mounted = host.querySelector('.jects-layout__cell--center button.jects-btn');
    expect(mounted).toBe(btn.el);
    expect(host.querySelector('.jects-layout__cell--west')).toBeTruthy();

    l.destroy();
    expect(btn.isDestroyed).toBe(true);
  });

  it('destroys a content widget when its region is removed from config', () => {
    const detached = document.createElement('div');
    const btn = new Button(detached, { text: 'East' });
    const l = new Layout(host, { east: { content: btn }, center: { content: 'C' } });
    expect(host.querySelector('.jects-layout__cell--east button.jects-btn')).toBeTruthy();
    // Replace east's content — the old widget must be torn down, not leaked.
    l.update({ east: { content: 'plain' } });
    expect(btn.isDestroyed).toBe(true);
    l.destroy();
  });

  it('destroy() removes element and disposes owned splitters/widgets', () => {
    const l = new Layout(host, { north: { content: 'N' }, center: { content: 'C' } });
    l.destroy();
    expect(host.querySelector('.jects-layout')).toBeNull();
    expect(host.querySelector('.jects-splitter')).toBeNull();
  });
});
