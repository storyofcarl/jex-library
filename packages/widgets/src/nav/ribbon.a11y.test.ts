/**
 * axe-core a11y browser test for Ribbon (real Chromium).
 * Run with `pnpm --filter @jects/widgets test:browser`.
 * Asserts zero serious/critical violations (Quality Gate Q2) and verifies the
 * tablist roving tab stop survives a keyboard tab switch.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Ribbon, type RibbonTab } from './ribbon.js';
import { expectNoA11yViolations } from '../test-utils/a11y.js';

let host: HTMLElement;

const tabs: RibbonTab[] = [
  {
    id: 'home',
    text: 'Home',
    groups: [
      {
        title: 'Clipboard',
        commands: [
          { id: 'cut', text: 'Cut', icon: 'minus' },
          { id: 'copy', icon: 'plus', label: 'Copy' },
        ],
      },
    ],
  },
  {
    id: 'insert',
    text: 'Insert',
    groups: [
      {
        title: 'Media',
        commands: [{ id: 'image', text: 'Image' }],
      },
    ],
  },
];

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  host.remove();
});

describe('Ribbon a11y (axe-core)', () => {
  it('has no serious/critical violations on initial render', async () => {
    const r = new Ribbon(host, { tabs, label: 'Commands' });
    await expectNoA11yViolations(host);
    r.destroy();
  });

  it('keeps a single tablist roving tab stop after switching tabs', async () => {
    const r = new Ribbon(host, { tabs, label: 'Commands' });
    const first = host.querySelector('.jects-ribbon__tab') as HTMLElement;
    first.focus();
    first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    const tabbable = host.querySelectorAll('.jects-ribbon__tab[tabindex="0"]');
    expect(tabbable.length).toBe(1);
    expect(r.getActive()).toBe('insert');
    await expectNoA11yViolations(host);
    r.destroy();
  });
});
