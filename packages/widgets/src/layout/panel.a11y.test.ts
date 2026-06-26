/**
 * axe-core a11y browser test for Panel (real Chromium).
 * Run with `pnpm --filter @jects/widgets test:browser`.
 * Asserts zero serious/critical violations (Quality Gate Q2).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Panel } from './panel.js';
import { expectNoA11yViolations } from '../test-utils/a11y.js';

let host: HTMLElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  host.remove();
});

describe('Panel a11y (axe-core)', () => {
  it('has no serious/critical violations for a titled panel with body and footer', async () => {
    const p = new Panel(host, {
      title: 'Details',
      body: '<p>Body content</p>',
      footer: '<span>Footer</span>',
    });
    await expectNoA11yViolations(host);
    p.destroy();
  });

  it('has no serious/critical violations for a collapsible panel (expanded and collapsed)', async () => {
    const p = new Panel(host, {
      title: 'Section',
      collapsible: true,
      body: '<p>Collapsible body</p>',
    });
    await expectNoA11yViolations(host);
    // Collapse via the real toggle button and re-assert.
    host.querySelector<HTMLElement>('.jects-panel__toggle')!.click();
    expect(host.querySelector<HTMLElement>('.jects-panel__toggle')!.getAttribute('aria-expanded')).toBe('false');
    await expectNoA11yViolations(host);
    p.destroy();
  });

  it('has no serious/critical violations for a flat panel without a header', async () => {
    const p = new Panel(host, { flat: true, body: '<p>Just a body</p>' });
    await expectNoA11yViolations(host);
    p.destroy();
  });
});
