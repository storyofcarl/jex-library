/**
 * axe-core a11y browser test for Toolbar (real Chromium).
 * Run with `pnpm --filter @jects/widgets test:browser`.
 * Asserts zero serious/critical violations (Quality Gate Q2), including with the
 * overflow popup open, and verifies overflow dismissal + focus return.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Toolbar, type ToolbarItem } from './toolbar.js';
import { expectNoA11yViolations } from '../test-utils/a11y.js';

let host: HTMLElement;

const items: ToolbarItem[] = [
  { id: 'bold', icon: 'plus', label: 'Bold' },
  { id: 'italic', icon: 'minus', label: 'Italic' },
  { separator: true },
  { id: 'link', text: 'Link' },
];

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  host.remove();
});

describe('Toolbar a11y (axe-core)', () => {
  it('has no serious/critical violations (horizontal)', async () => {
    const t = new Toolbar(host, { items, label: 'Formatting' });
    await expectNoA11yViolations(host);
    t.destroy();
  });

  it('has no serious/critical violations (vertical)', async () => {
    const t = new Toolbar(host, { items, orientation: 'vertical', label: 'Formatting' });
    await expectNoA11yViolations(host);
    t.destroy();
  });

  it('has no serious/critical violations with the overflow menu open', async () => {
    const many: ToolbarItem[] = [
      { id: 'a', text: 'Action A' },
      { id: 'b', text: 'Action B' },
      { id: 'c', text: 'Action C' },
      { id: 'd', text: 'Action D' },
    ];
    const t = new Toolbar(host, { items: many, overflowAfter: 2, label: 'Formatting' });
    const trigger = t.getButton('__overflow')!;
    (trigger.el as HTMLButtonElement).click();
    await expectNoA11yViolations(host);
    t.destroy();
  });

  it('Escape closes the overflow menu and returns focus to the trigger', async () => {
    const many: ToolbarItem[] = [
      { id: 'a', text: 'Action A' },
      { id: 'b', text: 'Action B' },
      { id: 'c', text: 'Action C' },
    ];
    const t = new Toolbar(host, { items: many, overflowAfter: 2, label: 'Formatting' });
    const trigger = t.getButton('__overflow')!;
    (trigger.el as HTMLButtonElement).click();
    const menuHost = host.querySelector('.jects-toolbar__overflow-menu') as HTMLElement;
    expect(menuHost.hidden).toBe(false);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(menuHost.hidden).toBe(true);
    expect(trigger.el.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger.el);
    t.destroy();
  });
});
