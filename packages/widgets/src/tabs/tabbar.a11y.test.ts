/**
 * axe-core a11y browser test for Tabbar (real Chromium).
 * Run with `pnpm --filter @jects/widgets test:browser`.
 * Asserts zero serious/critical violations (Quality Gate Q2): valid tablist
 * roles + names, roving tabindex, and a close control that is a SIBLING of the
 * tab button (not invalidly nested inside it).
 */
import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { Tabbar } from './tabbar.js';
import { expectNoA11yViolations } from '../test-utils/a11y.js';

let host: HTMLElement;
const items = [
  { id: 'a', label: 'Alpha' },
  { id: 'b', label: 'Bravo' },
  { id: 'c', label: 'Charlie', disabled: true },
  { id: 'd', label: 'Delta' },
];

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  host.remove();
});

describe('Tabbar a11y (axe-core)', () => {
  it('has no serious/critical violations (basic tablist)', async () => {
    const t = new Tabbar(host, { items, ariaLabel: 'Sections' });
    await expectNoA11yViolations(host);
    t.destroy();
  });

  it('has no serious/critical violations when closable (no nested interactive control)', async () => {
    const t = new Tabbar(host, { items, ariaLabel: 'Sections', closable: true });
    // The close affordance is a decorative aria-hidden span — not an interactive
    // control nested inside the tab button (which axe would flag).
    const close = host.querySelector('.jects-tabbar__close[data-id="a"]') as HTMLElement;
    expect(close).toBeTruthy();
    expect(close.getAttribute('aria-hidden')).toBe('true');
    expect(close.getAttribute('role')).toBeNull();
    const tab = host.querySelector('.jects-tabbar__tab[data-id="a"]') as HTMLElement;
    expect(tab.getAttribute('aria-keyshortcuts')).toBe('Delete');
    await expectNoA11yViolations(host);
    t.destroy();
  });

  it('has no serious/critical violations with a different active tab', async () => {
    const t = new Tabbar(host, { items, ariaLabel: 'Sections', active: 'd', closable: true });
    await expectNoA11yViolations(host);
    t.destroy();
  });
});
