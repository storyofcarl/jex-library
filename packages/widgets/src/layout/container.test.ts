/** jsdom unit test — runs in the default `pnpm test`. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Container } from './container.js';
import '../button/button.js'; // registers 'button' for factory items

let host: HTMLElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  host.remove();
});

describe('Container (jsdom)', () => {
  it('renders a flex container with default modifiers', () => {
    const c = new Container(host);
    const el = host.querySelector('.jects-container') as HTMLElement;
    expect(el).toBeTruthy();
    expect(el.classList.contains('jects-container--flex')).toBe(true);
    expect(el.classList.contains('jects-container--row')).toBe(true);
    c.destroy();
  });

  it('applies grid layout with columns', () => {
    const c = new Container(host, { layout: 'grid', columns: 3 });
    const el = host.querySelector('.jects-container') as HTMLElement;
    expect(el.classList.contains('jects-container--grid')).toBe(true);
    expect(el.style.getPropertyValue('--_container-columns')).toBe('3');
    c.destroy();
  });

  it('maps numeric gap to a space token and align/justify to CSS values', () => {
    const c = new Container(host, { gap: 4, align: 'center', justify: 'between' });
    const el = host.querySelector('.jects-container') as HTMLElement;
    expect(el.style.getPropertyValue('--_container-gap')).toBe('var(--jects-space-4)');
    expect(el.style.getPropertyValue('--_container-align')).toBe('center');
    expect(el.style.getPropertyValue('--_container-justify')).toBe('space-between');
    c.destroy();
  });

  it('builds factory item configs as child widgets', () => {
    const c = new Container(host, {
      items: [{ type: 'button', text: 'One' }, { type: 'button', text: 'Two' }],
    });
    const el = host.querySelector('.jects-container')!;
    const buttons = el.querySelectorAll('button.jects-btn');
    expect(buttons.length).toBe(2);
    expect(c.getItems().length).toBe(2);
    c.destroy();
  });

  it('accepts raw HTML and element items', () => {
    const span = document.createElement('span');
    span.textContent = 'el';
    const c = new Container(host, { items: ['<b>html</b>', span] });
    const el = host.querySelector('.jects-container')!;
    expect(el.textContent).toContain('html');
    expect(el.contains(span)).toBe(true);
    c.destroy();
  });

  it('add() emits itemsChange and appends a widget', () => {
    const c = new Container(host);
    const spy = vi.fn();
    c.on('itemsChange', spy);
    const w = c.add({ type: 'button', text: 'Added' });
    expect(w).toBeTruthy();
    expect(c.getItems().length).toBe(1);
    expect(spy).toHaveBeenCalled();
    c.destroy();
  });

  it('sets role and aria-label', () => {
    const c = new Container(host, { role: 'toolbar', ariaLabel: 'Tools' });
    const el = host.querySelector('.jects-container') as HTMLElement;
    expect(el.getAttribute('role')).toBe('toolbar');
    expect(el.getAttribute('aria-label')).toBe('Tools');
    c.destroy();
  });

  it('destroy() removes element and disposes owned child widgets', () => {
    const c = new Container(host, { items: [{ type: 'button', text: 'X' }] });
    const child = c.getItems()[0]!;
    c.destroy();
    expect(host.querySelector('.jects-container')).toBeNull();
    expect(child.isDestroyed).toBe(true);
  });

  it('keeps imperatively added items after an unrelated update()', () => {
    const c = new Container(host, { items: [{ type: 'button', text: 'Seed' }] });
    c.add({ type: 'button', text: 'Added' });
    expect(c.getItems().length).toBe(2);
    expect(host.querySelectorAll('button.jects-btn').length).toBe(2);

    // An update unrelated to items must NOT drop the added item.
    c.update({ gap: 8 });
    expect(c.getItems().length).toBe(2);
    const buttons = host.querySelectorAll('button.jects-btn');
    expect(buttons.length).toBe(2);
    expect(Array.from(buttons).map((b) => b.textContent)).toEqual(['Seed', 'Added']);

    // Even update({}) keeps it.
    c.update({});
    expect(host.querySelectorAll('button.jects-btn').length).toBe(2);
    c.destroy();
  });

  it('update() rebuilds items without leaking old widgets', () => {
    const c = new Container(host, { items: [{ type: 'button', text: 'A' }] });
    const first = c.getItems()[0]!;
    c.update({ items: [{ type: 'button', text: 'B' }] });
    expect(first.isDestroyed).toBe(true);
    expect(c.getItems().length).toBe(1);
    expect(host.querySelectorAll('button.jects-btn').length).toBe(1);
    c.destroy();
  });
});
