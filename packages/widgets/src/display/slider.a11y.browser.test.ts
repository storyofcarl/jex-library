/**
 * axe-core a11y browser test for Slider (real Chromium).
 * Asserts zero serious/critical violations (Quality Gate Q2).
 * Run with `pnpm --filter @jects/widgets test:browser`.
 */
import { describe, it, beforeEach, afterEach } from 'vitest';
import { Slider } from './slider.js';
import { expectNoA11yViolations } from '../test-utils/a11y.js';

let host: HTMLElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  host.remove();
});

describe('Slider a11y (axe-core)', () => {
  it('has no serious/critical violations with a default (unlabeled) slider', async () => {
    const s = new Slider(host, { min: 0, max: 10, value: 5 });
    await expectNoA11yViolations(host);
    s.destroy();
  });

  it('has no serious/critical violations with an explicit label', async () => {
    const s = new Slider(host, { min: 0, max: 100, value: 40, label: 'Volume' });
    await expectNoA11yViolations(host);
    s.destroy();
  });

  it('has no serious/critical violations when disabled', async () => {
    const s = new Slider(host, { value: 3, disabled: true });
    await expectNoA11yViolations(host);
    s.destroy();
  });
});
