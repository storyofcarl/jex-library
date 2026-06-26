/**
 * axe-core accessibility test for Link (real Chromium via Vitest browser mode).
 * Run with `pnpm --filter @jects/widgets test:browser`.
 * Asserts zero serious/critical violations (Quality Gate Q2).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Link } from './link.js';
import { expectNoA11yViolations } from '../test-utils/a11y.js';

let host: HTMLElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  host.remove();
});

describe('Link a11y (axe-core)', () => {
  it('anchor with href has no serious/critical violations', async () => {
    const l = new Link(host, { text: 'Documentation', href: 'https://example.test/docs' });
    await expectNoA11yViolations(host);
    l.destroy();
  });

  it('new-tab link with rel is accessible', async () => {
    const l = new Link(host, { text: 'External', href: 'https://example.test', target: '_blank' });
    await expectNoA11yViolations(host);
    l.destroy();
  });

  it('disabled link is marked aria-disabled and is accessible', async () => {
    const l = new Link(host, { text: 'Unavailable', href: 'https://example.test', disabled: true });
    const a = host.querySelector('a') as HTMLAnchorElement;
    expect(a.getAttribute('aria-disabled')).toBe('true');
    expect(a.tabIndex).toBe(-1);
    await expectNoA11yViolations(host);
    l.destroy();
  });

  it('enabled hrefless link is NOT marked aria-disabled and is accessible', async () => {
    const l = new Link(host, { text: 'Activate', disabled: false });
    const a = host.querySelector('a') as HTMLAnchorElement;
    expect(a.hasAttribute('aria-disabled')).toBe(false);
    expect(a.tabIndex).toBe(0);
    await expectNoA11yViolations(host);
    l.destroy();
  });
});
