/**
 * axe-core a11y browser test for Sidebar (real Chromium).
 * Run with `pnpm --filter @jects/widgets test:browser`.
 * Asserts zero serious/critical violations (Quality Gate Q2), in expanded and
 * collapsed (mini) mode, and verifies the keyboard-reachable collapse toggle.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Sidebar, type SidebarItem } from './sidebar.js';
import { expectNoA11yViolations } from '../test-utils/a11y.js';

let host: HTMLElement;

const items: SidebarItem[] = [
  { id: 'home', text: 'Home', icon: 'chevron-right' },
  {
    id: 'lib',
    text: 'Library',
    icon: 'menu',
    children: [
      { id: 'books', text: 'Books' },
      { id: 'media', text: 'Media' },
    ],
  },
  { id: 'settings', text: 'Settings', icon: 'plus', badge: '3' },
];

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  host.remove();
});

describe('Sidebar a11y (axe-core)', () => {
  it('has no serious/critical violations (expanded)', async () => {
    const s = new Sidebar(host, { items, title: 'App', expanded: ['lib'], label: 'Primary' });
    await expectNoA11yViolations(host);
    s.destroy();
  });

  it('has no serious/critical violations (collapsed / mini mode)', async () => {
    // Icon-only items must still carry an accessible name in mini mode.
    const s = new Sidebar(host, { items, collapsed: true, label: 'Primary' });
    expect(host.querySelector('[data-id="home"]')!.getAttribute('aria-label')).toBe('Home');
    await expectNoA11yViolations(host);
    s.destroy();
  });

  it('the collapse toggle is keyboard-reachable and operable', async () => {
    const s = new Sidebar(host, { items, label: 'Primary' });
    const toggle = host.querySelector('[data-toggle="collapse"]') as HTMLButtonElement;
    expect(toggle.getAttribute('tabindex')).toBe('0');
    toggle.focus();
    expect(document.activeElement).toBe(toggle);
    toggle.click();
    expect(s.collapsed).toBe(true);
    await expectNoA11yViolations(host);
    s.destroy();
  });
});
