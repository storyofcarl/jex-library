/**
 * axe-core a11y browser test for Splitter (real Chromium).
 * Run with `pnpm --filter @jects/widgets test:browser`.
 * Asserts zero serious/critical violations (Quality Gate Q2).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Splitter } from './splitter.js';
import { expectNoA11yViolations } from '../test-utils/a11y.js';

let host: HTMLElement;

beforeEach(() => {
  host = document.createElement('div');
  host.style.width = '600px';
  host.style.height = '300px';
  document.body.appendChild(host);
});
afterEach(() => {
  host.remove();
});

describe('Splitter a11y (axe-core)', () => {
  it('has no serious/critical violations for a horizontal splitter', async () => {
    const s = new Splitter(host, {
      orientation: 'horizontal',
      first: '<p>Left</p>',
      second: '<p>Right</p>',
    });
    await expectNoA11yViolations(host);
    s.destroy();
  });

  it('has no serious/critical violations for a vertical splitter', async () => {
    const s = new Splitter(host, {
      orientation: 'vertical',
      first: '<p>Top</p>',
      second: '<p>Bottom</p>',
    });
    await expectNoA11yViolations(host);
    s.destroy();
  });

  it('has no serious/critical violations after a keyboard resize, and when disabled', async () => {
    const s = new Splitter(host, { first: '<p>A</p>', second: '<p>B</p>' });
    const handle = host.querySelector<HTMLElement>('.jects-splitter__handle')!;
    handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await expectNoA11yViolations(host);

    s.update({ disabled: true });
    expect(handle.getAttribute('aria-disabled')).toBe('true');
    await expectNoA11yViolations(host);
    s.destroy();
  });
});
