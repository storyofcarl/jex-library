/**
 * axe-core a11y browser test for Mask (Quality Gate Q2).
 * Run with `pnpm --filter @jects/widgets test:browser`.
 * Mounts the component in real Chromium and asserts zero serious/critical violations.
 */
import { describe, it, beforeEach, afterEach } from 'vitest';
import { Mask } from './mask.js';
import { expectNoA11yViolations } from '../test-utils/a11y.js';

let host: HTMLElement;

beforeEach(() => {
  host = document.createElement('div');
  host.style.position = 'relative';
  document.body.appendChild(host);
});
afterEach(() => {
  host.remove();
});

describe('Mask a11y (axe-core, real Chromium)', () => {
  it('visible mask with message has no serious/critical violations', async () => {
    const m = new Mask(host, { message: 'Loading…', spinner: true });
    await expectNoA11yViolations(document.body);
    m.destroy();
  });

  it('dismissible mask passes axe', async () => {
    const m = new Mask(host, { message: 'Saving…', dismissible: true });
    await expectNoA11yViolations(document.body);
    m.destroy();
  });
});
