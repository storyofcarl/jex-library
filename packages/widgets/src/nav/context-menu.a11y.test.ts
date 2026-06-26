/**
 * axe-core a11y browser test for ContextMenu (real Chromium).
 * Run with `pnpm --filter @jects/widgets test:browser`.
 * Asserts zero serious/critical violations (Quality Gate Q2) when open, and
 * verifies focus is returned to the invoker on close (WCAG 2.4.3).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ContextMenu } from './context-menu.js';
import type { MenuItem } from './menu.js';
import { expectNoA11yViolations } from '../test-utils/a11y.js';

let host: HTMLElement;

const items: MenuItem[] = [
  { id: 'cut', text: 'Cut' },
  { id: 'copy', text: 'Copy' },
  { id: 'paste', text: 'Paste' },
];

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  host.remove();
});

describe('ContextMenu a11y (axe-core)', () => {
  it('has no serious/critical violations when open', async () => {
    const cm = new ContextMenu(host, { items, label: 'Edit actions' });
    cm.openAt(20, 20);
    await expectNoA11yViolations(document.body);
    cm.destroy();
  });

  it('returns focus to the invoking element on close', async () => {
    const trigger = document.createElement('button');
    trigger.textContent = 'Open';
    document.body.appendChild(trigger);
    trigger.focus();

    const cm = new ContextMenu(host, { items, label: 'Edit actions' });
    cm.openAt(20, 20);
    // Focus moved into the popup.
    expect(host.contains(document.activeElement) || cm.el.contains(document.activeElement)).toBe(true);
    cm.close('escape');
    expect(document.activeElement).toBe(trigger);

    cm.destroy();
    trigger.remove();
  });

  it('Escape closes the popup and restores focus', async () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();

    const cm = new ContextMenu(host, { items });
    cm.openAt(0, 0);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(cm.opened).toBe(false);
    expect(document.activeElement).toBe(trigger);

    cm.destroy();
    trigger.remove();
  });
});
