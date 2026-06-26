/**
 * axe-core a11y browser test for Rating (real Chromium).
 * Asserts zero serious/critical violations (Quality Gate Q2).
 * Run with `pnpm --filter @jects/widgets test:browser`.
 */
import { describe, it, beforeEach, afterEach } from 'vitest';
import { Rating } from './rating.js';
import { expectNoA11yViolations } from '../test-utils/a11y.js';

let host: HTMLElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  host.remove();
});

describe('Rating a11y (axe-core)', () => {
  it('has no serious/critical violations with a default rating', async () => {
    const r = new Rating(host, { max: 5, value: 3 });
    await expectNoA11yViolations(host);
    r.destroy();
  });

  it('has no serious/critical violations with an explicit label and half steps', async () => {
    const r = new Rating(host, { max: 5, value: 2.5, allowHalf: true, label: 'Quality' });
    await expectNoA11yViolations(host);
    r.destroy();
  });

  it('has no serious/critical violations when readonly', async () => {
    const r = new Rating(host, { max: 5, value: 4, readOnly: true });
    await expectNoA11yViolations(host);
    r.destroy();
  });
});
