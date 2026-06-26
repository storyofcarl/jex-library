/**
 * axe-core a11y browser test for Menu (real Chromium).
 * Run with `pnpm --filter @jects/widgets test:browser`.
 * Asserts zero serious/critical violations (Quality Gate Q2), in both the
 * vertical `menu` and horizontal `menubar` variants, including an open submenu.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Menu, type MenuItem } from './menu.js';
import { expectNoA11yViolations } from '../test-utils/a11y.js';

let host: HTMLElement;

const items: MenuItem[] = [
  { id: 'new', text: 'New', icon: 'plus' },
  { id: 'open', text: 'Open' },
  { separator: true },
  { id: 'wrap', text: 'Word Wrap', checkable: true, checked: true },
  {
    id: 'recent',
    text: 'Recent',
    children: [
      { id: 'r1', text: 'File 1' },
      { id: 'r2', text: 'File 2' },
    ],
  },
  { id: 'gone', text: 'Disabled', disabled: true },
];

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  host.remove();
});

describe('Menu a11y (axe-core)', () => {
  it('has no serious/critical violations as a vertical menu', async () => {
    const m = new Menu(host, { items, label: 'File menu' });
    await expectNoA11yViolations(host);
    m.destroy();
  });

  it('has no serious/critical violations as a menubar', async () => {
    const m = new Menu(host, { items, variant: 'menubar', label: 'Main menu' });
    await expectNoA11yViolations(host);
    m.destroy();
  });

  it('keeps exactly one roving tab stop when a submenu is open and entered', async () => {
    const m = new Menu(host, { items, label: 'File menu' });
    (host.querySelector('[data-id="recent"]') as HTMLElement).click();
    m.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    const tabbable = host.querySelectorAll('.jects-menu__item[tabindex="0"]');
    expect(tabbable.length).toBe(1);
    await expectNoA11yViolations(host);
    m.destroy();
  });
});
